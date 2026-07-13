const { contextBridge, ipcRenderer } = require("electron");

function orbSourceFromArgv() {
  const arg = process.argv.find((a) => a.startsWith("--beacon-source="));
  if (arg) return arg.slice("--beacon-source=".length);
  return null;
}

const orbSource = orbSourceFromArgv();

contextBridge.exposeInMainWorld("beacon", {
  orbSource,
  getStatus: () => ipcRenderer.invoke("get-status", orbSource),
  setStatus: (next) => ipcRenderer.invoke("set-status", next),
  focusApp: (source) =>
    ipcRenderer.invoke("focus-app", source || orbSource || "cursor"),
  ack: () => ipcRenderer.invoke("ack", orbSource),
  openConnections: () => ipcRenderer.invoke("open-connections"),
  showOrbMenu: (source) => ipcRenderer.invoke("show-orb-menu", source),
  getInstallStatus: () => ipcRenderer.invoke("get-install-status"),
  installToApplications: () => ipcRenderer.invoke("install-to-applications"),
  listConnections: () => ipcRenderer.invoke("list-connections"),
  connectWorkflow: (id) => ipcRenderer.invoke("connect-workflow", id),
  disconnectWorkflow: (id) => ipcRenderer.invoke("disconnect-workflow", id),
  onStatus: (handler) => {
    const listener = (_event, status) => handler(status);
    ipcRenderer.on("status", listener);
    return () => ipcRenderer.removeListener("status", listener);
  },
});
