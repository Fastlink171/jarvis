// Mic, voice activity detection and audio playback run here (cheap). The speech models run in two
// background workers (see voice-worker.js) so the window stays smooth while Jarvis listens and talks.

const V = {
  hearingReady: false, hearingModel: null, hearingDevice: null,
  voiceReady: false, voiceDevice: null,
  micOn: false, level: 0, speaking: false, sensitivity: 0.5,
  onLevel: null, onSpeakingChange: null, onVadState: null, log: () => {}
};

/* ------------------------------------------------------------ workers */
function makeWorker(name) {
  const w = new Worker(new URL('./voice-worker.js', location.href).href, { type: 'module', name });
  const calls = new Map(); let seq = 0;
  w.onmessage = ({ data: m }) => {
    if (m.log) { V.log(m.log); return; }
    const c = calls.get(m.id); if (!c) return;
    if (m.progress) { c.onProgress && c.onProgress(m.progress); return; }
    calls.delete(m.id);
    m.error ? c.reject(new Error(m.error)) : c.resolve(m.result);
  };
  w.onerror = e => { V.log(name + ' worker error: ' + (e.message || 'crashed')); for (const c of calls.values()) c.reject(new Error('voice engine crashed')); calls.clear(); };
  return (type, payload = {}, onProgress, transfer) => new Promise((resolve, reject) => {
    const id = ++seq; calls.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, type, ...payload }, transfer || []);
  });
}
const ear = makeWorker('hearing');
const mouth = makeWorker('voice');

/* ------------------------------------------------------------ hearing */
async function loadHearing(model = 'whisper-base.en', onProgress) {
  if (V.hearingReady && V.hearingModel === model) return true;
  V.hearingReady = false;
  const r = await ear('loadHearing', { model }, onProgress);
  V.hearingDevice = r.device; V.hearingModel = model; V.hearingReady = true;
  return true;
}
const HALLU = /^\s*(\[[^\]]*\]|\([^)]*\)|thank you\.?|thanks for watching[.!]*|you\.?|bye\.?|\.+|okay\.?|so\.?|uh\.?|um\.?)\s*$/i;
async function transcribe(samples) {
  if (!V.hearingReady) throw new Error('Hearing is not loaded yet.');
  const text = await ear('transcribe', { samples }, null, [samples.buffer]);
  return HALLU.test(text) ? '' : text;
}

/* ------------------------------------------------------------ microphone + VAD */
let ctx = null, stream = null, node = null, srcNode = null;
const FRAME = 512;                          // 32 ms at 16 kHz
let frameBuf = new Float32Array(0);
let noise = 0.004, armed = false, recording = false, recBuf = [], preRoll = [], loud = 0, quiet = 0, armTimer = null;
let mode = 'off';                           // off | once | continuous
let onceResolve = null, onUtter = null, mutedUntil = 0;

async function startMic() {
  if (V.micOn) return;
  stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  ctx = new AudioContext();                 // mic's native rate; resampled to 16 kHz below
  resampleRatio = ctx.sampleRate / 16000; resampleCarry = 0; rsLeft = new Float32Array(0);
  await ctx.audioWorklet.addModule(new URL('./mic-worklet.js', location.href).href);
  srcNode = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, 'mic-tap');
  node.port.onmessage = e => onSamples(e.data);
  srcNode.connect(node);
  V.micOn = true;
}
function stopMic() {
  mode = 'off'; armed = false; recording = false;
  try { srcNode && srcNode.disconnect(); node && node.disconnect(); } catch {}
  try { stream && stream.getTracks().forEach(t => t.stop()); } catch {}
  try { ctx && ctx.close(); } catch {}
  ctx = stream = node = srcNode = null; V.micOn = false; V.level = 0;
  setVad('off');
}
function setVad(s) { V.vad = s; V.onVadState && V.onVadState(s); }

