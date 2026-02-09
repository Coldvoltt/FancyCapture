import { create } from 'zustand';

export type RecordingMode = 'screen' | 'camera' | 'screen-camera';
export type CameraShape = 'circle' | 'rounded';
export type RecordingState = 'idle' | 'preparing' | 'recording' | 'paused' | 'saving' | 'converting';
export type ResolutionPreset = '720p' | '1080p' | '1440p' | '4k' | 'source';
export type FpsOption = 24 | 30 | 60;

export const fpsPresets: { id: FpsOption; label: string }[] = [
  { id: 24, label: '24 fps (Cinematic)' },
  { id: 30, label: '30 fps (Standard)' },
  { id: 60, label: '60 fps (Smooth)' },
];

export interface ResolutionOption {
  id: ResolutionPreset;
  label: string;
  width: number;
  height: number;
}

export const resolutionPresets: ResolutionOption[] = [
  { id: 'source', label: 'Source', width: 0, height: 0 }, // Uses source resolution
  { id: '720p', label: '720p HD', width: 1280, height: 720 },
  { id: '1080p', label: '1080p Full HD', width: 1920, height: 1080 },
  { id: '1440p', label: '1440p QHD', width: 2560, height: 1440 },
  { id: '4k', label: '4K Ultra HD', width: 3840, height: 2160 },
];

export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  appIcon: string | null;
  isScreen: boolean;
  displayBounds?: { x: number; y: number; width: number; height: number };
  scaleFactor?: number;
}

export interface ZoomConfig {
  enabled: boolean;
  scale: number;
  x: number;
  y: number;
}

interface AppState {
  // Recording mode
  recordingMode: RecordingMode;
  setRecordingMode: (mode: RecordingMode) => void;

  // Recording state
  recordingState: RecordingState;
  setRecordingState: (state: RecordingState) => void;

  // Screen source
  selectedSource: ScreenSource | null;
  setSelectedSource: (source: ScreenSource | null) => void;
  availableSources: ScreenSource[];
  setAvailableSources: (sources: ScreenSource[]) => void;

  // Camera settings
  cameraShape: CameraShape;
  setCameraShape: (shape: CameraShape) => void;
  cameraSize: number;
  setCameraSize: (size: number) => void;
  cameraPosition: { x: number; y: number };
  setCameraPosition: (position: { x: number; y: number }) => void;
  selectedCamera: string | null;
  setSelectedCamera: (deviceId: string | null) => void;
  availableCameras: MediaDeviceInfo[];
  setAvailableCameras: (cameras: MediaDeviceInfo[]) => void;
  previewDimensions: { width: number; height: number };
  setPreviewDimensions: (dimensions: { width: number; height: number }) => void;

  // Audio settings
  microphoneEnabled: boolean;
  setMicrophoneEnabled: (enabled: boolean) => void;
  systemAudioEnabled: boolean;
  setSystemAudioEnabled: (enabled: boolean) => void;
  selectedMicrophone: string | null;
  setSelectedMicrophone: (deviceId: string | null) => void;
  availableMicrophones: MediaDeviceInfo[];
  setAvailableMicrophones: (microphones: MediaDeviceInfo[]) => void;

  // Zoom configuration
  zoomConfig: ZoomConfig;
  setZoomConfig: (config: Partial<ZoomConfig>) => void;
  isZooming: boolean;
  setIsZooming: (zooming: boolean) => void;

  // Output settings
  outputFolder: string;
  setOutputFolder: (folder: string) => void;
  outputResolution: ResolutionPreset;
  setOutputResolution: (resolution: ResolutionPreset) => void;
  recordingFps: FpsOption;
  setRecordingFps: (fps: FpsOption) => void;

  // Recording duration
  recordingDuration: number;
  setRecordingDuration: (duration: number) => void;
  incrementDuration: () => void;

  // UI state
  showSourcePicker: boolean;
  setShowSourcePicker: (show: boolean) => void;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;

  // Preview camera stream (shared so RecordingControls can release it for dshow)
  previewCameraStream: MediaStream | null;
  setPreviewCameraStream: (stream: MediaStream | null) => void;
  // Suspend preview camera so FFmpeg dshow can access the device
  previewCameraSuspended: boolean;
  setPreviewCameraSuspended: (suspended: boolean) => void;

  // Web screen stream (shared between Preview and RecordingControls on web)
  webScreenStream: MediaStream | null;
  setWebScreenStream: (stream: MediaStream | null) => void;
}

export const useStore = create<AppState>((set) => ({
  // Recording mode
  recordingMode: 'screen',
  setRecordingMode: (mode) => set({ recordingMode: mode }),

  // Recording state
  recordingState: 'idle',
  setRecordingState: (state) => set({ recordingState: state }),

  // Screen source
  selectedSource: null,
  setSelectedSource: (source) => set({ selectedSource: source }),
  availableSources: [],
  setAvailableSources: (sources) => set({ availableSources: sources }),

  // Camera settings
  cameraShape: 'circle',
  setCameraShape: (shape) => set({ cameraShape: shape }),
  cameraSize: 200,
  setCameraSize: (size) => set({ cameraSize: size }),
  cameraPosition: { x: 20, y: 20 },
  setCameraPosition: (position) => set({ cameraPosition: position }),
  previewDimensions: { width: 1200, height: 675 },
  setPreviewDimensions: (dimensions) => set({ previewDimensions: dimensions }),
  selectedCamera: null,
  setSelectedCamera: (deviceId) => set({ selectedCamera: deviceId }),
  availableCameras: [],
  setAvailableCameras: (cameras) => set({ availableCameras: cameras }),

  // Audio settings
  microphoneEnabled: true,
  setMicrophoneEnabled: (enabled) => set({ microphoneEnabled: enabled }),
  systemAudioEnabled: true,
  setSystemAudioEnabled: (enabled) => set({ systemAudioEnabled: enabled }),
  selectedMicrophone: null,
  setSelectedMicrophone: (deviceId) => set({ selectedMicrophone: deviceId }),
  availableMicrophones: [],
  setAvailableMicrophones: (microphones) => set({ availableMicrophones: microphones }),

  // Zoom configuration
  zoomConfig: {
    enabled: false,
    scale: 2,
    x: 0,
    y: 0,
  },
  setZoomConfig: (config) =>
    set((state) => ({ zoomConfig: { ...state.zoomConfig, ...config } })),
  isZooming: false,
  setIsZooming: (zooming) => set({ isZooming: zooming }),

  // Output settings
  outputFolder: '',
  setOutputFolder: (folder) => set({ outputFolder: folder }),
  outputResolution: '1080p',
  setOutputResolution: (resolution) => set({ outputResolution: resolution }),
  recordingFps: 30,
  setRecordingFps: (fps) => set({ recordingFps: fps }),

  // Recording duration
  recordingDuration: 0,
  setRecordingDuration: (duration) => set({ recordingDuration: duration }),
  incrementDuration: () => set((state) => ({ recordingDuration: state.recordingDuration + 1 })),

  // UI state
  showSourcePicker: false,
  setShowSourcePicker: (show) => set({ showSourcePicker: show }),
  showSettings: false,
  setShowSettings: (show) => set({ showSettings: show }),

  // Preview camera stream
  previewCameraStream: null,
  setPreviewCameraStream: (stream) => set({ previewCameraStream: stream }),
  // Preview camera suspension
  previewCameraSuspended: false,
  setPreviewCameraSuspended: (suspended) => set({ previewCameraSuspended: suspended }),

  // Web screen stream
  webScreenStream: null,
  setWebScreenStream: (stream) => set({ webScreenStream: stream }),
}));
