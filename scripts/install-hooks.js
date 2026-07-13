#!/usr/bin/env node
/**
 * Install Beacon hooks for Cursor (and optionally Claude Code).
 *
 * Always installs into ~/.agent-beacon/hooks so paths work on any Mac,
 * whether you run from source or from a packaged .app.
 *
 * Usage:
 *   node scripts/install-hooks.js
 *   node scripts/install-hooks.js --claude
 *   BEACON_HOOKS_SOURCE=/path/to/hooks node scripts/install-hooks.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const CURSOR_HOOKS = path.join(os.homedir(), ".cursor", "hooks.json");
const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const INSTALL_DIR = path.join(os.homedir(), ".agent-beacon", "hooks");

function resolveSourceDir() {
  if (process.env.BEACON_HOOKS_SOURCE) {
    return path.resolve(process.env.BEACON_HOOKS_SOURCE);
  }
  // Packaged Electron: extraResources/hooks
  if (process.resourcesPath) {
    const packed = path.join(process.resourcesPath, "hooks");
    if (fs.existsSync(packed)) return packed;
  }
  return path.join(REPO_ROOT, "hooks");
}

const SOURCE_DIR = resolveSourceDir();

const HOOK_FILES = [
  "cursor-working.sh",
  "cursor-done.sh",
  "cursor-session.sh",
  "claude-working.sh",
  "claude-done.sh",
  "notify.sh",
  "notify-from-hook.js",
];

function ensureExecutable(file) {
  try {
    fs.chmodSync(file, 0o755);
  } catch {
    // ignore
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${file}.beacon-backup-${stamp}`;
    fs.copyFileSync(file, backup);
    console.log(`  backup → ${backup}`);
  }
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function syncHooksToInstallDir() {
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  for (const name of HOOK_FILES) {
    const src = path.join(SOURCE_DIR, name);
    const dest = path.join(INSTALL_DIR, name);
    if (!fs.existsSync(src)) {
      console.warn(`  skip missing ${name}`);
      continue;
    }
    fs.copyFileSync(src, dest);
    ensureExecutable(dest);
  }
  console.log(`✓ hooks copied → ${INSTALL_DIR}`);
  console.log(`  (source: ${SOURCE_DIR})`);
}

function upsertCursorHook(list, command) {
  const next = Array.isArray(list) ? [...list] : [];
  const abs = path.resolve(command);
  const filtered = next.filter((entry) => {
    if (!entry || typeof entry.command !== "string") return true;
    const cmd = entry.command;
    return (
      !cmd.includes("agent-beacon") &&
      !cmd.includes("Beacon/hooks/cursor-") &&
      !cmd.includes(".agent-beacon/hooks/cursor-")
    );
  });
  filtered.push({ command: abs });
  return filtered;
}

function installCursor() {
  const cursorWorking = path.join(INSTALL_DIR, "cursor-working.sh");
  const cursorDone = path.join(INSTALL_DIR, "cursor-done.sh");
  const cursorSession = path.join(INSTALL_DIR, "cursor-session.sh");

  const config = readJson(CURSOR_HOOKS, { version: 1, hooks: {} });
  config.version = config.version || 1;
  config.hooks = config.hooks || {};
  config.hooks.sessionStart = upsertCursorHook(
    config.hooks.sessionStart,
    cursorSession
  );
  config.hooks.beforeSubmitPrompt = upsertCursorHook(
    config.hooks.beforeSubmitPrompt,
    cursorWorking
  );
  config.hooks.stop = upsertCursorHook(config.hooks.stop, cursorDone);
  writeJson(CURSOR_HOOKS, config);
  console.log(`✓ Cursor hooks → ${CURSOR_HOOKS}`);
}

function upsertClaudeCommand(groups, command) {
  const abs = path.resolve(command);
  const next = Array.isArray(groups) ? [...groups] : [];
  const cleaned = next
    .map((group) => {
      if (!group || !Array.isArray(group.hooks)) return group;
      const hooks = group.hooks.filter((h) => {
        if (!h || typeof h.command !== "string") return true;
        return (
          !h.command.includes("agent-beacon") &&
          !h.command.includes("Beacon/hooks/claude-") &&
          !h.command.includes(".agent-beacon/hooks/claude-")
        );
      });
      return { ...group, hooks };
    })
    .filter((group) => group && Array.isArray(group.hooks) && group.hooks.length > 0);

  cleaned.push({
    hooks: [{ type: "command", command: abs }],
  });
  return cleaned;
}

function installClaude() {
  const claudeWorking = path.join(INSTALL_DIR, "claude-working.sh");
  const claudeDone = path.join(INSTALL_DIR, "claude-done.sh");
  const settings = readJson(CLAUDE_SETTINGS, {});
  settings.hooks = settings.hooks || {};
  settings.hooks.UserPromptSubmit = upsertClaudeCommand(
    settings.hooks.UserPromptSubmit,
    claudeWorking
  );
  settings.hooks.Stop = upsertClaudeCommand(settings.hooks.Stop, claudeDone);
  writeJson(CLAUDE_SETTINGS, settings);
  console.log(`✓ Claude Code hooks → ${CLAUDE_SETTINGS}`);
}

function main() {
  const args = new Set(process.argv.slice(2));
  const doCursor = args.size === 0 || args.has("--cursor") || args.has("--all");
  const doClaude = args.has("--claude") || args.has("--all");

  syncHooksToInstallDir();
  if (doCursor) installCursor();
  if (doClaude) installClaude();
  if (!doClaude) {
    console.log("(Claude Code hooks skipped — pass --claude to install)");
  }

  console.log("\nOn the other Mac:");
  console.log("  1. Open Beacon.app");
  console.log("  2. Menu bar icon → Install Cursor Hooks (or re-run this script)");
  console.log("  3. Reload Cursor hooks / restart Cursor");
}

if (require.main === module) {
  main();
}

module.exports = { main, syncHooksToInstallDir, INSTALL_DIR };
