#!/usr/bin/env node
/**
 * Read Cursor hook JSON from stdin and POST status to Beacon.
 * Usage: node notify-from-hook.js <working|done|session|response|action> <source>
 *
 * Stop/done always posts green (done). Red (action) only when a hook passes
 * state "action" explicitly (e.g. tool approval).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const os = require("os");

const stateArg = process.argv[2] || "done";
const port = Number(process.env.AGENT_BEACON_PORT || 17373);
const BEACON_DIR = path.join(os.homedir(), ".agent-beacon");

function lastResponsePath(source) {
  return path.join(BEACON_DIR, `last-response-${source}.txt`);
}

/** Host app from hook payload — not the AI model inside it. */
function resolveSource(declared, payload) {
  const d = String(declared || "cursor").toLowerCase();

  if (
    payload.cursor_version ||
    payload.composer_mode ||
    payload.hook_event_name === "beforeSubmitPrompt" ||
    payload.hook_event_name === "afterAgentResponse" ||
    payload.hook_event_name === "sessionStart" ||
    (typeof payload.transcript_path === "string" &&
      payload.transcript_path.includes("/.cursor/"))
  ) {
    return "cursor";
  }

  return d;
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve({});
    const chunks = [];
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    };
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", done);
    process.stdin.on("error", done);
    setTimeout(done, 1500);
  });
}

function post(body) {
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

function detectSurface() {
  try {
    const out = execFileSync(
      "/usr/bin/swift",
      [
        "-e",
        `
import CoreGraphics
let opts = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { print("unknown"); exit(0) }
var bestLayer = Int.max
var bestName = ""
for w in info {
  let owner = w[kCGWindowOwnerName as String] as? String ?? ""
  guard owner == "Cursor" else { continue }
  let name = (w[kCGWindowName as String] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  let layer = w[kCGWindowLayer as String] as? Int ?? 0
  if layer <= bestLayer {
    bestLayer = layer
    if !name.isEmpty { bestName = name }
  }
}
if bestName.localizedCaseInsensitiveContains("Agents Window") {
  print("agents")
} else if bestName.isEmpty {
  print("unknown")
} else {
  print("editor")
}
`,
      ],
      { timeout: 1500, encoding: "utf8" }
    );
    const v = String(out).trim();
    if (v === "agents" || v === "editor") return v;
  } catch {
    // ignore
  }
  return "unknown";
}

function cacheResponse(text, source) {
  try {
    fs.mkdirSync(BEACON_DIR, { recursive: true });
    fs.writeFileSync(lastResponsePath(source), text || "", "utf8");
  } catch {
    // ignore
  }
}

(async () => {
  const payload = await readStdin();
  const declared = (process.argv[3] || "cursor").toLowerCase();
  const source = resolveSource(declared, payload);

  try {
    fs.mkdirSync(BEACON_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(BEACON_DIR, "last-hook.json"),
      `${JSON.stringify({ state: stateArg, source, declared, payload, at: new Date().toISOString() }, null, 2)}\n`
    );
  } catch {
    // ignore
  }

  // Cache assistant text from afterAgentResponse for the following stop hook
  if (stateArg === "response") {
    const text =
      payload.text ||
      payload.last_assistant_message ||
      payload.message ||
      "";
    cacheResponse(String(text), source);
    // Don't change beacon color on every partial response — wait for stop.
    if (source === "cursor") process.stdout.write("{}\n");
    process.exit(0);
  }

  const workspaceRoot = Array.isArray(payload.workspace_roots)
    ? payload.workspace_roots[0]
    : payload.cwd || process.env.CURSOR_PROJECT_DIR || null;

  const conversationId =
    payload.conversation_id ||
    payload.session_id ||
    payload.composer_id ||
    null;

  const composerMode = payload.composer_mode || null;
  const workspaceLabel = workspaceRoot
    ? path.basename(workspaceRoot)
    : null;

  let state =
    stateArg === "session"
      ? "working"
      : stateArg === "working" ||
          stateArg === "done" ||
          stateArg === "idle" ||
          stateArg === "action"
        ? stateArg
        : "done";

  const surface = detectSurface();
  const labelParts = [];
  if (workspaceLabel) labelParts.push(workspaceLabel);
  if (composerMode) labelParts.push(composerMode);
  if (state === "action") labelParts.push("needs you");
  if (surface === "agents") labelParts.push("agents");
  if (surface === "editor") labelParts.push("editor");

  await post({
    state,
    source,
    app:
      source === "claude"
        ? "Claude"
        : source === "codex"
          ? "Codex"
          : source === "http"
            ? "Custom"
            : "Cursor",
    label: labelParts.join(" · ") || composerMode || workspaceLabel,
    conversationId,
    workspaceRoot,
    composerMode,
    surface,
    hookEvent: payload.hook_event_name || stateArg,
  });

  if (source === "cursor") {
    process.stdout.write("{}\n");
  }
  process.exit(0);
})();
