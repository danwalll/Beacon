# Beacon

Amber = working · Rose = needs you · Green = done

Floating orbs on your desktop — one per app — so you always know when an AI agent needs you.

**Landing page:** [danwalll.github.io/Beacon](https://danwalll.github.io/Beacon/) · local preview: `open landing/index.html`

## Install (for anyone)

1. Get the latest **Beacon DMG** from [Releases](https://github.com/danwalll/Beacon/releases) — `Beacon-*-arm64.dmg` on Apple Silicon
2. Open the DMG → double-click **Beacon** (it copies itself to Applications and reopens)
3. First launch only: a **First time on this Mac?** screen explains the one-time **Right-click → Open** step if macOS blocks Beacon
4. First launch: Beacon **auto-connects** Cursor, ChatGPT, and/or Claude if it finds them
5. When prompted, **restart each connected app once** so hooks load
6. Open Beacon anytime: **⌘Space** → type **Beacon** → Enter

**Right-click the orb** for sound, notifications, login, and setup.

### Optional

- Menu bar **Beacon** → **Open at login**
- **System Settings → Privacy & Security → Accessibility** → enable **Beacon** for better click-to-focus

### Apple Silicon vs Intel

- M1/M2/M3/M4 → `arm64` DMG
- Intel Mac → build `x64` on an Intel machine (`npx electron-builder --mac dmg --x64`)

---

## Build & share (maintainers)

```bash
cd ~/Beacon
bash scripts/install-app.sh   # rebuild + install to /Applications
npm run release               # DMG in dist/
```

Creates `dist/Beacon-1.1.1-<arch>.dmg`. AirDrop, Drive, or attach to a GitHub Release.

```bash
npm start              # run from source
npm run install:hooks  # connect Cursor without packaging
npm run demo:done      # smoke-test the green state
```

## How it works

Hooks in `~/.agent-beacon/hooks` notify a local server (`127.0.0.1:17373`) when an agent starts or finishes. Each connected app gets its own orb.

| App | How it connects |
|---|---|
| **Cursor** | One-click hooks |
| **ChatGPT** | Codex hooks (`~/.codex/hooks.json`) |
| **Claude** | Claude Code hooks + Desktop Cowork watcher (`audit.jsonl`) |
| **Custom** | HTTP POST to `/status` |

Hooks don’t depend on this repo path after install.
