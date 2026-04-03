import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';

const isDev = !app.isPackaged;

// registerSchemesAsPrivileged MUST be called before app.ready fires.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      allowServiceWorkers: true,
    },
  },
]);

// Path to the Vite web build.
// Dev: <repo-root>/dist  |  Packaged: Resources/web (via extraResources)
function getWebDistPath(): string {
  if (isDev) {
    return path.resolve(__dirname, '../../dist');
  }
  return path.join(process.resourcesPath, 'web');
}

// Custom 'app://' protocol so the web SPA (using BrowserRouter) can load
// from a file-like origin without triggering file:// security restrictions.
// Unknown paths fall back to index.html so React Router handles them.
function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const distPath = getWebDistPath();
    const url = new URL(request.url);
    const relativePath = url.pathname.replace(/^\//, '') || 'index.html';
    const filePath = path.join(distPath, relativePath);

    try {
      return await net.fetch('file://' + filePath);
    } catch {
      return net.fetch('file://' + path.join(distPath, 'index.html'));
    }
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // WebGL (Three.js) and experimental WebXR support.
      experimentalFeatures: true,
    },
  });

  if (isDev) {
    // Requires `npm run dev` (Vite dev server) to be running.
    win.loadURL('http://localhost:5173').catch(() => {
      console.error(
        'Could not reach Vite dev server at http://localhost:5173.\n' +
          'Run `npm run dev` from the repo root first.'
      );
    });
    win.webContents.openDevTools();
  } else {
    win.loadURL('app://localhost');
  }

  return win;
}

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.on('install-update', () => autoUpdater.quitAndInstall());

app.on('ready', () => {
  registerAppProtocol();

  const win = createWindow();

  if (!isDev) {
    autoUpdater.on('update-available', () =>
      win.webContents.send('update-available')
    );
    autoUpdater.on('update-downloaded', () =>
      win.webContents.send('update-downloaded')
    );
    autoUpdater.checkForUpdatesAndNotify();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
