// Desktop pet: an original little floating music-bot that mirrors what Jarvis is doing.
(() => {
'use strict';
const P = window.pet;
const c = document.getElementById('c'), x = c.getContext('2d');
const dpr = 2; x.scale(dpr, dpr);
const W = 240, H = 260;
const OX = 30, OY = 80;                                 // where the drawn bot sits inside the 300x340 window
const sprite = document.getElementById('sprite'), fx = document.getElementById('fx'), fxx = fx.getContext('2d'); fxx.scale(2, 2);
let custom = {}, scale = 1, imgs = {}, curSrc = '';
let st = { state: 'idle', level: 0, theme: 'neon' }, lvl = 0, blinkAt = 0, blink = 0, notes = [], lastActive = performance.now(), bubbleT = null;
const COL = {
  neon:    { body1: '#f2fffd', body2: '#9ef2e6', rim: '#3ff0d8', visor: '#12062c', eye: '#3ff0d8', acc: '#ff5fb4', accRGB: '255,95,180', eyeRGB: '63,240,216' },
  classic: { body1: '#f4f9ff', body2: '#b9d9ee', rim: '#8fe3ff', visor: '#0a1626', eye: '#8fe3ff', acc: '#ffd38a', accRGB: '255,211,138', eyeRGB: '143,227,255' }
};

P.on(d => {
  if (d.theme) { st.theme = d.theme; document.body.className = d.theme === 'classic' ? 'classic' : ''; }
  if (d.state) { if (d.state !== 'idle') lastActive = performance.now(); st.state = d.state; }
  if (typeof d.level === 'number') st.level = d.level;
  if (d.say) say(d.say);
  if ('scale' in d) scale = d.scale || 1;
  if ('custom' in d) {
    custom = d.custom || {};
    imgs = {};
    for (const k of ['idle', 'speaking', 'listening', 'thinking']) if (custom[k]) { const im = new Image(); im.src = custom[k]; imgs[k] = im; }
    const on = !!custom.idle;
    c.style.display = on ? 'none' : 'block'; sprite.style.display = on ? 'block' : 'none';
    curSrc = '';
  }
});
// for click-through: is there a visible pixel of the custom picture under the mouse?
const hitCv = document.createElement('canvas'), hitX = hitCv.getContext('2d', { willReadFrequently: true });
function overSprite(mx, my) {
  const r = sprite.getBoundingClientRect();
  if (mx < r.left || mx > r.right || my < r.top || my > r.bottom || !r.width) return false;
  try {
    hitCv.width = Math.max(1, Math.round(r.width)); hitCv.height = Math.max(1, Math.round(r.height));
    hitX.drawImage(sprite, 0, 0, hitCv.width, hitCv.height);
    return hitX.getImageData(Math.round(mx - r.left), Math.round(my - r.top), 1, 1).data[3] > 25;
  } catch { return true; }
}
function say(text) {
  const el = document.getElementById('say');
  el.textContent = text.length > 110 ? text.slice(0, 107) + '…' : text;
  document.getElementById('bubble').style.display = 'flex';
  clearTimeout(bubbleT); bubbleT = setTimeout(() => document.getElementById('bubble').style.display = 'none', Math.min(9000, 2500 + text.length * 45));
}

// ---- input: drag to move, click to talk, right-click for a menu. Only the bot itself catches the mouse.
const cx = 120, cy = 178;
const overBot = (mx, my) => {
  if (custom.idle) return overSprite(mx, my);
  mx -= OX; my -= OY;
  return Math.hypot(mx - cx, (my - cy) * 1.05) < 54 || (Math.abs(mx - cx) < 8 && my > cy - 92 && my < cy - 40);
};
let hover = false, down = null, moved = false;
addEventListener('mousemove', e => {
  const h = overBot(e.clientX, e.clientY) || !!down;
  if (h !== hover) { hover = h; P.mouse(h); }
  if (down) { const dx = e.screenX - down.x, dy = e.screenY - down.y; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; if (moved) P.drag(dx, dy); }
});
addEventListener('mousedown', e => { if (e.button === 0 && overBot(e.clientX, e.clientY)) { down = { x: e.screenX, y: e.screenY }; moved = false; P.dragStart(); } });
addEventListener('mouseup', e => { if (e.button !== 0 || !down) return; const wasMoved = moved; down = null; P.dragEnd(); if (!wasMoved) { P.click(); hop = 1; } });
addEventListener('contextmenu', e => { e.preventDefault(); if (overBot(e.clientX, e.clientY)) P.menu(); });
addEventListener('mouseleave', () => { if (!down && hover) { hover = false; P.mouse(false); } });
let hop = 0;

// ---- drawing
function rr(x0, y0, w, h, r) { x.beginPath(); x.moveTo(x0 + r, y0); x.arcTo(x0 + w, y0, x0 + w, y0 + h, r); x.arcTo(x0 + w, y0 + h, x0, y0 + h, r); x.arcTo(x0, y0 + h, x0, y0, r); x.arcTo(x0, y0, x0 + w, y0, r); x.closePath(); }
function frameCustom(t) {
  const C = COL[st.theme] || COL.neon, s = st.state, sec = t / 1000;
  lvl += (st.level - lvl) * .35; hop *= .9;
  const sleepy = s === 'idle' && t - lastActive > 180000;
  const want = (imgs[s] && imgs[s].src) || imgs.idle.src;
  if (want !== curSrc) { sprite.src = want; curSrc = want; }
  const size = Math.round(200 * scale);
  sprite.style.maxWidth = Math.min(290, size) + 'px'; sprite.style.maxHeight = Math.min(300, size) + 'px';
  const bob = Math.sin(sec * (s === 'speaking' ? 4 : 1.6)) * (s === 'speaking' ? 3 : 4) - hop * 16;
  const sq = s === 'speaking' ? 1 + lvl * .05 : 1 + Math.sin(sec * 1.6) * .012;
  sprite.style.transform = `translateX(-50%) translateY(${bob}px) scale(${sq}, ${2 - sq})`;
  sprite.style.filter = s === 'listening' ? `drop-shadow(0 0 ${8 + lvl * 10}px rgba(${C.accRGB},.9))` : s === 'speaking' ? `drop-shadow(0 0 6px rgba(${C.eyeRGB},.7))` : sleepy ? 'grayscale(.35) brightness(.85)' : 'none';
  sprite.style.opacity = sleepy ? .85 : 1;
  // effects layer: shadow, rings, thinking dots, notes, z's
  fxx.clearRect(0, 0, 300, 340);
  const r = sprite.getBoundingClientRect(), mx = r.left + r.width / 2, top = r.top;
  document.getElementById('bubble').style.bottom = Math.round(340 - top + 8) + 'px';
  fxx.fillStyle = 'rgba(0,0,0,.2)'; fxx.beginPath(); fxx.ellipse(mx, 332, Math.max(20, r.width * .3), 6, 0, 0, 7); fxx.fill();
  if (s === 'listening') for (let i = 0; i < 3; i++) { const k = ((sec * .9 + i / 3) % 1); fxx.strokeStyle = `rgba(${C.accRGB},${(1 - k) * .5})`; fxx.lineWidth = 2; fxx.beginPath(); fxx.ellipse(mx, r.top + r.height * .55, r.width * .45 + k * 30, r.height * .45 + k * 30, 0, 0, 7); fxx.stroke(); }
  if (s === 'thinking') for (let i = 0; i < 3; i++) { fxx.fillStyle = `rgba(${C.accRGB},${.3 + .7 * ((Math.sin(sec * 5 - i) + 1) / 2)})`; fxx.beginPath(); fxx.arc(r.right - 6 + i * 11, top + 8 - i * 7, 3 + i, 0, 7); fxx.fill(); }
  if (sleepy) { fxx.fillStyle = `rgba(${C.eyeRGB},.85)`; fxx.font = 'bold 14px sans-serif'; fxx.fillText('z', r.right - 4, top + 14 + Math.sin(sec) * 3); fxx.font = 'bold 11px sans-serif'; fxx.fillText('z', r.right + 8, top + Math.sin(sec + 1) * 3); }
  if ((s === 'speaking' && Math.random() < .06) || (s === 'idle' && !sleepy && Math.random() < .004)) notes.push({ x: mx + (Math.random() - .5) * r.width * .6, y: top + 10, vx: (Math.random() - .5) * .6, a: 1, ch: Math.random() < .5 ? '♪' : '♫', col: Math.random() < .5 ? C.acc : C.eye });
  fxx.font = '16px serif'; notes = notes.filter(n => n.a > 0);
  for (const n of notes) { n.x += n.vx; n.y -= .7; n.a -= .012; fxx.globalAlpha = Math.max(0, n.a); fxx.fillStyle = n.col; fxx.fillText(n.ch, n.x, n.y); }
  fxx.globalAlpha = 1;
}
function frame(t) {
  requestAnimationFrame(frame);
  if (custom.idle && imgs.idle) { frameCustom(t); return; }
  fxx.clearRect(0, 0, 300, 340);
  document.getElementById('bubble').style.bottom = '';
  const C = COL[st.theme] || COL.neon, s = st.state, sec = t / 1000;
  lvl += (st.level - lvl) * .35;
  const sleepy = s === 'idle' && t - lastActive > 180000;
  x.clearRect(0, 0, W, H);
  hop *= .9;
  const bob = Math.sin(sec * (s === 'speaking' ? 4 : 1.6)) * (s === 'speaking' ? 3 : 5) - hop * 16;
  const by = cy + bob;

  // shadow
  x.fillStyle = `rgba(0,0,0,${.22 - bob * .01})`; x.beginPath(); x.ellipse(cx, 246, 40 - bob * .6, 7, 0, 0, 7); x.fill();
  // listening rings
  if (s === 'listening') for (let i = 0; i < 3; i++) { const k = ((sec * .9 + i / 3) % 1); x.strokeStyle = `rgba(${C.accRGB},${(1 - k) * .55})`; x.lineWidth = 2; x.beginPath(); x.arc(cx, by, 56 + k * 40 + lvl * 20, 0, 7); x.stroke(); }
  // antenna with a music-note tip
  x.strokeStyle = C.rim; x.lineWidth = 3; x.beginPath(); x.moveTo(cx, by - 50); x.quadraticCurveTo(cx + Math.sin(sec * 2) * 6, by - 66, cx + Math.sin(sec * 2) * 4, by - 80); x.stroke();
  const ax = cx + Math.sin(sec * 2) * 4, ay = by - 84;
  x.fillStyle = C.acc; x.shadowColor = C.acc; x.shadowBlur = s === 'idle' ? 6 : 14;
  x.beginPath(); x.ellipse(ax - 3, ay + 4, 6, 4.5, -.4, 0, 7); x.fill(); x.fillRect(ax + 1.5, ay - 12, 2.5, 16); x.beginPath(); x.moveTo(ax + 4, ay - 12); x.quadraticCurveTo(ax + 13, ay - 8, ax + 10, ay - 1); x.lineTo(ax + 4, ay - 6); x.fill();
  x.shadowBlur = 0;
  // ear pods (speaker cones)
  for (const d of [-1, 1]) {
    const ex = cx + d * 50;
    x.fillStyle = C.visor; rr(ex - 9, by - 18, 18, 36, 8); x.fill();
    x.fillStyle = (s === 'listening' || s === 'speaking') ? C.acc : C.rim; x.globalAlpha = .55 + lvl * .45;
    rr(ex - 5 + d * 2, by - 11, 10, 22, 5); x.fill(); x.globalAlpha = 1;
  }
  // body
  let g = x.createLinearGradient(cx, by - 52, cx, by + 52); g.addColorStop(0, C.body1); g.addColorStop(1, C.body2);
  x.fillStyle = g; x.beginPath(); x.ellipse(cx, by, 47, 50, 0, 0, 7); x.fill();
  x.strokeStyle = C.rim; x.lineWidth = 2; x.globalAlpha = .7; x.stroke(); x.globalAlpha = 1;
  // visor
  x.fillStyle = C.visor; rr(cx - 34, by - 24, 68, 40, 18); x.fill();
  x.strokeStyle = `rgba(${C.eyeRGB},.35)`; x.lineWidth = 1.5; x.stroke();
  // eyes
  if (t > blinkAt) { blink = 1; blinkAt = t + 2500 + Math.random() * 3500; }
  blink = Math.max(0, blink - .12);
  const lookX = s === 'thinking' ? Math.sin(sec * 3) * 5 : 0, lookY = s === 'thinking' ? -4 : 0;
  x.fillStyle = C.eye; x.shadowColor = C.eye; x.shadowBlur = 10;
  for (const d of [-1, 1]) {
    const ex = cx + d * 15 + lookX, ey = by - 6 + lookY;
    if (sleepy) { x.fillRect(ex - 7, ey, 14, 2.5); continue; }
    if (s === 'listening') { x.beginPath(); x.ellipse(ex, ey, 7.5, 8.5 * (1 - blink * .9), 0, 0, 7); x.fill(); }
    else if (s === 'speaking' || s === 'idle') { x.beginPath(); x.ellipse(ex, ey, 6, 7.5 * (1 - blink * .9), 0, 0, 7); x.fill(); }
    else { x.beginPath(); x.arc(ex, ey, 5, Math.PI, 0); x.lineWidth = 3; x.strokeStyle = C.eye; x.stroke(); }   // thinking: ^ ^
  }
  x.shadowBlur = 0;
  // mouth: equalizer when speaking
  if (s === 'speaking') {
    for (let i = 0; i < 7; i++) { const h = 2 + (Math.sin(sec * 18 + i * 1.3) * .5 + .5) * (4 + lvl * 9); x.fillStyle = i % 2 ? C.acc : C.eye; x.fillRect(cx - 14 + i * 4, by + 9 - h / 2, 2.5, h); }
  } else if (!sleepy) { x.strokeStyle = `rgba(${C.eyeRGB},.8)`; x.lineWidth = 2; x.beginPath(); x.arc(cx, by + 5, 5, .2, Math.PI - .2); x.stroke(); }
  // cheeks
  x.fillStyle = `rgba(${C.accRGB},.35)`; for (const d of [-1, 1]) { x.beginPath(); x.ellipse(cx + d * 30, by + 22, 6, 3.5, 0, 0, 7); x.fill(); }
  // thinking dots
  if (s === 'thinking') for (let i = 0; i < 3; i++) { x.fillStyle = `rgba(${C.accRGB},${.3 + .7 * ((Math.sin(sec * 5 - i) + 1) / 2)})`; x.beginPath(); x.arc(cx + 38 + i * 11, by - 54 - i * 6, 3 + i, 0, 7); x.fill(); }
  // sleeping z's
  if (sleepy) { x.fillStyle = `rgba(${C.eyeRGB},.8)`; x.font = 'bold 13px sans-serif'; x.fillText('z', cx + 40, by - 50 + Math.sin(sec) * 3); x.font = 'bold 10px sans-serif'; x.fillText('z', cx + 52, by - 64 + Math.sin(sec + 1) * 3); }
  // floating notes while speaking (and now and then while idle)
  if ((s === 'speaking' && Math.random() < .06) || (s === 'idle' && !sleepy && Math.random() < .004)) notes.push({ x: cx + (Math.random() - .5) * 60, y: by - 40, vx: (Math.random() - .5) * .6, a: 1, ch: Math.random() < .5 ? '♪' : '♫', col: Math.random() < .5 ? C.acc : C.eye });
  x.font = '16px serif';
  notes = notes.filter(n => n.a > 0);
  for (const n of notes) { n.x += n.vx; n.y -= .7; n.a -= .012; x.globalAlpha = Math.max(0, n.a); x.fillStyle = n.col; x.fillText(n.ch, n.x, n.y); }
  x.globalAlpha = 1;
}
requestAnimationFrame(frame);
P.ready();
})();
