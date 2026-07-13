#!/usr/bin/env node
/**
 * Watch Claude Desktop Cowork audit.jsonl files and drive Beacon status.
 * Hooks in ~/.claude/settings.json do not fire in Cowork; this is the fallback.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const SOURCE = "claude";
const APP_NAME = "Claude";
const BASE_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Claude",
  "local-agent-mode-sessions"
);
const SCAN_MS = 10_000;
const IDLE_MS = 120_000;

function looksLikeNeedsAction(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.trim();
  if (!t) return false;
  const tail = t.slice(-1200);
  if (/\?\s*$/m.test(tail)) return true;
  if ((tail.match(/\?/g) || []).length >= 2) return true;
  const patterns = [
    /\b(should i|shall i|do you want|would you like|want me to|can you confirm)\b/i,
    /\b(which (one|option|approach|path)|what would you|how would you like)\b/i,
    /\b(before (i|we) continue|let me know|your call|up to you)\b/i,
    /\b(pick one|choose one|reply with|tell me (if|whether|which))\b/i,
    /\b(are you (ok|okay|fine) with|does that work|sound good)\b/i,
    /\b(waiting (on|for) (you|your)|need (your|a) (decision|answer|choice))\b/i,
  ];
  return patterns.some((re) => re.test(tail));
}

function extractAssistantText(message) {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((b) => b && b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n");
}

function extractToolUses(message) {
  if (!message || !Array.isArray(message.content)) return [];
  return message.content
    .filter((b) => b && b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name || "" }));
}

function isToolResultUser(message) {
  const content = message && message.content;
  if (!Array.isArray(content) || !content.length) return false;
  return content.some((b) => b && b.type === "tool_result");
}

function stateFromAuditRow(row) {
  if (!row || !row.type) return null;

  if (row.type === "user") {
    if (isToolResultUser(row.message)) {
      return { state: "working" };
    }
    return { state: "working" };
  }

  if (row.type === "assistant") {
    const tools = extractToolUses(row.message);
    if (tools.some((t) => t.name === "AskUserQuestion")) {
      return { state: "action", label: "needs you" };
    }
    if (tools.length) {
      return { state: "working" };
    }
    const text = extractAssistantText(row.message);
    if (text && row.message && row.message.stop_reason) {
      const state = looksLikeNeedsAction(text) ? "action" : "done";
      return { state, label: state === "action" ? "needs you" : null };
    }
    if (text) return { state: "working" };
    return { state: "working" };
  }

  if (row.type === "tool_use" || row.type === "tool_result") {
    return { state: "working" };
  }

  if (row.type === "result") {
    const denied = Array.isArray(row.permission_denials) && row.permission_denials.length;
    const text = String(row.result || "");
    if (denied) {
      return { state: "action", label: "needs approval" };
    }
    const state = looksLikeNeedsAction(text) ? "action" : "done";
    return { state, label: state === "action" ? "needs you" : null };
  }

  if (row.type === "system") {
    return { state: "working" };
  }

  return null;
}

function walkAuditFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkAuditFiles(full, out);
    } else if (ent.isFile() && ent.name === "audit.jsonl") {
      out.push(full);
    }
  }
  return out;
}

function postStatus(port, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/status",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 2000,
      },
      (res) => {
        res.resume();
        resolve();
      }
    );
    req.on("error", () => resolve());
    req.on("timeout", () => {
      req.destroy();
      resolve();
    });
    req.end(data);
  });
}

function createClaudeDesktopWatcher(options = {}) {
  const port = Number(options.port || process.env.AGENT_BEACON_PORT || 17373);
  const onStatus =
    typeof options.onStatus === "function"
      ? options.onStatus
      : (body) => postStatus(port, body);

  /** @type {Map<string, { offset: number, sessionId: string | null }>} */
  const files = new Map();
  let watcher = null;
  let scanTimer = null;
  let idleTimer = null;
  let lastActivityAt = 0;
  let lastPostedState = null;
  let lastConversationId = null;
  let stopped = false;

  function bumpActivity() {
    lastActivityAt = Date.now();
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (stopped) return;
      if (Date.now() - lastActivityAt >= IDLE_MS) {
        emit({ state: "idle" });
      }
    }, IDLE_MS + 50);
  }

  async function emit(patch) {
    const state = patch.state;
    if (!state) return;
    const conversationId = patch.conversationId || null;
    if (
      state === lastPostedState &&
      conversationId === lastConversationId &&
      !patch.label
    ) {
      return;
    }
    lastPostedState = state;
    lastConversationId = conversationId;
    bumpActivity();
    await onStatus({
      state,
      source: SOURCE,
      app: APP_NAME,
      label: patch.label || null,
      conversationId: patch.conversationId || null,
    });
  }

  function tailFile(filePath) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }
    if (!stat.isFile()) return;

    let rec = files.get(filePath);
    if (!rec) {
      rec = { offset: stat.size, sessionId: null };
      files.set(filePath, rec);
      return;
    }

    if (stat.size < rec.offset) {
      rec.offset = 0;
    }
    if (stat.size <= rec.offset) return;

    let chunk;
    try {
      const fd = fs.openSync(filePath, "r");
      const len = stat.size - rec.offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, rec.offset);
      fs.closeSync(fd);
      chunk = buf.toString("utf8");
      rec.offset = stat.size;
    } catch {
      return;
    }

    const lines = chunk.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.session_id) rec.sessionId = row.session_id;
      const mapped = stateFromAuditRow(row);
      if (!mapped) continue;
      emit({
        state: mapped.state,
        label: mapped.label,
        conversationId: rec.sessionId,
      });
    }
  }

  function registerFiles() {
    for (const filePath of walkAuditFiles(BASE_DIR)) {
      if (!files.has(filePath)) {
        files.set(filePath, { offset: 0, sessionId: null });
        try {
          const size = fs.statSync(filePath).size;
          files.get(filePath).offset = size;
        } catch {
          // ignore
        }
      }
      tailFile(filePath);
    }
  }

  function onFsEvent(_event, filename) {
    if (stopped || !filename) return;
    if (!String(filename).includes("audit.jsonl")) return;
    const full = path.join(BASE_DIR, filename);
    tailFile(full);
  }

  function start() {
    if (process.platform !== "darwin") {
      return { ok: false, error: "Claude Desktop watcher is macOS only" };
    }
    if (stopped) stopped = false;
    registerFiles();

    try {
      if (fs.existsSync(BASE_DIR)) {
        watcher = fs.watch(BASE_DIR, { recursive: true }, onFsEvent);
        watcher.on("error", () => {
          // recursive watch can error; polling still runs
        });
      }
    } catch (err) {
      console.error("Claude Desktop watcher: fs.watch failed:", err.message);
    }

    scanTimer = setInterval(registerFiles, SCAN_MS);
    return { ok: true, files: files.size, baseDir: BASE_DIR };
  }

  function stop() {
    stopped = true;
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
      watcher = null;
    }
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  return { start, stop, BASE_DIR };
}

module.exports = {
  createClaudeDesktopWatcher,
  looksLikeNeedsAction,
  stateFromAuditRow,
  BASE_DIR,
};

if (require.main === module) {
  const watcher = createClaudeDesktopWatcher();
  const result = watcher.start();
  console.log(JSON.stringify(result, null, 2));
  process.on("SIGINT", () => {
    watcher.stop();
    process.exit(0);
  });
}
