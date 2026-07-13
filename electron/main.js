const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  dialog,
  nativeImage,
  shell,
  screen,
  ipcMain,
} = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.AGENT_BEACON_PORT || 17373);
const HOST = "127.0.0.1";
const SIZE = 72;

/** @type {{ state: 'idle' | 'working' | 'action' | 'done', source: string | null, app: string | null, label: string | null, conversationId: string | null, workspaceRoot: string | null, surface: 'agents' | 'editor' | 'unknown' | null, composerMode: string | null, updatedAt: string }} */
let status = {
  state: "idle",
  source: null,
  app: null,
  label: null,
  conversationId: null,
  workspaceRoot: null,
  surface: null,
  composerMode: null,
  updatedAt: new Date().toISOString(),
};

/** Recent sessions keyed by conversationId — lets focus follow whichever chat last spoke. */
/** @type {Map<string, typeof status>} */
const sessions = new Map();

/** @type {{ x: number | null, y: number | null, launchAtLogin: boolean, sound: boolean, notify: boolean, focusPreference: 'auto' | 'agents' | 'editor', setupComplete: boolean }} */
let prefs = {
  x: null,
  y: null,
  launchAtLogin: false,
  sound: true,
  notify: true,
  focusPreference: "auto",
  setupComplete: false,
};

/** @type {Set<import('http').ServerResponse>} */
const sseClients = new Set();

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
/** @type {import('http').Server | null} */
let server = null;

const APP_BUNDLES = {
  cursor: ["Cursor", "Cursor Nightly"],
  claude: ["Claude", "Claude Code"],
};

function prefsPath() {
  return path.join(app.getPath("userData"), "prefs.json");
}

function loadPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath(), "utf8"));
    prefs = {
      x: Number.isFinite(raw.x) ? raw.x : null,
      y: Number.isFinite(raw.y) ? raw.y : null,
      launchAtLogin: Boolean(raw.launchAtLogin),
      sound: raw.sound !== false,
      notify: raw.notify !== false,
      focusPreference: ["auto", "agents", "editor"].includes(raw.focusPreference)
        ? raw.focusPreference
        : "auto",
      setupComplete: Boolean(raw.setupComplete),
    };
  } catch {
    // first run
  }
}

function savePrefs() {
  try {
    fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
    fs.writeFileSync(prefsPath(), `${JSON.stringify(prefs, null, 2)}\n`);
  } catch (err) {
    console.error("Failed to save prefs:", err);
  }
}

function installHooksFromApp({ silent = false } = {}) {
  try {
    const source = app.isPackaged
      ? path.join(process.resourcesPath, "hooks")
      : path.join(__dirname, "..", "hooks");
    const installer = app.isPackaged
      ? path.join(process.resourcesPath, "install-hooks.js")
      : path.join(__dirname, "..", "scripts", "install-hooks.js");

    process.env.BEACON_HOOKS_SOURCE = source;
    try {
      delete require.cache[require.resolve(installer)];
    } catch {
      delete require.cache[installer];
    }
    const mod = require(installer);
    if (typeof mod.main === "function") {
      mod.main();
    }
    if (!silent) {
      dialog.showMessageBox({
        type: "info",
        title: "Beacon",
        message: "Cursor hooks installed",
        detail:
          "Hooks were copied to ~/.agent-beacon/hooks and registered in ~/.cursor/hooks.json.\n\nReload Cursor hooks (or restart Cursor), then keep Beacon running.",
      });
    }
    return { ok: true };
  } catch (err) {
    if (!silent) {
      dialog.showErrorBox(
        "Hook install failed",
        String(err && err.message ? err.message : err)
      );
    }
    return { ok: false, error: String(err) };
  }
}

