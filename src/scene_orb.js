/* ============================================================ night scene */
const scene = $('#scene'), sx = scene.getContext('2d');
let bgImg = null, motes = [];
function rnd(seed){ return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
function buildScene(){
  const W = innerWidth, H = innerHeight, dpr = Math.min(devicePixelRatio || 1, Q.dpr);
  scene.width = W * dpr; scene.height = H * dpr;
  const c = document.createElement('canvas'); c.width = W * dpr; c.height = H * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr); const R = rnd(7);
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
function drawScene(t){
  const W = innerWidth, H = innerHeight, dpr = scene.width / W;
  sx.setTransform(1, 0, 0, 1, 0, 0); sx.drawImage(bgImg, 0, 0); sx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (Q.motes) {
    const step = Math.min(3, (t - (drawScene.last || t)) / 16.7 || 1); drawScene.last = t;
    for (const m of motes) {
      m.x += m.vx * step; m.y += m.vy * step; if (m.y < -20) { m.y = H + 20; m.x = Math.random() * W; } if (m.x < -20) m.x = W + 20; if (m.x > W + 20) m.x = -20;
      sx.globalAlpha = (.35 + .35 * Math.sin(t / 900 + m.p)) * (m.r > 4 ? .35 : .9);
      const d = m.r * 4.8; sx.drawImage(moteSprite, m.x - d / 2, m.y - d / 2, d, d);
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
  const tint = S.thinking ? '255,211,138' : '143,227,255';

  const g = ox.createRadialGradient(cx, cy, 0, cx, cy, R * 1.5);
  g.addColorStop(0, `rgba(${tint},${.06 + lv * .18})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ox.fillStyle = g; ox.fillRect(0, 0, W, H);

  const ay = sec * (.18 + lv * .7), ax = .38;
  const sy = Math.sin(ay), cyy = Math.cos(ay), sxx = Math.sin(ax), cxx = Math.cos(ax);
  ox.fillStyle = 'rgb(225,242,255)';
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
  ox.strokeStyle = `rgba(${tint},.12)`; ox.lineWidth = 16 + lv * 6; ox.beginPath(); ox.arc(cx, cy, R * 1.38, base, base + .75 + lv * .6); ox.stroke();
  ox.strokeStyle = `rgba(${tint},.22)`; ox.lineWidth = 9 + lv * 4; ox.beginPath(); ox.arc(cx, cy, R * 1.38, base, base + .75 + lv * .6); ox.stroke();
  ox.strokeStyle = `rgba(${tint},${.85})`; ox.lineWidth = 4 + lv * 3;
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
