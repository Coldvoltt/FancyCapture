import { useStore, RecordingMode, CameraShape } from '../store/useStore';
import { isElectron, promptScreenCapture } from '../platform';

const recordingModes: { mode: RecordingMode; label: string; description: string; icon: JSX.Element }[] = [
  {
    mode: 'screen',
    label: 'Screen',
    description: 'Record your display',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    mode: 'camera',
    label: 'Camera',
    description: 'Record from webcam',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    mode: 'screen-camera',
    label: 'Both',
    description: 'Screen with camera overlay',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
      </svg>
    ),
  },
];

const cameraShapes: { shape: CameraShape; icon: JSX.Element }[] = [
  {
    shape: 'circle',
    icon: <div className="w-5 h-5 rounded-full bg-current" />
  },
  {
    shape: 'rounded',
    icon: <div className="w-5 h-5 rounded-lg bg-current" />
  },
];

function Sidebar() {
  const {
    recordingMode,
    setRecordingMode,
    recordingState,
    cameraShape,
    setCameraShape,
    cameraSize,
    setCameraSize,
    selectedCamera,
    setSelectedCamera,
    availableCameras,
    microphoneEnabled,
    setMicrophoneEnabled,
    selectedMicrophone,
    setSelectedMicrophone,
    availableMicrophones,
    setShowSourcePicker,
    setWebScreenStream,
    setSelectedSource,
  } = useStore();

  const isRecording = recordingState !== 'idle';

  const handleSourceSelect = async () => {
    if (isElectron) {
      setShowSourcePicker(true);
    } else {
      // Web: use getDisplayMedia() directly
      try {
        const stream = await promptScreenCapture();
        setWebScreenStream(stream);
        // Create a synthetic source so the rest of the app works
        const track = stream.getVideoTracks()[0];
        setSelectedSource({
          id: 'web-screen',
          name: track.label || 'Screen',
          thumbnail: '',
          appIcon: null,
          isScreen: true,
        });
        // Stop stream when track ends (user clicks "Stop sharing")
        track.onended = () => {
          setWebScreenStream(null);
          setSelectedSource(null);
        };
      } catch (error) {
        console.error('Screen capture cancelled or failed:', error);
      }
    }
  };

  const showCameraSettings = recordingMode === 'camera' || recordingMode === 'screen-camera';
  const showScreenSettings = recordingMode === 'screen' || recordingMode === 'screen-camera';

  return (
    <aside className="w-80 glass flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Recording Mode */}
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2m0 2v2m0-2h10m0 0V2m0 2v2m0-2H7m10 8v8m0-8H7m10 0a2 2 0 012 2v6a2 2 0 01-2 2H7a2 2 0 01-2-2v-6a2 2 0 012-2" />
            </svg>
            Recording Mode
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {recordingModes.map(({ mode, label, description, icon }) => (
              <button
                key={mode}
                onClick={() => setRecordingMode(mode)}
                disabled={isRecording}
                className={`relative flex flex-col items-center gap-2 p-4 rounded-xl transition-all ${
                  recordingMode === mode
                    ? 'gradient-primary text-white shadow-lg'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                } ${isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {icon}
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Screen Source Selection */}
        {showScreenSettings && (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Source
            </h3>
            <button
              onClick={handleSourceSelect}
              disabled={isRecording}
              className={`w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all ${
                isRecording ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm font-medium">Choose Screen or Window</span>
            </button>
          </div>
        )}

        {/* Camera Settings */}
        {showCameraSettings && (
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Camera
            </h3>

            <div className="space-y-4">
              {/* Camera Selection */}
              <select
                value={selectedCamera || ''}
                onChange={(e) => setSelectedCamera(e.target.value || null)}
                disabled={isRecording}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all"
              >
                <option value="" className="bg-gray-900 text-white">Default Camera</option>
                {availableCameras.map((camera) => (
                  <option key={camera.deviceId} value={camera.deviceId} className="bg-gray-900 text-white">
                    {camera.label || `Camera ${camera.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>

              {/* Camera Shape */}
              {recordingMode === 'screen-camera' && (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 mb-2">Shape</label>
                    <div className="flex gap-2">
                      {cameraShapes.map(({ shape, icon }) => (
                        <button
                          key={shape}
                          onClick={() => setCameraShape(shape)}
                          disabled={isRecording}
                          className={`flex-1 aspect-square rounded-xl flex items-center justify-center transition-all ${
                            cameraShape === shape
                              ? 'gradient-primary text-white'
                              : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
                          } ${isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Camera Size */}
                  <div>
                    <label className="flex items-center justify-between text-xs text-gray-500 mb-2">
                      <span>Size</span>
                      <span className="text-white font-medium">{cameraSize}px</span>
                    </label>
                    <input
                      type="range"
                      min="100"
                      max="400"
                      value={cameraSize}
                      onChange={(e) => setCameraSize(Number(e.target.value))}
                      disabled={isRecording}
                      className="w-full"
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Audio Settings */}
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            Audio
          </h3>

          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={microphoneEnabled}
                onChange={(e) => setMicrophoneEnabled(e.target.checked)}
                disabled={isRecording}
              />
              <span className="text-sm text-gray-400 group-hover:text-white transition-colors">
                Record microphone
              </span>
            </label>

            {microphoneEnabled && (
              <select
                value={selectedMicrophone || ''}
                onChange={(e) => setSelectedMicrophone(e.target.value || null)}
                disabled={isRecording}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all"
              >
                <option value="" className="bg-gray-900 text-white">Default Microphone</option>
                {availableMicrophones.map((mic) => (
                  <option key={mic.deviceId} value={mic.deviceId} className="bg-gray-900 text-white">
                    {mic.label || `Microphone ${mic.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

      </div>
    </aside>
  );
}

export default Sidebar;
