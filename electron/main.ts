import { app, BrowserWindow, ipcMain, desktopCapturer, dialog, screen, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

let mainWindow: BrowserWindow | null = null;
let floatingControlsWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1400, width),
    height: Math.min(900, height),
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // Prevent lag when window loses focus during recording
    },
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? false : true,
    backgroundColor: '#0f172a',
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Close floating controls when main window closes
    if (floatingControlsWindow) {
      floatingControlsWindow.close();
      floatingControlsWindow = null;
    }
  });
}

function createFloatingControls(): void {
  if (floatingControlsWindow) {
    floatingControlsWindow.show();
    return;
  }

  const { width } = screen.getPrimaryDisplay().workAreaSize;

  floatingControlsWindow = new BrowserWindow({
    width: 320,
    height: 220,
    x: Math.floor(width / 2 - 160),
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // Keep video playing when window doesn't have focus
    },
  });

  // Allow window to be dragged
  floatingControlsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Keep window within screen bounds after dragging
  floatingControlsWindow.on('moved', () => {
    if (!floatingControlsWindow) return;

    const display = screen.getDisplayNearestPoint(floatingControlsWindow.getBounds());
    const screenBounds = display.workArea;
    const windowBounds = floatingControlsWindow.getBounds();

    let newX = windowBounds.x;
    let newY = windowBounds.y;
    let needsAdjustment = false;

    // Keep within horizontal bounds
    if (windowBounds.x < screenBounds.x) {
      newX = screenBounds.x + 5;
      needsAdjustment = true;
    } else if (windowBounds.x + windowBounds.width > screenBounds.x + screenBounds.width) {
      newX = screenBounds.x + screenBounds.width - windowBounds.width - 5;
      needsAdjustment = true;
    }

    // Keep within vertical bounds
    if (windowBounds.y < screenBounds.y) {
      newY = screenBounds.y + 5;
      needsAdjustment = true;
    } else if (windowBounds.y + windowBounds.height > screenBounds.y + screenBounds.height) {
      newY = screenBounds.y + screenBounds.height - windowBounds.height - 5;
      needsAdjustment = true;
    }

    if (needsAdjustment) {
      floatingControlsWindow.setPosition(Math.round(newX), Math.round(newY));
    }
  });

  if (isDev) {
    floatingControlsWindow.loadURL('http://localhost:5173/#/floating');
  } else {
    floatingControlsWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: '/floating',
    });
  }

  floatingControlsWindow.on('closed', () => {
    floatingControlsWindow = null;
  });
}

function hideFloatingControls(): void {
  if (floatingControlsWindow) {
    floatingControlsWindow.hide();
  }
}

app.whenReady().then(() => {
  // Grant media permissions for all windows
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    // Grant camera and microphone permissions
    if (permission === 'media') {
      callback(true);
      return;
    }
    callback(true);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

// Get available screen sources
ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });

    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon?.toDataURL() || null,
      isScreen: source.id.startsWith('screen:'),
    }));
  } catch (error) {
    console.error('Error getting sources:', error);
    return [];
  }
});

// Get screen dimensions for a source
ipcMain.handle('get-screen-size', async () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    width: primaryDisplay.size.width,
    height: primaryDisplay.size.height,
    scaleFactor: primaryDisplay.scaleFactor,
  };
});

// Show save dialog
ipcMain.handle('show-save-dialog', async (_, defaultName: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save Recording',
    defaultPath: defaultName,
    filters: [
      { name: 'WebM Video', extensions: ['webm'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  return result.canceled ? null : result.filePath;
});

// Show folder picker dialog
ipcMain.handle('show-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Output Folder',
    properties: ['openDirectory', 'createDirectory'],
  });

  return result.canceled ? null : result.filePaths[0];
});

// Save file to disk
ipcMain.handle('save-file', async (_, filePath: string, buffer: ArrayBuffer) => {
  try {
    await fs.promises.writeFile(filePath, Buffer.from(buffer));
    return { success: true, path: filePath };
  } catch (error) {
    console.error('Error saving file:', error);
    return { success: false, error: String(error) };
  }
});

// Check if path exists
ipcMain.handle('path-exists', async (_, filePath: string) => {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
});

