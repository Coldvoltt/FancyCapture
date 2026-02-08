import { app, BrowserWindow, ipcMain, desktopCapturer, dialog, screen, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { FFmpegRecorder, RecordingConfig } from './ffmpeg-recorder';

// Set FFmpeg path (for fluent-ffmpeg WebM→MP4 conversion, kept for web compatibility)
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

let mainWindow: BrowserWindow | null = null;
let floatingControlsWindow: BrowserWindow | null = null;
let cameraBubbleWindow: BrowserWindow | null = null;

// --- FFmpeg sidecar recorder ---
let recorder: FFmpegRecorder;
try {
  recorder = new FFmpegRecorder();
} catch (err) {
  console.error('FFmpegRecorder init failed:', err);
  recorder = null as any; // Will be checked at call sites
}

// --- Streaming file write state (kept for web compatibility) ---
const openFileHandles = new Map<number, fs.promises.FileHandle>();
let nextFileHandleId = 1;

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

interface CameraBubbleConfig {
  deviceId: string | null;
  shape: string;
  size: number;
  position: { x: number; y: number };
  previewWidth: number;
  previewHeight: number;
}

function createCameraBubble(config: CameraBubbleConfig): void {
  if (cameraBubbleWindow) {
    destroyCameraBubble();
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

  // Map camera size/position from preview coordinates to screen coordinates
  const scaleX = screenW / config.previewWidth;
  const scaleY = screenH / config.previewHeight;
  const scale = Math.min(scaleX, scaleY);

  const bubbleSize = Math.round(Math.max(150, Math.min(400, config.size * scale)));
  const bubbleX = Math.round(Math.min(config.position.x * scaleX, screenW - bubbleSize - 10));
  const bubbleY = Math.round(Math.min(config.position.y * scaleY, screenH - bubbleSize - 10));

  cameraBubbleWindow = new BrowserWindow({
    width: bubbleSize,
    height: bubbleSize,
    x: Math.max(0, bubbleX),
    y: Math.max(0, bubbleY),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });

  cameraBubbleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Prevent the camera bubble from stealing focus
  cameraBubbleWindow.setAlwaysOnTop(true, 'screen-saver');

  if (isDev) {
    cameraBubbleWindow.loadURL('http://localhost:5173/#/camera-bubble');
  } else {
    cameraBubbleWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: '/camera-bubble',
    });
  }

  // Send camera config once loaded
  cameraBubbleWindow.webContents.once('did-finish-load', () => {
    cameraBubbleWindow?.webContents.send('camera-bubble-config', {
      deviceId: config.deviceId,
      shape: config.shape,
    });
  });

  cameraBubbleWindow.on('closed', () => {
    cameraBubbleWindow = null;
  });
}

function destroyCameraBubble(): void {
  if (cameraBubbleWindow) {
    cameraBubbleWindow.close();
    cameraBubbleWindow = null;
  }
}

app.whenReady().then(async () => {
  // Grant media permissions for all windows
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    // Grant camera and microphone permissions
    if (permission === 'media') {
      callback(true);
      return;
    }
    callback(true);
  });

  // Detect best available hardware encoder at startup
  if (recorder) {
    try {
      const encoder = await recorder.detectEncoder();
      console.log(`Encoder detected: ${encoder.encoder} (${encoder.type})`);
    } catch (err) {
      console.error('Encoder detection failed:', err);
    }

    // Forward FFmpeg errors to the renderer
    recorder.setErrorHandler((error: string) => {
      if (mainWindow) {
        mainWindow.webContents.send('ffmpeg-error', { error });
      }
    });
  } else {
    console.error('FFmpeg recorder not available - recording will not work');
  }

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

// Close any dangling file handles on quit
app.on('before-quit', async () => {
  for (const [id, handle] of openFileHandles) {
    try {
      await handle.close();
    } catch { /* ignore */ }
    openFileHandles.delete(id);
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

// --- Streaming file write handlers ---

// Open a file for incremental writing
ipcMain.handle('stream-file-open', async (_, filePath: string) => {
  try {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const handle = await fs.promises.open(filePath, 'w');
    const id = nextFileHandleId++;
    openFileHandles.set(id, handle);
    return { success: true, handleId: id };
  } catch (error) {
    console.error('Error opening file for streaming:', error);
    return { success: false, error: String(error) };
  }
});

// Append a chunk to an open file (fire-and-forget via `on`/`send` — no IPC
// round-trip needed, the renderer doesn't wait for the write to finish)
ipcMain.on('stream-file-append', async (_, handleId: number, chunk: ArrayBuffer) => {
  try {
    const handle = openFileHandles.get(handleId);
    if (!handle) {
      console.error(`Invalid file handle: ${handleId}`);
      return;
    }
    await handle.write(Buffer.from(chunk));
  } catch (error) {
    console.error('Error appending chunk:', error);
  }
});

// Close a file handle
ipcMain.handle('stream-file-close', async (_, handleId: number) => {
  try {
    const handle = openFileHandles.get(handleId);
    if (!handle) {
      return { success: false, error: `Invalid file handle: ${handleId}` };
    }
    await handle.close();
    openFileHandles.delete(handleId);
    return { success: true };
  } catch (error) {
    console.error('Error closing file handle:', error);
    openFileHandles.delete(handleId);
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

// --- Window management ---
ipcMain.handle('minimize-main-window', () => {
  if (mainWindow) mainWindow.minimize();
  return { success: true };
});

ipcMain.handle('restore-main-window', () => {
  if (mainWindow) {
    mainWindow.restore();
    mainWindow.show();
  }
  return { success: true };
});

// --- Camera bubble IPC handlers ---

ipcMain.handle('show-camera-bubble', (_, config: CameraBubbleConfig) => {
  createCameraBubble(config);
  return { success: true };
});

ipcMain.handle('hide-camera-bubble', () => {
  destroyCameraBubble();
  return { success: true };
});

// --- FFmpeg sidecar recording handlers ---

ipcMain.handle('ffmpeg-detect-encoder', async () => {
  try {
    return await recorder.detectEncoder();
  } catch (error) {
    return { encoder: 'libx264', type: 'software' };
  }
});

ipcMain.handle('ffmpeg-start-recording', async (_, config: RecordingConfig) => {
  if (!recorder) {
    return { success: false, error: 'FFmpeg recorder not initialized. FFmpeg binary may not be found.' };
  }
  try {
    const result = await recorder.start(config);
    console.log('ffmpeg-start-recording result:', JSON.stringify(result));
    return result;
  } catch (error) {
    console.error('ffmpeg-start-recording error:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('ffmpeg-pause-recording', async () => {
  return recorder.pause();
});

ipcMain.handle('ffmpeg-resume-recording', async () => {
  return recorder.resume();
});

ipcMain.handle('ffmpeg-stop-recording', async () => {
  return recorder.stop();
});

ipcMain.handle('ffmpeg-post-process-camera', async (_, config: {
  screenPath: string;
  cameraPath: string;
  outputPath: string;
  cameraSize: number;
  cameraPosition: { x: number; y: number };
  cameraShape: string;
  outputWidth: number;
  outputHeight: number;
  previewWidth: number;
  previewHeight: number;
}) => {
  if (!recorder) {
    return { success: false, error: 'FFmpeg recorder not initialized' };
  }
  try {
    return await recorder.postProcessCamera(config as any);
  } catch (error) {
    console.error('ffmpeg-post-process-camera error:', error);
    return { success: false, error: String(error) };
  }
});
