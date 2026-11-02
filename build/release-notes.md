## M.I.K.U 1.19.0: your custom voice runs by itself

- **No more voice server to start.** With "Custom trained voice" picked in Settings → Voice, M.I.K.U starts the voice engine on its own, hidden in the background, and closes it when you quit. You don't need Start-TTS.cmd or a window open anymore.
- **Finds your voice by itself.** It looks for your trained voice folder in Documents\Codex. If it lives somewhere else, press **CHOOSE FOLDER** in Settings and pick the folder that has "models" and "runtime" inside.
- **Settings show the engine's status:** RUNNING, STARTING or OFF, plus a **RESTART** button.
- The voice takes a few seconds to load after launch. Until it's ready, replies use your other voice, then switch over automatically.
- If you start the voice server yourself anyway, M.I.K.U uses that one instead of starting a second copy.