// Get default recordings folder
ipcMain.handle('get-default-folder', () => {
  const videosPath = app.getPath('videos');
  const recordingsPath = path.join(videosPath, 'FancyCapture');

  if (!fs.existsSync(recordingsPath)) {
    fs.mkdirSync(recordingsPath, { recursive: true });
  }

  return recordingsPath;
});

// Convert WebM to MP4
ipcMain.handle('convert-to-mp4', async (_, webmPath: string, mp4Path: string) => {
  return new Promise((resolve) => {
    ffmpeg(webmPath)
      .outputOptions([
        '-c:v libx264',
        '-preset ultrafast', // Much faster encoding
        '-crf 23',
        '-c:a aac',
        '-b:a 128k',
        '-movflags +faststart',
        '-pix_fmt yuv420p',
        '-threads 0', // Use all available CPU threads
      ])
      .output(mp4Path)
      .on('start', (cmd: string) => {
        console.log('FFmpeg started:', cmd);
        mainWindow?.webContents.send('conversion-progress', { status: 'started' });
      })
      .on('progress', (progress: { percent?: number }) => {
        mainWindow?.webContents.send('conversion-progress', {
          status: 'progress',
          percent: progress.percent || 0,
        });
      })
      .on('end', async () => {
        console.log('Conversion complete');
        // Delete temp WebM file
        try {
          await fs.promises.unlink(webmPath);
          console.log('Temp WebM file deleted');
        } catch (err) {
          console.error('Failed to delete temp file:', err);
        }
        resolve({ success: true, path: mp4Path });
      })
      .on('error', (err: Error) => {
        console.error('Conversion error:', err);
        resolve({ success: false, error: err.message });
      })
      .run();
  });
});

// Import background image
ipcMain.handle('import-background-image', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select Background Image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'No file selected' };
    }

    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath, path.extname(filePath));
    const buffer = await fs.promises.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase().slice(1);
    const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return { success: true, dataUrl, name: fileName };
  } catch (error) {
    console.error('Error importing background image:', error);
    return { success: false, error: String(error) };
  }
});

// Floating controls IPC handlers
ipcMain.handle('show-floating-controls', () => {
  createFloatingControls();
  return { success: true };
});

ipcMain.handle('hide-floating-controls', () => {
  hideFloatingControls();
  return { success: true };
});

// Adjust floating window position to keep it on screen
ipcMain.handle('adjust-floating-position', (_, cameraVisible: boolean) => {
  if (!floatingControlsWindow) return { success: false };

  const display = screen.getDisplayNearestPoint(
    floatingControlsWindow.getBounds()
  );
  const screenBounds = display.workArea;
  const windowBounds = floatingControlsWindow.getBounds();

  // Camera preview is 128px tall + 8px gap
  const cameraHeight = cameraVisible ? 136 : 0;
  const controlsHeight = 60; // Approximate height of controls bar
  const totalHeight = cameraHeight + controlsHeight + 16; // 16px padding

  let newY = windowBounds.y;
  let newX = windowBounds.x;

  // Check if window would go below screen bottom
  if (windowBounds.y + totalHeight > screenBounds.y + screenBounds.height) {
    // Move window up to fit
    newY = screenBounds.y + screenBounds.height - totalHeight - 10;
  }

  // Check if window would go above screen top
  if (newY < screenBounds.y) {
    newY = screenBounds.y + 10;
  }

  // Check horizontal bounds
  if (windowBounds.x + windowBounds.width > screenBounds.x + screenBounds.width) {
    newX = screenBounds.x + screenBounds.width - windowBounds.width - 10;
  }
  if (newX < screenBounds.x) {
    newX = screenBounds.x + 10;
  }

  // Only move if position changed
  if (newX !== windowBounds.x || newY !== windowBounds.y) {
    floatingControlsWindow.setPosition(Math.round(newX), Math.round(newY));
  }

  return { success: true };
});

// Sync recording state to floating controls
ipcMain.on('recording-state-changed', (_, state: { recordingState: string; duration: number }) => {
  if (floatingControlsWindow) {
    floatingControlsWindow.webContents.send('recording-state-update', state);
  }
});

// Handle recording actions from floating controls
ipcMain.on('floating-control-action', (_, action: string) => {
  if (mainWindow) {
    mainWindow.webContents.send('floating-control-action', action);
  }
});
