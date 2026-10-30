// Builds the generated renderer files: voice.js (bundle), ui.js (assembled), ONNX runtime files.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const R = p => path.join(__dirname, '..', p);

const esb = (src, out) => execSync(`npx esbuild ${src} --bundle --format=esm --platform=browser --target=chrome130 --minify --outfile=${out} --log-level=warning`, { cwd: R(''), stdio: 'inherit' });
esb('src/voice.js', 'app/renderer/voice.js');
esb('src/voice-worker.js', 'app/renderer/voice-worker.js');

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

// To-Do: one source (src/todo) -> Jarvis's screen (app/renderer/todo.html), the helpers Jarvis's voice commands use
// (app/renderer/todo-core.js) and the stand-alone web page (dist-web/todo.html).
{
  const core = fs.readFileSync(R('src/todo/core.js'), 'utf8');
  const page = fs.readFileSync(R('src/todo/page.html'), 'utf8').replace('/*__CORE__*/', () => core);
  fs.writeFileSync(R('app/renderer/todo-core.js'), core);
  const head = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; font-src \'self\' https://fonts.gstatic.com data:; img-src \'self\' data:">' +
    '<style>[hidden]{display:none!important}</style></head><body>';
  fs.writeFileSync(R('app/renderer/todo.html'), head + page + '</body></html>');
  fs.mkdirSync(R('dist-web'), { recursive: true });
  fs.writeFileSync(R('dist-web/todo.html'), page);
}
console.log('to-do built');
