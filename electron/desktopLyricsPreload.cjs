const { contextBridge, ipcRenderer } = require('electron');

// 字幕窗只有自身设置与只读播放快照，不暴露主播放器、网络或文件能力。
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('desktopLyrics', {
  getState: () => ipcRenderer.invoke('desktop-lyrics-state'),
  update: patch => ipcRenderer.invoke('desktop-lyrics-update', patch),
  onState: callback => subscribe('desktop-lyrics-state-changed', callback),
  getSnapshot: () => ipcRenderer.invoke('desktop-lyrics-snapshot'),
  onSnapshot: callback => subscribe('desktop-lyrics-snapshot-changed', callback),
});
