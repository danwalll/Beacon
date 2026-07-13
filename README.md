# Beacon

Always-on-top desktop widget that turns **amber while an agent works** and **green when it finishes**. Click the green beacon to jump back to the Cursor workspace/chat that finished.

## Is this possible?

Yes — with one important caveat: **Cursor does not expose a public “open this exact chat” desktop API**. The reliable approach is:

1. Run a tiny local status server + floating widget
2. Have **Cursor Hooks** POST `working` / `done` (with conversation + workspace ids)
3. On click, reopen that workspace in Cursor and raise the matching window

That is exactly what this project does.

## Limitations

| Surface | Support | Notes |
|---|---|---|
| Cursor Agent / Chat | Strong | `beforeSubmitPrompt` + `stop`; click reopens the bound workspace |
| Exact chat tab | Best-effort | Cursor has no public chat deeplink; window raise needs Accessibility permission |
| Claude Code CLI | Optional | `npm run install:hooks -- --claude` (off by default) |
| claude.ai / Claude Desktop | Not linked | No official completion hook |
| Cloud / background agents | Partial | Only if that runner can hit `http://127.0.0.1:17373` |

Other constraints:

- The beacon must be **running** to receive updates
- Hooks fail open — if the beacon is down, agents still work; you just get no light
- Always-on-top can sit under some secure system overlays (password prompts, some full-screen games)
- For precise window matching, grant **Accessibility** to Beacon / Electron in System Settings

## Package for another Mac

```bash
cd /Users/danwall/Beacon
npm install
npm run dist
```

Output lands in `dist/`:

- `Beacon-1.0.0-arm64-mac.zip` — unzip → `Beacon.app`
- `Beacon-1.0.0-arm64.dmg` — if you built with `npm run dist`

This machine builds **Apple Silicon (arm64)** by default. If the other Mac is Intel:

```bash
npx electron-builder --mac zip --x64
```

### On the other Mac

1. Copy the DMG or `.app` over (AirDrop, USB, cloud)
2. Open it — if Gatekeeper blocks: **Right-click → Open** (unsigned build)
3. Launch **Beacon**
4. Menu bar icon → **Install Cursor Hooks**
5. Restart Cursor (or reload hooks)
6. Optional: enable **Launch at Login** in the menu
7. Optional: **System Settings → Privacy → Accessibility** → enable Beacon for precise window focus

Hooks install to `~/.agent-beacon/hooks` (machine-local), so they don’t depend on this repo path.

### Quick alternative (no DMG)

Copy the whole repo folder, then on the other Mac:

```bash
npm install
npm run install:hooks
npm start
```

Smoke test (with the beacon running):

```bash
npm run demo:working
npm run demo:done
```

Click the green orb → Cursor comes to the front and the beacon returns to idle.

### Widget controls

- **Click (when green / done)** → focus Cursor or Claude, then idle
- **Right-click the orb** → cycle idle → working → done (manual / demo)
- **Drag the outer ring** → reposition (saved across restarts)
- **Menu bar icon** → Mark Working / Done / Idle, Focus apps, sound/notification toggles, **Launch at Login**, Quit

When an agent finishes, the beacon turns green, plays a short system sound, and shows a macOS notification (both toggleable).

## HTTP API

Local only: `http://127.0.0.1:17373`

| Method | Path | Body | Purpose |
|---|---|---|---|
| `GET` | `/status` | — | Current state |
| `GET` | `/events` | — | SSE stream of status changes |
| `POST` | `/status` | `{ "state":"working\|done\|idle", "source":"cursor\|claude" }` | Update |
| `POST` | `/focus` | `{ "source":"cursor\|claude" }` optional | Activate app |
| `POST` | `/ack` | — | Clear to idle |

Override port with `AGENT_BEACON_PORT`.

## Hooks installed

- **Cursor** → `~/.cursor/hooks.json`
  - `beforeSubmitPrompt` → amber / working
  - `stop` → green / done
- **Claude Code** → `~/.claude/settings.json`
  - `UserPromptSubmit` → amber / working
  - `Stop` → green / done

Re-run `npm run install:hooks` after moving this repo. Installer merges and replaces only prior Beacon entries.

## Make money later

The $2M/year part is the productization layer on top of this wedge:

- Multi-agent queue (which chat finished?)
- Team dashboard / Slack ping when long agents complete
- Browser extension for claude.ai / ChatGPT
- Packaged `.dmg` + launch-at-login
- Sound / haptic / Focus Mode integration

This repo is the working core: **signal → light → click back**.
