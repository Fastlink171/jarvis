# J.A.R.V.I.S.

A personal AI assistant for Windows that runs entirely on your own PC.

- **Brain:** a local model through [Ollama](https://ollama.com), on your graphics card. No accounts or tokens.
- **Hearing:** Whisper speech recognition, running locally.
- **Voice:** Kokoro neural voices (British male "George" by default), running locally.
- **Abilities:** web search and page reading, PowerShell, opening apps and sites, reading and writing files, timers, reminders, tasks, weather and long-term memory.

## Install

Download `Jarvis-Setup-x.y.z.exe` from the [latest release](https://github.com/Fastlink171/jarvis/releases/latest) and run it. Jarvis walks you through installing Ollama and downloading a brain and voice on first launch. After that he updates himself.

## Develop

```
npm install
npm start          # build the renderer and run Jarvis
npm run dist       # build the Windows installer locally (Windows only)
```

See `DEVELOPING.md` for how releases work.

## Credits
- Wake word: a JavaScript port of [openWakeWord](https://github.com/dscripka/openWakeWord) (Apache-2.0). The pre-trained "hey jarvis", melspectrogram and embedding models are by David Scripka, licensed CC BY-NC-SA 4.0 (non-commercial use).
- Speech recognition: Whisper via Transformers.js. Voice: Kokoro-82M.
