// Minimal preload — context isolation enabled, no Node APIs exposed (the PWA
// gets localStorage, IndexedDB and service workers with http(s) URLs).
window.addEventListener("DOMContentLoaded", () => {
  document.title = "FuelPro";
});
