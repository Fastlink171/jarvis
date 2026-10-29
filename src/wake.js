// "Hey Jarvis" wake-word detector — a JavaScript port of openWakeWord's streaming pipeline
// (https://github.com/dscripka/openWakeWord, Apache-2.0; the pre-trained models are CC BY-NC-SA 4.0).
// Pipeline per 80 ms of 16 kHz audio: melspectrogram model -> speech embedding model -> wake-word model.
// Tiny models, run on the CPU: listening all day costs almost nothing.

export const CHUNK = 1280;                 // 80 ms at 16 kHz
const MEL_CONTEXT = 160 * 3;               // extra samples the reference feeds the mel model
const MEL_MAX = 10 * 97, FEAT_MAX = 120;

export class WakeDetector {
  constructor(ort, sessions) {
    this.ort = ort; this.mel = sessions.mel; this.emb = sessions.emb; this.ww = sessions.ww;
    this.melIn = this.mel.inputNames[0]; this.embIn = this.emb.inputNames[0]; this.wwIn = this.ww.inputNames[0];
  }
  static async create(ort, bytes, opts = {}) {
    const so = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', ...opts };
    const [mel, emb, ww] = await Promise.all([bytes.mel, bytes.emb, bytes.ww].map(b => ort.InferenceSession.create(b, so)));
    const d = new WakeDetector(ort, { mel, emb, ww });
    await d.reset(opts.noise);
    return d;
  }

  async melspec(samples) {                  // samples: Float32Array of int16-scaled values
    const out = await this.mel.run({ [this.melIn]: new this.ort.Tensor('float32', samples, [1, samples.length]) });
    const t = out[this.mel.outputNames[0]], frames = t.dims[2], data = t.data, rows = [];
    for (let f = 0; f < frames; f++) {
      const r = new Float32Array(32);
      for (let k = 0; k < 32; k++) r[k] = data[f * 32 + k] / 10 + 2;
      rows.push(r);
    }
    return rows;
  }
  async embed(rows76) {                     // 76 mel rows -> 96-dim embedding
    const buf = new Float32Array(76 * 32);
    rows76.forEach((r, i) => buf.set(r, i * 32));
    const out = await this.emb.run({ [this.embIn]: new this.ort.Tensor('float32', buf, [1, 76, 32, 1]) });
    return Float32Array.from(out[this.emb.outputNames[0]].data);
  }

  // Start-up state, exactly as the reference: mel buffer of ones, feature buffer from 4 s of quiet noise.
  async reset(noise) {
    this.raw = new Float32Array(0);
    this.melBuf = Array.from({ length: 76 }, () => new Float32Array(32).fill(1));
    this.preds = 0;
    if (!noise) { let s = 12345; noise = new Float32Array(16000 * 4).map(() => { s = (s * 16807) % 2147483647; return Math.floor((s / 2147483647) * 2000) - 1000; }); }
    const rows = await this.melspec(noise);
    this.feat = [];
    for (let i = 0; i + 76 <= rows.length; i += 8) this.feat.push(await this.embed(rows.slice(i, i + 76)));
  }

  // Feed exactly CHUNK samples (int16-scaled floats). Returns the wake-word score 0..1.
  async feed(chunk) {
    const keep = CHUNK + MEL_CONTEXT;
    const raw = new Float32Array(Math.min(keep, this.raw.length + chunk.length));
    const old = this.raw.subarray(Math.max(0, this.raw.length - (raw.length - chunk.length)));
    raw.set(old); raw.set(chunk, old.length); this.raw = raw;
    this.melBuf.push(...await this.melspec(raw));
    if (this.melBuf.length > MEL_MAX) this.melBuf = this.melBuf.slice(-MEL_MAX);
    this.feat.push(await this.embed(this.melBuf.slice(-76)));
    if (this.feat.length > FEAT_MAX) this.feat = this.feat.slice(-FEAT_MAX);
    const f16 = new Float32Array(16 * 96);
    this.feat.slice(-16).forEach((v, i) => f16.set(v, i * 96));
    const out = await this.ww.run({ [this.wwIn]: new this.ort.Tensor('float32', f16, [1, 16, 96]) });
    const score = out[this.ww.outputNames[0]].data[0];
    return this.preds++ < 5 ? 0 : score;   // the reference ignores the first 5 predictions
  }
}
