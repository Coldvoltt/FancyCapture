import { contextBridge, ipcRenderer } from 'electron';

export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  appIcon: string | null;
  isScreen: boolean;
}

export interface ScreenSize {
  width: number;
  height: number;
  scaleFactor: number;
}

export interface SaveResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface ConversionProgress {
  status: 'started' | 'progress' | 'complete' | 'error';
  percent?: number;
}

export interface ImageImportResult {
  success: boolean;
  dataUrl?: string;
  name?: string;
  error?: string;
}

const electronAPI = {
  getSources: (): Promise<ScreenSource[]> => ipcRenderer.invoke('get-sources'),
  getScreenSize: (): Promise<ScreenSize> => ipcRenderer.invoke('get-screen-size'),
  showSaveDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('show-save-dialog', defaultName),
  showFolderDialog: (): Promise<string | null> => ipcRenderer.invoke('show-folder-dialog'),
  saveFile: (filePath: string, buffer: ArrayBuffer): Promise<SaveResult> =>
    ipcRenderer.invoke('save-file', filePath, buffer),
  streamFileOpen: (filePath: string): Promise<{ success: boolean; handleId?: number; error?: string }> =>
    ipcRenderer.invoke('stream-file-open', filePath),
  streamFileAppend: (handleId: number, chunk: ArrayBuffer): void =>
    ipcRenderer.send('stream-file-append', handleId, chunk),
  streamFileClose: (handleId: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('stream-file-close', handleId),
  pathExists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('path-exists', filePath),
  getDefaultFolder: (): Promise<string> => ipcRenderer.invoke('get-default-folder'),
  convertToMp4: (webmPath: string, mp4Path: string): Promise<SaveResult> =>
    ipcRenderer.invoke('convert-to-mp4', webmPath, mp4Path),
  onConversionProgress: (callback: (progress: ConversionProgress) => void) => {
    ipcRenderer.on('conversion-progress', (_, progress) => callback(progress));
  },
  removeConversionProgressListener: () => {
    ipcRenderer.removeAllListeners('conversion-progress');
  },
  importBackgroundImage: (): Promise<ImageImportResult> =>
    ipcRenderer.invoke('import-background-image'),

  // Floating controls
  showFloatingControls: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('show-floating-controls'),
  hideFloatingControls: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('hide-floating-controls'),
  adjustFloatingPosition: (cameraVisible: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('adjust-floating-position', cameraVisible),
  sendRecordingState: (state: { recordingState: string; duration: number; showCamera?: boolean; cameraDeviceId?: string; cameraShape?: string }) => {
    ipcRenderer.send('recording-state-changed', state);
  },
  onRecordingStateUpdate: (callback: (state: { recordingState: string; duration: number; showCamera?: boolean; cameraDeviceId?: string; cameraShape?: string }) => void) => {
    ipcRenderer.on('recording-state-update', (_, state) => callback(state));
  },
  sendFloatingControlAction: (action: string) => {
    ipcRenderer.send('floating-control-action', action);
  },
  onFloatingControlAction: (callback: (action: string) => void) => {
    ipcRenderer.on('floating-control-action', (_, action) => callback(action));
  },
  removeFloatingControlListeners: () => {
    ipcRenderer.removeAllListeners('recording-state-update');
    ipcRenderer.removeAllListeners('floating-control-action');
  },

  // Window management
  minimizeMainWindow: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('minimize-main-window'),
  restoreMainWindow: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('restore-main-window'),

  // Camera bubble
  showCameraBubble: (config: {
    deviceId: string | null;
    shape: string;
    size: number;
    position: { x: number; y: number };
    previewWidth: number;
    previewHeight: number;
    displayBounds?: { x: number; y: number; width: number; height: number };
  }): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('show-camera-bubble', config),
  hideCameraBubble: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('hide-camera-bubble'),
  onCameraBubbleConfig: (callback: (config: { deviceId: string | null; shape: string }) => void) => {
    ipcRenderer.on('camera-bubble-config', (_, config) => callback(config));
  },

  // FFmpeg sidecar recording
  ffmpegDetectEncoder: (): Promise<{ encoder: string; type: string }> =>
    ipcRenderer.invoke('ffmpeg-detect-encoder'),
  ffmpegStartRecording: (config: {
    mode: string;
    screenSource: { id: string; name: string; isScreen: boolean } | null;
    cameraLabel: string | null;
    cameraSize: number;
    cameraPosition: { x: number; y: number };
    cameraShape: string;
    microphoneLabel: string | null;
    outputFolder: string;
    outputResolution: string;
    fps: number;
    previewWidth: number;
    previewHeight: number;
    useFloatingCamera?: boolean;
    screenRegion?: { x: number; y: number; w: number; h: number };
    backgroundData?: string;
    foregroundData?: string;
    backgroundContentArea?: { x: number; y: number; w: number; h: number };
    backgroundOutputSize?: { w: number; h: number };
  }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ffmpeg-start-recording', config),
  ffmpegPauseRecording: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ffmpeg-pause-recording'),
  ffmpegResumeRecording: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('ffmpeg-resume-recording'),
  ffmpegStopRecording: (): Promise<{ success: boolean; outputPath?: string; error?: string }> =>
    ipcRenderer.invoke('ffmpeg-stop-recording'),
  ffmpegPostProcessCamera: (config: {
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
  }): Promise<{ success: boolean; outputPath?: string; error?: string }> =>
    ipcRenderer.invoke('ffmpeg-post-process-camera', config),
  onFfmpegError: (callback: (data: { error: string }) => void) => {
    ipcRenderer.on('ffmpeg-error', (_, data) => callback(data));
  },
  removeFfmpegListeners: () => {
    ipcRenderer.removeAllListeners('ffmpeg-error');
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}
