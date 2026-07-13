#!/usr/bin/env node
/**
 * Read Cursor hook JSON from stdin and POST status to Agent Beacon.
 * Usage: node notify-from-hook.js <working|done|session> <source>
 *
 * Automatically rebinds the beacon to whichever conversation just
 * started / received a prompt / finished — so switching Agents Window
 * ↔ Editor ↔ chats stays seamless.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const stateArg = process.argv[2] || "done";
const source = (process.argv[3] || "cursor").toLowerCase();
const port = Number(process.env.AGENT_BEACON_PORT || 17373);

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

/** Best-effort: which Cursor surface looks frontmost right now. */
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

(async () => {
  const payload = await readStdin();

  try {
    const debugDir = path.join(require("os").homedir(), ".agent-beacon");
    fs.mkdirSync(debugDir, { recursive: true });
    fs.writeFileSync(
      path.join(debugDir, "last-hook.json"),
      `${JSON.stringify({ state: stateArg, source, payload, at: new Date().toISOString() }, null, 2)}\n`
    );
  } catch {
    // ignore
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

  // sessionStart maps to working so a brand-new chat is already bound
  const state =
    stateArg === "session"
      ? "working"
      : stateArg === "working" || stateArg === "done" || stateArg === "idle"
        ? stateArg
        : "done";

  const surface = detectSurface();
  const labelParts = [];
  if (workspaceLabel) labelParts.push(workspaceLabel);
  if (composerMode) labelParts.push(composerMode);
  if (surface === "agents") labelParts.push("agents");
  if (surface === "editor") labelParts.push("editor");

  await post({
    state,
    source,
    app: source === "claude" ? "Claude" : "Cursor",
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
