'use strict';
/*
  Runs the custom trained voice server for you.

  - When M.I.K.U. launches (and whenever the custom voice is needed) it first asks the configured address whether a
    server is already answering. If one is, it is left alone.
  - If not, it launches your own experimental-trained-tts\Start.ps1 (hidden). If no Start.ps1 can be found it falls
    back to starting the KoboldCpp engine from the voice folder directly, as older versions did.
  - It waits until the server really answers before any sentence is sent to it.
  - It never starts a second copy: not while one is loading, not while something already holds the port, and not while
    a server it launched earlier (even from a previous run of M.I.K.U.) is still alive.
  - A watchdog notices when the server goes away while M.I.K.U. is running and restarts it after a short delay, a
    limited number of times.
  - Everything (including the exact error and the last lines Start.ps1 printed) goes to logs\tts-server.log.
  Nothing in the voice folder is changed: models, reference audio and settings are only ever read by your own script.
*/
const fs = require('fs'), path = require('path'), net = require('net'), { spawn, execFile } = require('child_process');
const tts = require('./tts');

const isExe = f => /^koboldcpp.*\.exe$/i.test(f) || /^koboldcpp(-[\w.-]+)?$/i.test(f);
function list(d) { try { return fs.readdirSync(d); } catch { return []; } }
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

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

/* ---------------------------------------------------------------- finding experimental-trained-tts\Start.ps1 */
const SCRIPT_DIR = /^experimental-trained-tts$/i;
const startIn = d => { const f = list(d).find(n => /^start\.ps1$/i.test(n)); return f ? path.join(d, f) : null; };
// 1) the voice folder itself or one of its parents is experimental-trained-tts, or holds it;
// 2) otherwise look a few folders deep under the usual places.
function findStartScript(voiceDir, roots = [], maxDepth = 6) {
  if (voiceDir) {
    let d = path.resolve(voiceDir);
    for (let i = 0; i < 5 && d; i++) {
      if (SCRIPT_DIR.test(path.basename(d)) && startIn(d)) return startIn(d);
      const child = list(d).find(n => SCRIPT_DIR.test(n));
      if (child && startIn(path.join(d, child))) return startIn(path.join(d, child));
      const up = path.dirname(d); if (up === d) break; d = up;
    }
  }
  const seen = new Set();
  const walk = (d, depth) => {
    if (depth > maxDepth || seen.has(d) || seen.size > 6000) return null; seen.add(d);
    for (const n of list(d)) {
      if (n.startsWith('.') || /^(node_modules|runtime-temp|checkpoint|adapter|\$recycle\.bin|AppData)$/i.test(n)) continue;
      const p = path.join(d, n); if (!isDir(p)) continue;
      if (SCRIPT_DIR.test(n) && startIn(p)) return startIn(p);
      const r = walk(p, depth + 1); if (r) return r;
    }
    return null;
  };
  for (const r of roots) { const f = r && walk(r, 0); if (f) return f; }
  return null;
}

/* ---------------------------------------------------------------- small helpers */
// Is anything accepting connections on the port? (true while a server is loading, before it answers HTTP)
function portOpen(host, port, timeoutMs = 800) {
  return new Promise(res => {
    const s = net.connect({ host, port });
    const done = v => { s.destroy(); res(v); };
    s.setTimeout(timeoutMs, () => done(false)); s.once('connect', () => done(true)); s.once('error', () => done(false));
  });
}
function pidAlive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
// Windows only: running processes as [{ name, pid }]
function processes(platform) {
  if (platform !== 'win32') return Promise.resolve([]);
  return new Promise(res => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 6000, maxBuffer: 8 << 20 }, (err, out) => {
    if (err) return res([]);
    res(String(out).split(/\r?\n/).map(l => l.match(/^"([^"]+)","(\d+)"/)).filter(Boolean).map(m => ({ name: m[1], pid: +m[2] })));
  }));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lastLines = (s, n = 6) => String(s || '').trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-n).join(' | ');

