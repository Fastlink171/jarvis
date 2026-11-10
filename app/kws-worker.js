'use strict';
/*
  Wake-phrase listener ("Hey <name>") for names other than Jarvis.
  A tiny streaming keyword spotter (sherpa-onnx, 3.3M parameters) that runs on the CPU in its own thread.
  Any phrase works without training: the name is split into the model's word pieces here.
  Messages in:  { type:'start', dir, phrases:[...], threshold }  { type:'feed', samples:Float32Array }  { type:'stop' }
  Messages out: { type:'ready' } { type:'hit', keyword } { type:'error', error }
*/
const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

let kws = null, stream = null, vocab = null, fed = 0, lastStat = Date.now();
// forward slashes everywhere: the runtime's file layer is happiest with them on Windows
const fwd = p => p.replace(/\\/g, '/');

function loadVocab(file) {
  return new Map(fs.readFileSync(file, 'utf8').trim().split('\n').map(l => { const [p, s] = l.split('\t'); return [p, +s]; }));
}
// best-scoring split of each word into the model's pieces (same result as SentencePiece for this model)
function encode(text) {
  const out = [];
  for (const w of String(text).toUpperCase().replace(/[^A-Z' ]/g, ' ').split(/\s+/).filter(Boolean)) {
    const s = '▁' + w, n = s.length, best = new Array(n + 1).fill(-Infinity), back = new Array(n + 1).fill(-1); best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      for (let j = i + 1; j <= n; j++) { const p = s.slice(i, j); if (vocab.has(p)) { const sc = best[i] + vocab.get(p) - 1; if (sc > best[j]) { best[j] = sc; back[j] = i; } } }
    }
    const pieces = []; for (let j = n; j > 0; j = back[j]) { if (back[j] < 0) return ''; pieces.unshift(s.slice(back[j], j)); }
    out.push(...pieces);
  }
  return out.join(' ');
}

function start(msg) {
  const sherpa = require('sherpa-onnx');
  const dir = fwd(msg.dir);
  vocab = loadVocab(dir + '/bpe.vocab');
  const thr = Math.max(0.05, Math.min(0.5, msg.threshold || 0.2));
  const seen = new Set();
  const lines = msg.phrases.map((p, i) => { const t = encode(p); if (!t || seen.has(t)) return ''; seen.add(t); return `${t} :2.0 #${thr.toFixed(3)} @k${i}`; }).filter(Boolean);
  if (!lines.length) throw new Error('could not spell the wake phrase');
  kws = sherpa.createKws({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: dir + '/encoder.int8.onnx', decoder: dir + '/decoder.onnx', joiner: dir + '/joiner.int8.onnx' },
      tokens: dir + '/tokens.txt', numThreads: 1, provider: 'cpu', debug: 0
    },
    keywords: lines.join('\n')
  });
  stream = kws.createStream();
  return lines;
}

parentPort.on('message', msg => {
  try {
    if (msg.type === 'start') { const lines = start(msg); parentPort.postMessage({ type: 'ready', lines }); }
    else if (msg.type === 'feed' && kws && stream) {
      stream.acceptWaveform(16000, msg.samples); fed += msg.samples.length;
      if (Date.now() - lastStat > 60000) { parentPort.postMessage({ type: 'stat', seconds: Math.round(fed / 16000) }); lastStat = Date.now(); }
      while (kws.isReady(stream)) {
        kws.decode(stream);
        const r = kws.getResult(stream);
        if (r && r.keyword) { kws.reset(stream); parentPort.postMessage({ type: 'hit', keyword: r.keyword }); }
      }
    } else if (msg.type === 'stop') { kws = null; stream = null; }
  } catch (e) { parentPort.postMessage({ type: 'error', error: String(e && e.message || e) }); }
});
