from pathlib import Path
import argparse
import io
import json
import os
import select
import socket
import threading
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent
class ClientDisconnected(Exception):
    pass

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["NUMBA_CACHE_DIR"] = str(ROOT / "cache")
import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5003)
    args = parser.parse_args()
    config = json.loads((ROOT / "voice.json").read_text(encoding="utf-8-sig"))
    base = (ROOT / config["modelPath"]).resolve()
    torch.set_num_threads(8)
    model = Qwen3TTSModel.from_pretrained(
        str(base), device_map="cpu", dtype=torch.float32,
        attn_implementation="sdpa", local_files_only=True,
    )
    prompt = model.create_voice_clone_prompt(
        ref_audio=str(ROOT / "reference.wav"), ref_text=config["referenceText"],
    )
    synthesis_lock = threading.Lock()
    cache = OrderedDict()
    preview = ROOT / "preview.wav"
    if config.get("previewText") and preview.is_file():
        cache[("English", 1234, config["previewText"])] = preview.read_bytes()

    class Handler(BaseHTTPRequestHandler):
        def check_client(self, *_):
            readable, _, _ = select.select([self.connection], [], [], 0)
            if readable:
                try:
                    if not self.connection.recv(1, socket.MSG_PEEK):
                        raise ClientDisconnected()
                except ConnectionError as exc:
                    raise ClientDisconnected() from exc

        def respond(self, status, payload, mime="application/json"):
            try:
                self.send_response(status)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except ConnectionError:
                pass

        def error(self, status, message):
            self.respond(status, json.dumps({"error": {"message": message}}).encode())

        def do_GET(self):
            if self.path not in ("/", "/health"):
                self.error(404, "Unknown endpoint")
                return
            self.respond(200, b'{"ready":true,"voice":"miku-expressive"}')

        def do_POST(self):
            if self.path != "/v1/audio/speech":
                self.error(404, "Unknown endpoint")
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 16384:
                    raise ValueError("Invalid request length")
                body = json.loads(self.rfile.read(size))
                text = body.get("input")
                if not isinstance(text, str) or not 0 < len(text.strip()) <= 500:
                    raise ValueError("Expected 1 to 500 characters of text")
                language = {"en": "English", "ja": "Japanese"}.get(body.get("language", "en"))
                if language is None or body.get("response_format", "wav") != "wav":
                    raise ValueError("Expected English or Japanese and WAV")
                seed = int(body.get("seed", 1234))
                if not 0 <= seed <= 2**32 - 1:
                    raise ValueError("Invalid seed")
            except (TypeError, ValueError, AttributeError) as exc:
                self.error(400, str(exc))
                return
            try:
                key = (language, seed, text.strip())
                with synthesis_lock:
                    self.check_client()
                    if key not in cache:
                        hook = model.model.talker.register_forward_pre_hook(self.check_client)
                        try:
                            torch.manual_seed(seed)
                            wavs, rate = model.generate_voice_clone(
                                text=key[2], language=language, voice_clone_prompt=prompt,
                                max_new_tokens=150, temperature=0.7,
                            )
                        finally:
                            hook.remove()
                        wave = np.asarray(wavs[0])
                        if wave.size == 0 or not np.isfinite(wave).all():
                            raise RuntimeError("Voice engine returned invalid audio")
                        buffer = io.BytesIO()
                        sf.write(buffer, wave, rate, format="WAV", subtype="PCM_16")
                        cache[key] = buffer.getvalue()
                        if len(cache) > 32:
                            cache.popitem(last=False)
                    cache.move_to_end(key)
                    payload = cache[key]
                self.respond(200, payload, "audio/wav")
            except ClientDisconnected:
                self.log_message("Speech request canceled")
            except Exception as exc:
                self.error(500, str(exc))

    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        print(f"Miku expressive voice ready at 127.0.0.1:{args.port}", flush=True)
        server.serve_forever()

if __name__ == "__main__":
    main()