function fileLogger(file, maxBytes = 2 << 20) {
  if (!file) return () => {};
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch {}
  return line => {
    try {
      try { if (fs.statSync(file).size > maxBytes) fs.renameSync(file, file + '.1'); } catch {}
      fs.appendFileSync(file, new Date().toISOString() + '  ' + line + '\n');
    } catch {}
  };
}

/* ---------------------------------------------------------------- the host */
function createHost({
  log = () => {}, logFile = '', pidFile = '', platform = process.platform, readyTimeoutMs = 180000,
  // how a .ps1 is run; overridable for tests
  shell = script => ({ cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script] })
} = {}) {
  const toFile = fileLogger(logFile);
  const say = m => { toFile(m); try { log(m); } catch {} };     // important events: file + app
  const raw = m => toFile(m);                                  // the server's own output: file only

  let proc = null, starting = null, tail = '', quitting = false;
  const state = { running: false, ours: false, error: '', via: '', lastExit: '' };

  const readPid = () => { try { return JSON.parse(fs.readFileSync(pidFile, 'utf8')); } catch { return null; } };
  const writePid = o => { if (pidFile) try { fs.writeFileSync(pidFile, JSON.stringify(o)); } catch {} };
  const clearPid = pid => { if (!pidFile) return; const o = readPid(); if (!o || !pid || o.pid === pid) try { fs.unlinkSync(pidFile); } catch {} };

  async function killTree(pid) {
    if (!pid) return;
    if (platform === 'win32') {
      await new Promise(resolve => execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => resolve()));
    } else {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  }
  async function stop() {
    const p = proc; proc = null; state.running = false; state.ours = false;
    if (!p || p.exitCode !== null) return;
    say('stopping the voice server M.I.K.U. started (pid ' + p.pid + ')');
    p._stopping = true;
    await killTree(p.pid);
    clearPid(p.pid);
    if (starting) await starting;
  }

  // Something already starting/holding the server? Returns why (and launching another copy is skipped), or ''.
  async function busy(host, port) {
    if (proc && proc.exitCode === null) return 'the voice server M.I.K.U. started (pid ' + proc.pid + ') is still loading';
    if (await portOpen(host, port)) return 'something is already listening on port ' + port + ' but not answering yet (still loading?)';
    const prev = readPid();
    if (prev && pidAlive(prev.pid)) {
      const age = Date.now() - (prev.at || 0);
      if (age < readyTimeoutMs) return 'a voice server M.I.K.U. launched earlier (pid ' + prev.pid + ') is still starting';
      // ours from an earlier run, alive far longer than any start takes, and never answered: it is stuck
      const p = (await processes(platform)).find(x => x.pid === prev.pid);
      if (platform !== 'win32' || (p && /^(powershell|pwsh|koboldcpp)/i.test(p.name))) {
        say('voice server from an earlier run (pid ' + prev.pid + ') never answered — closing it before starting a fresh one');
        await killTree(prev.pid);
      }
      clearPid(prev.pid);
    }
    const kob = (await processes(platform)).find(x => /^koboldcpp/i.test(x.name));
    if (kob) return kob.name + ' (pid ' + kob.pid + ') is already running';
    return '';
  }

  // Wait for the server at `url` to answer. `p` is the process we launched (or null when waiting on someone else's).
  async function waitReady(url, p, label) {
    const t0 = Date.now();
    let exitInfo = null; if (p) p.once('exit', (code, sig) => { exitInfo = { code, sig }; });
    let toldExit0 = false;
    while (Date.now() - t0 < readyTimeoutMs) {
      if (p?._stopping) return { ...state, running: false, error: 'Voice server startup canceled' };
      if ((await tts.ping(url, 1500)).ok) {
        state.running = true; state.error = ''; state.ours = !!(p && p.exitCode === null) || state.ours;
        say('voice server ready at ' + new URL(url).host + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)');
        return { ...state };
      }
      if (p && (exitInfo || p.exitCode !== null)) {
        const code = exitInfo ? exitInfo.code : p.exitCode, sig = exitInfo && exitInfo.sig;
        if (code === 0 && state.via === 'script') {
          // the script may hand the server off to its own window/process and finish: keep waiting for the address
          if (!toldExit0) { say('Start.ps1 finished (exit code 0) — waiting for the server it launched to answer'); toldExit0 = true; state.ours = false; }
        } else {
          const why = lastLines(tail);
          state.running = false;
          state.error = label + ' exited with ' + (sig ? 'signal ' + sig : 'code ' + code) + ' before the server was ready' + (why ? ': ' + why : '');
          say('START FAILED: ' + state.error);
          return { ...state };
        }
      }
      await sleep(700);
    }
    const why = lastLines(tail);
    state.running = false;
    state.error = 'no answer at ' + new URL(url).host + ' after ' + Math.round(readyTimeoutMs / 1000) + ' s' +
      (p ? ' (' + label + ' was started; check that the port it uses matches the custom voice address)' : '') + (why ? ' — last output: ' + why : '');
    say('START FAILED: ' + state.error);
    if (p && p.exitCode === null && proc === p) stop();     // ours and stuck: don't leave it half-alive
    return { ...state };
  }

  // Make sure a voice server answers at `url`. `script` = Start.ps1 (preferred); `dir` = voice folder (fallback).
  function ensure(dir, url, script) {
    if (starting) return starting;
    starting = (async () => {
      const u = tts.checkUrl(url);
      const host = u.hostname.replace(/^\[|\]$/g, ''), port = +(u.port || (u.protocol === 'https:' ? 443 : 80));
      if ((await tts.ping(url, 1500)).ok) {
        if (!state.running) say('voice server already running at ' + u.host + ' — leaving it alone');
        state.running = true; state.error = ''; return { ...state };
      }
      const why = await busy(host, port);
      if (why) { say('not launching another copy: ' + why + ' — waiting for it'); return waitReady(url, proc && proc.exitCode === null ? proc : null, 'the voice server'); }

      let cmd, args, cwd, env = process.env, label;
      if (script && fs.existsSync(script)) {
        const sh = shell(script); cmd = sh.cmd; args = sh.args; cwd = path.dirname(script); label = 'Start.ps1'; state.via = 'script';
        say('voice server offline at ' + u.host + ' — launching ' + script);
      } else {
        const eng = findEngine(dir);
        if (!eng.ok) {
          state.running = false;
          state.error = (script ? 'Start.ps1 not found at ' + script : 'experimental-trained-tts\\Start.ps1 not found') + ', and no voice engine folder to fall back on (' + eng.error + ')';
          say('START FAILED: ' + state.error); return { ...state };
        }
        const temp = path.join(eng.dir, 'runtime-temp'); try { fs.mkdirSync(temp, { recursive: true }); } catch {}
        cmd = eng.exe; cwd = eng.dir; env = { ...process.env, TEMP: temp, TMP: temp }; label = path.basename(eng.exe); state.via = 'exe';
        args = ['--usevulkan', '--ttsgpu', '--ttsmodel', eng.model, '--ttswavtokenizer', eng.tokenizer, '--host', '127.0.0.1', '--port', String(port), '--skiplauncher'];
        say('voice server offline at ' + u.host + ' — Start.ps1 not found, starting ' + eng.exe + ' directly');
      }

      tail = '';
      let p;
      try { p = spawn(cmd, args, { cwd, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { state.running = false; state.error = 'could not launch ' + label + ': ' + e.message; say('START FAILED: ' + state.error); return { ...state }; }
      proc = p; state.ours = true;
      if (p.pid) writePid({ pid: p.pid, at: Date.now(), cmd: label });
      const keep = d => { const s = d.toString(); tail = (tail + s).slice(-4000); s.split(/\r?\n/).filter(l => l.trim()).forEach(l => raw('[server] ' + l)); };
      p.stdout.on('data', keep); p.stderr.on('data', keep);
      p.on('error', e => { tail += '\n' + e.message; say('could not launch ' + label + ': ' + e.message); });
      p.on('exit', (code, sig) => {
        clearPid(p.pid);
        if (proc === p) { proc = null; state.ours = false; }
        if (p._stopping || quitting) return;
        state.lastExit = (sig ? 'signal ' + sig : 'exit code ' + code) + (lastLines(tail, 3) ? ': ' + lastLines(tail, 3) : '');
        if (state.running) say(label + ' process ended while M.I.K.U. was using it (' + state.lastExit + ')');
      });
      return waitReady(url, p, label);
    })().catch(e => { state.running = false; state.error = e.message; say('START FAILED: ' + e.message); return { ...state }; })
      .finally(() => { starting = null; });
    return starting;
  }

  /* -------- watchdog: restart after a crash, with a short delay and a limited number of tries */
  let wd = null;
  function supervise(getUrl, restart, { intervalMs = 5000, delays = [3000, 10000, 30000], stableMs = 5 * 60000 } = {}) {
    unsupervise();
    const w = wd = { timer: null, pending: null, seenUp: false, crashed: false, misses: 0, tries: 0, upSince: 0, gaveUp: false };
    const tick = async () => {
      const url = getUrl();
      if (!url || starting || w.pending || w.gaveUp) return;
      let u; try { u = tts.checkUrl(url); } catch { return; }
      const up = await portOpen(u.hostname.replace(/^\[|\]$/g, ''), +(u.port || 80));
      if (wd !== w) return;
      if (up) {
        if (!w.seenUp) { w.seenUp = true; w.upSince = Date.now(); }
        w.misses = 0; w.crashed = false;
        if (w.tries && Date.now() - w.upSince > stableMs) w.tries = 0;   // stable again: full set of retries next time
        return;
      }
      if (!w.seenUp && !w.crashed) return;     // never came up: the start itself already reported why
      if (++w.misses < 2) return;              // one missed check can be a hiccup
      w.misses = 0; w.seenUp = false; w.crashed = true; state.running = false;
      if (w.tries >= delays.length) {
        w.gaveUp = true;
        state.error = 'voice server stopped and ' + delays.length + ' restarts did not bring it back' + (state.lastExit ? ' (last: ' + state.lastExit + ')' : '') + (state.error ? ' — ' + state.error : '');
        say('GIVING UP: ' + state.error + '. Press CHECK in Settings to try again.');
        return;
      }
      const delay = delays[w.tries++];
      say('voice server stopped answering at ' + u.host + (state.lastExit ? ' (' + state.lastExit + ')' : '') + ' — restarting in ' + Math.round(delay / 1000) + ' s (attempt ' + w.tries + ' of ' + delays.length + ')');
      w.pending = setTimeout(async () => {
        if (wd !== w) return;
        const st = await restart().catch(e => ({ running: false, error: e.message }));
        w.pending = null;
        if (st && st.running) { w.seenUp = true; w.crashed = false; w.upSince = Date.now(); say('voice server is back after restart ' + w.tries); }
        else say('restart ' + w.tries + ' failed: ' + (st && st.error || 'unknown error'));
      }, delay);
    };
    w.timer = setInterval(() => { tick().catch(() => {}); }, intervalMs);
    return { reset() { w.tries = 0; w.gaveUp = false; w.crashed = false; w.misses = 0; } };
  }
  function unsupervise() { if (!wd) return; clearInterval(wd.timer); clearTimeout(wd.pending); wd = null; }
  function resetWatch() { if (wd) { wd.tries = 0; wd.gaveUp = false; wd.misses = 0; } }

  function shutdown() { quitting = true; unsupervise(); stop(); }
  return { ensure, stop, shutdown, supervise, unsupervise, resetWatch, log: say, state: () => ({ ...state, starting: !!starting }) };
}

module.exports = { findEngine, search, findStartScript, createHost, portOpen };
