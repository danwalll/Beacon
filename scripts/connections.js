#!/usr/bin/env node
/**
 * Multi-workflow connection manager for Beacon.
 * Connect / disconnect Cursor, Claude Code, Codex, and expose a generic HTTP recipe.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const INSTALL_DIR = path.join(os.homedir(), ".agent-beacon", "hooks");
const CURSOR_HOOKS = path.join(os.homedir(), ".cursor", "hooks.json");
const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const CODEX_HOOKS = path.join(os.homedir(), ".codex", "hooks.json");

const PROVIDERS = [
  {
    id: "cursor",
    name: "Cursor",
    blurb: "Your Cursor chats light up the orb when they’re working or done.",
    tip: "Restart Cursor once after turning this on.",
    focus: ["Cursor", "Cursor Nightly"],
    kind: "hooks",
  },
  {
    id: "codex",
    name: "ChatGPT",
    blurb: "Works with ChatGPT’s coding agent (Codex) on your Mac.",
    tip: "Quit and reopen ChatGPT. If asked, trust Beacon’s hooks.",
    focus: ["ChatGPT", "Codex", "Terminal", "iTerm2", "Warp"],
    kind: "hooks",
  },
  {
    id: "claude",
    name: "Claude",
    blurb: "Works with Claude Code on your Mac.",
    tip: "Restart Claude Code once after turning this on.",
    focus: ["Claude", "Claude Code", "Terminal", "iTerm2", "Warp", "Ghostty"],
    kind: "hooks",
  },
  {
    id: "http",
    name: "Something else",
    blurb: "For custom setups — usually you can ignore this.",
    tip: null,
    focus: [],
    kind: "http",
  },
];

function resolveSourceDir() {
  if (process.env.BEACON_HOOKS_SOURCE) {
    return path.resolve(process.env.BEACON_HOOKS_SOURCE);
  }
  if (process.resourcesPath) {
    const packed = path.join(process.resourcesPath, "hooks");
    if (fs.existsSync(packed)) return packed;
  }
  return path.join(__dirname, "..", "hooks");
}

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
    fs.copyFileSync(file, `${file}.beacon-backup-${stamp}`);
  }
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function syncHooks() {
  const source = resolveSourceDir();
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  const files = [
    "cursor-working.sh",
    "cursor-done.sh",
    "cursor-session.sh",
    "cursor-response.sh",
    "claude-working.sh",
    "claude-done.sh",
    "codex-working.sh",
    "codex-done.sh",
    "notify.sh",
    "notify-from-hook.js",
  ];
  for (const name of files) {
    const src = path.join(source, name);
    const dest = path.join(INSTALL_DIR, name);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, dest);
    ensureExecutable(dest);
  }
  return INSTALL_DIR;
}

function upsertCursorCommand(list, command) {
  const abs = path.resolve(command);
  const next = Array.isArray(list) ? [...list] : [];
  const filtered = next.filter((entry) => {
    if (!entry || typeof entry.command !== "string") return true;
    const cmd = entry.command;
    return (
      !cmd.includes(".agent-beacon/hooks/cursor-") &&
      !cmd.includes("nara-mock/hooks/cursor-") &&
      !cmd.includes("Beacon/hooks/cursor-")
    );
  });
  filtered.push({ command: abs });
  return filtered;
}

function removeCursorBeacon(list) {
  return (Array.isArray(list) ? list : []).filter((entry) => {
    if (!entry || typeof entry.command !== "string") return true;
    const cmd = entry.command;
    return (
      !cmd.includes(".agent-beacon/hooks/cursor-") &&
      !cmd.includes("Beacon/hooks/cursor-")
    );
  });
}

function isCursorConnected() {
  const config = readJson(CURSOR_HOOKS, { hooks: {} });
  const stop = config.hooks?.stop || [];
  return stop.some(
    (e) =>
      typeof e?.command === "string" &&
      e.command.includes(".agent-beacon/hooks/cursor-done")
  );
}

function connectCursor() {
  syncHooks();
  const config = readJson(CURSOR_HOOKS, { version: 1, hooks: {} });
  config.version = config.version || 1;
  config.hooks = config.hooks || {};
  config.hooks.sessionStart = upsertCursorCommand(
    config.hooks.sessionStart,
    path.join(INSTALL_DIR, "cursor-session.sh")
  );
  config.hooks.beforeSubmitPrompt = upsertCursorCommand(
    config.hooks.beforeSubmitPrompt,
    path.join(INSTALL_DIR, "cursor-working.sh")
  );
  config.hooks.afterAgentResponse = upsertCursorCommand(
    config.hooks.afterAgentResponse,
    path.join(INSTALL_DIR, "cursor-response.sh")
  );
  config.hooks.stop = upsertCursorCommand(
    config.hooks.stop,
    path.join(INSTALL_DIR, "cursor-done.sh")
  );
  writeJson(CURSOR_HOOKS, config);
  return { ok: true, path: CURSOR_HOOKS };
}

function disconnectCursor() {
  const config = readJson(CURSOR_HOOKS, { version: 1, hooks: {} });
  if (!config.hooks) return { ok: true };
  for (const key of [
    "sessionStart",
    "beforeSubmitPrompt",
    "afterAgentResponse",
    "stop",
  ]) {
    if (config.hooks[key]) {
      config.hooks[key] = removeCursorBeacon(config.hooks[key]);
      if (!config.hooks[key].length) delete config.hooks[key];
    }
  }
  writeJson(CURSOR_HOOKS, config);
  return { ok: true };
}

function upsertNestedCommand(groups, command) {
  const abs = path.resolve(command);
  const next = Array.isArray(groups) ? [...groups] : [];
  const cleaned = next
    .map((group) => {
      if (!group || !Array.isArray(group.hooks)) return group;
      const hooks = group.hooks.filter((h) => {
        if (!h || typeof h.command !== "string") return true;
        return !h.command.includes(".agent-beacon/hooks/");
      });
      return { ...group, hooks };
    })
    .filter((g) => g && Array.isArray(g.hooks) && g.hooks.length > 0);
  cleaned.push({ hooks: [{ type: "command", command: abs }] });
  return cleaned;
}

function removeNestedBeacon(groups) {
  return (Array.isArray(groups) ? groups : [])
    .map((group) => {
      if (!group || !Array.isArray(group.hooks)) return group;
      const hooks = group.hooks.filter(
        (h) =>
          !(
            typeof h?.command === "string" &&
            h.command.includes(".agent-beacon/hooks/")
          )
      );
      return { ...group, hooks };
    })
    .filter((g) => g && Array.isArray(g.hooks) && g.hooks.length > 0);
}

function isClaudeConnected() {
  const settings = readJson(CLAUDE_SETTINGS, {});
  const stop = settings.hooks?.Stop || [];
  return JSON.stringify(stop).includes(".agent-beacon/hooks/claude-done");
}

function connectClaude() {
  syncHooks();
  const settings = readJson(CLAUDE_SETTINGS, {});
  settings.hooks = settings.hooks || {};
  settings.hooks.UserPromptSubmit = upsertNestedCommand(
    settings.hooks.UserPromptSubmit,
    path.join(INSTALL_DIR, "claude-working.sh")
  );
  settings.hooks.Stop = upsertNestedCommand(
    settings.hooks.Stop,
    path.join(INSTALL_DIR, "claude-done.sh")
  );
  writeJson(CLAUDE_SETTINGS, settings);
  return { ok: true, path: CLAUDE_SETTINGS };
}

function disconnectClaude() {
  const settings = readJson(CLAUDE_SETTINGS, {});
  if (!settings.hooks) return { ok: true };
  for (const key of ["UserPromptSubmit", "Stop"]) {
    if (settings.hooks[key]) {
      settings.hooks[key] = removeNestedBeacon(settings.hooks[key]);
      if (!settings.hooks[key].length) delete settings.hooks[key];
    }
  }
  writeJson(CLAUDE_SETTINGS, settings);
  return { ok: true };
}

function isCodexConnected() {
  const hooks = readJson(CODEX_HOOKS, {});
  const stop = hooks.hooks?.Stop || [];
  return JSON.stringify(stop).includes(".agent-beacon/hooks/codex-done");
}

function connectCodex() {
  syncHooks();
  const hooks = readJson(CODEX_HOOKS, { hooks: {} });
  hooks.hooks = hooks.hooks || {};
  hooks.hooks.UserPromptSubmit = upsertNestedCommand(
    hooks.hooks.UserPromptSubmit,
    path.join(INSTALL_DIR, "codex-working.sh")
  );
  hooks.hooks.Stop = upsertNestedCommand(
    hooks.hooks.Stop,
    path.join(INSTALL_DIR, "codex-done.sh")
  );
  writeJson(CODEX_HOOKS, hooks);
  return { ok: true, path: CODEX_HOOKS };
}

function disconnectCodex() {
  const hooks = readJson(CODEX_HOOKS, { hooks: {} });
  if (!hooks.hooks) return { ok: true };
  for (const key of ["UserPromptSubmit", "Stop"]) {
    if (hooks.hooks[key]) {
      hooks.hooks[key] = removeNestedBeacon(hooks.hooks[key]);
      if (!hooks.hooks[key].length) delete hooks.hooks[key];
    }
  }
  writeJson(CODEX_HOOKS, hooks);
  return { ok: true };
}

function httpRecipe(port = 17373) {
  return {
    working: `curl -sS -X POST http://127.0.0.1:${port}/status -H 'Content-Type: application/json' -d '{"state":"working","source":"http","label":"my-tool"}'`,
    done: `curl -sS -X POST http://127.0.0.1:${port}/status -H 'Content-Type: application/json' -d '{"state":"done","source":"http","label":"my-tool"}'`,
    action: `curl -sS -X POST http://127.0.0.1:${port}/status -H 'Content-Type: application/json' -d '{"state":"action","source":"http","label":"my-tool"}'`,
  };
}

function likelyInstalled() {
  const appsDir = "/Applications";
  return {
    cursor:
      fs.existsSync(path.join(appsDir, "Cursor.app")) ||
      fs.existsSync(CURSOR_HOOKS),
    codex:
      fs.existsSync(path.join(appsDir, "ChatGPT.app")) ||
      fs.existsSync(CODEX_HOOKS),
    claude:
      fs.existsSync(CLAUDE_SETTINGS) ||
      fs.existsSync(path.join(appsDir, "Claude.app")),
  };
}

function listConnections(port = 17373) {
  const likely = likelyInstalled();
  const list = PROVIDERS.map((p) => {
    let connected = false;
    let detail = null;
    if (p.id === "cursor") {
      connected = isCursorConnected();
      detail = CURSOR_HOOKS;
    } else if (p.id === "claude") {
      connected = isClaudeConnected();
      detail = CLAUDE_SETTINGS;
    } else if (p.id === "codex") {
      connected = isCodexConnected();
      detail = CODEX_HOOKS;
    } else if (p.id === "http") {
      connected = true;
      detail = "Always available while Beacon is running";
    }
    const recommended =
      p.id !== "http" && !connected && Boolean(likely[p.id]);
    return {
      ...p,
      connected,
      recommended,
      detail,
      recipe: p.id === "http" ? httpRecipe(port) : null,
    };
  });

  const order = { cursor: 0, codex: 1, claude: 2, http: 9 };
  list.sort((a, b) => {
    if (a.id === "http") return 1;
    if (b.id === "http") return -1;
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    if (a.connected !== b.connected) return a.connected ? 1 : -1;
    return (order[a.id] ?? 5) - (order[b.id] ?? 5);
  });

  return list;
}

function connect(id) {
  syncHooks();
  if (id === "cursor") return connectCursor();
  if (id === "claude") return connectClaude();
  if (id === "codex") return connectCodex();
  if (id === "http") return { ok: true, note: "HTTP is always on" };
  return { ok: false, error: `unknown provider: ${id}` };
}

function disconnect(id) {
  if (id === "cursor") return disconnectCursor();
  if (id === "claude") return disconnectClaude();
  if (id === "codex") return disconnectCodex();
  if (id === "http") return { ok: true, note: "HTTP cannot be disconnected" };
  return { ok: false, error: `unknown provider: ${id}` };
}

function focusAppsFor(source) {
  const p = PROVIDERS.find((x) => x.id === source);
  return p?.focus || ["Cursor"];
}

module.exports = {
  PROVIDERS,
  listConnections,
  connect,
  disconnect,
  syncHooks,
  httpRecipe,
  focusAppsFor,
  INSTALL_DIR,
};

if (require.main === module) {
  const [cmd, id] = process.argv.slice(2);
  if (cmd === "list") {
    console.log(JSON.stringify(listConnections(), null, 2));
  } else if (cmd === "connect" && id) {
    console.log(JSON.stringify(connect(id), null, 2));
  } else if (cmd === "disconnect" && id) {
    console.log(JSON.stringify(disconnect(id), null, 2));
  } else {
    console.log("Usage: node connections.js <list|connect|disconnect> [id]");
    process.exit(1);
  }
}
