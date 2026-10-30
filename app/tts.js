'use strict';
/*
  Custom trained voice: a local text-to-speech server on this PC (e.g. the KoboldCpp Qwen3-TTS export,
  started with its Start-TTS.cmd). Jarvis only ever talks to it on this computer (127.0.0.1 / localhost) —
  replies and audio are never sent anywhere else. The server buffers a whole sentence and returns one WAV.
*/
const DEFAULT_URL = 'http://127.0.0.1:5003/v1/audio/speech';
const DEFAULTS = { model: 'custom-trained-tts', voice: 'aiden', timeoutMs: 30000 };
const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function checkUrl(u) {
  let url;
  try { url = new URL(String(u || DEFAULT_URL)); } catch { throw new Error('the custom voice address is not a valid URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('the custom voice address must start with http://');
  if (!LOCAL.has(url.hostname)) throw new Error('the custom voice server must be on this PC (127.0.0.1 or localhost)');
  return url;
}
// Japanese text gets 'ja'; everything else 'en' (the only two the trained voice was checked with)
const langOf = text => /[぀-ヿ㐀-鿿ｦ-ﾟ]/.test(text) ? 'ja' : 'en';

function friendly(err, url, timeoutMs, cancelled) {
  if (cancelled) { const e = new Error('cancelled'); e.code = 'cancelled'; return e; }
  if (err && err.name === 'AbortError') { const e = new Error(`custom voice server took longer than ${Math.round(timeoutMs / 1000)} s`); e.code = 'timeout'; return e; }
  const c = err && (err.cause && err.cause.code || err.code);
  if (c === 'ECONNREFUSED' || c === 'ECONNRESET' || c === 'EHOSTUNREACH' || /fetch failed/i.test(err && err.message || '')) {
    const e = new Error(`custom voice server isn't running at ${url.host} — start Start-TTS.cmd and keep its window open`); e.code = 'offline'; return e;
  }
  return err instanceof Error ? err : new Error(String(err));
}

const inflight = new Map();   // id -> { ac, cancelled }

async function speak(id, text, opts = {}) {
  const url = checkUrl(opts.url);
  const timeoutMs = Math.max(2000, Math.min(120000, +opts.timeoutMs || DEFAULTS.timeoutMs));
  const body = {
    model: opts.model || DEFAULTS.model, input: String(text || ''), voice: opts.voice || DEFAULTS.voice,
    language: opts.language || langOf(String(text || '')), response_format: 'wav'
  };
  const ac = new AbortController(), rec = { ac, cancelled: false };
  if (id != null) inflight.set(id, rec);
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body), signal: ac.signal });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok) { let m = buf.toString('utf8').slice(0, 300); try { const j = JSON.parse(m); m = (j.error && (j.error.message || j.error)) || j.detail || m; } catch {} throw new Error(`custom voice server error ${r.status}${m ? ': ' + m : ''}`); }
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('custom voice server did not send WAV audio — check its console window');
    return buf;
  } catch (e) { throw friendly(e, url, timeoutMs, rec.cancelled); }
  finally { clearTimeout(t); if (id != null && inflight.get(id) === rec) inflight.delete(id); }
}
function abort(id) { const rec = inflight.get(id); if (rec) { rec.cancelled = true; rec.ac.abort(); } }
function abortAll() { for (const id of [...inflight.keys()]) abort(id); }

// Is the server up? Any HTTP answer from its address counts.
async function ping(u, timeoutMs = 2500) {
  const url = checkUrl(u);
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
  try { await fetch(url.origin + '/', { signal: ac.signal }); return { ok: true }; }
  catch (e) { return { ok: false, error: friendly(e, url, timeoutMs, false).message }; }
  finally { clearTimeout(t); }
}

module.exports = { DEFAULT_URL, DEFAULTS, speak, abort, abortAll, ping, langOf, checkUrl };
