'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const inv = ch => (...a) => ipcRenderer.invoke(ch, ...a);
const EVENTS = new Set(['chat:chunk', 'pull:progress', 'hotkey:talk', 'update:status', 'tray:wake', 'win:visible', 'pet:off']);

contextBridge.exposeInMainWorld('jarvis', {
  info: inv('app:info'),
  setPrefs: inv('app:prefs'),
  openExternal: inv('app:openExternal'),
  showWindow: inv('win:show'),
  flash: inv('win:flash'),
  isVisible: inv('win:visible'),
  pc: inv('pc:do'),
  capture: inv('screen:capture'),
  pet: { set: inv('pet:set'), theme: t => ipcRenderer.invoke('pet:set', { theme: t }) },
  voices: { list: inv('voices:list'), openFolder: inv('voices:openFolder') },
  tts: { speak: inv('tts:speak'), abort: inv('tts:abort'), ping: inv('tts:ping') },
  custom: { get: inv('custom:get'), pick: inv('custom:pick'), clear: inv('custom:clear') },
  todo: { load: inv('todo:load'), save: inv('todo:save') },
  appIcon: { get: inv('appicon:get'), pick: inv('appicon:pick'), clear: inv('appicon:clear') },
  scene: { get: inv('scene:get'), pick: inv('scene:pick'), clear: inv('scene:clear') },
  data: { mirror: inv('data:mirror'), mirrorLoadSync: () => ipcRenderer.sendSync('data:mirrorLoadSync'), backupNow: inv('data:backupNow'), openFolder: inv('data:openFolder') },
  ollama: {
    version: inv('ollama:version'), tags: inv('ollama:tags'), ps: inv('ollama:ps'), show: inv('ollama:show'),
    start: inv('ollama:start'), pull: inv('ollama:pull'), pullCancel: inv('ollama:pullCancel'), remove: inv('ollama:delete'),
    chat: inv('ollama:chat'), abort: inv('ollama:abort'), unload: inv('ollama:unload')
  },
  ps: { run: inv('ps:run'), cwd: inv('ps:cwd') },
  fs: { read: inv('fs:read'), write: inv('fs:write'), resolve: inv('fs:resolve') },
  open: inv('open:target'),
  update: { state: inv('update:state'), check: inv('update:check'), install: inv('update:install'), setKey: inv('update:setKey') },
  stats: inv('sys:stats'),
  web: { search: inv('web:search'), read: inv('web:read'), json: inv('web:json') },
  on(ch, cb) {
    if (!EVENTS.has(ch)) return () => {};
    const f = (e, d) => cb(d);
    ipcRenderer.on(ch, f);
    return () => ipcRenderer.removeListener(ch, f);
  }
});