async function runFirstLaunchSetup() {
  if (!app.isPackaged || prefs.setupComplete) return;

  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "Welcome to Beacon",
    message: "Set up Beacon in one step?",
    detail:
      "Beacon will:\n" +
      "• Connect to Cursor (install hooks)\n" +
      "• Start automatically at login\n" +
      "• Sit on top of your desktop and turn green when an agent finishes\n\n" +
      "After setup, restart Cursor once. If macOS asks for Accessibility later, allow Beacon so click-to-focus works.",
    buttons: ["Set up now", "Skip for now"],
    defaultId: 0,
    cancelId: 1,
  });

  prefs.setupComplete = true;
  savePrefs();

  if (response !== 0) return;

  const hooks = installHooksFromApp({ silent: true });
  prefs.launchAtLogin = true;
  savePrefs();
  applyLoginItem();

  await dialog.showMessageBox({
    type: hooks.ok ? "info" : "warning",
    title: "Beacon",
    message: hooks.ok ? "You're set" : "Almost set",
    detail: hooks.ok
      ? "1. Restart Cursor (or reload hooks)\n2. Keep Beacon running in the menu bar\n3. When an agent finishes, the orb turns green — click it to jump back\n\nMenu bar icon → Install Cursor Hooks if you ever need to reconnect."
      : `Hooks could not be installed automatically:\n${hooks.error || "unknown error"}\n\nUse the menu bar icon → Install Cursor Hooks.`,
  });
}

function applyLoginItem() {
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: prefs.launchAtLogin,
        openAsHidden: true,
      });
    } else {
      app.setLoginItemSettings({
        openAtLogin: prefs.launchAtLogin,
        openAsHidden: true,
        path: process.execPath,
        args: [path.resolve(__dirname, "..")],
      });
    }
  } catch (err) {
    console.error("Failed to set login item:", err);
  }
}

function defaultPosition() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workArea;
  return {
    x: display.workArea.x + width - SIZE - 28,
    y: display.workArea.y + Math.round(height * 0.35),
  };
}

function clampToVisible(x, y) {
  const displays = screen.getAllDisplays();
  for (const d of displays) {
    const a = d.workArea;
    if (
      x + SIZE > a.x &&
      x < a.x + a.width &&
      y + SIZE > a.y &&
      y < a.y + a.height
    ) {
      return {
        x: Math.min(Math.max(x, a.x), a.x + a.width - SIZE),
        y: Math.min(Math.max(y, a.y), a.y + a.height - SIZE),
      };
    }
  }
  return defaultPosition();
}

function notifyAttention(kind) {
  if (!prefs.notify) return;
  if (!Notification.isSupported()) return;
  const isAction = kind === "action";
  const n = new Notification({
    title: isAction ? "Beacon — needs you" : "Cursor agent finished",
    body: isAction
      ? "The agent asked a question or needs a decision. Click to jump back."
      : status.label
        ? `${status.label} is done — click the beacon to jump back.`
        : "Click the beacon to jump back to this Cursor chat.",
    silent: true,
  });
  n.on("click", async () => {
    await activateApp("cursor");
    setStatus({ state: "idle" });
  });
  n.show();
}

function playAttentionSound(kind) {
  if (!prefs.sound) return;
  const sound =
    kind === "action"
      ? "/System/Library/Sounds/Purr.aiff"
      : "/System/Library/Sounds/Glass.aiff";
  execFile("afplay", [sound], () => {});
}

