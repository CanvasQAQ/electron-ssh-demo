const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('relay', Object.freeze({
  action: (action, payload) => ipcRenderer.invoke('relay:action', action, payload),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('relay:state', listener);
    return () => ipcRenderer.removeListener('relay:state', listener);
  }
}));