let resampleRatio = 1, resampleCarry = 0, rsLeft = new Float32Array(0);
function to16k(input) {
  if (Math.abs(resampleRatio - 1) < 1e-6) return input;
  const x = new Float32Array(rsLeft.length + input.length); x.set(rsLeft); x.set(input, rsLeft.length);
  const out = []; let pos = resampleCarry;
  while (pos + resampleRatio <= x.length) {           // average of each output sample's span
    const a = Math.floor(pos), b = Math.floor(pos + resampleRatio);
    let sum = 0; for (let i = a; i < b; i++) sum += x[i];
    out.push(sum / Math.max(1, b - a)); pos += resampleRatio;
  }
  const keep = Math.floor(pos); rsLeft = x.slice(keep); resampleCarry = pos - keep;
  return Float32Array.from(out);
}
function onSamples(raw) {
  const chunk = to16k(raw);
  const merged = new Float32Array(frameBuf.length + chunk.length);
  merged.set(frameBuf); merged.set(chunk, frameBuf.length); frameBuf = merged;
  while (frameBuf.length >= FRAME) { processFrame(frameBuf.slice(0, FRAME)); frameBuf = frameBuf.slice(FRAME); }
}
function processFrame(f) {
  let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  const rms = Math.sqrt(s / f.length);
  V.level = Math.min(1, rms * 18); V.onLevel && V.onLevel(V.level);
  const muted = V.speaking || performance.now() < mutedUntil;
  if (!armed || muted) {
    if (!recording) noise = noise * 0.98 + Math.min(rms, 0.05) * 0.02;
    if (muted && recording && mode === 'continuous') { recording = false; recBuf = []; setVad('armed'); }
    return;
  }
  const thr = Math.max(0.006, noise * (2.2 + (1 - V.sensitivity) * 3));
  if (!recording) {
    preRoll.push(f); if (preRoll.length > 10) preRoll.shift();
    noise = noise * 0.97 + Math.min(rms, 0.05) * 0.03;
    loud = rms > thr ? loud + 1 : 0;
    if (loud >= 3) { recording = true; recBuf = preRoll.slice(); preRoll = []; quiet = 0; setVad('recording'); clearTimeout(armTimer); }
  } else {
    recBuf.push(f);
    quiet = rms < thr * 0.8 ? quiet + 1 : 0;
    const secs = recBuf.length * FRAME / 16000;
    const endAfter = mode === 'once' ? 30 : 25;           // ~0.95 s / 0.8 s of silence
    if (quiet >= endAfter || secs > 20) finishUtterance();
  }
}
function finishUtterance() {
  recording = false;
  const total = recBuf.reduce((a, b) => a + b.length, 0);
  const audio = new Float32Array(total); let o = 0; for (const b of recBuf) { audio.set(b, o); o += b.length; }
  recBuf = [];
  if (mode === 'once') { armed = false; mode = 'off'; setVad('processing'); }
  else setVad('armed');
  if (total < 16000 * 0.35) { if (onceResolve) { onceResolve(''); onceResolve = null; setVad('off'); } return; }
  const handler = onceResolve; onceResolve = null;
  transcribe(audio).then(t => {
    if (handler) { setVad('off'); handler(t); }
    else if (onUtter && t) onUtter(t);
  }).catch(e => { V.log('hearing error: ' + e.message); if (handler) { setVad('off'); handler(''); } });
}
async function listenOnce(timeoutMs = 7000) {
  await startMic();
  if (onceResolve) { onceResolve(''); onceResolve = null; }
  mode = 'once'; armed = true; recording = false; preRoll = []; loud = 0; setVad('armed');
  return new Promise(res => {
    onceResolve = res;
    clearTimeout(armTimer);
    armTimer = setTimeout(() => { if (mode === 'once' && !recording) { armed = false; mode = 'off'; setVad('off'); if (onceResolve) { onceResolve(''); onceResolve = null; } } }, timeoutMs);
  });
}
function cancelListen() { clearTimeout(armTimer); armed = recording = false; if (mode === 'once') mode = 'off'; if (onceResolve) { onceResolve(''); onceResolve = null; } setVad(mode === 'continuous' ? 'armed' : 'off'); }
async function setContinuous(on, cb) {
  if (on) { await startMic(); onUtter = cb; mode = 'continuous'; armed = true; setVad('armed'); }
  else { onUtter = null; if (mode === 'continuous') { mode = 'off'; armed = false; recording = false; setVad('off'); } }
}

/* ------------------------------------------------------------ voice */
let playCtx = null, playing = null, queue = [], qRunning = false, genId = 0, voiceList = [];
const MALE_VOICES = ['bm_george', 'bm_lewis', 'bm_daniel', 'bm_fable', 'am_michael', 'am_adam', 'am_eric', 'am_liam', 'am_onyx', 'am_echo', 'am_puck', 'am_fenrir'];
async function loadVoice(onProgress) {
  if (V.voiceReady) return true;
  const r = await mouth('loadVoice', {}, onProgress);
  voiceList = r.voices || []; V.voiceDevice = r.device; V.voiceReady = true;
  return true;
}
function listVoices() {
  if (!voiceList.length) return MALE_VOICES.map(id => ({ id, name: id }));
  return voiceList.filter(v => /^[ab]m_/.test(v.id) || (/male/i.test(v.gender || '') && !/female/i.test(v.gender || '')));
}
function setSpeaking(on) { if (V.speaking === on) return; V.speaking = on; if (!on) mutedUntil = performance.now() + 400; V.onSpeakingChange && V.onSpeakingChange(on); }

