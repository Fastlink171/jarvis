// Runs speech models off the UI thread. Two copies run: one for hearing (Whisper), one for the voice (Kokoro),
// so Jarvis can listen while he talks and the window never freezes.
import { pipeline, env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import * as ort from 'onnxruntime-web';
import { WakeDetector, CHUNK } from './wake.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('./ort/', self.location.href).href;
env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, Math.floor(((navigator.hardwareConcurrency || 4) - 2) / 2)));

let asr = null, asrModel = null, tts = null, wake = null;
const post = (m, transfer) => self.postMessage(m, transfer || []);

async function hasGPU() { try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { return false; } }

async function loadHearing(model, onProgress) {
  if (asr && asrModel === model) return { device: asr._device };
  if (asr) { try { await asr.dispose(); } catch {} asr = null; }
  const id = 'onnx-community/' + model;
  const load = device => pipeline('automatic-speech-recognition', id, {
    device, dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8', progress_callback: onProgress
  });
  let device = 'cpu';
  if (await hasGPU()) { try { asr = await load('webgpu'); device = 'webgpu'; } catch (e) { post({ log: 'hearing: GPU failed, using CPU: ' + e.message }); } }
  if (!asr) asr = await load('wasm');
  asr._device = device; asrModel = model;
  return { device };
}

async function loadVoice(onProgress) {
  if (!tts) tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm', progress_callback: onProgress });
  const voices = Object.entries(tts.voices || {}).map(([id, v]) => ({ id, name: (v && v.name) || id, gender: v && v.gender }));
  return { device: 'cpu', voices };
}

self.onmessage = async ({ data: m }) => {
  const { id, type } = m;
  const progress = p => post({ id, progress: { status: p.status, file: p.file, loaded: p.loaded, total: p.total } });
  try {
    let result, transfer;
    switch (type) {
      case 'loadHearing': result = await loadHearing(m.model, progress); break;
      case 'transcribe': {
        if (!asr) throw new Error('Hearing is not loaded yet.');
        const r = await asr(m.samples, { chunk_length_s: 30, stride_length_s: 5 });
        result = String(r.text || '').replace(/\s+/g, ' ').trim();
        break;
      }
      case 'loadVoice': result = await loadVoice(progress); break;
      case 'synth': {
        if (!tts) throw new Error('Voice is not loaded yet.');
        const a = await tts.generate(m.text, { voice: m.voice || 'bm_george', speed: m.speed || 1 });
        result = { samples: a.audio, rate: a.sampling_rate }; transfer = [a.audio.buffer];
        break;
      }
      case 'wakeInit': {
        if (!wake) {
          ort.env.wasm.numThreads = 1;                        // tiny models: one thread is plenty
          const get = f => fetch(new URL('./wake/' + f, self.location.href).href).then(r => { if (!r.ok) throw new Error('missing ' + f); return r.arrayBuffer(); }).then(b => new Uint8Array(b));
          wake = await WakeDetector.create(ort, { mel: await get('melspectrogram.onnx'), emb: await get('embedding_model.onnx'), ww: await get('hey_jarvis_v0.1.onnx') });
        }
        result = { chunk: CHUNK }; break;
      }
      case 'wakeFeed': result = wake ? await wake.feed(m.chunk) : 0; break;
      case 'wakeReset': if (wake) await wake.reset(); result = true; break;
      case 'selfTest': {
        const sess = await ort.InferenceSession.create(m.bytes, { executionProviders: [m.device || 'wasm'] });
        const out = await sess.run({ x: new ort.Tensor('float32', new Float32Array([1, 2]), [2]) });
        result = Array.from(out.y.data); break;
      }
      default: throw new Error('unknown request ' + type);
    }
    post({ id, result }, transfer);
  } catch (e) { post({ id, error: String(e && e.message || e) }); }
};
post({ ready: true });