function broadcast() {
  const payload = `data: ${JSON.stringify(status)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
  if (win && !win.isDestroyed()) {
    win.webContents.send("status", status);
  }
  updateTray();
}

function setStatus(next) {
  const prev = status.state;
  const state = String(next.state || "idle").toLowerCase();
  if (!["idle", "working", "action", "done"].includes(state)) {
    return { ok: false, error: "state must be idle, working, action, or done" };
  }

  const source = next.source
    ? String(next.source).toLowerCase()
    : status.source;
  const appName =
    next.app != null
      ? String(next.app)
      : source === "claude"
        ? "Claude"
        : source === "cursor"
          ? "Cursor"
          : status.app;

  const surfaceRaw = next.surface != null ? String(next.surface) : status.surface;
  const surface =
    surfaceRaw === "agents" || surfaceRaw === "editor" || surfaceRaw === "unknown"
      ? surfaceRaw
      : status.surface;

  status = {
    state,
    source: source || null,
    app: appName || null,
    label:
      next.label != null
        ? String(next.label)
        : next.label === null
          ? null
          : status.label,
    conversationId:
      next.conversationId != null
        ? String(next.conversationId)
        : next.conversationId === null
          ? null
          : status.conversationId,
    workspaceRoot:
      next.workspaceRoot != null
        ? String(next.workspaceRoot)
        : next.workspaceRoot === null
          ? null
          : status.workspaceRoot,
    surface: surface || null,
    composerMode:
      next.composerMode != null
        ? String(next.composerMode)
        : next.composerMode === null
          ? null
          : status.composerMode,
    updatedAt: new Date().toISOString(),
  };

  if (status.conversationId) {
    sessions.set(status.conversationId, { ...status });
    // Cap memory
    if (sessions.size > 40) {
      const first = sessions.keys().next().value;
      sessions.delete(first);
    }
  }

  broadcast();

  if (
    (state === "done" && prev !== "done") ||
    (state === "action" && prev !== "action")
  ) {
    playAttentionSound(state);
    notifyAttention(state);
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(true, "screen-saver");
      win.showInactive();
    }
  }

  return { ok: true, status, sessions: sessions.size };
}

function focusHintsForStatus(s) {
  const workspace = s.workspaceRoot || path.resolve(__dirname, "..");
  const base = path.basename(workspace);
  const agentsFirst = [
    "Agents Window",
    s.label,
    "Beacon",
    base,
  ];
  const editorFirst = [
    base,
    s.label,
    "Beacon",
    "Agents Window",
  ];

  const pref = prefs.focusPreference || "auto";
  if (pref === "agents") return agentsFirst;
  if (pref === "editor") return editorFirst;
  if (s.surface === "agents") return agentsFirst;
  if (s.surface === "editor") return editorFirst;
  // auto + unknown: Agents Window first (your usual surface), then editor
  return agentsFirst;
}

/** Prevent stacked focus clicks from activating repeatedly. */
let focusInFlight = false;
let focusInFlightUntil = 0;

async function focusCursorWindow(hints) {
  const cleaned = [...new Set((hints || []).filter(Boolean).map(String))];
  if (!cleaned.length) return { ok: false, reason: "no hints" };

  const hintList = cleaned
    .map((h) => h.replace(/\\/g, "\\\\").replace(/"/g, '\\"'))
    .map((h) => `"${h}"`)
    .join(", ");

  // Raise an existing Cursor window — never create one.
  // Prefer Agents Window (Glass), then chat/workspace title hints.
  const script = `
    set hints to {${hintList}}
    tell application "System Events"
      if not (exists process "Cursor") then return "missing"
      tell process "Cursor"
        set frontmost to true
        set wins to every window
        repeat with hint in hints
          set hintText to hint as text
          repeat with w in wins
            try
              set winName to name of w as text
              if winName contains hintText then
                perform action "AXRaise" of w
                try
                  set value of attribute "AXMain" of w to true
                end try
                return winName
              end if
            end try
          end repeat
        end repeat
        -- Fallback: raise the first real window (often Agents Window when that's all you use)
        if (count of wins) > 0 then
          try
            set w to item 1 of wins
            perform action "AXRaise" of w
            return name of w as text
          end try
        end if
      end tell
    end tell
    return "no-match"
  `;

  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    return { ok: true, matched: String(stdout).trim() };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.stderr ? err.stderr : err.message || err),
    };
  }
}

async function activateApp(preferred) {
  const now = Date.now();
  if (focusInFlight || now < focusInFlightUntil) {
    return { ok: true, debounced: true };
  }
  focusInFlight = true;
  focusInFlightUntil = now + 2000;

  try {
    const source = (preferred || status.source || "cursor").toLowerCase();

    // Clear attention states immediately so extra clicks don't re-fire focus.
    if (status.state === "done" || status.state === "action") {
      setStatus({ state: "idle" });
    }

    if (source === "cursor" || source === "Cursor") {
      const workspace =
        status.workspaceRoot || path.resolve(__dirname, "..");
      const hints = focusHintsForStatus(status);

      // IMPORTANT: only activate the already-running Cursor app.
      // Never `cursor -r <path>` / `open -a Cursor <path>` — that spawns new IDE windows.
      try {
        await execFileAsync("osascript", [
          "-e",
          'tell application "Cursor" to activate',
        ]);
      } catch {
        await execFileAsync("open", ["-a", "Cursor"]);
      }

      const raised = await focusCursorWindow(hints);
      return {
        ok: true,
        app: "Cursor",
        target: status.surface || prefs.focusPreference || "auto",
        workspace,
        conversationId: status.conversationId,
        window: raised,
        hints,
      };
    }

    if (source === "claude") {
      for (const name of APP_BUNDLES.claude) {
        try {
          await execFileAsync("osascript", [
            "-e",
            `tell application "${name}" to activate`,
          ]);
          return { ok: true, app: name };
        } catch {
          // try next
        }
      }
      try {
        await execFileAsync("open", ["-a", "Claude"]);
        return { ok: true, app: "Claude", via: "open" };
      } catch (err) {
        return {
          ok: false,
          error: String(err && err.message ? err.message : err),
        };
      }
    }

    return { ok: false, error: `unknown source: ${source}` };
  } finally {
    focusInFlight = false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

function createServer() {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, port: PORT });
        return;
      }

      if (req.method === "GET" && url.pathname === "/status") {
        sendJson(res, 200, status);
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        res.write(`data: ${JSON.stringify(status)}\n\n`);
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      if (req.method === "POST" && url.pathname === "/status") {
        const body = await readBody(req);
        const result = setStatus(body);
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/focus") {
        const body = await readBody(req).catch(() => ({}));
        const result = await activateApp(body.source || body.app || "cursor");
        sendJson(res, result.ok ? 200 : 500, result);
        return;
      }

      if (req.method === "POST" && url.pathname === "/ack") {
        setStatus({ state: "idle" });
        sendJson(res, 200, { ok: true, status });
        return;
      }

      sendJson(res, 404, { ok: false, error: "not found" });
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: String(err && err.message ? err.message : err),
      });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, () => resolve(undefined));
  });
}

function createWindow() {
  const fallback = defaultPosition();
  const pos =
    prefs.x != null && prefs.y != null
      ? clampToVisible(prefs.x, prefs.y)
      : fallback;

  win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    focusable: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (typeof win.setExcludedFromShownWindowsMenu === "function") {
    win.setExcludedFromShownWindowsMenu(true);
  }

  win.loadFile(path.join(__dirname, "..", "ui", "index.html"));
  win.once("ready-to-show", () => {
    if (win && !win.isDestroyed()) {
      win.showInactive();
    }
  });

  let moveTimer = null;
  win.on("moved", () => {
    if (!win || win.isDestroyed()) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const [x, y] = win.getPosition();
      prefs.x = x;
      prefs.y = y;
      savePrefs();
    }, 200);
  });

  win.on("closed", () => {
    win = null;
  });
}

function trayIcon(state) {
  const colors = {
    idle: "#6B7280",
    working: "#D97706",
    action: "#E11D48",
    done: "#10B981",
  };
  const color = colors[state] || colors.idle;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="${color}"/></svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
  );
}

function updateTray() {
  if (!tray) return;
  tray.setImage(trayIcon(status.state));
  const label =
    status.state === "working"
      ? `Working${status.source ? ` · ${status.source}` : ""}`
      : status.state === "action"
        ? `Needs you${status.source ? ` · ${status.source}` : ""} — click to answer`
        : status.state === "done"
          ? `Done${status.source ? ` · ${status.source}` : ""} — click to focus`
          : "Idle";
  tray.setToolTip(`Beacon — ${label}`);
  tray.setContextMenu(buildTrayMenu());
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: `State: ${status.state}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Mark Working",
      click: () =>
        setStatus({ state: "working", source: status.source || "cursor" }),
    },
    {
      label: "Mark Needs You (question)",
      click: () =>
        setStatus({ state: "action", source: status.source || "cursor" }),
    },
    {
      label: "Mark Done",
      click: () =>
        setStatus({ state: "done", source: status.source || "cursor" }),
    },
    {
      label: "Mark Idle",
      click: () => setStatus({ state: "idle" }),
    },
    { type: "separator" },
    {
      label: "Focus Agents Window",
      click: async () => {
        await activateApp("cursor");
      },
    },
    {
      label: "Focus Preference",
      submenu: [
        {
          label: "Auto (detect Agents vs Editor)",
          type: "radio",
          checked: prefs.focusPreference === "auto",
          click: () => {
            prefs.focusPreference = "auto";
            savePrefs();
            updateTray();
          },
        },
        {
          label: "Prefer Agents Window",
          type: "radio",
          checked: prefs.focusPreference === "agents",
          click: () => {
            prefs.focusPreference = "agents";
            savePrefs();
            updateTray();
          },
        },
        {
          label: "Prefer Editor Window",
          type: "radio",
          checked: prefs.focusPreference === "editor",
          click: () => {
            prefs.focusPreference = "editor";
            savePrefs();
            updateTray();
          },
        },
      ],
    },
    { type: "separator" },
    {
      label: "Play Sound When Done",
      type: "checkbox",
      checked: prefs.sound,
      click: (item) => {
        prefs.sound = item.checked;
        savePrefs();
      },
    },
    {
      label: "Show Notification When Done",
      type: "checkbox",
      checked: prefs.notify,
      click: (item) => {
        prefs.notify = item.checked;
        savePrefs();
      },
    },
    {
      label: "Launch at Login",
      type: "checkbox",
      checked: prefs.launchAtLogin,
      click: (item) => {
        prefs.launchAtLogin = item.checked;
        savePrefs();
        applyLoginItem();
      },
    },
    { type: "separator" },
    {
      label: "Show Beacon",
      click: () => {
        if (win) {
          win.show();
          win.setAlwaysOnTop(true, "screen-saver");
        } else {
          createWindow();
        }
      },
    },
    {
      label: "Reset Position",
      click: () => {
        const pos = defaultPosition();
        prefs.x = pos.x;
        prefs.y = pos.y;
        savePrefs();
        if (win && !win.isDestroyed()) {
          win.setPosition(pos.x, pos.y);
        }
      },
    },
    {
      label: "Open Status URL",
      click: () => shell.openExternal(`http://${HOST}:${PORT}/status`),
    },
    {
      label: "Install Cursor Hooks",
      click: () => installHooksFromApp(),
    },
    { type: "separator" },
    { label: "Quit Beacon", role: "quit" },
  ]);
}

