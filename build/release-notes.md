## M.I.K.U 1.23.0: Miku looks after your voice server

- **Starts your trained voice by itself:** when Miku launches and your custom voice is selected, she checks whether the voice server is answering. If it is, she leaves it alone. If not, she runs your `experimental-trained-tts\Start.ps1` in the background and waits until it's ready before speaking.
- **No more quiet switch to another voice:** if the server can't start, Miku shows the exact error and stays silent for that reply instead of switching voices behind your back. The full details are in `logs\tts-server.log` in Miku's data folder.
- **Crash recovery:** if the voice server stops while Miku is running, she restarts it after a few seconds, up to 3 times. If it keeps crashing she stops trying and tells you why. Press CHECK in Settings to try again.
- **Never starts a second copy:** she won't launch the server again while one is still loading or already using the port.
- Your voice model, reference audio and voice settings are never touched.
