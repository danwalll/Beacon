#!/usr/bin/env node
/**
 * Read Cursor hook JSON from stdin and POST status to Beacon.
 * Usage: node notify-from-hook.js <working|done|session|response> <source>
 *
 * On stop/done: if the last agent message looks like a question / waiting
 * for the user, posts state "action" instead of "done".
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const os = require("os");

const stateArg = process.argv[2] || "done";
const source = (process.argv[3] || "cursor").toLowerCase();
const port = Number(process.env.AGENT_BEACON_PORT || 17373);
const BEACON_DIR = path.join(os.homedir(), ".agent-beacon");
const LAST_RESPONSE = path.join(BEACON_DIR, "last-response.txt");

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

function looksLikeNeedsAction(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.trim();
  if (!t) return false;

  // Focus on the tail — questions usually land at the end.
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

function readLastAssistantText(payload) {
  const direct =
    payload.last_assistant_message ||
    payload.text ||
    payload.message ||
    payload.response ||
    null;
  if (direct && String(direct).trim()) return String(direct);

  try {
    if (fs.existsSync(LAST_RESPONSE)) {
      const cached = fs.readFileSync(LAST_RESPONSE, "utf8");
      if (cached.trim()) return cached;
    }
  } catch {
    // ignore
  }

  const transcript =
    payload.transcript_path || process.env.CURSOR_TRANSCRIPT_PATH || null;
  if (!transcript || !fs.existsSync(transcript)) return "";

  try {
    const raw = fs.readFileSync(transcript, "utf8");
    // jsonl: walk backwards for last assistant-ish message
    const lines = raw.trim().split(/\n+/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const row = JSON.parse(lines[i]);
        const role = row.role || row.type || row.speaker || "";
        const content =
          row.content ||
          row.text ||
          row.message ||
          (typeof row.message === "object" && row.message?.content) ||
          "";
        const text = Array.isArray(content)
          ? content
              .map((c) => (typeof c === "string" ? c : c?.text || ""))
              .join("\n")
          : String(content || "");
        if (
          text &&
          (/assistant|ai|model|bot/i.test(String(role)) ||
            (!role && text.length > 40 && i === lines.length - 1))
        ) {
          if (
            /assistant|ai|model|bot/i.test(String(role)) ||
            i > lines.length - 4
          ) {
            if (text.trim()) return text;
          }
        }
        // fallback: last non-empty content field
        if (!role && text.trim().length > 20 && i === lines.length - 1) {
          return text;
        }
      } catch {
        // plain text line
        if (lines[i].length > 40) return lines[i];
      }
    }
    // last resort: last 800 chars of file
    return raw.slice(-800);
  } catch {
    return "";
  }
}

function cacheResponse(text) {
  try {
    fs.mkdirSync(BEACON_DIR, { recursive: true });
    fs.writeFileSync(LAST_RESPONSE, text || "", "utf8");
  } catch {
    // ignore
  }
}

(async () => {
  const payload = await readStdin();

  try {
    fs.mkdirSync(BEACON_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(BEACON_DIR, "last-hook.json"),
      `${JSON.stringify({ state: stateArg, source, payload, at: new Date().toISOString() }, null, 2)}\n`
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
    cacheResponse(String(text));
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

  // Stop/done → promote to "action" when the agent is clearly asking something
  if (state === "done") {
    const lastText = readLastAssistantText(payload);
    if (looksLikeNeedsAction(lastText)) {
      state = "action";
    }
  }

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
