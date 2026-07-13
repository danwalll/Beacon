const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("guide", {
  dismiss: () => ipcRenderer.invoke("gatekeeper-dismiss"),
  revealInApplications: () => ipcRenderer.invoke("gatekeeper-reveal"),
});
