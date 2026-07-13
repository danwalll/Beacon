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
const ORB_WIDTH = 100;
const ORB_HEIGHT = 108;

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

/** Recent agent sessions — one orb tracks many. Keyed by source:conversationId. */
/** @type {Map<string, object>} */
const sessions = new Map();

/** @type {{ x: number | null, y: number | null, positions: Record<string, {x:number,y:number}>, launchAtLogin: boolean, sound: boolean, notify: boolean, focusPreference: 'auto' | 'agents' | 'editor', setupComplete: boolean, gatekeeperGuideSeen: boolean }} */
let prefs = {
  x: null,
  y: null,
  positions: {},
  launchAtLogin: true,
  sound: true,
  notify: true,
  focusPreference: "auto",
  setupComplete: false,
  gatekeeperGuideSeen: false,
};

const RESTART_APPS = {
  cursor: { name: "Cursor", label: "Cursor" },
  codex: { name: "ChatGPT", label: "ChatGPT" },
  claude: { name: "Claude", label: "Claude Code" },
};

/** @type {Set<import('http').ServerResponse>} */
const sseClients = new Set();

/** One floating orb per workflow source (cursor, codex, …). */
/** @type {Map<string, BrowserWindow>} */
const orbs = new Map();

/** Best non-idle status per source. */
/** @type {Map<string, object>} */
const bySource = new Map();

/** @type {Tray | null} */
let tray = null;
/** @type {import('http').Server | null} */
let server = null;

const SOURCE_ORDER = ["cursor", "codex", "claude", "http", "home"];
const SOURCE_SHORT = {
  cursor: "cur",
  codex: "gpt",
  claude: "cld",
  http: "http",
  home: "",
};

const APP_BUNDLES = {
  cursor: ["Cursor", "Cursor Nightly"],
  claude: ["Claude", "Claude Code", "Terminal", "iTerm2", "Warp", "Ghostty"],
  codex: ["ChatGPT", "Codex", "Terminal", "iTerm2", "Warp"],
  http: [],
};

/** @type {BrowserWindow | null} */
let connectionsWin = null;
/** @type {BrowserWindow | null} */
let gatekeeperWin = null;

function connectionsModule() {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "connections.js")
    : path.join(__dirname, "..", "scripts", "connections.js");
  try {
    delete require.cache[require.resolve(candidate)];
  } catch {
    delete require.cache[candidate];
  }
  return require(candidate);
}

function claudeDesktopWatcherModule() {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "claude-desktop-watcher.js")
    : path.join(__dirname, "..", "scripts", "claude-desktop-watcher.js");
  try {
    delete require.cache[require.resolve(candidate)];
  } catch {
    delete require.cache[candidate];
  }
  return require(candidate);
}

/** @type {{ stop: () => void } | null} */
let claudeDesktopWatcher = null;

function startClaudeDesktopWatcher() {
  if (process.platform !== "darwin") return;
  try {
    const mod = claudeDesktopWatcherModule();
    claudeDesktopWatcher = mod.createClaudeDesktopWatcher({
      port: PORT,
      onStatus: (body) => setStatus(body),
    });
    const result = claudeDesktopWatcher.start();
    if (result.ok) {
      console.log(
        `Claude Desktop watcher on (${result.files} session file(s) tracked)`
      );
    }
  } catch (err) {
    console.error("Claude Desktop watcher failed to start:", err);
  }
}

function prefsPath() {
  return path.join(app.getPath("userData"), "prefs.json");
}

function loadPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath(), "utf8"));
    const positions =
      raw.positions && typeof raw.positions === "object" ? raw.positions : {};
    prefs = {
      x: Number.isFinite(raw.x) ? raw.x : null,
      y: Number.isFinite(raw.y) ? raw.y : null,
      positions,
      launchAtLogin: raw.launchAtLogin !== false,
      sound: raw.sound !== false,
      notify: raw.notify !== false,
      focusPreference: ["auto", "agents", "editor"].includes(raw.focusPreference)
        ? raw.focusPreference
        : "auto",
      setupComplete: Boolean(raw.setupComplete),
      gatekeeperGuideSeen: Boolean(raw.gatekeeperGuideSeen),
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

async function offerRestartAfterConnect(id) {
  const info = RESTART_APPS[id];
  if (!info) return;

  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Almost done",
    message: `Restart ${info.label}?`,
    detail:
      `Beacon is connected to ${info.label}.\n\n` +
      `Open ${info.name} once so the orb can follow along.`,
    buttons: [`Open ${info.name}`, "Later"],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    try {
      await execFileAsync("open", ["-a", info.name]);
    } catch {
      // ignore
    }
  }
}

