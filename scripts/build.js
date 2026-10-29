// Builds the generated renderer files: voice.js (bundle), ui.js (assembled), ONNX runtime files.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const R = p => path.join(__dirname, '..', p);

execSync('npx esbuild src/voice.js --bundle --format=esm --platform=browser --target=chrome130 --minify --outfile=app/renderer/voice.js --log-level=warning', { cwd: R(''), stdio: 'inherit' });

let orb = fs.readFileSync(R('src/scene_orb.js'), 'utf8');
const rep = [
  ["  if (analyser && S.listening) { analyser.getByteFrequencyData(meterData); let s = 0; for (const v of meterData) s += v; S.micLv = Math.min(1, s / meterData.length / 55); S.level = Math.max(S.level, S.micLv); } else S.micLv *= .9;",
   "  if (V && V.micOn) { S.micLv = V.level || 0; if (S.listening || (V.vad === 'recording')) S.level = Math.max(S.level, S.micLv); } else S.micLv *= .9;"],
  ["  if (S.speaking) S.level = Math.max(S.level, .25 + .2 * Math.sin(t / 90));",
   "  if (speaking()) S.level = Math.max(S.level, .15 + Math.min(1, (V.outLevel || 0)) * .6);"],
  ["v = analyser && S.listening ? meterData[(i * 2) % meterData.length] / 255 : lv * (.5 + .5 * Math.sin(i * 1.7 + sec * 9));",
   "v = lv * (.5 + .5 * Math.sin(i * 1.7 + sec * 9));"]
];
for (const [a, b] of rep) { if (!orb.includes(a)) throw new Error('scene_orb patch missing: ' + a.slice(0, 50)); orb = orb.split(a).join(b); }
const ui = fs.readFileSync(R('src/ui.js'), 'utf8').replace('/*__SCENE_ORB__*/', () => orb);
fs.writeFileSync(R('app/renderer/ui.js'), ui);

const ortDir = R('app/renderer/ort'); fs.mkdirSync(ortDir, { recursive: true });
const ortSrc = [R('node_modules/@huggingface/transformers/node_modules/onnxruntime-web'), R('node_modules/onnxruntime-web')].find(d => fs.existsSync(path.join(d, 'dist')));
for (const f of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) fs.copyFileSync(path.join(ortSrc, 'dist', f), path.join(ortDir, f));
console.log('renderer built');
