(() => {
'use strict';
const J = window.jarvis;
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const store = {
  get(k, d){ try { const v = localStorage.getItem('jarvis.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v){ try { localStorage.setItem('jarvis.' + k, JSON.stringify(v)); } catch {} }
};
const pick = a => a[Math.floor(Math.random() * a.length)];
const today = () => new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let V = window.JarvisVoice || null;   // voice module (loads as an ES module)

/* ============================================================ models offered in setup */
const MODELS = [
  { tag:'qwen3.5:9b',    name:'Qwen 3.5 · 9B',   size:'6.6 GB', note:'Recommended — quick, smart, very good with tools' },
  { tag:'gpt-oss:20b',   name:'gpt-oss · 20B',   size:'14 GB',  note:'Smartest that fits your 16 GB card — slower, tight on memory' },
  { tag:'granite4.2:8b', name:'Granite 4.2 · 8B', size:'5.3 GB', note:'Lightest — fastest replies, a bit less clever' }
];

/* ============================================================ state */
const S = {
  info:{}, name:store.get('name', ''), ollama:false, models:[], model:store.get('model', ''), caps:[], modelSize:0,
  deep:store.get('deep', false), listening:false, thinking:false, wake:store.get('wake', false), awaitingUntil:0,
  pending:null, history:[], run:0, chatId:null,
  confirm:store.get('confirm', true), autoSafe:store.get('autoSafe', true),
  voice:store.get('voice', 'bm_george'), rate:store.get('rate', 1), ear:store.get('ear', 'whisper-base.en'), sens:store.get('sens', 0.5),
  memories:store.get('memories', []), tasks:store.get('tasks', []), timers:store.get('timers', []),
  counts:store.get('counts', { total:0, cmds:0, days:{} }), session:0,
  city:store.get('city', null), celsius:store.get('celsius', false), weather:null,
  level:0, micLv:0, cpuHist:[], netHist:[], actMic:[], actVoice:[], btcHist:[], btc:null, stats:null, gpuPct:null
};
const QUALITY = {
  full:     { fps: 60, dpr: 2,    motes: true,  blur: true },
  balanced: { fps: 30, dpr: 1.25, motes: true,  blur: false },
  low:      { fps: 15, dpr: 1,    motes: false, blur: false }
};
let quality = store.get('quality', 'balanced'); if (!QUALITY[quality]) quality = 'balanced';
let Q = QUALITY[quality];
function applyQuality(){ document.body.classList.toggle('noblur', !Q.blur); }
const speaking = () => !!(V && V.speaking);
const userName = () => S.name || (S.info.user ? S.info.user[0].toUpperCase() + S.info.user.slice(1) : 'Operator');

/* ============================================================ UI helpers */
function tb(id, val, cls){ const el = $(id); el.className = 'tb ' + (cls || ''); el.querySelector('b').textContent = val; }
function setState(){
  const t = speaking() ? 'speaking' : S.thinking ? 'thinking' : S.listening ? 'listening' : (S.wake ? 'say “jarvis”' : 'standby');
  $('#state').textContent = t;
  $('#mic').classList.toggle('on', S.listening);
  tb('#tbMic', S.listening ? 'LIVE' : S.wake ? 'WAKE' : 'OFF', S.listening || S.wake ? 'on' : '');
}
function event(msg){
  const d = document.createElement('div'); d.className = 'it';
  d.innerHTML = `<time>${new Date().toLocaleTimeString([], { hour12:false })}</time><span>${esc(msg)}</span>`;
  const box = $('#events'); box.prepend(d); while (box.children.length > 200) box.lastChild.remove();
}
function addMsg(who, text, extra){
  const d = document.createElement('div'); d.className = 'row ' + who;
  const label = who === 'user' ? userName().toUpperCase().slice(0, 9) : who === 'sys' ? 'SYSTEM' : who === 'tool' ? '' : 'JARVIS';
  d.innerHTML = `<b>${esc(label)}</b><div>${esc(text)}</div>`;
  if (extra) d.lastChild.appendChild(extra);
  const log = $('#log'); log.appendChild(d); log.scrollTop = 1e9;
  while (log.children.length > 200) log.firstChild.remove();
  return d;
}
function toolLine(icon, text){ return addMsg('tool', icon + '  ' + text); }
function termWrite(html){ const t = $('#term'); t.insertAdjacentHTML('beforeend', html); t.scrollTop = 1e9; }
function ago(t){ const s = (Date.now() - t) / 1000; return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; }
function greeting(){ const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

/* ============================================================ counters */
function countInteraction(){
  S.counts.total++; S.session++;
  const d = today(); const arr = S.counts.days[d] || (S.counts.days[d] = new Array(24).fill(0));
  arr[new Date().getHours()]++;
  Object.keys(S.counts.days).sort().slice(0, -14).forEach(k => delete S.counts.days[k]);
  store.set('counts', S.counts); renderCounters();
}
function countAction(){ S.counts.cmds++; store.set('counts', S.counts); renderCounters(); }
function renderCounters(){
  $('#cTotal').textContent = S.counts.total; $('#cMem').textContent = S.memories.length;
  $('#cCmds').textContent = S.counts.cmds; $('#cSess').textContent = S.session;
  drawBars('#sparkDay', S.counts.days[today()] || new Array(24).fill(0));
}

/* ============================================================ voice wrappers */
function voiceOpts(){ return { engine: V && V.voiceReady ? 'kokoro' : 'windows', voice: S.voice, speed: S.rate, rate: S.rate, pitch: 0.9 }; }
function speak(text){
  if (!text || !V) return Promise.resolve();
  if (S.wake) S.awaitingUntil = 0;
  return V.speak(text, voiceOpts()).then(() => { if (S.wake) S.awaitingUntil = Date.now() + 8000; });
}
function stopVoice(){ if (V) V.stopSpeaking(); setState(); }
function reply(text){ addMsg('jarvis', text); return speak(text); }

/* ============================================================ listening */
async function talk(){
  if (!V) return addMsg('sys', 'Voice module is still starting…');
  if (!V.hearingReady) {
    addMsg('sys', V.hearingLoading ? 'My hearing is still loading — one moment.' : 'Hearing isn’t set up yet. Open Settings → Run setup again, or type to me.');
    return;
  }
  if (S.listening) { V.cancelListen(); S.listening = false; setState(); return; }
  stopVoice();
  S.listening = true; setState(); $('#heard').textContent = '';
  let text = '';
  try { text = await V.listenOnce(8000); }
  catch (e) { addMsg('sys', 'Microphone problem: ' + e.message + '. Check Windows Settings → Privacy → Microphone.'); }
  S.listening = false; setState();
  if (text) { $('#heard').textContent = text; setTimeout(() => $('#heard').textContent = '', 3000); onHeard(text, true); }
}
const WAKE = /^(?:hey |ok |okay |yo )?(?:jarvis|jervis|jarvus|jarvas|travis|jarv)\b[\s,.!?]*/i;
const YES = /^(yes|yeah|yep|do it|go ahead|proceed|confirm|run it|affirmative|sure|ok|okay|execute|please do)\b/i;
const NO  = /^(no|nope|cancel|stop|abort|negative|don'?t|never mind|nevermind)\b/i;
function onHeard(text, direct){
  const clean = text.replace(/\s+/g, ' ').trim();
  if (S.pending) { if (YES.test(clean)) return S.pending.answer(true); if (NO.test(clean)) return S.pending.answer(false); }
  if (!direct) {
    const m = clean.match(WAKE);
    const followUp = Date.now() < S.awaitingUntil;
    if (!m && !followUp) return;
    const rest = m ? clean.slice(m[0].length).trim() : clean;
    $('#heard').textContent = clean; setTimeout(() => $('#heard').textContent = '', 3000);
    if (!rest) { S.awaitingUntil = Date.now() + 9000; return reply(pick(['Yes, sir?', 'At your service.', 'Sir?'])); }
    return handle(rest);
  }
  handle(clean.replace(WAKE, '') || clean);
}
async function setWake(on){
  S.wake = on; store.set('wake', on);
  $('#wakePill').classList.toggle('on', on); $('#wakeTxt').textContent = on ? 'ON' : 'OFF';
  if (V && V.hearingReady) {
    try { await V.setContinuous(on, t => onHeard(t, false)); }
    catch (e) { addMsg('sys', 'Microphone problem: ' + e.message); S.wake = false; $('#wakePill').classList.remove('on'); $('#wakeTxt').textContent = 'OFF'; }
    if (on) event('wake word armed');
  } else if (on) addMsg('sys', 'Wake word will start once my hearing has loaded.');
  setState();
}

/* ============================================================ memory / tasks / timers */
function saveMem(){ store.set('memories', S.memories); renderMem(); renderCounters(); }
function addMemory(text){ S.memories.unshift({ text: String(text).trim(), t: Date.now() }); S.memories = S.memories.slice(0, 150); saveMem(); event('memory: ' + String(text).slice(0, 50)); }
function renderMem(){
  $('#ledger').innerHTML = S.memories.length ? S.memories.slice(0, 4).map(m => `<tr><td title="${esc(m.text)}">${esc(m.text)}</td><td>${ago(m.t)}</td></tr>`).join('')
    : '<tr><td class="muted" colspan="2">empty · say “remember that…”</td></tr>';
  $('#memList').innerHTML = S.memories.map((m, i) => `<div class="it"><span>${esc(m.text)}</span><time>${ago(m.t)}</time><button data-i="${i}">✕</button></div>`).join('') || '<div class="muted">Nothing remembered yet.</div>';
}
function saveTasks(){ store.set('tasks', S.tasks); renderTasks(); }
function renderTasks(){
  $('#taskCount').textContent = '// ' + S.tasks.filter(t => !t.done).length;
  $('#tasks').innerHTML = S.tasks.length ? S.tasks.map((t, i) => `<div class="task ${t.done ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${t.done ? 'checked' : ''}><span>${esc(t.text)}</span><button data-del="${i}">✕</button></div>`).join('')
    : '<div class="muted">No tasks. Tell Jarvis to add one.</div>';
}
const NUMW = { a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, fifteen:15, twenty:20, thirty:30, forty:40, 'forty-five':45, sixty:60, ninety:90, half:0.5 };
const toNum = w => { w = String(w).toLowerCase(); return isNaN(+w) ? (NUMW[w] ?? null) : +w; };
const unitMs = u => /^s/.test(u) ? 1000 : /^h/.test(u) ? 3600000 : 60000;
function fmtDur(ms){ const s = Math.round(ms / 1000); if (s < 60) return s + ' second' + (s === 1 ? '' : 's'); const m = Math.round(s / 60); if (m < 60) return m + ' minute' + (m === 1 ? '' : 's'); const h = +(m / 60).toFixed(1); return h + ' hour' + (h === 1 ? '' : 's'); }
function clockFmt(ms){ const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); }
function addTimer(ms, label, kind){
  S.timers.push({ id: Date.now() + Math.random(), end: Date.now() + ms, label: label || '', kind: kind || 'timer', len: ms });
  store.set('timers', S.timers); renderTimers(); event((kind || 'timer') + ' set: ' + fmtDur(ms) + (label ? ' · ' + label : ''));
}
function renderTimers(){
  $('#timerList').innerHTML = S.timers.map(t => `<div class="it"><span>${t.kind === 'reminder' ? '▤ ' : '◷ '}${esc(t.label || fmtDur(t.len))}</span><time>${clockFmt(t.end - Date.now())}</time><button data-id="${t.id}">✕</button></div>`).join('') || '<div class="muted">No timers running.</div>';
}
function beep(){
  try { const c = new AudioContext(); [0, .35, .7].forEach(d => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; o.connect(g); g.connect(c.destination); g.gain.setValueAtTime(.0001, c.currentTime + d); g.gain.exponentialRampToValueAtTime(.25, c.currentTime + d + .02); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + d + .25); o.start(c.currentTime + d); o.stop(c.currentTime + d + .3); }); } catch {}
}
function tickTimers(){
  const now = Date.now(), due = S.timers.filter(t => t.end <= now);
  if (due.length) {
    S.timers = S.timers.filter(t => t.end > now); store.set('timers', S.timers);
    due.forEach(t => {
      beep();
      const msg = t.kind === 'reminder' ? `Sir, a reminder: ${t.label}.` : `Sir, your ${t.label || fmtDur(t.len)} timer is done.`;
      reply(msg);
      try { new Notification('Jarvis', { body: msg }); } catch {}
      J.flash();
    });
  }
  const next = S.timers.slice().sort((a, b) => a.end - b.end)[0];
  $('#timerTxt').textContent = next ? clockFmt(next.end - now) : 'TIMER';
  $('#tbTimer').className = 'tb' + (next ? ' on' : '');
  if ($('#drawer').classList.contains('show')) renderTimers();
}

/* ============================================================ weather + market */
const WMO = { 0:'clear sky', 1:'mainly clear', 2:'partly cloudy', 3:'overcast', 45:'fog', 48:'freezing fog', 51:'light drizzle', 53:'drizzle', 55:'heavy drizzle', 61:'light rain', 63:'rain', 65:'heavy rain', 66:'freezing rain', 67:'freezing rain', 71:'light snow', 73:'snow', 75:'heavy snow', 77:'snow grains', 80:'rain showers', 81:'rain showers', 82:'violent rain showers', 85:'snow showers', 86:'snow showers', 95:'thunderstorms', 96:'thunderstorms with hail', 99:'thunderstorms with hail' };
async function geocode(name){
  const r = await J.web.json('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(name));
  const g = r.ok && r.data.results && r.data.results[0];
  return g ? { name: g.name + (g.admin1 ? ', ' + g.admin1 : ''), lat: g.latitude, lon: g.longitude } : null;
}
async function setCity(name){
  const c = await geocode(name);
  if (!c) { $('#wDesc').textContent = 'City not found'; return false; }
  S.city = c; store.set('city', c); await loadWeather(); return true;
}
async function fetchWeather(c){
  const u = S.celsius ? 'celsius' : 'fahrenheit';
  const r = await J.web.json(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=3&temperature_unit=${u}&wind_speed_unit=mph`);
  if (!r.ok) return null;
  const d = r.data, cur = d.current, deg = S.celsius ? '°C' : '°F';
  return { place: c.name, t: Math.round(cur.temperature_2m), feels: Math.round(cur.apparent_temperature), desc: WMO[cur.weather_code] || 'unknown', wind: Math.round(cur.wind_speed_10m), hum: cur.relative_humidity_2m,
    hi: Math.round(d.daily.temperature_2m_max[0]), lo: Math.round(d.daily.temperature_2m_min[0]), rain: d.daily.precipitation_probability_max[0], deg,
    next: d.daily.time.slice(1).map((day, i) => ({ day, hi: Math.round(d.daily.temperature_2m_max[i + 1]), lo: Math.round(d.daily.temperature_2m_min[i + 1]), desc: WMO[d.daily.weather_code[i + 1]] || '', rain: d.daily.precipitation_probability_max[i + 1] })) };
}
async function loadWeather(){
  if (!S.city) return;
  const w = await fetchWeather(S.city);
  if (!w) { $('#wDesc').textContent = 'Weather service unreachable'; return; }
  S.weather = w;
  $('#wTemp').textContent = w.t + w.deg;
  $('#wDesc').textContent = `${w.desc} · H ${w.hi}° L ${w.lo}° · wind ${w.wind} mph`;
  $('#wPlace').textContent = '// ' + S.city.name.split(',')[0].toUpperCase();
}
async function locateMe(){
  $('#wDesc').textContent = 'Locating…';
  const r = await J.web.json('https://get.geojs.io/v1/ip/geo.json');
  if (!r.ok || !r.data.latitude) { $('#wDesc').textContent = 'Location unavailable — type a city instead'; return; }
  S.city = { name: (r.data.city || 'Your location') + (r.data.region ? ', ' + r.data.region : ''), lat: +r.data.latitude, lon: +r.data.longitude };
  store.set('city', S.city); loadWeather();
}
async function loadBtc(){
  const r = await J.web.json('https://api.coinbase.com/v2/prices/BTC-USD/spot');
  if (r.ok) {
    S.btc = +r.data.data.amount; S.btcHist.push(S.btc); if (S.btcHist.length > 60) S.btcHist.shift();
    $('#btc').textContent = '$' + S.btc.toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
    drawSpark('#sparkBtc', S.btcHist, null, true);
  } else if (S.btc == null) $('#btc').textContent = 'offline';
}

/* ============================================================ PowerShell */
async function runPS(command, quiet){
  termWrite(`<span class="p">${esc('PS ' + (S.cwd || '') + '>')} </span>${esc(command)}\n`);
  event('powershell: ' + command.split('\n')[0].slice(0, 80));
  countAction();
  const r = await J.ps.run(command);
  if (r.output) termWrite(esc(r.output) + '\n');
  (r.errors || []).forEach(e => termWrite(`<span class="e">${esc(e)}</span>\n`));
  if (!r.output && !(r.errors || []).length) termWrite('<span class="d">(done)</span>\n');
  if (r.cwd) { S.cwd = r.cwd; $('#cwd').textContent = 'PS ' + r.cwd + '>'; }
  return r;
}
// commands that only read information
const SAFE_START = /^\s*(Get-|Test-Path|Test-Connection|Resolve-DnsName|Measure-|Select-|Where-|Sort-|Format-|Out-String|ConvertTo-Json|Write-Output|\$env:|\[System\.Environment\]|\[Environment\]|ipconfig|systeminfo|whoami|hostname|tasklist|ping |nslookup|ollama (list|ps)|dir\b|ls\b|cd\b|Set-Location|pwd)/i;
const UNSAFE = /(Remove-|Set-(?!Location)|Stop-|Restart-|New-|Move-|Copy-|Rename-|Clear-|Disable-|Enable-|Install-|Uninstall-|Invoke-Expression|\biex\b|Invoke-WebRequest|\biwr\b|Invoke-RestMethod|\birm\b|Start-Process|Out-File|Add-Content|>\s*\S|\bdel\b|\brm\b|\bformat\b|shutdown|reg (add|delete)|bcdedit|diskpart|takeown|icacls|-Force|Start-BitsTransfer|schtasks|netsh|sc\.exe)/i;
const isSafe = cmd => cmd.split(/[;\n|]/).every(seg => !seg.trim() || SAFE_START.test(seg.trim()) || /^\s*(Select|Where|Sort|Format|Measure|ConvertTo|Out-String|ForEach-Object\s*\{\s*\$_\.\w+\s*\})/i.test(seg.trim())) && !UNSAFE.test(cmd);

function confirmAction(say, detail){
  if (S.pending) S.pending.answer(false, true);
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.innerHTML = `<div class="cmd">${esc(detail)}</div><div class="acts"><button class="btn">RUN</button><button class="btn no">CANCEL</button></div>`;
    const [runB, noB] = box.querySelectorAll('button');
    const p = {
      answer(yes, silent){
        if (S.pending !== p) return; S.pending = null;
        box.querySelector('.acts').innerHTML = `<span class="muted" style="font-size:8.5px;letter-spacing:.2em">${yes ? 'APPROVED' : 'CANCELLED'}</span>`;
        if (!yes && !silent) speak('Cancelled.');
        resolve(yes);
      }
    };
    runB.onclick = () => p.answer(true); noB.onclick = () => p.answer(false);
    S.pending = p;
    addMsg('jarvis', say, box);
    speak(say + ' Shall I go ahead?').then(() => {
      if (S.pending === p && V && V.hearingReady && !S.wake) { S.awaitingUntil = Date.now() + 9000; listenForAnswer(p); }
    });
  });
}
async function listenForAnswer(p){
  S.listening = true; setState();
  const t = await V.listenOnce(7000).catch(() => '');
  S.listening = false; setState();
  if (S.pending !== p || !t) return;
  if (YES.test(t)) p.answer(true); else if (NO.test(t)) p.answer(false);
}

/* ============================================================ tools for the AI */
const TOOLS = [
  { name:'web_search', description:'Search the internet. Use for anything current, factual, or that you are not sure about (news, prices, scores, how-tos, people, products). Returns titles, links and snippets.', params:{ query:{ type:'string', description:'search terms' } }, required:['query'] },
  { name:'read_webpage', description:'Open a web page and read its main text. Use after web_search to get details from the best result.', params:{ url:{ type:'string', description:'full URL' } }, required:['url'] },
  { name:'run_powershell', description:'Run a Windows PowerShell command on the user\'s PC and get its output. Use for system info, files and folders, processes, settings, network, installed apps, and automating tasks.', params:{ command:{ type:'string', description:'PowerShell 5.1 script' }, purpose:{ type:'string', description:'one short sentence saying what this does, shown to the user' } }, required:['command', 'purpose'] },
  { name:'open', description:'Open an app, file, folder or website for the user (e.g. "spotify", "notepad", "C:\\\\Users\\\\me\\\\Desktop", "https://youtube.com").', params:{ target:{ type:'string' } }, required:['target'] },
  { name:'read_file', description:'Read a text file (or list a folder) on the PC. Paths can start with Desktop, Documents or Downloads.', params:{ path:{ type:'string' } }, required:['path'] },
  { name:'write_file', description:'Create or overwrite a text file on the PC (notes, scripts, lists). Paths can start with Desktop, Documents or Downloads.', params:{ path:{ type:'string' }, content:{ type:'string' } }, required:['path', 'content'] },
  { name:'remember', description:'Save a lasting fact about the user or their preferences so you remember it in future conversations.', params:{ fact:{ type:'string' } }, required:['fact'] },
  { name:'add_task', description:'Add an item to the user\'s task list.', params:{ text:{ type:'string' } }, required:['text'] },
  { name:'complete_task', description:'Mark a task on the list as done.', params:{ text:{ type:'string', description:'the task (or part of it)' } }, required:['text'] },
  { name:'set_timer', description:'Start a timer, or a reminder when a label is given. Jarvis will speak up when it ends.', params:{ minutes:{ type:'number' }, label:{ type:'string', description:'what to remind about (optional)' } }, required:['minutes'] },
  { name:'get_weather', description:'Current weather and 3-day forecast. Leave city empty for the user\'s saved location.', params:{ city:{ type:'string' } }, required:[] },
  { name:'system_status', description:'CPU, memory, disk, uptime and top processes of this PC.', params:{}, required:[] }
];
const toolSchemas = () => TOOLS.map(t => ({ type:'function', function:{ name:t.name, description:t.description, parameters:{ type:'object', properties:t.params, required:t.required } } }));
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '\n…(truncated)' : s; };
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

async function runTool(name, args){
  args = args || {};
  try {
    switch (name) {
      case 'web_search': {
        const q = String(args.query || '').trim();
        const line = toolLine('⌕', 'Searching the web: ' + q);
        const r = await J.web.search(q);
        if (!r.ok) return 'Search failed: ' + (r.error || 'no results');
        line.lastChild.textContent = '⌕  Searched: ' + q + ' — ' + r.results.length + ' results';
        countAction();
        return r.results.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`).join('\n');
      }
      case 'read_webpage': {
        const line = toolLine('▤', 'Reading ' + host(args.url));
        const r = await J.web.read(args.url);
        if (!r.ok) { line.lastChild.textContent = '▤  Could not open ' + host(args.url); return 'Could not read page: ' + r.error; }
        countAction();
        return `TITLE: ${r.title}\nURL: ${r.url}\n${r.description ? 'SUMMARY: ' + r.description + '\n' : ''}\n${r.text}`;
      }
      case 'run_powershell': {
        const cmd = String(args.command || '').trim(); if (!cmd) return 'No command given.';
        const safe = S.autoSafe && isSafe(cmd);
        if (!safe && S.confirm) {
          const ok = await confirmAction(args.purpose || 'I’d like to run a PowerShell command.', cmd);
          if (!ok) return 'The user declined to run this command.';
        } else toolLine('›_', args.purpose || cmd.split('\n')[0]);
        const r = await runPS(cmd);
        const out = (r.output || '') + (r.errors && r.errors.length ? '\nERRORS:\n' + r.errors.join('\n') : '');
        return clip(out.trim() || '(command completed with no output)', 6000);
      }
      case 'open': {
        toolLine('↗', 'Opening ' + args.target);
        const r = await J.open(args.target); countAction();
        return r.ok ? 'Opened ' + args.target : 'Could not open it: ' + r.error;
      }
      case 'read_file': {
        toolLine('▤', 'Reading ' + args.path);
        const r = await J.fs.read(args.path);
        return r.ok ? `PATH: ${r.path}\n${r.text}${r.truncated ? '\n…(truncated)' : ''}` : 'Could not read ' + r.path + ': ' + r.error;
      }
      case 'write_file': {
        const full = await J.fs.resolve(args.path);
        if (S.confirm) {
          const ok = await confirmAction(`I’d like to save a file to ${full}.`, clip(args.content, 600));
          if (!ok) return 'The user declined.';
        }
        const r = await J.fs.write(args.path, args.content); countAction();
        if (r.ok) toolLine('✎', 'Saved ' + r.path);
        return r.ok ? 'Saved to ' + r.path : 'Could not save: ' + r.error;
      }
      case 'remember': addMemory(args.fact); toolLine('✦', 'Remembered: ' + args.fact); return 'Saved to memory.';
      case 'add_task': S.tasks.push({ text: String(args.text), done:false }); saveTasks(); toolLine('☐', 'Task added: ' + args.text); return 'Task added.';
      case 'complete_task': {
        const q = String(args.text || '').toLowerCase(); const t = S.tasks.find(x => !x.done && x.text.toLowerCase().includes(q)) || S.tasks.find(x => !x.done && q.includes(x.text.toLowerCase()));
        if (!t) return 'No matching open task.'; t.done = true; saveTasks(); toolLine('☑', 'Done: ' + t.text); return 'Marked done: ' + t.text;
      }
      case 'set_timer': {
        const ms = Math.max(1, +args.minutes || 0) * 60000; addTimer(ms, args.label || '', args.label ? 'reminder' : 'timer');
        toolLine('◷', (args.label ? 'Reminder: ' + args.label + ' in ' : 'Timer: ') + fmtDur(ms)); return 'Timer set for ' + fmtDur(ms) + '.';
      }
      case 'get_weather': {
        let c = S.city;
        if (args.city) c = await geocode(args.city);
        if (!c) return args.city ? 'City not found.' : 'No location saved. Ask the user for their city.';
        toolLine('☁', 'Weather for ' + c.name);
        const w = await fetchWeather(c); if (!w) return 'Weather service unreachable.';
        if (!args.city) { S.weather = w; loadWeather(); }
        return JSON.stringify(w);
      }
      case 'system_status': {
        const s = await J.stats(); renderStats(s);
        return JSON.stringify({ cpu: s.cpu + '%', memory: `${s.memUsed}/${s.memTotal} GB (${s.mem}%)`, disk_c: `${s.diskFree} GB free of ${s.diskTotal} GB`, uptime: s.uptime, gpu: s.gpu, top_processes_MB: s.procs });
      }
      default: return 'Unknown tool: ' + name;
    }
  } catch (e) { return 'Tool error: ' + e.message; }
}

/* ============================================================ the brain */
function systemPrompt(){
  const open = S.tasks.filter(t => !t.done).map(t => t.text);
  const mem = S.memories.slice(0, 50).map(m => '- ' + m.text).join('\n');
  return `You are J.A.R.V.I.S. ("Jarvis"), a personal AI assistant living on ${userName()}'s Windows PC (${S.info.computer || 'this PC'}, ${S.info.os || 'Windows'}). You run entirely on this computer.
Current date and time: ${new Date().toLocaleString([], { weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'numeric', minute:'2-digit' })}.
User's name: ${userName()}. Home folder: ${S.info.home || ''}. PowerShell current folder: ${S.cwd || S.info.home || ''}.
${S.weather ? `Weather now in ${S.weather.place}: ${S.weather.t}${S.weather.deg}, ${S.weather.desc}.\n` : ''}${open.length ? 'Open tasks: ' + open.join('; ') + '\n' : ''}${mem ? 'Things you remember about the user:\n' + mem + '\n' : ''}
PERSONALITY: calm, capable, quietly witty, British, loyal. Address the user as "sir" occasionally, not every sentence.

HOW YOU WORK:
- You have tools. Use them instead of guessing. For anything about current events, prices, people, products, sports, or facts you are not certain of: call web_search, then read_webpage on the best one or two results, then answer. Never invent facts, numbers or URLs.
- To act on the PC use open (apps, files, sites) or run_powershell. Think about what the user actually wants and do it in as few steps as possible. Check results and fix mistakes.
- When the user tells you something about themselves worth keeping, call remember.
- Prefer safe, read-only commands. Never delete files, change security settings or do anything destructive unless the user clearly asked for it.
- PowerShell is Windows PowerShell 5.1: no "&&", use ";". Keep command output small (Select-Object -First, Format-Table -AutoSize).

HOW YOU TALK: your words are spoken aloud. Answer in one to three short sentences of plain speech — no markdown, no bullet points, no code, no URLs, no emoji. Give the answer first. If the user asks for a long text (an essay, list or code), write it to a file with write_file and tell them where it is.`;
}
function trimHistory(){
  const size = () => S.history.reduce((a, m) => a + (m.content || '').length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
  const budget = S.modelSize > 11e9 ? 14000 : 26000;
  while (S.history.length > 4 && (size() > budget || S.history.length > 40)) S.history.shift();
  while (S.history.length && S.history[0].role !== 'user') S.history.shift();
}
function chatBody(messages, withTools){
  const body = { model: S.model, messages, keep_alive: '30m', options: { num_ctx: S.modelSize > 11e9 ? 8192 : 16384, temperature: 0.5 } };
  if (withTools && S.caps.includes('tools')) body.tools = toolSchemas();
  if (S.caps.includes('thinking')) body.think = /gpt-oss/i.test(S.model) ? (S.deep ? 'high' : 'low') : !!S.deep;
  return body;
}
let chunkHandler = null;
J.on('chat:chunk', d => { if (chunkHandler) chunkHandler(d); });

async function chatOnce(runId, onText){
  const id = 'c' + Date.now() + Math.random().toString(36).slice(2, 6); S.chatId = id;
  let think = false, buf = '';
  chunkHandler = d => {
    if (d.id !== id || runId !== S.run) return;
    if (d.thinking) { onText(null, d.thinking); return; }
    if (!d.content) return;
    // hide inline <think> blocks some models emit
    buf += d.content; let out = '';
    for (;;) {
      if (think) { const e = buf.indexOf('</think>'); if (e < 0) { buf = buf.slice(-8); break; } buf = buf.slice(e + 8); think = false; }
      else { const s2 = buf.indexOf('<think>'); if (s2 < 0) { const keep = buf.lastIndexOf('<'); if (keep >= 0 && buf.length - keep < 8) { out += buf.slice(0, keep); buf = buf.slice(keep); } else { out += buf; buf = ''; } break; } out += buf.slice(0, s2); buf = buf.slice(s2 + 7); think = true; }
    }
    if (out) onText(out);
  };
  const messages = [{ role:'system', content: systemPrompt() }, ...S.history];
  let r = await J.ollama.chat(id, chatBody(messages, true));
  if (!r.ok && /think/i.test(r.error || '')) { S.caps = S.caps.filter(c => c !== 'thinking'); r = await J.ollama.chat(id, chatBody(messages, true)); }
  if (!r.ok && /tools?/i.test(r.error || '') && /support/i.test(r.error || '')) { S.caps = S.caps.filter(c => c !== 'tools'); r = await J.ollama.chat(id, chatBody(messages, true)); }
  if (buf && !think) onText(buf.replace(/<\/?think>/g, ''));
  chunkHandler = null;
  if (r.ok) r.content = String(r.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return r;
}

async function think(text){
  if (!S.ollama) return reply('My brain isn’t running, sir. Ollama doesn’t seem to be open — I’ve tried to start it. Give it a moment, or open Settings and run setup.');
  if (!S.model) return reply('I don’t have a brain model yet, sir. Open Settings to download one.');
  const runId = ++S.run;
  pushUser(text);
  S.thinking = true; setState();
  const t0 = performance.now();
  try {
    for (let step = 0; step < 10; step++) {
      let row = null, spoken = '', said = '', thinkEl = null, tn = null;
      const r = await chatOnce(runId, (txt, thoughts) => {
        if (runId !== S.run) return;
        if (thoughts) {
          if (!row) row = addMsg('jarvis', '');
          if (!thinkEl) { thinkEl = document.createElement('div'); thinkEl.className = 'think'; row.lastChild.appendChild(thinkEl); }
          thinkEl.textContent = (thinkEl.textContent + thoughts).slice(-400); return;
        }
        if (!row) row = addMsg('jarvis', '');
        said += txt;
        if (!tn) { tn = document.createTextNode(''); row.lastChild.insertBefore(tn, row.lastChild.firstChild); }
        tn.textContent = said;
        $('#log').scrollTop = 1e9;
        // speak finished sentences while the rest is still being written
        const m = said.slice(spoken.length).match(/^[\s\S]*[.!?](?=\s|$)/);
        if (m && m[0].trim().length > 2) { spoken += m[0]; speak(m[0]); }
      });
      if (runId !== S.run) return;
      if (thinkEl) thinkEl.remove();
      if (!r.ok) {
        if (r.error === 'aborted') return;
        event('ai error: ' + r.error);
        if (/not found/i.test(r.error)) return reply(`I can’t find my brain model ${S.model}, sir. Open Settings to pick or download one.`);
        if (/fetch failed|ECONNREFUSED|connect/i.test(r.error)) { S.ollama = false; updateBrainChip(); J.ollama.start(); return reply('I’ve lost contact with Ollama, sir. I’m trying to restart it.'); }
        return reply('Something went wrong in my head, sir: ' + r.error.slice(0, 140));
      }
      if (r.content && r.content.length > said.length) {        // late-arriving text
        said = r.content; if (!row) row = addMsg('jarvis', '');
        if (!tn) { tn = document.createTextNode(''); row.lastChild.insertBefore(tn, row.lastChild.firstChild); }
        tn.textContent = said;
      }
      const rest = said.slice(spoken.length).trim(); if (rest) speak(rest);
      const msg = { role:'assistant', content: r.content || '' };
      const calls = (r.tool_calls || []).map(tc => ({ function: { name: tc.function && tc.function.name, arguments: typeof (tc.function && tc.function.arguments) === 'string' ? safeJSON(tc.function.arguments) : (tc.function && tc.function.arguments) || {} } })).filter(c => c.function.name);
      if (calls.length) msg.tool_calls = calls;
      if (!msg.content && !calls.length) { if (!row) reply('Done.'); break; }
      if (!r.content && row && !said) row.remove();
      S.history.push(msg);
      if (!calls.length) break;
      for (const c of calls) {
        if (runId !== S.run) return;
        const out = await runTool(c.function.name, c.function.arguments);
        S.history.push({ role:'tool', tool_name: c.function.name, content: clip(out, 9000) });
      }
      trimHistory();
      if (step === 9) reply('I’ve taken quite a few steps on that, sir, so I’ll stop here. Tell me if you want me to keep going.');
    }
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    event(`answered in ${secs}s`);
  } finally { if (runId === S.run) { S.thinking = false; setState(); } }
}
const safeJSON = s => { try { return JSON.parse(s); } catch { return {}; } };
function pushUser(text){ S.history.push({ role:'user', content:text }); trimHistory(); }
function interrupt(){ S.run++; if (S.chatId) J.ollama.abort(S.chatId); stopVoice(); S.thinking = false; setState(); }

/* ============================================================ quick commands (instant, no AI needed) */
const APPS = { 'notepad':'notepad', 'calculator':'calc', 'calc':'calc', 'file explorer':'explorer', 'explorer':'explorer', 'files':'explorer', 'task manager':'taskmgr', 'paint':'mspaint', 'settings':'ms-settings:', 'control panel':'control', 'chrome':'chrome', 'google chrome':'chrome', 'edge':'msedge', 'command prompt':'cmd', 'powershell':'powershell', 'terminal':'wt', 'word':'winword', 'excel':'excel', 'powerpoint':'powerpnt', 'outlook':'outlook', 'spotify':'spotify:', 'discord':'discord:', 'steam':'steam:', 'vs code':'code', 'visual studio code':'code', 'snipping tool':'snippingtool', 'camera':'microsoft.windows.camera:', 'store':'ms-windows-store:', 'downloads':'shell:Downloads', 'documents':'shell:Personal', 'desktop':'shell:Desktop' };
const SITES = { youtube:'https://www.youtube.com', google:'https://www.google.com', gmail:'https://mail.google.com', github:'https://github.com', netflix:'https://www.netflix.com', reddit:'https://www.reddit.com', amazon:'https://www.amazon.com', twitch:'https://www.twitch.tv', maps:'https://maps.google.com' };
const N = '(\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|forty-five|sixty|ninety|half)';
const U = '(seconds?|secs?|minutes?|mins?|hours?|hrs?)';

async function handle(text){
  if (!text) return;
  if (S.thinking || speaking()) interrupt();
  $('#say').value = '';
  addMsg('user', text); countInteraction();
  const t = text.toLowerCase().replace(/[.!?]+$/, '').trim();
  let m;
  if (/^(stop|quiet|be quiet|shut up|silence|enough|cancel)$/.test(t)) return;
  if (/^(clear|clear (the )?(screen|chat|log)|new (session|conversation))$/.test(t)) { $('#log').innerHTML = ''; S.history = []; return reply('Fresh start.'); }
  if (/^(what('?s| is) the time|what time is it|time)$/.test(t)) return reply('It is ' + new Date().toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) + '.');
  if (/^(what('?s| is) (the |today'?s )?date|what day is it|date)$/.test(t)) return reply('Today is ' + new Date().toLocaleDateString([], { weekday:'long', month:'long', day:'numeric', year:'numeric' }) + '.');
  if ((m = text.match(/^(?:my name is|call me) ([\w' -]{1,30})[.!]?$/i))) { S.name = m[1].trim(); store.set('name', S.name); renderOperator(); $('#nameIn').value = S.name; return reply(`Very well. I'll call you ${S.name}.`); }
  if ((m = t.match(new RegExp('^(?:set |start )?(?:a |an )?' + N + '[ -]' + U + ' timer$')) || t.match(new RegExp('^(?:set )?(?:a )?timer for ' + N + ' ' + U + '$')))) {
    const n = toNum(m[1]); if (n) { addTimer(n * unitMs(m[2]), '', 'timer'); return reply(`Timer set for ${fmtDur(n * unitMs(m[2]))}.`); }
  }
  if (/^(cancel|stop|clear) (the |my |all )?(timers?|reminders?)$/.test(t)) { S.timers = []; store.set('timers', S.timers); renderTimers(); return reply('All timers cancelled.'); }
  if ((m = t.match(/^(?:open|launch|start|bring up)(?: up)?(?: the| my)? ([\w .-]+?)(?: app| application| please)?$/))) {
    const name = m[1].trim();
    const target = APPS[name] || SITES[name];
    if (target) { J.open(target); countAction(); return reply(pick(['Opening ' + name + '.', 'Right away.', 'On it.'])); }
  }
  if (/^(stop listening|go to sleep|goodbye|that'?s all)$/.test(t)) { setWake(false); return reply('Very good, sir. I’ll be here.'); }
  if (/^(run|execute) /i.test(text)) { const cmd = text.replace(/^(run|execute)( the)?( command)?[: ]+/i, ''); await runPS(cmd); return speak('Done.'); }
  return think(text);
}

/* ============================================================ telemetry */
function renderStats(s){
  S.stats = s;
  $('#pCores').textContent = s.cores ?? '—';
  $('#pCpu').textContent = (s.cpu ?? '—') + '%'; $('#mCpu').style.width = (s.cpu || 0) + '%';
  $('#pRam').textContent = s.memUsed != null ? `${s.memUsed}/${s.memTotal} GB` : '—'; $('#mRam').style.width = (s.mem || 0) + '%';
  $('#pDisk').textContent = s.diskTotal != null ? `${s.diskTotal - s.diskFree}/${s.diskTotal} GB` : '—'; $('#mDisk').style.width = (s.disk || 0) + '%';
  $('#netNow').textContent = '// ' + Math.round(s.netKBs || 0) + ' KB/s';
  S.cpuHist.push(s.cpu || 0); S.netHist.push(s.netKBs || 0);
  if (S.cpuHist.length > 60) S.cpuHist.shift(); if (S.netHist.length > 60) S.netHist.shift();
  drawSpark('#sparkCpu', S.cpuHist, 100); drawSpark('#sparkNet', S.netHist);
  $('#oUp').textContent = s.uptime || '—';
  if (s.gpu) S.gpuName = s.gpu;
  if (s.cwd) { S.cwd = s.cwd; $('#cwd').textContent = 'PS ' + s.cwd + '>'; }
  renderRelays();
}
function renderRelays(){
  const s = S.stats || {};
  const rows = [['CPU', s.cpu], ['MEM', s.mem], ['DSK', s.disk], ['NET', Math.min(100, (s.netKBs || 0) / 10)], ['GPU', S.gpuPct ?? 0], ['MIC', S.micLv * 100]];
  $('#relays').innerHTML = rows.map(([k, v]) => { const n = Math.round((v || 0) / 100 * 16); let h = `<span>${k}</span>`; for (let i = 0; i < 16; i++) h += `<i class="${i < n ? (i >= 13 ? 'hot' : 'on') : ''}"></i>`; return h; }).join('');
}
function sizeCanvas(c){ const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight; if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; } const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h); return [x, w, h]; }
function drawSpark(sel, data, fixedMax, fit, color){
  const [x, w, h] = sizeCanvas($(sel));
  x.strokeStyle = 'rgba(170,205,230,.08)'; x.lineWidth = 1;
  for (let i = 1; i < 3; i++) { x.beginPath(); x.moveTo(0, h * i / 3); x.lineTo(w, h * i / 3); x.stroke(); }
  if (data.length < 2) return;
  let lo = 0, hi = fixedMax || Math.max(...data, 1) * 1.2;
  if (fit) { lo = Math.min(...data); hi = Math.max(...data); if (hi === lo) { hi += 1; lo -= 1; } }
  const step = w / 59, pts = data.map((v, i) => [w - (data.length - 1 - i) * step, h - ((v - lo) / (hi - lo)) * (h - 4) - 2]);
  const c = color || '143,227,255';
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, `rgba(${c},.25)`); g.addColorStop(1, `rgba(${c},0)`);
  x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b));
  x.strokeStyle = `rgba(${c},.9)`; x.lineWidth = 1.2; x.stroke();
  x.lineTo(pts[pts.length - 1][0], h); x.lineTo(pts[0][0], h); x.closePath(); x.fillStyle = g; x.fill();
}
function drawBars(sel, arr){
  const [x, w, h] = sizeCanvas($(sel)); const max = Math.max(...arr, 1), bw = w / 24, now = new Date().getHours();
  arr.forEach((v, i) => { const bh = v ? Math.max(3, v / max * (h - 2)) : 1; x.fillStyle = i === now ? 'rgba(143,227,255,.95)' : v ? 'rgba(143,227,255,.5)' : 'rgba(170,205,230,.12)'; x.fillRect(i * bw + 1, h - bh, bw - 2, bh); });
}
function drawActivity(){
  S.actMic.push(S.micLv); S.actVoice.push(V ? (V.outLevel || 0) : 0);
  if (S.actMic.length > 60) { S.actMic.shift(); S.actVoice.shift(); }
  drawSpark('#sparkAct', S.actMic, 1);
  const c = $('#sparkAct'), x = c.getContext('2d'), w = c.clientWidth, h = c.clientHeight, step = w / 59;
  x.beginPath(); S.actVoice.forEach((v, i) => { const a = w - (S.actVoice.length - 1 - i) * step, b = h - Math.min(1, v) * (h - 4) - 2; i ? x.lineTo(a, b) : x.moveTo(a, b); });
  x.strokeStyle = 'rgba(255,211,138,.85)'; x.lineWidth = 1.2; x.stroke();
}
async function pollStats(){ try { renderStats(await J.stats()); } catch {} }
async function pollGpu(){
  const r = await J.ollama.ps();
  const m = r.ok && r.models.find(x => x.name === S.model || x.model === S.model) || (r.ok && r.models[0]);
  if (m && m.size) {
    S.gpuPct = Math.round(100 * (m.size_vram || 0) / m.size);
    const txt = S.gpuPct >= 99 ? '100% GPU' : S.gpuPct <= 1 ? 'CPU ONLY' : S.gpuPct + '% GPU';
    tb('#tbGpu', txt, S.gpuPct >= 99 ? 'on' : 'warn');
    $('#oGpu').textContent = txt + ' · ' + (m.size_vram / 1073741824).toFixed(1) + ' GB';
  } else { S.gpuPct = 0; tb('#tbGpu', S.ollama ? 'IDLE' : '—', ''); $('#oGpu').textContent = S.gpuName ? S.gpuName.replace(/AMD |NVIDIA |Radeon\(TM\) /g, '') : '—'; }
}

/* ============================================================ brain status / models */
function updateBrainChip(){
  if (!S.ollama) tb('#tbBrain', 'OFFLINE', 'off');
  else if (!S.model) tb('#tbBrain', 'NO MODEL', 'warn');
  else tb('#tbBrain', S.model.toUpperCase().slice(0, 16), 'on');
  renderOperator();
}
function renderOperator(){
  $('#oName').textContent = userName(); $('#badgeName').textContent = userName().toUpperCase();
  $('#oBrain').textContent = S.model || '—';
  $('#oHost').textContent = S.info.computer || '—'; $('#oSys').textContent = (S.info.os || '—').replace('Microsoft ', '');
}
async function refreshModels(){
  const v = await J.ollama.version();
  S.ollama = v.ok;
  if (!v.ok) { updateBrainChip(); return false; }
  const t = await J.ollama.tags();
  S.models = (t.models || []).filter(m => !/embed/i.test(m.name));
  if (S.model && !S.models.find(m => m.name === S.model)) {
    const alt = S.models.find(m => m.name.startsWith(S.model.split(':')[0])); S.model = alt ? alt.name : '';
  }
  if (!S.model && S.models.length) {
    const pref = MODELS.map(x => S.models.find(m => m.name === x.tag || m.name.startsWith(x.tag))).find(Boolean);
    S.model = (pref || S.models[0]).name;
  }
  store.set('model', S.model);
  await loadModelInfo();
  fillModelSelect(); updateBrainChip();
  return true;
}
async function loadModelInfo(){
  if (!S.model) { S.caps = []; return; }
  const m = S.models.find(x => x.name === S.model); S.modelSize = m ? m.size : 0;
  const r = await J.ollama.show(S.model);
  S.caps = r.ok ? r.capabilities : ['completion'];
  $('#modelInfo').textContent = S.model ? `${(S.modelSize / 1073741824).toFixed(1)} GB · ${S.caps.includes('tools') ? 'can use tools (web, PowerShell, files)' : 'NO TOOL SUPPORT — Jarvis can only chat with this model'}${S.caps.includes('thinking') ? ' · supports deep thinking' : ''}` : '';
}
function fillModelSelect(){
  const sel = $('#modelSel'); sel.innerHTML = '';
  if (!S.models.length) { sel.innerHTML = '<option value="">No models installed</option>'; return; }
  S.models.forEach(m => { const o = document.createElement('option'); o.value = m.name; o.textContent = m.name + '  ·  ' + (m.size / 1073741824).toFixed(1) + ' GB'; sel.appendChild(o); });
  sel.value = S.model;
}
async function warmUp(){
  if (!S.ollama || !S.model) return;
  event('loading ' + S.model + ' onto the GPU…');
  await J.ollama.chat('warm', { model: S.model, messages: [{ role:'user', content:'hi' }], keep_alive:'30m', options:{ num_ctx: S.modelSize > 11e9 ? 8192 : 16384, num_predict: 1 } });
  pollGpu();
}

/* ============================================================ setup wizard */
let pickTag = MODELS[0].tag, pulling = null;
function stepState(id, state){ const el = $(id); el.classList.remove('ok', 'now'); if (state) el.classList.add(state); el.querySelector('i').textContent = state === 'ok' ? '✓' : el.dataset.n || el.querySelector('i').textContent; }
function renderModelChoices(){
  $('#modelChoices').innerHTML = MODELS.map(m => {
    const have = S.models.find(x => x.name === m.tag || x.name.startsWith(m.tag));
    return `<div class="model ${pickTag === m.tag ? 'sel' : ''}" data-tag="${m.tag}"><b>${esc(m.name)}</b><span>${esc(m.size)} · ${esc(m.note)}</span>${have ? '<em>INSTALLED</em>' : ''}</div>`;
  }).join('');
}
async function runSetup(force){
  ['#stOllama', '#stBrain', '#stVoice'].forEach((s, i) => $(s).dataset.n = i + 1);
  const ok = await refreshModels();
  const voiceOk = store.get('voiceDone', false);
  if (!force && ok && S.model && voiceOk) return false;
  $('#setup').classList.add('show');
  if (ok) { stepState('#stOllama', 'ok'); $('#stOllamaTxt').textContent = 'Ollama is running. It uses your graphics card automatically.'; $('#stOllamaActs').style.display = 'none'; }
  else {
    stepState('#stOllama', 'now');
    $('#stOllamaTxt').innerHTML = 'Jarvis thinks with <b style="color:var(--acc2)">Ollama</b>, a free program that runs AI models on your graphics card. Download it, run the installer, then come back — Jarvis notices automatically.';
    $('#stOllamaActs').style.display = '';
    J.ollama.start();
  }
  stepState('#stBrain', S.model ? 'ok' : ok ? 'now' : '');
  stepState('#stVoice', voiceOk ? 'ok' : '');
  if (voiceOk) $('#voiceTxt').textContent = 'Downloaded.';
  renderModelChoices();
  return true;
}
let setupPoll = null;
function watchSetup(){
  clearInterval(setupPoll);
  setupPoll = setInterval(async () => {
    if (!$('#setup').classList.contains('show')) return clearInterval(setupPoll);
    if (!S.ollama) { if (await refreshModels()) { stepState('#stOllama', 'ok'); $('#stOllamaTxt').textContent = 'Ollama is running.'; $('#stOllamaActs').style.display = 'none'; stepState('#stBrain', S.model ? 'ok' : 'now'); renderModelChoices(); event('Ollama detected'); } }
  }, 3000);
}
async function pullModel(tag){
  if (pulling) return;
  if (!S.ollama) { $('#pullTxt').textContent = 'Install and start Ollama first (step 1).'; return; }
  pulling = tag; $('#pullBtn').disabled = true; $('#pullCancel').style.display = '';
  $('#pullProg').classList.add('show'); $('#pullTxt').textContent = 'Starting download of ' + tag + '…';
  event('downloading model ' + tag);
  const r = await J.ollama.pull(tag);
  pulling = null; $('#pullBtn').disabled = false; $('#pullCancel').style.display = 'none';
  if (r.ok) {
    $('#pullProg i').style.width = '100%'; $('#pullTxt').textContent = tag + ' is ready.';
    S.model = tag; store.set('model', tag); await refreshModels(); stepState('#stBrain', 'ok'); renderModelChoices(); warmUp();
    if (!store.get('voiceDone', false)) stepState('#stVoice', 'now');
  } else {
    $('#pullTxt').textContent = r.error === 'cancelled' ? 'Cancelled.' : 'Download failed: ' + r.error + (/not exist|manifest|not found/i.test(r.error) ? ' — check the model name on ollama.com/library.' : '');
  }
}
J.on('pull:progress', d => {
  const pct = d.total ? Math.round(100 * (d.completed || 0) / d.total) : null;
  if (pct != null) $('#pullProg i').style.width = pct + '%';
  $('#pullTxt').textContent = d.model + ' · ' + d.status + (d.total ? ` · ${((d.completed || 0) / 1073741824).toFixed(2)} / ${(d.total / 1073741824).toFixed(2)} GB (${pct}%)` : '');
});
function progressTracker(barSel, txtSel, label){
  const files = {};
  return p => {
    if (p.status === 'progress' && p.file) {
      files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
      const L = Object.values(files).reduce((a, f) => a + f.loaded, 0), T = Object.values(files).reduce((a, f) => a + f.total, 0);
      if (T) { $(barSel).style.width = Math.round(100 * L / T) + '%'; $(txtSel).textContent = `${label} · ${(L / 1048576).toFixed(0)} / ${(T / 1048576).toFixed(0)} MB`; }
    } else if (p.status === 'initiate' && p.file) $(txtSel).textContent = label + ' · ' + p.file;
  };
}
async function loadVoiceModels(fromSetup){
  if (!V) return;
  const tasks = [];
  if (!V.hearingReady) {
    V.hearingLoading = true; tb('#tbEar', 'LOADING', 'warn');
    if (fromSetup) { $('#voiceProg').classList.add('show'); }
    tasks.push(V.loadHearing(S.ear, fromSetup ? progressTracker('#voiceProg i', '#voiceTxt', 'Hearing') : null)
      .then(() => { V.hearingLoading = false; tb('#tbEar', (S.ear.includes('small') ? 'WHISPER S' : 'WHISPER') + ' · ' + V.hearingDevice.toUpperCase(), 'on'); event('hearing ready (' + V.hearingDevice + ')'); if (S.wake) setWake(true); })
      .catch(e => { V.hearingLoading = false; tb('#tbEar', 'FAILED', 'off'); event('hearing failed: ' + e.message); throw e; }));
  }
  const voiceTask = () => V.loadVoice(fromSetup ? progressTracker('#voiceProg i', '#voiceTxt', 'Voice') : null)
    .then(() => { tb('#tbVoice', S.voice.replace(/^[ab]m_/, '').toUpperCase(), 'on'); fillVoiceSelect(); event('voice ready'); })
    .catch(e => { tb('#tbVoice', 'WINDOWS', 'warn'); event('neural voice failed, using Windows voice: ' + e.message); throw e; });
  if (!V.voiceReady) { tb('#tbVoice', 'LOADING', 'warn'); }
  try {
    await Promise.all(tasks);           // hearing first, then voice (keeps downloads tidy)
    if (!V.voiceReady) await voiceTask();
    store.set('voiceDone', true);
    if (fromSetup) { $('#voiceProg i').style.width = '100%'; $('#voiceTxt').textContent = 'Hearing and voice are ready.'; stepState('#stVoice', 'ok'); }
  } catch (e) {
    if (fromSetup) $('#voiceTxt').textContent = 'Download failed: ' + e.message + '. Check your internet connection and try again.';
  }
}
function fillVoiceSelect(){
  const sel = $('#voiceSel'); sel.innerHTML = '';
  const list = V && V.voiceReady ? V.listVoices() : [];
  const nice = { bm_george:'George — British (Jarvis)', bm_lewis:'Lewis — British', bm_daniel:'Daniel — British', bm_fable:'Fable — British', am_michael:'Michael — American', am_adam:'Adam — American', am_eric:'Eric — American', am_liam:'Liam — American', am_onyx:'Onyx — American, deep', am_echo:'Echo — American', am_puck:'Puck — American', am_fenrir:'Fenrir — American' };
  (list.length ? list : (V ? V.MALE_VOICES.map(id => ({ id })) : [])).forEach(v => { const o = document.createElement('option'); o.value = v.id; o.textContent = nice[v.id] || v.id; sel.appendChild(o); });
  const w = document.createElement('option'); w.value = 'windows'; w.textContent = 'Windows built-in voice (David)'; sel.appendChild(w);
  sel.value = V && V.voiceReady ? S.voice : 'windows';
}

/* ============================================================ scene + orb (shared with the HTML version) */
/*__SCENE_ORB__*/
let lastFrame = 0;
function frame(t){
  requestAnimationFrame(frame);
  if (document.hidden) return;
  // fewer frames while the AI is thinking (it shares the graphics card) or when Jarvis isn't the active window
  let fps = Q.fps; if (S.thinking) fps = Math.min(fps, 20); if (!document.hasFocus()) fps = Math.min(fps, 10);
  if (t - lastFrame < 1000 / fps - 2) return;
  lastFrame = t; drawScene(t); drawOrb(t);
}
// note any moment the window stalls, so problems can be traced from the LOG panel
let lastStallLog = 0;
try {
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) {
      if (e.duration < 400 || performance.now() - lastStallLog < 5000) continue;
      lastStallLog = performance.now();
      event(`window stalled ${Math.round(e.duration)} ms (${speaking() ? 'speaking' : S.thinking ? 'thinking' : S.listening ? 'listening' : 'idle'})`);
    }
  }).observe({ type: 'longtask', buffered: false });
} catch {}

/* ============================================================ clock */
function tick(){
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString([], { hour12:false });
  $('#date').textContent = d.toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' }).toUpperCase();
  tickTimers();
}

/* ============================================================ wiring */
function wire(){
  const send = () => { const v = $('#say').value.trim(); if (v) handle(v); };
  $('#mic').onclick = talk; $('#core').onclick = talk; $('#send').onclick = send;
  $('#say').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  document.addEventListener('keydown', e => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (!typing && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); talk(); }
    if (e.key === 'Escape') { interrupt(); if (V) V.cancelListen(); S.listening = false; setState(); $('#modal').classList.remove('show'); $('#drawer').classList.remove('show'); }
  });
  J.on('hotkey:talk', () => talk());
  $('#wakePill').onclick = () => setWake(!S.wake);
  $('#newSess').onclick = () => { interrupt(); S.history = []; S.session = 0; $('#log').innerHTML = ''; renderCounters(); addMsg('sys', 'New session started. Memories are kept.'); };
  $('#stopVoice').onclick = interrupt;

  const openDrawer = tab => {
    $('#drawer').classList.add('show');
    $$('.pane').forEach(p => p.classList.toggle('show', p.id === 'pane-' + tab));
    $$('.tabs [data-pane]').forEach(b => b.classList.toggle('sel', b.dataset.pane === tab));
    if (tab === 'timers') renderTimers(); if (tab === 'memory') renderMem();
    if (tab === 'console') setTimeout(() => $('#termInput').focus(), 300);
  };
  $$('[data-tab]').forEach(b => b.onclick = () => openDrawer(b.dataset.tab));
  $$('[data-pane]').forEach(b => b.onclick = () => openDrawer(b.dataset.pane));
  $$('[data-open="settings"]').forEach(b => b.onclick = () => { $('#modal').classList.add('show'); refreshModels(); });
  $('#closeDrawer').onclick = () => $('#drawer').classList.remove('show');
  $('#termForm').onsubmit = e => { e.preventDefault(); const v = $('#termInput').value.trim(); if (!v) return; $('#termInput').value = ''; if (v === 'cls' || v === 'clear') { $('#term').innerHTML = ''; return; } runPS(v); };
  $$('.protos button').forEach(b => b.onclick = () => b.dataset.say ? handle(b.dataset.say) : runPS(b.dataset.ps));

  $('#tAdd').onclick = () => { const n = parseFloat($('#tMin').value); if (n > 0) { addTimer(n * 60000, $('#tLabel').value.trim(), $('#tLabel').value.trim() ? 'reminder' : 'timer'); $('#tMin').value = $('#tLabel').value = ''; } };
  $('#timerList').onclick = e => { const id = e.target.dataset.id; if (id) { S.timers = S.timers.filter(t => String(t.id) !== id); store.set('timers', S.timers); renderTimers(); } };
  $('#memAdd').onclick = () => { const v = $('#memIn').value.trim(); if (v) { addMemory(v); $('#memIn').value = ''; } };
  $('#memIn').onkeydown = e => { if (e.key === 'Enter') $('#memAdd').click(); };
  $('#memList').onclick = e => { const i = e.target.dataset.i; if (i != null) { S.memories.splice(+i, 1); saveMem(); } };
  $('#taskIn').onkeydown = e => { if (e.key === 'Enter' && e.target.value.trim()) { S.tasks.push({ text: e.target.value.trim(), done:false }); e.target.value = ''; saveTasks(); } };
  $('#tasks').onclick = e => { const d = e.target.dataset; if (d.del != null) { S.tasks.splice(+d.del, 1); saveTasks(); } else if (d.i != null) { S.tasks[+d.i].done = e.target.checked; saveTasks(); } };

  $('#wSet').onclick = () => { const v = $('#wCity').value.trim(); if (v) setCity(v); };
  $('#wCity').onkeydown = e => { if (e.key === 'Enter') $('#wSet').click(); };
  $('#wRef').onclick = loadWeather; $('#wLoc').onclick = locateMe;

  // settings
  $('#closeModal').onclick = () => $('#modal').classList.remove('show');
  $('#modal').onclick = e => { if (e.target.id === 'modal') $('#modal').classList.remove('show'); };
  $('#nameIn').value = S.name; $('#nameIn').onchange = e => { S.name = e.target.value.trim(); store.set('name', S.name); renderOperator(); };
  $('#modelSel').onchange = async e => { S.model = e.target.value; store.set('model', S.model); S.history = []; await loadModelInfo(); updateBrainChip(); event('brain: ' + S.model); warmUp(); };
  $('#refreshModels').onclick = refreshModels;
  $('#moreModels').onclick = () => { $('#modal').classList.remove('show'); runSetup(true).then(watchSetup); };
  $('#rerunSetup').onclick = $('#moreModels').onclick;
  $('#deep').checked = S.deep; $('#deep').onchange = e => { S.deep = e.target.checked; store.set('deep', S.deep); };
  $('#voiceSel').onchange = e => { if (e.target.value !== 'windows') { S.voice = e.target.value; store.set('voice', S.voice); tb('#tbVoice', S.voice.replace(/^[ab]m_/, '').toUpperCase(), 'on'); } else { if (V) V.voiceReady = false; tb('#tbVoice', 'WINDOWS', 'warn'); } };
  $('#rate').value = S.rate; const showR = () => $('#rateV').textContent = (+S.rate).toFixed(2); showR();
  $('#rate').oninput = e => { S.rate = +e.target.value; store.set('rate', S.rate); showR(); };
  $('#testVoice').onclick = () => { stopVoice(); speak(`${greeting()}, sir. All systems are online and at your disposal.`); };
  $('#earSel').value = S.ear; $('#earSel').onchange = e => { S.ear = e.target.value; store.set('ear', S.ear); if (V) { V.hearingReady = false; loadVoiceModels(false); } };
  $('#sens').value = S.sens; const showS = () => $('#sensV').textContent = Math.round(S.sens * 100) + '%'; showS();
  $('#sens').oninput = e => { S.sens = +e.target.value; store.set('sens', S.sens); if (V) V.sensitivity = S.sens; showS(); };
  $('#autoSafe').checked = S.autoSafe; $('#autoSafe').onchange = e => { S.autoSafe = e.target.checked; store.set('autoSafe', S.autoSafe); };
  $('#confirm').checked = S.confirm; $('#confirm').onchange = e => { S.confirm = e.target.checked; store.set('confirm', S.confirm); };
  $('#qualSel').value = quality;
  $('#qualSel').onchange = e => { quality = e.target.value; store.set('quality', quality); Q = QUALITY[quality]; applyQuality(); buildScene(); event('visual quality: ' + quality); };
  $('#celsius').checked = S.celsius; $('#celsius').onchange = e => { S.celsius = e.target.checked; store.set('celsius', S.celsius); loadWeather(); };
  $('#login').onchange = e => J.setPrefs({ login: e.target.checked });
  $('#trayChk').onchange = e => J.setPrefs({ tray: e.target.checked });

  // setup wizard
  $('#modelChoices').onclick = e => { const m = e.target.closest('.model'); if (m) { pickTag = m.dataset.tag; $('#customModel').value = ''; renderModelChoices(); } };
  $('#pullBtn').onclick = () => {
    const tag = $('#customModel').value.trim() || pickTag;
    const have = S.models.find(x => x.name === tag || x.name.startsWith(tag + ':') || (tag.includes(':') ? false : x.name.startsWith(tag)));
    if (have) { S.model = have.name; store.set('model', S.model); refreshModels().then(() => { stepState('#stBrain', 'ok'); warmUp(); }); $('#pullTxt').textContent = 'Using ' + have.name + '.'; return; }
    pullModel(tag);
  };
  $('#pullCancel').onclick = () => pulling && J.ollama.pullCancel(pulling);
  $('#getOllama').onclick = () => J.openExternal('https://ollama.com/download/windows');
  $('#recheckOllama').onclick = async () => { $('#stOllamaTxt').textContent = 'Checking…'; await J.ollama.start(); await sleep(2500); runSetup(true); };
  $('#voiceBtn').onclick = () => { $('#voiceBtn').disabled = true; loadVoiceModels(true).finally(() => $('#voiceBtn').disabled = false); };
  $('#setupDone').onclick = () => { $('#setup').classList.remove('show'); greet(); };
}

/* ============================================================ voice module hookup */
function attachVoice(){
  V = window.JarvisVoice; if (!V || V._hooked) return; V._hooked = true;
  V.sensitivity = S.sens;
  V.log = m => event(m);
  V.onLevel = lv => { S.micLv = lv; };
  V.onSpeakingChange = () => setState();
  V.onVadState = st => { if (st === 'recording') $('#state').textContent = 'listening'; else setState(); };
  fillVoiceSelect();
  if (store.get('voiceDone', false)) loadVoiceModels(false);   // from cache: quick, offline
  else { tb('#tbEar', 'SETUP', 'warn'); tb('#tbVoice', 'WINDOWS', 'warn'); }
}
window.addEventListener('jarvis-voice-ready', attachVoice);

/* ============================================================ updates */
let updAnnounced = null;
function renderUpdate(st){
  const t = $('#updTxt'), ib = $('#updInstall');
  ib.style.display = st.state === 'ready' ? '' : 'none';
  t.textContent = {
    dev: 'Updates are only checked in the installed app.', idle: 'Jarvis checks for new versions automatically.',
    checking: 'Checking for updates…', latest: 'You have the latest version.',
    downloading: `Downloading version ${st.version || ''}… ${st.percent ? st.percent + '%' : ''}`,
    ready: `Version ${st.version} is ready. Restart to apply it.`, error: 'Update check failed: ' + (st.error || 'unknown error')
  }[st.state] || '';
  if (st.state === 'ready' && updAnnounced !== st.version) {
    updAnnounced = st.version;
    event('update ' + st.version + ' downloaded');
    const box = document.createElement('div');
    box.innerHTML = `${st.notes ? `<div class="cmd" style="color:var(--ink)">${esc(st.notes.slice(0, 600))}</div>` : ''}<div class="acts"><button class="btn">RESTART NOW</button><button class="btn no">LATER</button></div>`;
    const [go, later] = box.querySelectorAll('button');
    go.onclick = () => J.update.install();
    later.onclick = () => { box.querySelector('.acts').innerHTML = '<span class="muted" style="font-size:8.5px;letter-spacing:.2em">INSTALLS NEXT TIME JARVIS CLOSES</span>'; };
    addMsg('sys', `Jarvis ${st.version} is ready.`, box);
    if (!S.thinking && !speaking()) speak('Sir, an update is ready. Restart me whenever convenient.');
  }
}
J.on('update:status', renderUpdate);

/* ============================================================ start */
let greeted = false;
function greet(){
  if (greeted) return; greeted = true;
  const name = S.name ? ', ' + S.name : ', sir';
  addMsg('sys', `J.A.R.V.I.S. online. Brain: ${S.model || 'none'}. Welcome back, ${userName()}.`);
  const line = S.ollama && S.model ? `${greeting()}${name}. All systems online.` + (S.memories.length ? ` I remember ${S.memories.length} thing${S.memories.length > 1 ? 's' : ''} about you.` : '') : `${greeting()}${name}. My brain isn’t set up yet — Settings will walk you through it.`;
  reply(line);
  if (!S.info.login && !store.get('askedLogin', false)) { store.set('askedLogin', true); addMsg('sys', 'Tip: Settings → “Start Jarvis with Windows” keeps me ready at all times. Press Ctrl+Shift+J from any app to talk.'); }
}
async function boot(){
  wire();
  S.info = await J.info();
  if (S.info.platform === 'darwin') document.body.classList.add('mac');
  $('#login').checked = !!S.info.login; $('#trayChk').checked = !!S.info.tray;
  renderOperator(); renderCounters(); renderMem(); renderTasks(); renderTimers(); renderRelays(); setState();
  $('#wakePill').classList.toggle('on', S.wake); $('#wakeTxt').textContent = S.wake ? 'ON' : 'OFF';
  applyQuality(); buildScene();
  let rz = 0; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { buildScene(); renderCounters(); }, 200); });
  requestAnimationFrame(frame);
  tick(); setInterval(tick, 1000);
  setInterval(() => { if (!document.hidden) { drawActivity(); renderRelays(); } }, 1000);
  pollStats(); setInterval(() => { if (!document.hidden) pollStats(); }, 5000); setInterval(() => { if (!document.hidden) pollGpu(); }, 8000);
  if (S.city) { $('#wCity').value = S.city.name.split(',')[0]; loadWeather(); }
  loadBtc(); setInterval(loadBtc, 60000); setInterval(loadWeather, 15 * 60000);
  setInterval(async () => { const was = S.ollama; const v = await J.ollama.version(); if (v.ok !== was) { await refreshModels(); event(v.ok ? 'Ollama connected' : 'Ollama disconnected'); if (v.ok) warmUp(); } }, 6000);
  attachVoice();
  J.update.state().then(st => {
    $('#verTxt').textContent = st.current; renderUpdate(st);
    if (st.justUpdated) addMsg('sys', `Updated to version ${st.justUpdated.version}.` + (st.justUpdated.notes ? ' What’s new: ' + st.justUpdated.notes.slice(0, 500) : ''));
  });
  $('#updCheck').onclick = () => J.update.check().then(renderUpdate);
  const showKey = has => { $('#keyState').textContent = has ? 'SAVED ✓' : 'NOT SET'; $('#keyState').style.color = has ? 'var(--ok)' : 'var(--warn)'; };
  J.update.state().then(st => showKey(st.hasKey));
  $('#updKeySave').onclick = async () => {
    const k = $('#updKey').value.trim();
    $('#updKeyTxt').textContent = k ? 'Checking the key with GitHub…' : 'Removing key…';
    const r = await J.update.setKey(k);
    $('#updKey').value = '';
    if (r.ok) { showKey(!r.cleared); $('#updKeyTxt').textContent = r.cleared ? 'Key removed.' : 'Key works and is saved. Jarvis will use it to check for updates.'; event(r.cleared ? 'update key removed' : 'update key saved'); }
    else $('#updKeyTxt').textContent = r.error;
  };
  $('#updKey').onkeydown = e => { if (e.key === 'Enter') $('#updKeySave').click(); };
  $('#updInstall').onclick = () => J.update.install();

  const lines = ['initialising neural interface ........ OK', 'locating AI engine ................... ', 'loading memory banks ................. ' + S.memories.length + ' ENTRIES', 'calibrating voice synthesis .......... OK', '', 'ALL SYSTEMS READY.'];
  const el = $('#bootText');
  el.textContent += lines[0] + '\n';
  let ok = await refreshModels();
  if (!ok) { await J.ollama.start(); for (let i = 0; i < 6 && !ok; i++) { await sleep(1000); ok = await refreshModels(); } }
  el.textContent += lines[1] + (ok ? 'OK' : 'NOT FOUND') + '\n';
  for (const l of lines.slice(2)) { el.textContent += l + '\n'; await sleep(120); }
  await sleep(250);
  $('#boot').classList.add('hide');
  const needSetup = await runSetup(false);
  if (needSetup) watchSetup(); else { greet(); warmUp(); }
}
boot();
})();
