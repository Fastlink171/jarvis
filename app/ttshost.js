'use strict';
/*
  Runs the custom trained voice engine for you: finds the voice folder (the KoboldCpp runtime + .gguf models),
  starts it hidden in the background when the custom voice is chosen, and closes it when the app quits.
  If a voice server is already running at that address (e.g. you started Start-TTS.cmd yourself), it is reused.
*/
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const tts = require('./tts');

const isExe = f => /^koboldcpp.*\.exe$/i.test(f) || /^koboldcpp(-[\w.-]+)?$/i.test(f);
function list(d) { try { return fs.readdirSync(d); } catch { return []; } }

// What's needed inside a voice folder: the runtime exe and two .gguf files (the voice + its audio tokenizer)
function findEngine(dir) {
  if (!dir || !fs.existsSync(dir)) return { ok: false, error: 'voice folder not found' };
  const exeDir = [path.join(dir, 'runtime'), dir].find(d => list(d).some(isExe));
  const exes = exeDir ? list(exeDir).filter(isExe) : [];
  const exe = exes.length ? path.join(exeDir, exes.find(f => /nocuda/i.test(f)) || exes.find(f => /\.exe$/i.test(f)) || exes[0]) : null;
  const mdir = [path.join(dir, 'models'), dir].find(d => list(d).some(f => /\.gguf$/i.test(f)));
  const ggufs = mdir ? list(mdir).filter(f => /\.gguf$/i.test(f)) : [];
  const tok = ggufs.find(f => /tokenizer/i.test(f));
  const voice = ggufs.filter(f => f !== tok).sort((a, b) => (/custom|trained/i.test(b) ? 1 : 0) - (/custom|trained/i.test(a) ? 1 : 0))[0];
  if (!exe) return { ok: false, error: 'no koboldcpp program in that folder (looked in it and its "runtime" folder)' };
  if (!voice || !tok) return { ok: false, error: 'the voice model files (.gguf) are missing from its "models" folder' };
  return { ok: true, dir, exe, model: path.join(mdir, voice), tokenizer: path.join(mdir, tok) };
}

// Look a few folders deep for one that holds a voice engine (the trained voice package lands deep inside Documents\Codex)
function search(roots, maxDepth = 5) {
  const seen = new Set();
  const walk = (d, depth) => {
    if (depth > maxDepth || seen.has(d) || seen.size > 4000) return null; seen.add(d);
    const names = list(d);
    if (names.includes('models') && (names.includes('runtime') || names.some(isExe)) && findEngine(d).ok) return d;
    for (const n of names) {
      if (n.startsWith('.') || /^(node_modules|runtime-temp|checkpoint|adapter|\$recycle\.bin)$/i.test(n)) continue;
      const p = path.join(d, n); let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) { const r = walk(p, depth + 1); if (r) return r; }
    }
    return null;
  };
  for (const r of roots) { const f = r && walk(r, 0); if (f) return f; }
  return null;
}

function createHost({ log = () => {}, platform = process.platform, readyTimeoutMs = 180000 } = {}) {
  let proc = null, starting = null, tail = '';
  const state = { running: false, ours: false, error: '' };

  function stop() {
    const p = proc; proc = null; state.running = false; state.ours = false;
    if (!p || p.exitCode !== null) return;
    try { if (platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else p.kill('SIGKILL'); } catch {}
  }

  // Make sure a voice server answers at `url`, starting the engine from `dir` if needed. Resolves to state.
  function ensure(dir, url) {
    if (starting) return starting;
    starting = (async () => {
      const u = tts.checkUrl(url);
      if ((await tts.ping(url, 1500)).ok) { state.running = true; state.error = ''; return { ...state }; }
      if (proc && proc.exitCode === null) stop();          // ours but not answering: start over
      const eng = findEngine(dir);
      if (!eng.ok) { state.running = false; state.error = eng.error; return { ...state }; }
      const port = u.port || (u.protocol === 'https:' ? '443' : '80');
      const temp = path.join(eng.dir, 'runtime-temp'); try { fs.mkdirSync(temp, { recursive: true }); } catch {}
      const args = ['--usevulkan', '--ttsgpu', '--ttsmodel', eng.model, '--ttswavtokenizer', eng.tokenizer, '--host', '127.0.0.1', '--port', String(port), '--skiplauncher'];
      log('starting voice engine: ' + path.basename(eng.exe));
      tail = '';
      const p = spawn(eng.exe, args, { cwd: eng.dir, windowsHide: true, env: { ...process.env, TEMP: temp, TMP: temp }, stdio: ['ignore', 'pipe', 'pipe'] });
      proc = p;
      const keep = d => { tail = (tail + d.toString()).slice(-2000); };
      p.stdout.on('data', keep); p.stderr.on('data', keep);
      let exited = null; p.on('exit', code => { exited = code; if (proc === p) { proc = null; state.running = false; state.ours = false; } });
      p.on('error', e => { exited = -1; tail += '\n' + e.message; });
      const t0 = Date.now();
      while (Date.now() - t0 < readyTimeoutMs) {
        if (exited !== null) {
          const why = tail.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
          state.running = false; state.error = 'voice engine closed on start' + (why ? ': ' + why : ''); return { ...state };
        }
        if ((await tts.ping(url, 1500)).ok) { state.running = true; state.ours = true; state.error = ''; log('voice engine ready (' + Math.round((Date.now() - t0) / 1000) + ' s)'); return { ...state }; }
        await new Promise(r => setTimeout(r, 700));
      }
      stop(); state.error = 'voice engine took too long to start'; return { ...state };
    })().finally(() => { starting = null; });
    return starting;
  }
  return { ensure, stop, state: () => ({ ...state, starting: !!starting }) };
}

module.exports = { findEngine, search, createHost };
