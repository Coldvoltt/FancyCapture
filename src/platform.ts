/**
 * Platform abstraction layer.
 * Detects Electron vs browser at runtime and provides web equivalents
 * of all Electron APIs used by the app.
 */

export const isElectron = !!(window as any).electronAPI;

/** Get a screen capture stream appropriate for the current platform. */
export async function getScreenCaptureStream(sourceId: string): Promise<MediaStream> {
  if (isElectron) {
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
        },
      } as MediaTrackConstraints,
    });
  }
  // Web: should never be called directly — use webScreenStream from the store instead
  throw new Error('On web, use getDisplayMedia() via the Source button');
}

/** Prompt the user to pick a screen/window (web only). Returns a MediaStream. */
export async function promptScreenCapture(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      // Prefer full-monitor capture so the taskbar and entire desktop are included.
      displaySurface: 'monitor',
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
    // @ts-ignore – Chrome-specific: suppress the "prefer current tab" banner
    preferCurrentTab: false,
  } as DisplayMediaStreamOptions);
}

/**
 * Platform-equivalent API surface that mirrors window.electronAPI.
 * On Electron, delegates to the real API.
 * On web, provides browser-native equivalents or no-ops.
 */
export const platform = {
  async getScreenSize(): Promise<{ width: number; height: number; scaleFactor: number }> {
    if (isElectron) return window.electronAPI.getScreenSize();
    return {
      width: window.screen.width,
      height: window.screen.height,
      scaleFactor: window.devicePixelRatio || 1,
    };
  },

  async getDefaultFolder(): Promise<string> {
    if (isElectron) return window.electronAPI.getDefaultFolder();
    return 'Downloads';
  },

  async saveFile(
    filePath: string,
    buffer: ArrayBuffer
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    if (isElectron) return window.electronAPI.saveFile(filePath, buffer);

    // Web: trigger a browser download
    try {
      const blob = new Blob([buffer], { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Extract just the filename from the path
      const filename = filePath.split(/[/\\]/).pop() || 'recording.webm';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { success: true, path: filename };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async showFolderDialog(): Promise<string | null> {
    if (isElectron) return window.electronAPI.showFolderDialog();
    // Web: no folder dialog available
    return null;
  },

  async importBackgroundImage(): Promise<{
    success: boolean;
    dataUrl?: string;
    name?: string;
  }> {
    if (isElectron) return (window as any).electronAPI.importBackgroundImage();

    // Web: use a hidden file input
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve({ success: false });
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            success: true,
            dataUrl: reader.result as string,
            name: file.name,
          });
        };
        reader.onerror = () => resolve({ success: false });
        reader.readAsDataURL(file);
      };
      // User cancelled
      input.oncancel = () => resolve({ success: false });
      input.click();
    });
  },

  // Floating controls — Electron only, no-ops on web
  showFloatingControls(): void {
    if (isElectron) (window as any).electronAPI.showFloatingControls();
  },
  hideFloatingControls(): void {
    if (isElectron) (window as any).electronAPI.hideFloatingControls();
  },
  sendRecordingState(state: any): void {
    if (isElectron) (window as any).electronAPI.sendRecordingState(state);
  },
  onFloatingControlAction(callback: (action: string) => void): void {
    if (isElectron) (window as any).electronAPI.onFloatingControlAction(callback);
  },
  removeFloatingControlListeners(): void {
    if (isElectron) (window as any).electronAPI.removeFloatingControlListeners();
  },
};
