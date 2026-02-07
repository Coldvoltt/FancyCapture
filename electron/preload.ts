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
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}
