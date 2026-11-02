## M.I.K.U 1.18.0: a proper "Hey Miku" detector

- **New wake-phrase detector.** "Hey Miku" is now caught by a small keyword spotter built for wake words, instead of general speech recognition. It listens constantly on the CPU, uses very little power, and works for whatever name you give your assistant, with no training needed.
- **Interrupt her mid-sentence:** say "Hey Miku" while she's talking and she stops to listen, just like "Hey Jarvis" did.
- "Hi Miku" and "Okay Miku" work too.
- The mic sensitivity slider in Settings now also adjusts how easily she wakes up.
- If the detector can't start for some reason, she falls back to the previous speech-recognition method automatically.
