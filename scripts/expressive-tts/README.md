# Expressive local voice

This server uses a local Qwen3-TTS Base checkpoint and a spoken reference to
synthesize WAV audio for M.I.K.U. It listens on 127.0.0.1:5003.

1. Copy this folder to a location where you keep local voice files.
2. Copy voice.example.json to voice.json. Set python to the Python executable
   in your Qwen3-TTS environment, modelPath to the local Base checkpoint, and
   referenceText to the transcript of your reference clip. The Python
   environment needs qwen-tts, PyTorch, NumPy and SoundFile.
3. Save the reference clip as reference.wav in that folder.
4. In M.I.K.U., select Custom trained voice, then Choose Folder and select
   this folder. If you started a voice server manually on port 5003, close it
   before switching.

To seed the cache with an existing preview, set previewText to its exact
English transcript and save the audio as preview.wav. Use a preview generated
with the same model, reference and seed 1234. The server caches up to 32 lines
in memory and releases synthesis when a client disconnects. First-time lines
depend on CPU speed.