function macSheetWindowOptions(extra = {}) {
  const base = {
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 16 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  if (process.platform === "darwin") {
    Object.assign(base, {
      transparent: true,
      backgroundColor: "#00000000",
      vibrancy: "under-window",
      visualEffectState: "active",
      backgroundMaterial: "under-window",
    });
  } else {
    base.backgroundColor = "#ececec";
  }

  return { ...base, ...extra };
}

function openGatekeeperGuide({ force = false } = {}) {
  if (gatekeeperWin && !gatekeeperWin.isDestroyed()) {
    gatekeeperWin.show();
    gatekeeperWin.focus();
    return gatekeeperWin;
  }

  gatekeeperWin = new BrowserWindow(
    macSheetWindowOptions({
      width: 460,
      height: 520,
      minWidth: 400,
      minHeight: 460,
      title: "First time on this Mac?",
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, "guide-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
  );

  gatekeeperWin.loadFile(path.join(__dirname, "..", "ui", "gatekeeper.html"));
  gatekeeperWin.once("ready-to-show", () => {
    if (gatekeeperWin && !gatekeeperWin.isDestroyed()) {
      gatekeeperWin.show();
    }
  });
  gatekeeperWin.on("closed", () => {
    gatekeeperWin = null;
  });

  if (force) {
    gatekeeperWin.webContents.once("did-finish-load", () => {
      if (gatekeeperWin && !gatekeeperWin.isDestroyed()) {
        gatekeeperWin.show();
        gatekeeperWin.focus();
      }
    });
  }

  return gatekeeperWin;
}

async function revealBeaconInApplications() {
  const appPath = "/Applications/Beacon.app";
  try {
    if (fs.existsSync(appPath)) {
      await execFileAsync("open", ["-R", appPath]);
    } else {
      await execFileAsync("open", ["/Applications"]);
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
    };
  }
}

function dismissGatekeeperGuide() {
  prefs.gatekeeperGuideSeen = true;
  savePrefs();
  if (gatekeeperWin && !gatekeeperWin.isDestroyed()) {
    gatekeeperWin.close();
  }
  return { ok: true };
}

async function runGatekeeperGuide() {
  if (!app.isPackaged || prefs.gatekeeperGuideSeen) return;

  await new Promise((resolve) => {
    const win = openGatekeeperGuide();
    win.once("closed", resolve);
  });
}

function formatAppList(names) {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

async function openConnectedApps(ids) {
  for (const id of ids) {
    const info = RESTART_APPS[id];
    if (!info) continue;
    try {
      await execFileAsync("open", ["-a", info.name]);
    } catch {
      // ignore
    }
  }
}

async function runFirstLaunchSetup() {
  if (!app.isPackaged || prefs.setupComplete) return;

  let connected = [];
  try {
    connected = connectionsModule().autoConnectRecommended(PORT);
  } catch (err) {
    console.error("Auto-connect failed:", err);
  }

  prefs.setupComplete = true;
  savePrefs();

  if (connected.length === 0) {
    await dialog.showMessageBox({
      type: "info",
      title: "Welcome to Beacon",
      message: "Beacon is ready",
      detail:
        "We didn't find Cursor, ChatGPT, or Claude on this Mac yet.\n\n" +
        "When you install one, connect it from the Beacon menu.\n\n" +
        "Find Beacon anytime: ⌘Space → type Beacon → Enter.",
      buttons: ["OK"],
    });
    return;
  }

  const labels = formatAppList(connected.map((c) => c.name));
  const openLabel =
    connected.length === 1
      ? `Open ${RESTART_APPS[connected[0].id]?.name || connected[0].name}`
      : "Open all";

  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Beacon",
    message: `We connected ${labels} — restart them`,
    detail:
      "Beacon hooked up the apps we found on your Mac.\n\n" +
      "Restart each one once so the orb can follow along.",
    buttons: [openLabel, "Later"],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    await openConnectedApps(connected.map((c) => c.id));
  }
}

function bundlePath() {
  if (!app.isPackaged) return null;
  return path.resolve(process.execPath, "..", "..", "..");
}

function isInstalledInApplications() {
  const bundle = bundlePath();
  if (!bundle) return true;
  return bundle === "/Applications/Beacon.app";
}

async function moveToApplications() {
  const src = bundlePath();
  if (!src || isInstalledInApplications()) {
    return { ok: true, already: true };
  }

  const dest = "/Applications/Beacon.app";
  try {
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    await execFileAsync("ditto", [src, dest]);
    try {
      await execFileAsync("xattr", ["-cr", dest]);
    } catch {
      // ignore
    }
    try {
      await execFileAsync("codesign", ["--force", "--deep", "--sign", "-", dest]);
    } catch {
      // ignore
    }
    await execFileAsync("open", [dest]);
    return { ok: true, relaunch: true };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
    };
  }
}

/** First open from DMG/Downloads — auto-copy to Applications, then relaunch. */
async function ensureInstalledInApplications() {
  if (!app.isPackaged || isInstalledInApplications()) return true;

  const result = await moveToApplications();
  if (result.ok && result.relaunch) {
    app.quit();
    return false;
  }

  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Install Beacon",
    message: "Put Beacon in Applications",
    detail:
      "Beacon couldn’t install automatically.\n\n" +
      "Click Install to try again — or drag Beacon onto Applications in the download window.\n\n" +
      "After that, open Beacon from Applications (⌘Space → “Beacon”).",
    buttons: ["Install", "Continue anyway"],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    const retry = await moveToApplications();
    if (retry.ok && retry.relaunch) {
      app.quit();
      return false;
    }
    await dialog.showMessageBox({
      type: "warning",
      title: "Install manually",
      message: "Drag Beacon to Applications",
      detail:
        (retry.error ? `${retry.error}\n\n` : "") +
        "In the download window, drag the Beacon icon onto the Applications folder.",
      buttons: ["OK"],
    });
  }

  return true;
}

function openConnectionsWindow() {
  if (connectionsWin && !connectionsWin.isDestroyed()) {
    connectionsWin.show();
    connectionsWin.focus();
    return;
  }

  connectionsWin = new BrowserWindow(
    macSheetWindowOptions({
      width: 480,
      height: 620,
      minWidth: 400,
      minHeight: 480,
      title: "Set up Beacon",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
  );

  connectionsWin.loadFile(path.join(__dirname, "..", "ui", "connections.html"));
  connectionsWin.once("ready-to-show", () => {
    if (connectionsWin && !connectionsWin.isDestroyed()) {
      connectionsWin.show();
    }
  });
  connectionsWin.on("closed", () => {
    connectionsWin = null;
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
    x: display.workArea.x + width - ORB_WIDTH - 28,
    y: display.workArea.y + Math.round(height * 0.35),
  };
}

function clampToVisible(x, y) {
  const displays = screen.getAllDisplays();
  for (const d of displays) {
    const a = d.workArea;
    if (
      x + ORB_WIDTH > a.x &&
      x < a.x + a.width &&
      y + ORB_HEIGHT > a.y &&
      y < a.y + a.height
    ) {
      return {
        x: Math.min(Math.max(x, a.x), a.x + a.width - ORB_WIDTH),
        y: Math.min(Math.max(y, a.y), a.y + a.height - ORB_HEIGHT),
      };
    }
  }
  return defaultPosition();
}

function notifyAttention(kind, entry) {
  if (!prefs.notify) return;
  if (!Notification.isSupported()) return;
  const snap = entry || status;
  const isAction = kind === "action";
  const who = snap.app || snap.source || "Agent";
  const n = new Notification({
    title: isAction ? `Beacon — ${who} needs you` : `${who} finished`,
    body: isAction
      ? "The agent asked a question or needs a decision. Click its orb to jump back."
      : snap.label
        ? `${snap.label} is done — click its orb to jump back.`
        : "Click the orb to jump back.",
    silent: true,
  });
  n.on("click", async () => {
    await activateApp(snap.source || "cursor");
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

function idleSnapshot() {
  return {
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
}

function statusPayload() {
  return {
    ...status,
    sources: Object.fromEntries(bySource),
    orbs: [...orbs.keys()],
  };
}

function broadcast() {
  const payload = `data: ${JSON.stringify(statusPayload())}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
  for (const [src, w] of orbs) {
    if (!w || w.isDestroyed()) continue;
    const st =
      src === "home"
        ? idleSnapshot()
        : bySource.get(src) || { ...idleSnapshot(), source: src };
    w.webContents.send("status", { ...st, orbSource: src });
  }
  updateTray();
}

function sessionKey(source, conversationId) {
  const src = (source || "unknown").toLowerCase();
  return `${src}:${conversationId || src}`;
}

function pickBest(entries) {
  const rank = { working: 3, action: 2, done: 1, idle: 0 };
  return [...entries].sort((a, b) => {
    const rd = (rank[b.state] || 0) - (rank[a.state] || 0);
    if (rd !== 0) return rd;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  })[0];
}

function positionFor(source, index) {
  const saved = prefs.positions && prefs.positions[source];
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    return clampToVisible(saved.x, saved.y);
  }
  const base =
    prefs.x != null && prefs.y != null
      ? clampToVisible(prefs.x, prefs.y)
      : defaultPosition();
  return clampToVisible(base.x, base.y + index * (ORB_HEIGHT + 10));
}

function closeOrb(source) {
  const w = orbs.get(source);
  if (w && !w.isDestroyed()) {
    w.destroy();
  }
  orbs.delete(source);
}

function ensureOrb(source, stackIndex = 0) {
  const existing = orbs.get(source);
  if (existing && !existing.isDestroyed()) return existing;

  const pos = positionFor(source, stackIndex);

  const w = new BrowserWindow({
    width: ORB_WIDTH,
    height: ORB_HEIGHT,
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
      additionalArguments: [`--beacon-source=${source}`],
    },
  });

  w.setAlwaysOnTop(true, "screen-saver");
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (typeof w.setExcludedFromShownWindowsMenu === "function") {
    w.setExcludedFromShownWindowsMenu(true);
  }

  const html = path.join(__dirname, "..", "ui", "index.html");
  w.loadFile(html, { query: { source } });

  w.once("ready-to-show", () => {
    if (!w.isDestroyed()) w.showInactive();
  });

  let moveTimer = null;
  w.on("moved", () => {
    if (w.isDestroyed()) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const [x, y] = w.getPosition();
      if (!prefs.positions) prefs.positions = {};
      prefs.positions[source] = { x, y };
      if (source === "home" || orbs.size === 1) {
        prefs.x = x;
        prefs.y = y;
      }
      savePrefs();
    }, 200);
  });

  w.on("closed", () => {
    if (orbs.get(source) === w) orbs.delete(source);
  });

  orbs.set(source, w);
  return w;
}

function syncOrbs(attention) {
  const active = [...bySource.entries()]
    .filter(([, s]) => s.state && s.state !== "idle")
    .map(([src]) => src)
    .sort(
      (a, b) =>
        (SOURCE_ORDER.indexOf(a) === -1 ? 99 : SOURCE_ORDER.indexOf(a)) -
        (SOURCE_ORDER.indexOf(b) === -1 ? 99 : SOURCE_ORDER.indexOf(b))
    );

  const wanted = active.length ? active : ["home"];

  wanted.forEach((src, i) => ensureOrb(src, i));
  for (const src of [...orbs.keys()]) {
    if (!wanted.includes(src)) closeOrb(src);
  }

  broadcast();

  if (attention && attention.state !== "working") {
    playAttentionSound(attention.state);
    notifyAttention(attention.state, attention);
    const w = orbs.get(attention.source);
    if (w && !w.isDestroyed()) {
      w.setAlwaysOnTop(true, "screen-saver");
      w.showInactive();
    }
  }
}

function recomputeAggregate(prevBySource) {
  const grouped = new Map();
  for (const entry of sessions.values()) {
    if (!entry.source || entry.state === "idle") continue;
    const list = grouped.get(entry.source) || [];
    list.push(entry);
    grouped.set(entry.source, list);
  }

  bySource.clear();
  for (const [src, list] of grouped) {
    bySource.set(src, pickBest(list));
  }

  const all = [...bySource.values()];
  if (!all.length) {
    status = idleSnapshot();
    syncOrbs(null);
    return { ok: true, status, sessions: sessions.size, sources: 0 };
  }

  status = { ...pickBest(all), updatedAt: new Date().toISOString() };

  let attention = null;
  for (const [src, snap] of bySource) {
    const prev = prevBySource && prevBySource.get(src);
    const prevState = prev ? prev.state : "idle";
    if (
      (snap.state === "done" && prevState !== "done") ||
      (snap.state === "action" && prevState !== "action")
    ) {
      attention = snap;
    }
  }

  syncOrbs(attention);
  return {
    ok: true,
    status,
    sessions: sessions.size,
    sources: bySource.size,
    orbs: [...orbs.keys()],
  };
}

function setStatus(next) {
  const prevBySource = new Map(bySource);
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
        : source === "codex"
          ? "Codex"
          : source === "http"
            ? "Custom"
            : source === "cursor"
              ? "Cursor"
              : status.app;

  const surfaceRaw = next.surface != null ? String(next.surface) : status.surface;
  const surface =
    surfaceRaw === "agents" || surfaceRaw === "editor" || surfaceRaw === "unknown"
      ? surfaceRaw
      : status.surface;

  const conversationId =
    next.conversationId != null
      ? String(next.conversationId)
      : next.conversationId === null
        ? null
        : null;
  const key = sessionKey(source, conversationId);
  const prevForKey =
    sessions.get(key) || (source ? bySource.get(source) : null);

  const entry = {
    state,
    source: source || null,
    app: appName || null,
    label:
      next.label != null
        ? String(next.label)
        : next.label === null
          ? null
          : prevForKey?.label || null,
    conversationId:
      next.conversationId != null
        ? String(next.conversationId)
        : next.conversationId === null
          ? null
          : prevForKey?.conversationId || null,
    workspaceRoot:
      next.workspaceRoot != null
        ? String(next.workspaceRoot)
        : next.workspaceRoot === null
          ? null
          : prevForKey?.workspaceRoot || null,
    surface: surface || prevForKey?.surface || null,
    composerMode:
      next.composerMode != null
        ? String(next.composerMode)
        : next.composerMode === null
          ? null
          : prevForKey?.composerMode || null,
    updatedAt: new Date().toISOString(),
  };

  if (state === "idle") {
    if (next.clearAll) {
      sessions.clear();
    } else if (next.clearSource || entry.source) {
      // Clear this workflow's sessions (whole app orb → idle).
      for (const [k, v] of [...sessions]) {
        if (v.source === entry.source) sessions.delete(k);
      }
    } else {
      sessions.delete(key);
    }
  } else {
    sessions.set(key, entry);
    if (sessions.size > 40) {
      const first = sessions.keys().next().value;
      sessions.delete(first);
    }
    // Drop phantom mirrors: same Cursor chat attributed to another host app.
    if (entry.source === "cursor" && entry.conversationId) {
      for (const [k, v] of [...sessions]) {
        if (
          k !== key &&
          v.source &&
          v.source !== "cursor" &&
          v.conversationId === entry.conversationId
        ) {
          sessions.delete(k);
        }
      }
    }
  }

  return recomputeAggregate(prevBySource);
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
    const snap = bySource.get(source) || status;

    if (snap.state === "done" || snap.state === "action") {
      // Clear this workflow's orb only — other orbs stay lit.
      setStatus({
        state: "idle",
        source,
        clearSource: true,
      });
    }

    // Cursor gets Agents Window–aware focusing.
    if (source === "cursor") {
      const workspace =
        snap.workspaceRoot || path.resolve(__dirname, "..");
      const hints = focusHintsForStatus(snap);
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
        target: snap.surface || prefs.focusPreference || "auto",
        workspace,
        conversationId: snap.conversationId,
        window: raised,
        hints,
      };
    }

    let candidates = APP_BUNDLES[source] || [];
    try {
      candidates = connectionsModule().focusAppsFor(source) || candidates;
    } catch {
      // ignore
    }
    if (!candidates.length) {
      candidates = ["Cursor"];
    }

    for (const name of candidates) {
      try {
        await execFileAsync("osascript", [
          "-e",
          `tell application "${name}" to activate`,
        ]);
        return { ok: true, app: name, source };
      } catch {
        // try next
      }
    }

    try {
      await execFileAsync("open", ["-a", candidates[0]]);
      return { ok: true, app: candidates[0], source, via: "open" };
    } catch (err) {
      return {
        ok: false,
        error: String(err && err.message ? err.message : err),
      };
    }
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

      if (req.method === "POST" && url.pathname === "/open-connections") {
        openConnectionsWindow();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/connections") {
        try {
          sendJson(res, 200, {
            ok: true,
            connections: connectionsModule().listConnections(PORT),
          });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: String(err) });
        }
        return;
      }

      if (req.method === "POST" && url.pathname.startsWith("/connections/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        // /connections/:id/connect|disconnect
        const id = parts[1];
        const action = parts[2];
        try {
          const mod = connectionsModule();
          if (action === "connect") {
            const result = mod.connect(id);
            sendJson(res, 200, result);
            if (result.ok && RESTART_APPS[id]) {
              offerRestartAfterConnect(id);
            }
            return;
          }
          if (action === "disconnect") {
            sendJson(res, 200, mod.disconnect(id));
            return;
          }
          sendJson(res, 404, { ok: false, error: "use /connect or /disconnect" });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: String(err) });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/status") {
        sendJson(res, 200, statusPayload());
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        res.write(`data: ${JSON.stringify(statusPayload())}\n\n`);
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
        const body = await readBody(req).catch(() => ({}));
        setStatus({
          state: "idle",
          source: body.source || status.source,
          clearSource: true,
        });
        sendJson(res, 200, { ok: true, status: statusPayload() });
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
  syncOrbs(null);
}

function trayIcon(state) {
  const name = ["idle", "working", "action", "done"].includes(state)
    ? state
    : "idle";
  const file = path.join(__dirname, "..", "ui", "tray", `${name}.png`);
  try {
    const img = nativeImage.createFromPath(file);
    if (!img.isEmpty()) {
      return img.resize({ width: 18, height: 18, quality: "best" });
    }
  } catch {
    // fall through
  }
  // Fallback if PNG missing
  const colors = {
    idle: "#6B7280",
    working: "#D97706",
    action: "#E11D48",
    done: "#10B981",
  };
  const color = colors[name] || colors.idle;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="7" fill="${color}"/></svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
  );
}

function updateTray() {
  if (!tray) return;
  tray.setImage(trayIcon(status.state));
  // Text in menu bar so Beacon is findable even when icons are crowded.
  const title =
    status.state === "working"
      ? " Beacon"
      : status.state === "action"
        ? " Ask"
        : status.state === "done"
          ? " Done"
          : " Beacon";
  tray.setTitle(title);
  const parts = [...bySource.entries()].map(
    ([src, s]) => `${SOURCE_SHORT[src] || src}:${s.state}`
  );
  const label = parts.length
    ? parts.join(" · ")
    : status.state === "idle"
      ? "Idle"
      : status.state;
  tray.setToolTip(`Beacon — ${label}`);
  tray.setContextMenu(buildTrayMenu());
}

function buildTrayMenu() {
  const items = /** @type {import('electron').MenuItemConstructorOptions[]} */ ([
    {
      label: "Set up apps…",
      click: () => openConnectionsWindow(),
    },
    {
      label: "First open help…",
      click: () => openGatekeeperGuide({ force: true }),
    },
    { type: "separator" },
    {
      label: "Play sound",
      type: "checkbox",
      checked: prefs.sound,
      click: (item) => {
        prefs.sound = item.checked;
        savePrefs();
      },
    },
    {
      label: "Show notification",
      type: "checkbox",
      checked: prefs.notify,
      click: (item) => {
        prefs.notify = item.checked;
        savePrefs();
      },
    },
    {
      label: "Open at login",
      type: "checkbox",
      checked: prefs.launchAtLogin,
      click: (item) => {
        prefs.launchAtLogin = item.checked;
        savePrefs();
        applyLoginItem();
      },
    },
  ]);

  if (app.isPackaged && !isInstalledInApplications()) {
    items.push({ type: "separator" });
    items.push({
      label: "Add to Applications…",
      click: async () => {
        const result = await moveToApplications();
        if (result.ok && result.relaunch) {
          app.quit();
          return;
        }
        if (result.already) {
          dialog.showMessageBox({
            type: "info",
            title: "Beacon",
            message: "Beacon is already in Applications.",
            buttons: ["OK"],
          });
          return;
        }
        dialog.showMessageBox({
          type: "warning",
          title: "Beacon",
          message: "Couldn’t move Beacon to Applications.",
          detail: result.error || "Try dragging Beacon to Applications yourself.",
          buttons: ["OK"],
        });
      },
    });
  }

  items.push({ type: "separator" });
  items.push({
    label: "Show orbs",
    click: () => {
      if (!orbs.size) createWindow();
      for (const w of orbs.values()) {
        if (!w.isDestroyed()) {
          w.show();
          w.setAlwaysOnTop(true, "screen-saver");
        }
      }
    },
  });
  items.push({
    label: "Reset positions",
    click: () => {
      const pos = defaultPosition();
      prefs.x = pos.x;
      prefs.y = pos.y;
      prefs.positions = {};
      savePrefs();
      let i = 0;
      for (const [src, w] of orbs) {
        if (w.isDestroyed()) continue;
        const p = clampToVisible(pos.x, pos.y + i * (ORB_HEIGHT + 10));
        w.setPosition(p.x, p.y);
        i += 1;
      }
    },
  });

  if (!app.isPackaged) {
    items.push({ type: "separator" });
    items.push({
      label: `State: ${status.state}`,
      enabled: false,
    });
    items.push({
      label: "Mark Working (dev)",
      click: () =>
        setStatus({ state: "working", source: status.source || "cursor" }),
    });
    items.push({
      label: "Mark Needs You (dev)",
      click: () =>
        setStatus({ state: "action", source: status.source || "cursor" }),
    });
    items.push({
      label: "Mark Done (dev)",
      click: () =>
        setStatus({ state: "done", source: status.source || "cursor" }),
    });
    items.push({
      label: "Mark Idle (dev)",
      click: () => setStatus({ state: "idle", clearAll: true }),
    });
    items.push({
      label: "Focus last source",
      click: async () => {
        await activateApp(status.source || "cursor");
      },
    });
    items.push({
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
    });
    items.push({
      label: "Open Status URL",
      click: () => shell.openExternal(`http://${HOST}:${PORT}/status`),
    });
  }

  items.push({ type: "separator" });
  items.push({ label: "Quit Beacon", role: "quit" });

  return Menu.buildFromTemplate(items);
}

function appNameForSource(source) {
  const map = {
    cursor: "Cursor",
    codex: "ChatGPT",
    claude: "Claude",
    http: "Custom",
  };
  return map[source] || "App";
}

function showOrbContextMenu(source) {
  const src = (source || "home").toLowerCase();
  const snap =
    src !== "home" ? bySource.get(src) : null;
  const win = orbs.get(src) || orbs.values().next().value || null;

  const items = /** @type {import('electron').MenuItemConstructorOptions[]} */ ([]);

  if (snap && (snap.state === "done" || snap.state === "action")) {
    items.push({
      label: `Open ${appNameForSource(src)}`,
      click: () => activateApp(src),
    });
    items.push({ type: "separator" });
  }

  items.push({
    label: "Set up apps…",
    click: () => openConnectionsWindow(),
  });
  if (app.isPackaged) {
    items.push({
      label: "First open help…",
      click: () => openGatekeeperGuide({ force: true }),
    });
  }
  items.push({ type: "separator" });
  items.push({
    label: "Play sound",
    type: "checkbox",
    checked: prefs.sound,
    click: (item) => {
      prefs.sound = item.checked;
      savePrefs();
    },
  });
  items.push({
    label: "Show notification",
    type: "checkbox",
    checked: prefs.notify,
    click: (item) => {
      prefs.notify = item.checked;
      savePrefs();
    },
  });
  items.push({
    label: "Open at login",
    type: "checkbox",
    checked: prefs.launchAtLogin,
    click: (item) => {
      prefs.launchAtLogin = item.checked;
      savePrefs();
      applyLoginItem();
    },
  });

  if (app.isPackaged && !isInstalledInApplications()) {
    items.push({ type: "separator" });
    items.push({
      label: "Add to Applications…",
      click: async () => {
        const result = await moveToApplications();
        if (result.ok && result.relaunch) app.quit();
      },
    });
  }

  const menu = Menu.buildFromTemplate(items);
  if (win && !win.isDestroyed()) {
    menu.popup({ window: win });
  } else {
    menu.popup();
  }
}

function createTray() {
  tray = new Tray(trayIcon("idle"));
  updateTray();
  tray.on("click", async () => {
    if (status.state === "done" || status.state === "action") {
      await activateApp(status.source || "cursor");
      return;
    }
    tray.popUpContextMenu();
  });
  tray.on("right-click", () => {
    tray.popUpContextMenu();
  });
}

ipcMain.handle("open-connections", () => {
  openConnectionsWindow();
  return { ok: true };
});
ipcMain.handle("gatekeeper-dismiss", () => dismissGatekeeperGuide());
ipcMain.handle("gatekeeper-reveal", () => revealBeaconInApplications());
ipcMain.handle("show-orb-menu", (_e, source) => {
  showOrbContextMenu(source);
  return { ok: true };
});
ipcMain.handle("get-install-status", () => ({
  inApplications: isInstalledInApplications(),
  canInstall: app.isPackaged && !isInstalledInApplications(),
}));
ipcMain.handle("install-to-applications", async () => {
  const result = await moveToApplications();
  if (result.ok && result.relaunch) {
    app.quit();
  }
  return result;
});
ipcMain.handle("get-status", (_e, source) => {
  if (source && source !== "home") {
    return (
      bySource.get(source) || {
        ...idleSnapshot(),
        source,
        orbSource: source,
      }
    );
  }
  if (source === "home") return { ...idleSnapshot(), orbSource: "home" };
  return statusPayload();
});
ipcMain.handle("set-status", (_e, next) => setStatus(next));
ipcMain.handle("focus-app", async (_e, source) => {
  return activateApp(source || status.source || "cursor");
});
ipcMain.handle("ack", (_e, source) =>
  setStatus({
    state: "idle",
    source: source && source !== "home" ? source : status.source,
    clearSource: true,
  })
);
ipcMain.handle("list-connections", () => {
  try {
    return connectionsModule().listConnections(PORT);
  } catch (err) {
    return [{ id: "error", name: "Error", blurb: String(err), connected: false }];
  }
});
ipcMain.handle("connect-workflow", async (_e, id) => {
  try {
    const result = connectionsModule().connect(id);
    if (result.ok && RESTART_APPS[id]) {
      await offerRestartAfterConnect(id);
    }
    return result;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
ipcMain.handle("disconnect-workflow", (_e, id) => {
  try {
    return connectionsModule().disconnect(id);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!orbs.size) createWindow();
    for (const w of orbs.values()) {
      if (!w.isDestroyed()) {
        w.show();
        w.setAlwaysOnTop(true, "screen-saver");
      }
    }
  });

  app.whenReady().then(async () => {
    loadPrefs();

    // Auto-install before anything else when opened from DMG/Downloads.
    const proceed = await ensureInstalledInApplications();
    if (!proceed) return;

    // Default on — sync Login Items with prefs (dev uses Electron path + args).
    if (prefs.launchAtLogin !== false) {
      prefs.launchAtLogin = true;
      savePrefs();
    }
    applyLoginItem();

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
    startClaudeDesktopWatcher();
    await runGatekeeperGuide();
    await runFirstLaunchSetup();
  });

  app.on("window-all-closed", (e) => {
    e.preventDefault();
  });

  app.on("before-quit", () => {
    if (claudeDesktopWatcher) {
      claudeDesktopWatcher.stop();
      claudeDesktopWatcher = null;
    }
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