function createTray() {
  tray = new Tray(trayIcon("idle"));
  updateTray();
  tray.on("click", async () => {
    if (status.state === "done" || status.state === "action") {
      await activateApp("cursor");
      return;
    }
    tray.popUpContextMenu();
  });
  tray.on("right-click", () => {
    tray.popUpContextMenu();
  });
}

ipcMain.handle("get-status", () => status);
ipcMain.handle("set-status", (_e, next) => setStatus(next));
ipcMain.handle("focus-app", async (_e, source) => {
  return activateApp(source || "cursor");
});
ipcMain.handle("ack", () => setStatus({ state: "idle" }));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      win.show();
      win.setAlwaysOnTop(true, "screen-saver");
    }
  });

  app.whenReady().then(async () => {
    loadPrefs();
    // Only touch login items when enabled — unpackaged Electron often lacks permission.
    if (prefs.launchAtLogin) {
      applyLoginItem();
    }

    if (process.platform === "darwin" && app.dock) {
      app.dock.hide();
    }

    try {
      await createServer();
    } catch (err) {
      if (err && err.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} is already in use. Is Beacon already running?`
        );
        app.quit();
        return;
      }
      throw err;
    }

    createTray();
    createWindow();
    await runFirstLaunchSetup();
  });

  app.on("window-all-closed", (e) => {
    e.preventDefault();
  });

  app.on("before-quit", () => {
    for (const client of sseClients) {
      client.end();
    }
    sseClients.clear();
    if (server) {
      server.close();
      server = null;
    }
  });
}
