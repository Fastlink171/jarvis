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
const wakeW = makeWorker('wake');

/* ------------------------------------------------------------ "Hey Jarvis" wake word (always-on, tiny, CPU) */
let wakeOn = false, wakeReady = false, wakeCb = null, wakeAcc = new Float32Array(0), wakePending = 0, wakeCooldown = 0;
const recent = [];                                     // last ~0.6 s of mic frames, to catch speech right after the wake word
V.wakeThreshold = 0.5; V.wakeScore = 0;
async function setWakeWord(on, onWake) {
  if (on) {
    if (!wakeReady) { await wakeW('wakeInit'); wakeReady = true; }
    await startMic();
    wakeCb = onWake; wakeOn = true;
  } else { wakeOn = false; wakeCb = null; }
}
function feedWake(f) {
  const n = new Float32Array(wakeAcc.length + f.length); n.set(wakeAcc);
  for (let i = 0; i < f.length; i++) n[wakeAcc.length + i] = Math.round(Math.max(-1, Math.min(1, f[i])) * 32767);
  wakeAcc = n;
  while (wakeAcc.length >= 1280) {
    const chunk = wakeAcc.slice(0, 1280); wakeAcc = wakeAcc.slice(1280);
    if (wakePending > 6) continue;                     // never fall behind real time
    wakePending++;
    wakeW('wakeFeed', { chunk }, null, [chunk.buffer]).then(score => {
      wakePending--; V.wakeScore = score;
      const now = performance.now();
      const talking = V.speaking || now < mutedUntil;
      const selfSay = /jarvis/i.test(V.currentText || '');
      const need = talking ? Math.max(V.wakeThreshold, 0.6) : V.wakeThreshold;
      if (score >= need && wakeOn && now > wakeCooldown && mode !== 'once' && !(talking && selfSay)) {
        wakeCooldown = now + 2500;
        wakeCb && wakeCb(score, talking);
      }
    }).catch(() => { wakePending--; });
  }
}


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
  recent.push(f); if (recent.length > 19) recent.shift();
  if (wakeOn) feedWake(f);
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
async function listenOnce(timeoutMs = 7000, seedRecent = false) {
  await startMic();
  if (onceResolve) { onceResolve(''); onceResolve = null; }
  mode = 'once'; armed = true; recording = false; preRoll = seedRecent ? recent.slice(-10) : []; loud = 0; setVad('armed');
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
function listVoices(all) {
  if (!voiceList.length) return MALE_VOICES.map(id => ({ id, name: id }));
  if (all) return voiceList;
  return voiceList.filter(v => /^[ab]m_/.test(v.id) || (/male/i.test(v.gender || '') && !/female/i.test(v.gender || '')));
}
function setSpeaking(on) { if (V.speaking === on) return; V.speaking = on; if (!on) mutedUntil = performance.now() + 400; V.onSpeakingChange && V.onSpeakingChange(on); }

function splitSentences(text) {
  const clean = String(text).replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, 'the link').replace(/[*_#`>|]/g, '').replace(/\s+/g, ' ').trim();
  const parts = clean.match(/[^.!?;:。！？]+(?:[.!?;:。！？]+|$)/g) || [clean];
  const out = []; let cur = '';
  for (const p of parts) { if ((cur + p).length < 40) cur += p; else { if (cur) out.push(cur.trim()); cur = p; } }
  if (cur.trim()) out.push(cur.trim());
  // long sentences take long to render: split them at commas so speech starts sooner and flows on
  const fin = [];
  for (const sn of out) {
    if (sn.length <= 110) { fin.push(sn); continue; }
    let c = '';
    for (const piece of sn.split(/(?<=,)\s+|\s+(?=(?:and|but|so|because|which|while|although)\s)/)) { if ((c + ' ' + piece).length > 90 && c.length > 30) { fin.push(c.trim()); c = piece; } else c = c ? c + ' ' + piece : piece; }
    if (c.trim()) fin.push(c.trim());
  }
  return fin.filter(s => /[\p{L}\p{N}]/u.test(s));
}

// opts: { engine: 'kokoro'|'custom'|'windows', voice, speed, winVoice, rate, pitch, customUrl }
function speak(text, opts = {}) {
  const parts = splitSentences(text);
  if (!parts.length) return Promise.resolve();
  return new Promise(resolve => {
    parts.forEach((p, i) => {
      const item = { text: p, opts, done: i === parts.length - 1 ? resolve : null, gen: genId };
      // start rendering right away, while earlier sentences are still playing — no gaps between sentences
      if (opts.engine === 'custom') item.audioP = synthCustom(item).catch(e => { customFailed(e); return V.voiceReady ? synth(item).catch(() => null) : null; });
      else if (opts.engine !== 'windows' && V.voiceReady) item.audioP = synth(item).catch(e => { V.log('voice error: ' + e.message); return null; });
      queue.push(item);
    });
    runQueue();
  });
}
async function runQueue() {
  if (qRunning) return; qRunning = true;
  while (queue.length) {
    const item = queue.shift();
    if (item.gen !== genId) { item.done && item.done(); continue; }
    setSpeaking(true);
    V.currentText = item.text;
    try {
      if (item.audioP) {
        const audio = await item.audioP;
        if (audio && item.gen === genId) await play(audio);
        else if (!audio && item.gen === genId) await speakWindows(item.text, item.opts);
      } else await speakWindows(item.text, item.opts);
    } catch (e) { V.log('voice error: ' + e.message); try { await speakWindows(item.text, item.opts); } catch {} }
    item.done && item.done();
  }
  V.currentText = '';
  qRunning = false; setSpeaking(false);
}
const synthCache = new Map();
function synth(item) {
  // pitch is applied when playing (faster playback = higher), so render slower by the same amount to keep the pace
  const pitch = Math.max(.8, Math.min(1.25, +item.opts.kpitch || 1)) * (+item.opts.basePitch || 1), speed = (item.opts.speed || 1) / pitch;
  const blend = item.opts.blend && item.opts.blend.voice && item.opts.blend.amount > 0 ? item.opts.blend : null;
  const key = (item.opts.voice || 'bm_george') + '|' + speed + '|' + (blend ? blend.voice + ':' + blend.amount : '') + '|' + item.text;
  if (synthCache.has(key)) { const c = synthCache.get(key); return Promise.resolve({ samples: c.samples.slice(), rate: c.rate, pitch }); }
  return mouth('synth', { text: item.text, voice: item.opts.voice || 'bm_george', speed, blend }).then(a => {
    a.pitch = pitch;
    if (item.text.length <= 24) { synthCache.set(key, { samples: a.samples.slice(), rate: a.rate }); if (synthCache.size > 40) synthCache.delete(synthCache.keys().next().value); }
    return a;
  });
}
// Custom trained voice: a local TTS server reached through the main process (app/tts.js), one sentence at a time and
// in order — it renders a whole sentence before answering. If it fails, the sentence falls back to Kokoro or Windows.
let customChain = Promise.resolve(), ttsSeq = 0, lastCustomErr = '', lastCustomErrAt = 0;
function synthCustom(item) {
  const p = customChain.then(async () => {
    if (item.gen !== genId) return null;                      // stopped while waiting its turn
    const r = await window.jarvis.tts.speak('t' + (++ttsSeq), item.text, { url: item.opts.customUrl });
    if (!r.ok) { if (r.code === 'cancelled') return null; const e = new Error(r.error); e.code = r.code; throw e; }
    if (item.gen !== genId) return null;
    if (!playCtx) playCtx = new AudioContext();
    const w = r.wav, a = await playCtx.decodeAudioData(w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength));
    if (V.customError) { V.customError = ''; V.onCustomOk && V.onCustomOk(); }
    return { samples: a.getChannelData(0), rate: a.sampleRate, pitch: 1 };
  });
  customChain = p.catch(() => {});
  return p;
}
function customFailed(e) {
  const now = Date.now(); V.customError = e.message;
  if (e.message !== lastCustomErr || now - lastCustomErrAt > 30000) { V.log(e.message + ' — using the fallback voice'); V.onCustomError && V.onCustomError(e); }
  lastCustomErr = e.message; lastCustomErrAt = now;
}
function prepare(texts, opts = {}) { return Promise.all(texts.map(text => synth({ text, opts }).catch(() => null))); }
function play({ samples, rate, pitch }) {
  return new Promise(res => {
    if (!playCtx) playCtx = new AudioContext();
    const buf = playCtx.createBuffer(1, samples.length, rate);
    buf.copyToChannel(samples, 0);
    const src = playCtx.createBufferSource(); src.buffer = buf; if (pitch && pitch !== 1) src.playbackRate.value = pitch;
    const an = playCtx.createAnalyser(); an.fftSize = 256; const data = new Uint8Array(an.frequencyBinCount);
    src.connect(an); an.connect(playCtx.destination);
    playing = src;
    const iv = setInterval(() => { an.getByteFrequencyData(data); let s = 0; for (const v of data) s += v; V.outLevel = Math.min(1, s / data.length / 60); }, 50);
    src.onended = () => { clearInterval(iv); V.outLevel = 0; playing = null; res(); };
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
  try { window.jarvis && window.jarvis.tts && window.jarvis.tts.abort(null); } catch {}
  setSpeaking(false);
}

// self-test of the speech runtime (used by diagnostics)
function selfTest(bytes, device = 'wasm') { return ear('selfTest', { bytes, device }); }
Object.assign(V, { selfTest, setWakeWord, prepare, loadHearing, transcribe, startMic, stopMic, listenOnce, cancelListen, setContinuous, loadVoice, listVoices, speak, stopSpeaking, splitSentences, MALE_VOICES });
window.JarvisVoice = V;
window.dispatchEvent(new Event('jarvis-voice-ready'));
