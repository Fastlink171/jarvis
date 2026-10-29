/* ============================================================ night scene */
const scene = $('#scene'), sx = scene.getContext('2d');
let bgImg = null, motes = [];
function rnd(seed){ return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
function buildNeon(x, W, H, R){
  // night stage: deep violet sky, glowing striped sun, skyline, neon grid floor, stage beams
  const sky = x.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#05021a'); sky.addColorStop(.38, '#160a3a'); sky.addColorStop(.62, '#3b0f55'); sky.addColorStop(.71, '#7a1a6e'); sky.addColorStop(.72, '#0b0420'); sky.addColorStop(1, '#05020f');
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 220; i++) { x.fillStyle = `rgba(${R() < .5 ? '190,255,245' : '255,200,235'},${R() * .7})`; const z = R() * 1.4; x.fillRect(R() * W, R() * H * .6, z, z); }
  const hz = H * .715, sx0 = W * .5, sr = Math.min(W, H) * .2;
  let g = x.createRadialGradient(sx0, hz, 0, sx0, hz, sr * 3.2); g.addColorStop(0, 'rgba(255,80,170,.45)'); g.addColorStop(.4, 'rgba(120,40,170,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.save(); x.beginPath(); x.arc(sx0, hz, sr, Math.PI, 0); x.clip();
  g = x.createLinearGradient(0, hz - sr, 0, hz); g.addColorStop(0, '#ffd2f0'); g.addColorStop(.45, '#ff5fb4'); g.addColorStop(1, '#7a2bd6');
  x.fillStyle = g; x.fillRect(sx0 - sr, hz - sr, sr * 2, sr);
  x.fillStyle = '#160a3a'; for (let i = 0; i < 7; i++) { const yy = hz - sr * .55 + i * sr * .085, hh = 2 + i * 1.6; x.fillRect(sx0 - sr, yy, sr * 2, hh); }
  x.restore();
  // skyline
  x.fillStyle = '#0a0420';
  let px = 0; const sky2 = [];
  while (px < W) { const bw = 18 + R() * 46, bh = H * (.04 + R() * .13) * (Math.abs(px - sx0) < sr * 1.1 ? .55 : 1); sky2.push([px, bw, bh]); x.fillRect(px, hz - bh, bw - 2, bh); px += bw; }
  for (const [bx, bw, bh] of sky2) for (let wy = hz - bh + 6; wy < hz - 4; wy += 7) for (let wx = bx + 4; wx < bx + bw - 6; wx += 6) if (R() < .18) { x.fillStyle = R() < .6 ? 'rgba(60,240,220,.75)' : 'rgba(255,110,190,.7)'; x.fillRect(wx, wy, 2, 3); }
  // neon grid floor
  g = x.createLinearGradient(0, hz, 0, H); g.addColorStop(0, '#12062e'); g.addColorStop(1, '#030108');
  x.fillStyle = g; x.fillRect(0, hz, W, H - hz);
  x.lineWidth = 1;
  for (let i = -24; i <= 24; i++) { x.strokeStyle = `rgba(60,240,220,${.35 - Math.abs(i) * .01})`; x.beginPath(); x.moveTo(sx0 + i * 18, hz); x.lineTo(sx0 + i * W * .16, H); x.stroke(); }
  for (let k = 1; k < 18; k++) { const t = Math.pow(k / 18, 2.2), yy = hz + (H - hz) * t; x.strokeStyle = `rgba(255,95,180,${.12 + t * .45})`; x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy); x.stroke(); }
  g = x.createLinearGradient(0, hz - 3, 0, hz + 3); g.addColorStop(0, 'rgba(255,120,200,0)'); g.addColorStop(.5, 'rgba(255,150,220,.9)'); g.addColorStop(1, 'rgba(255,120,200,0)');
  x.fillStyle = g; x.fillRect(0, hz - 3, W, 6);
  // stage light beams
  [[.08, '60,240,220'], [.92, '255,95,180'], [.22, '255,95,180'], [.78, '60,240,220']].forEach(([fx, col], i) => {
    const bx = W * fx, ang = (fx < .5 ? 1 : -1) * (.32 + i * .05);
    x.save(); x.translate(bx, H); x.rotate(ang);
    const bg = x.createLinearGradient(0, 0, 0, -H * 1.1); bg.addColorStop(0, `rgba(${col},.22)`); bg.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = bg; x.beginPath(); x.moveTo(-6, 0); x.lineTo(6, 0); x.lineTo(70, -H * 1.1); x.lineTo(-70, -H * 1.1); x.closePath(); x.fill(); x.restore();
  });
  g = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(3,0,10,.55)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
}
function buildScene(){
  const W = innerWidth, H = innerHeight, dpr = Math.min(devicePixelRatio || 1, Q.dpr);
  scene.width = W * dpr; scene.height = H * dpr;
  const c = document.createElement('canvas'); c.width = W * dpr; c.height = H * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr); const R = rnd(7);
  if (S.wallImg && S.wallImg.complete && S.wallImg.naturalWidth) {
    // the user's own wallpaper, scaled to cover the window, dimmed so the panels stay readable
    const im = S.wallImg, k = Math.max(W / im.naturalWidth, H / im.naturalHeight), iw = im.naturalWidth * k, ih = im.naturalHeight * k;
    x.drawImage(im, (W - iw) / 2, (H - ih) / 2, iw, ih);
    x.fillStyle = `rgba(4,2,12,${S.wallDim})`; x.fillRect(0, 0, W, H);
    const vg = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
    x.fillStyle = vg; x.fillRect(0, 0, W, H);
    bgImg = c;
    motes = S.theme === 'neon' ? Array.from({ length: Math.round(W * H / 90000) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 5 + Math.random() * 6, vx: (Math.random() - .5) * .15, vy: -.12 - Math.random() * .25, p: Math.random() * 7, k: Math.floor(Math.random() * 4) })) : [];
    return;
  }
  if (S.theme === 'neon') {
    buildNeon(x, W, H, R); bgImg = c;
    motes = Array.from({ length: Math.round(W * H / 60000) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 5 + Math.random() * 6, vx: (Math.random() - .5) * .15, vy: -.12 - Math.random() * .25, p: Math.random() * 7, k: Math.floor(Math.random() * 4) }));
    return;
  }
  // sky
  const sky = x.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#07111f'); sky.addColorStop(.35, '#15304a'); sky.addColorStop(.62, '#3b5b78'); sky.addColorStop(.8, '#2a4258'); sky.addColorStop(1, '#0a1420');
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(230,240,255,${R() * .6})`; const s = R() * 1.3; x.fillRect(R() * W, R() * H * .45, s, s); }
  // moon
  const mx = W * .3, my = H * .05, mr = Math.max(46, H * .085);
  let g = x.createRadialGradient(mx, my, mr * .8, mx, my, mr * 4); g.addColorStop(0, 'rgba(220,235,250,.35)'); g.addColorStop(1, 'rgba(220,235,250,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  g = x.createRadialGradient(mx - mr * .3, my - mr * .3, mr * .1, mx, my, mr); g.addColorStop(0, '#f4f7f8'); g.addColorStop(1, '#b9c5cd');
  x.fillStyle = g; x.beginPath(); x.arc(mx, my, mr, 0, 7); x.fill();
  x.save(); x.beginPath(); x.arc(mx, my, mr, 0, 7); x.clip();
  for (let i = 0; i < 14; i++) { const a = R() * 7, d = R() * mr * .85, r = mr * (.04 + R() * .12); x.fillStyle = `rgba(110,128,142,${.06 + R() * .08})`; x.beginPath(); x.arc(mx + Math.cos(a) * d, my + Math.sin(a) * d, r, 0, 7); x.fill(); }
  x.restore();
  // clouds
  const cloud = (cx, cy, w, h, light) => {
    for (let i = 0; i < 26; i++) {
      const px = cx + (R() - .5) * w, py = cy + (R() - .5) * h * (1 - Math.abs(px - cx) / w), r = h * (.25 + R() * .55);
      const top = py < cy;
      const cg = x.createRadialGradient(px, py - r * .3, 0, px, py, r);
      cg.addColorStop(0, `rgba(${top ? '190,215,236' : '92,124,156'},${light * (.25 + R() * .25)})`); cg.addColorStop(1, 'rgba(90,115,140,0)');
      x.fillStyle = cg; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
    }
  };
  for (let i = 0; i < 9; i++) cloud(R() * W, H * (.28 + R() * .42), W * (.15 + R() * .25), H * (.07 + R() * .1), .5 + R() * .5);
  for (let i = 0; i < 6; i++) cloud(R() * W, H * (.12 + R() * .15), W * (.1 + R() * .2), H * .04, .25);
  // horizon glow + water
  g = x.createLinearGradient(0, H * .74, 0, H * .86); g.addColorStop(0, 'rgba(160,190,215,0)'); g.addColorStop(.5, 'rgba(160,190,215,.22)'); g.addColorStop(1, 'rgba(160,190,215,0)');
  x.fillStyle = g; x.fillRect(0, H * .74, W, H * .12);
  // ground
  x.fillStyle = '#050a11'; x.beginPath(); x.moveTo(0, H);
  for (let px = 0; px <= W; px += 8) x.lineTo(px, H * .86 + Math.sin(px * .004) * H * .015 + Math.sin(px * .023) * 4 + (R() - .5) * 3);
  x.lineTo(W, H); x.closePath(); x.fill();
  x.strokeStyle = '#050a11'; x.lineWidth = 1;
  for (let i = 0; i < 500; i++) { const px = R() * W, base = H * .86 + Math.sin(px * .004) * H * .015; x.beginPath(); x.moveTo(px, base + 2); x.quadraticCurveTo(px + (R() - .5) * 6, base - 6, px + (R() - .5) * 10, base - 4 - R() * 14); x.stroke(); }
  // fence on the right
  x.fillStyle = '#04080e'; x.strokeStyle = 'rgba(4,8,14,.9)';
  const posts = []; for (let i = 0; i < 6; i++) { const px = W * (.72 + i * .055), top = H * (.74 + i * .006); posts.push([px, top]); x.fillRect(px, top, 4 + i * .6, H - top); }
  [0.25, 0.55].forEach(f => { x.beginPath(); posts.forEach(([px, top], i) => { const y = top + (H * .86 - top) * f; i ? x.lineTo(px, y) : x.moveTo(px, y); }); x.lineTo(W, H * .78 + (H * .08) * f); x.stroke(); });
  // vignette
  g = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,4,10,.6)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  bgImg = c;
  motes = Array.from({ length: Math.round(W * H / 26000) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() < .25 ? 4 + Math.random() * 7 : 1 + Math.random() * 2.5, vx: (Math.random() - .5) * .12, vy: -.05 - Math.random() * .18, p: Math.random() * 7 }));
}
const moteSprite = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(190,235,255,1)'); g.addColorStop(.35, 'rgba(150,215,245,.5)'); g.addColorStop(1, 'rgba(150,215,245,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c;
})();
const noteSprites = ['♪', '♫', '♪', '♬'].map((ch, i) => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const col = i % 2 ? '255,95,180' : '60,240,220';
  x.font = '40px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = `rgba(${col},.9)`; x.shadowBlur = 12; x.fillStyle = `rgba(${col},1)`; x.fillText(ch, 32, 34);
  return c;
});
function drawScene(t){
  const W = innerWidth, H = innerHeight, dpr = scene.width / W;
  sx.setTransform(1, 0, 0, 1, 0, 0); sx.drawImage(bgImg, 0, 0); sx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (Q.motes) {
    const step = Math.min(3, (t - (drawScene.last || t)) / 16.7 || 1); drawScene.last = t;
    for (const m of motes) {
      m.x += m.vx * step; m.y += m.vy * step; if (m.y < -20) { m.y = H + 20; m.x = Math.random() * W; } if (m.x < -20) m.x = W + 20; if (m.x > W + 20) m.x = -20;
      sx.globalAlpha = (.35 + .35 * Math.sin(t / 900 + m.p)) * (m.r > 4 ? .35 : .9);
      if (S.theme === 'neon') { const d = m.r * 3.2; sx.drawImage(noteSprites[m.k || 0], m.x - d / 2, m.y - d / 2, d, d); }
      else { const d = m.r * 4.8; sx.drawImage(moteSprite, m.x - d / 2, m.y - d / 2, d, d); }
    }
    sx.globalAlpha = 1;
  }
}

/* ============================================================ core orb */
const orb = $('#orb'), ox = orb.getContext('2d');
const dots = [];
for (let i = 1; i < 26; i++) { const phi = i / 26 * Math.PI, n = Math.round(64 * Math.sin(phi)); for (let k = 0; k < n; k++) { const th = k / n * Math.PI * 2; dots.push([Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th), Math.random()]); } }
function drawOrb(t){
  const dpr = Math.min(devicePixelRatio || 1, Q.dpr), W = orb.clientWidth, H = orb.clientHeight;
  if (orb.width !== W * dpr || orb.height !== H * dpr) { orb.width = W * dpr; orb.height = H * dpr; }
  ox.setTransform(dpr, 0, 0, dpr, 0, 0); ox.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H * .47, R = Math.min(W * .5, H) * .34, sec = t / 1000;
  if (analyser && S.listening) { analyser.getByteFrequencyData(meterData); let s = 0; for (const v of meterData) s += v; S.micLv = Math.min(1, s / meterData.length / 55); S.level = Math.max(S.level, S.micLv); } else S.micLv *= .9;
  if (S.speaking) S.level = Math.max(S.level, .25 + .2 * Math.sin(t / 90));
  if (S.thinking) S.level = Math.max(S.level, .18);
  S.level *= .93; const lv = S.level;
  const neon = S.theme === 'neon';
  const tint = S.thinking ? (neon ? '255,95,180' : '255,211,138') : (neon ? '60,240,220' : '143,227,255');
  const arcTint = neon ? '255,95,180' : tint;

  const g = ox.createRadialGradient(cx, cy, 0, cx, cy, R * 1.5);
  g.addColorStop(0, `rgba(${tint},${.06 + lv * .18})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ox.fillStyle = g; ox.fillRect(0, 0, W, H);

  const ay = sec * (.18 + lv * .7), ax = .38;
  const sy = Math.sin(ay), cyy = Math.cos(ay), sxx = Math.sin(ax), cxx = Math.cos(ax);
  ox.fillStyle = neon ? 'rgb(205,255,248)' : 'rgb(225,242,255)';
  for (const d of dots) {
    const [x, y, z, n] = d;
    const x1 = x * cyy - z * sy, z1 = x * sy + z * cyy, y1 = y * cxx - z1 * sxx, z2 = y * sxx + z1 * cxx;
    const wob = 1 + lv * .1 * Math.sin(n * 30 + sec * 7), persp = 1 / (1.7 - z2 * .45), rr = R * wob * persp * 1.62;
    const a = .08 + (z2 + 1) * .42;
    ox.globalAlpha = Math.min(1, a);
    const s = (1 + (z2 + 1) * .55) * (n > .985 ? 1.8 : 1);
    ox.fillRect(cx + x1 * rr - s / 2, cy + y1 * rr - s / 2, s, s);
  }  ox.globalAlpha = 1;

  // thin ring + ticks
  ox.strokeStyle = 'rgba(200,225,245,.18)'; ox.lineWidth = 1; ox.beginPath(); ox.arc(cx, cy, R * 1.25, 0, 7); ox.stroke();
  for (let i = 0; i < 64; i++) {
    if (i % 16 > 12) continue;
    const a = i / 64 * Math.PI * 2 + sec * .03, r0 = R * 1.5, l = i % 4 === 0 ? 9 : 4;
    ox.strokeStyle = 'rgba(200,225,245,.35)'; ox.beginPath(); ox.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ox.lineTo(cx + Math.cos(a) * (r0 + l), cy + Math.sin(a) * (r0 + l)); ox.stroke();
  }
  // signature bright arc
  const base = -0.9 + Math.sin(sec * .4) * .25 + (S.thinking ? sec * 2.5 : 0);
  ox.lineCap = 'round';
  ox.strokeStyle = `rgba(${arcTint},.12)`; ox.lineWidth = 16 + lv * 6; ox.beginPath(); ox.arc(cx, cy, R * 1.38, base, base + .75 + lv * .6); ox.stroke();
  ox.strokeStyle = `rgba(${arcTint},.22)`; ox.lineWidth = 9 + lv * 4; ox.beginPath(); ox.arc(cx, cy, R * 1.38, base, base + .75 + lv * .6); ox.stroke();
  ox.strokeStyle = `rgba(${arcTint},${.85})`; ox.lineWidth = 4 + lv * 3;
  ox.beginPath(); ox.arc(cx, cy, R * 1.38, base, base + .75 + lv * .6); ox.stroke();
  ox.lineWidth = 1.5; ox.strokeStyle = `rgba(${tint},.35)`;
  ox.beginPath(); ox.arc(cx, cy, R * 1.38, base + Math.PI, base + Math.PI + .35); ox.stroke();
  // voice bars
  if (lv > .03) for (let i = 0; i < 90; i++) {
    const a = i / 90 * Math.PI * 2, v = analyser && S.listening ? meterData[(i * 2) % meterData.length] / 255 : lv * (.5 + .5 * Math.sin(i * 1.7 + sec * 9));
    const r0 = R * 1.1, l = v * R * .14;
    ox.strokeStyle = `rgba(${tint},${.2 + v * .6})`; ox.lineWidth = 1.5;
    ox.beginPath(); ox.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ox.lineTo(cx + Math.cos(a) * (r0 + l), cy + Math.sin(a) * (r0 + l)); ox.stroke();
  }
}
