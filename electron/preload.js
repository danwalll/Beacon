const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("beacon", {
  getStatus: () => ipcRenderer.invoke("get-status"),
  setStatus: (next) => ipcRenderer.invoke("set-status", next),
  focusApp: (source) => ipcRenderer.invoke("focus-app", source),
  ack: () => ipcRenderer.invoke("ack"),
  onStatus: (handler) => {
    const listener = (_event, status) => handler(status);
    ipcRenderer.on("status", listener);
    return () => ipcRenderer.removeListener("status", listener);
  },
});
