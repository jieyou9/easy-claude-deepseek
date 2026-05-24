const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showContextMenu: () => ipcRenderer.invoke('show-context-menu'),

  // 安装入口
  runInstall: (apiKey) => ipcRenderer.invoke('run-install', { apiKey }),

  // 事件监听
  onLog: (callback) => {
    const h = (_e, d) => callback(d);
    ipcRenderer.on('log', h);
    return () => ipcRenderer.removeListener('log', h);
  },
  onInstallStep: (callback) => {
    const h = (_e, d) => callback(d);
    ipcRenderer.on('install-step', h);
    return () => ipcRenderer.removeListener('install-step', h);
  },
});
