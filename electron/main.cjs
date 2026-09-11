const { app, BrowserWindow, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

// The desktop app loads the LIVE site directly (always up-to-date) with
// Cloudflare Pages primary and Vercel as fallback. App-shell updates are
// delivered silently via GitHub Releases auto-update below.
const URLS = [
  "https://fuel-app-mobile.pages.dev/",
  "https://fuel-app-mobile.vercel.app/",
];
const ALLOWED_HOSTS = URLS.map((u) => new URL(u).host);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: "#0a0e17",
    icon: path.join(__dirname, "../public/icon-512.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);

  // Open external links (supabase, youtube, docs, exports, etc.) in the
  // system browser so the app keeps control of its own window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (ALLOWED_HOSTS.includes(new URL(url).host)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!ALLOWED_HOSTS.includes(new URL(url).host)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Load the live site (content updates arrive instantly, no app update).
  const tryLoad = (index) => {
    if (index >= URLS.length) return;
    win.loadURL(URLS[index]).catch(() => tryLoad(index + 1));
  };
  tryLoad(0);
}

// ── Auto-update from GitHub Releases (silent, background download + install)
// electron-updater reads the GitHub release feed for this repo; on launch
// it downloads newer versions in the background and installs on quit.
function setupAutoUpdate() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.checkForUpdatesAndNotify().catch(() => {
    // Network issues shouldn't break the app — stay silent.
  });
}

app.whenReady().then(() => {
  setupAutoUpdate();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
