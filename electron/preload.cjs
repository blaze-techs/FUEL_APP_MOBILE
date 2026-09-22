const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("FuelProElectronPrint", {
  printHtml: (html, title) => ipcRenderer.invoke("fuelpro:print-html", html, title),
});

window.addEventListener("DOMContentLoaded", () => {
  document.title = "FuelPro";
});
