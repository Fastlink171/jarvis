# Developing Jarvis

## Layout
- `app/main.js` – Electron main process: window, tray, hotkey, Ollama client (chat/pull streaming), PowerShell runner, file tools, web search/read (DuckDuckGo, Bing fallback via hidden window), system stats, auto-updater.
- `app/helper.ps1` – PC-control helper, started once and kept running: media keys, volume (Core Audio), window list/focus/close, key combos, typing. JSON lines over stdin/stdout. Checked on Windows by CI (`-SelfTest`).
- `app/preload.js` – the `window.jarvis` API exposed to the page.
- `app/renderer/index.html`, `style.css` – the HUD.
- `src/ui.js` – renderer logic: agent loop with tool calling, quick commands, setup wizard, HUD panels. `src/scene_orb.js` (background + core drawing) is spliced in by the build.
- `src/voice.js` – Whisper hearing + Kokoro voice + mic VAD, bundled by esbuild.
- `scripts/build.js` – produces `app/renderer/ui.js`, `voice.js` and `ort/` (all git-ignored).

## Releasing an update
1. Make the change.
2. Bump `version` in `package.json` (e.g. 1.1.0 → 1.2.0).
3. Replace `build/release-notes.md` with a short list of what changed (shown to the user inside Jarvis).
4. Commit and push to `main`.
5. GitHub Actions (`.github/workflows/release.yml`) sees the new version, builds `Jarvis-Setup-<version>.exe` on Windows and publishes release `v<version>`.
   Pushes that don't change the version build nothing. Installed copies check on launch and every 3 hours, download in the background, and install on restart.

User data (memories, settings, voice models) lives in `%APPDATA%\Jarvis` and survives updates.

## Testing on Windows before release
Push to any branch other than `main` (e.g. `dev`) and `.github/workflows/check.yml` runs the helper self-test on GitHub's Windows machines.
