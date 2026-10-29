'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pet', {
  on: cb => ipcRenderer.on('pet:update', (e, d) => cb(d)),
  ready: () => ipcRenderer.send('pet:ready'),
  mouse: over => ipcRenderer.send('pet:mouse', !!over),
  dragStart: () => ipcRenderer.send('pet:dragStart'),
  drag: (dx, dy) => ipcRenderer.send('pet:drag', dx, dy),
  dragEnd: () => ipcRenderer.send('pet:dragEnd'),
  click: () => ipcRenderer.send('pet:click'),
  menu: () => ipcRenderer.send('pet:menu')
});
