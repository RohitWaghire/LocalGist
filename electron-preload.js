const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  chooseTranscripts: () => ipcRenderer.invoke("transcripts:choose"),
  openTranscriptFolder: () => ipcRenderer.invoke("transcripts:open-folder"),
  onTranscriptImport: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("transcripts:import", listener);
    return () => ipcRenderer.removeListener("transcripts:import", listener);
  }
});
