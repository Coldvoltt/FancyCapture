/// <reference types="vite/client" />

interface ElectronAPI {
  getSources: () => Promise<{
    id: string;
    name: string;
    thumbnail: string;
    appIcon: string | null;
    isScreen: boolean;
  }[]>;
  getScreenSize: () => Promise<{
    width: number;
    height: number;
    scaleFactor: number;
  }>;
  showSaveDialog: (defaultName: string) => Promise<string | null>;
  showFolderDialog: () => Promise<string | null>;
  saveFile: (filePath: string, buffer: ArrayBuffer) => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;
  pathExists: (filePath: string) => Promise<boolean>;
  getDefaultFolder: () => Promise<string>;
  convertToMp4: (webmPath: string, mp4Path: string) => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;
  onConversionProgress: (callback: (progress: {
    status: 'started' | 'progress' | 'complete' | 'error';
    percent?: number;
  }) => void) => void;
  removeConversionProgressListener: () => void;
  importBackgroundImage: () => Promise<{
    success: boolean;
    dataUrl?: string;
    name?: string;
  }>;
  showFloatingControls: () => void;
  hideFloatingControls: () => void;
  sendRecordingState: (state: any) => void;
  onFloatingControlAction: (callback: (action: string) => void) => void;
  removeFloatingControlListeners: () => void;
  onRecordingStateUpdate: (callback: (state: any) => void) => void;
  sendFloatingControlAction: (action: string) => void;
  adjustFloatingPosition: (showCamera: boolean) => void;
}

interface Window {
  electronAPI: ElectronAPI;
}
