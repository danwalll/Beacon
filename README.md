# Beacon

Desktop orb that turns green when your Cursor agent finishes. Click it to jump back.

## Install (for anyone)

1. Get the latest **Beacon DMG** (or zip) from whoever built it — usually `dist/Beacon-*-arm64.dmg`
2. Open the DMG → drag **Beacon** into **Applications**
3. First launch: **Right-click Beacon → Open** (required once; the app isn’t Apple-notarized yet)
4. When prompted, click **Set up now**
5. **Restart Cursor** once
6. Leave Beacon running (menu bar icon)

That’s it. Amber = agent working. Green = done → click to return.

### Optional
- Menu bar → **Launch at Login**
- Menu bar → **Install Cursor Hooks** (if setup was skipped)
- **System Settings → Privacy & Security → Accessibility** → enable **Beacon** for better window focusing

### Apple Silicon vs Intel
- M1/M2/M3/M4 → use the `arm64` DMG  
- Intel Mac → ask for the `x64` build (`./scripts/release.sh` on an Intel machine, or `npx electron-builder --mac dmg --x64`)

---

## Build a shareable DMG (maintainers)

```bash
cd /Users/danwall/Beacon
./scripts/release.sh
```

Creates `dist/Beacon-1.0.0-<arch>.dmg` and `.zip`. AirDrop / Drive / GitHub Release those files.

```bash
npm start              # run from source
npm run install:hooks  # connect Cursor without packaging
npm run demo:done      # smoke-test the green state
```

## How it works

Cursor hooks notify a local Beacon server when a prompt starts and when the agent stops. The floating widget reflects that state and focuses Cursor on click.

| Surface | Support |
|---|---|
| Cursor Agent / Editor | Yes (hooks) |
| Exact chat tab | Best-effort (needs Accessibility) |
| Claude Code | Optional (`npm run install:hooks -- --claude`) |

Hooks live in `~/.agent-beacon/hooks` and don’t depend on this repo path.
