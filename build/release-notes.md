## Jarvis 1.14.0: your custom trained voice

- **New voice option: "Custom trained voice (local server)".** In Settings → Voice, choose it at the bottom of the list. Jarvis speaks through your own text-to-speech server running on this PC (default `http://127.0.0.1:5003`).
- **Start the server first:** run `Start-TTS.cmd` and keep its window open. Press **CHECK** in Settings to see if Jarvis can reach it.
- **Falls back automatically:** if the server isn't running or doesn't answer within 30 seconds, Jarvis uses Kokoro (or the Windows voice) for that sentence. The voice chip at the top shows **CUSTOM OFFLINE**.
- Sentences are sent one at a time, in order. Stop and interrupt work the same as before.
- Japanese replies are sent to the server as Japanese.
- Your replies only go to the server on your own PC, never anywhere else.