function splitSentences(text) {
  const clean = String(text).replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, 'the link').replace(/[*_#`>|]/g, '').replace(/\s+/g, ' ').trim();
  const parts = clean.match(/[^.!?;:]+(?:[.!?;:]+|$)/g) || [clean];
  const out = []; let cur = '';
  for (const p of parts) { if ((cur + p).length < 40) cur += p; else { if (cur) out.push(cur.trim()); cur = p; } }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(s => /\w/.test(s));
}

// opts: { engine: 'kokoro'|'windows', voice, speed, winVoice, rate, pitch }
function speak(text, opts = {}) {
  const parts = splitSentences(text);
  if (!parts.length) return Promise.resolve();
  return new Promise(resolve => {
    parts.forEach((p, i) => queue.push({ text: p, opts, done: i === parts.length - 1 ? resolve : null, gen: genId }));
    runQueue();
  });
}
async function runQueue() {
  if (qRunning) return; qRunning = true;
  let pending = null;   // pre-synthesised next sentence
  while (queue.length) {
    const item = queue.shift();
    if (item.gen !== genId) { item.done && item.done(); continue; }
    setSpeaking(true);
    const useKokoro = item.opts.engine !== 'windows' && V.voiceReady;
    try {
      if (useKokoro) {
        const audio = pending && pending.text === item.text ? await pending.p : await synth(item);
        pending = null;
        const nxt = queue[0];
        if (nxt && nxt.gen === genId && nxt.opts.engine !== 'windows') pending = { text: nxt.text, p: synth(nxt).catch(() => null) };
        if (audio && item.gen === genId) await play(audio);
      } else await speakWindows(item.text, item.opts);
    } catch (e) { V.log('voice error: ' + e.message); try { await speakWindows(item.text, item.opts); } catch {} }
    item.done && item.done();
  }
  qRunning = false; setSpeaking(false);
}
function synth(item) {
  return mouth('synth', { text: item.text, voice: item.opts.voice || 'bm_george', speed: item.opts.speed || 1 });
}
function play({ samples, rate }) {
  return new Promise(res => {
    if (!playCtx) playCtx = new AudioContext();
    const buf = playCtx.createBuffer(1, samples.length, rate);
    buf.copyToChannel(samples, 0);
    const src = playCtx.createBufferSource(); src.buffer = buf;
    const an = playCtx.createAnalyser(); an.fftSize = 256; const data = new Uint8Array(an.frequencyBinCount);
    src.connect(an); an.connect(playCtx.destination);
    playing = src;
    let raf = 0; const meter = () => { an.getByteFrequencyData(data); let s = 0; for (const v of data) s += v; V.outLevel = Math.min(1, s / data.length / 60); raf = requestAnimationFrame(meter); }; meter();
    src.onended = () => { cancelAnimationFrame(raf); V.outLevel = 0; playing = null; res(); };
    src.start();
  });
}
function speakWindows(text, opts) {
  return new Promise(res => {
    if (!('speechSynthesis' in window)) return res();
    const u = new SpeechSynthesisUtterance(text);
    const vs = speechSynthesis.getVoices();
    const v = vs.find(x => x.name === opts.winVoice) || vs.find(x => /david|mark|george|guy|ryan|james|male/i.test(x.name) && /^en/i.test(x.lang)) || vs.find(x => /^en/i.test(x.lang));
    if (v) u.voice = v;
    u.rate = opts.rate || 1; u.pitch = opts.pitch || 0.9;
    u.onboundary = () => { V.outLevel = 0.6; setTimeout(() => V.outLevel = 0, 120); };
    u.onend = u.onerror = () => res();
    speechSynthesis.speak(u);
  });
}
function stopSpeaking() {
  genId++; queue.forEach(q => q.done && q.done()); queue = [];
  try { playing && playing.stop(); } catch {}
  try { speechSynthesis.cancel(); } catch {}
  setSpeaking(false);
}

// self-test of the speech runtime (used by diagnostics)
function selfTest(bytes, device = 'wasm') { return ear('selfTest', { bytes, device }); }
Object.assign(V, { selfTest, loadHearing, transcribe, startMic, stopMic, listenOnce, cancelListen, setContinuous, loadVoice, listVoices, speak, stopSpeaking, splitSentences, MALE_VOICES });
window.JarvisVoice = V;
window.dispatchEvent(new Event('jarvis-voice-ready'));
