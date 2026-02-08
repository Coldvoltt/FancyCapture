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
  streamFileOpen: (filePath: string) => Promise<{
    success: boolean;
    handleId?: number;
    error?: string;
  }>;
  streamFileAppend: (handleId: number, chunk: ArrayBuffer) => void;
  streamFileClose: (handleId: number) => Promise<{
    success: boolean;
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
  // Window management
  minimizeMainWindow: () => Promise<{ success: boolean }>;
  restoreMainWindow: () => Promise<{ success: boolean }>;
  // Camera bubble
  showCameraBubble: (config: {
    deviceId: string | null;
    shape: string;
    size: number;
    position: { x: number; y: number };
    previewWidth: number;
    previewHeight: number;
    displayBounds?: { x: number; y: number; width: number; height: number };
  }) => Promise<{ success: boolean }>;
  hideCameraBubble: () => Promise<{ success: boolean }>;
  onCameraBubbleConfig: (callback: (config: { deviceId: string | null; shape: string }) => void) => void;
  // FFmpeg sidecar recording
  ffmpegDetectEncoder: () => Promise<{ encoder: string; type: string }>;
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
  }) => Promise<{ success: boolean; error?: string }>;
  ffmpegPauseRecording: () => Promise<{ success: boolean; error?: string }>;
  ffmpegResumeRecording: () => Promise<{ success: boolean; error?: string }>;
  ffmpegStopRecording: () => Promise<{ success: boolean; outputPath?: string; error?: string }>;
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
  }) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
  onFfmpegError: (callback: (data: { error: string }) => void) => void;
  removeFfmpegListeners: () => void;
}

interface Window {
  electronAPI: ElectronAPI;
}
