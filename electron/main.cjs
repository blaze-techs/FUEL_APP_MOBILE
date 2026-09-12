const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const fs = require("fs");

// electron-updater ships in `dependencies` so it is packaged into the app.
// Guard the require anyway: if it is ever missing the app must still run
// (auto-update just stays disabled) instead of crashing the main process.
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  autoUpdater = null;
}

// The desktop app loads the LIVE site directly (always up-to-date) with
// Cloudflare Pages primary and Vercel as fallback. App-shell updates are
// delivered silently via GitHub Releases auto-update below.
const URLS = [
  "https://fuel-app-mobile.pages.dev/",
  "https://fuel-app-mobile.vercel.app/",
];
const ALLOWED_HOSTS = URLS.map((u) => new URL(u).host);

function resolveIcon() {
  const candidates = app.isPackaged
    ? [
        // extraResources copies public/ to <resources>/public
        path.join(process.resourcesPath, "public", "icon-512.png"),
        // asar fallback (if public/ is ever bundled inside the asar)
        path.join(__dirname, "../public/icon-512.png"),
      ]
    : [path.join(__dirname, "../public/icon-512.png")];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return undefined;
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: "#0a0e17",
    icon: resolveIcon(),
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
    if (ALLOWED_HOSTS.includes(safeHost(url))) return { action: "allow" };
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!ALLOWED_HOSTS.includes(safeHost(url))) {
      event.preventDefault();
      if (url.startsWith("https://") || url.startsWith("http://")) {
        shell.openExternal(url).catch(() => {});
      }
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
  if (!autoUpdater || !app.isPackaged) return;
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
