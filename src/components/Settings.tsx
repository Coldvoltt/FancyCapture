import { useStore, resolutionPresets, fpsPresets, FpsOption } from '../store/useStore';
import { isElectron, platform } from '../platform';

function Settings() {
  const {
    showSettings,
    setShowSettings,
    recordingState,
    outputResolution,
    setOutputResolution,
    outputFolder,
    recordingFps,
    setRecordingFps,
    zoomConfig,
    setZoomConfig,
    recordingMode,
  } = useStore();

  const isRecording = recordingState !== 'idle';
  const showScreenSettings = recordingMode === 'screen' || recordingMode === 'screen-camera';

  const handleFolderSelect = async () => {
    const folder = await platform.showFolderDialog();
    if (folder) {
      useStore.getState().setOutputFolder(folder);
    }
  };

  if (!showSettings) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setShowSettings(false)}
      />

      {/* Modal */}
      <div className="relative bg-gray-900 rounded-2xl shadow-2xl border border-white/10 w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button
            onClick={() => setShowSettings(false)}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Output Settings */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Output
            </h3>

            <div className="space-y-4">
              {/* Resolution Selection */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">Resolution</label>
                <select
                  value={outputResolution}
                  onChange={(e) => setOutputResolution(e.target.value as typeof outputResolution)}
                  disabled={isRecording}
                  className={`w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all ${
                    isRecording ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {resolutionPresets.map((preset) => (
                    <option key={preset.id} value={preset.id} className="bg-gray-900 text-white">
                      {preset.label} {preset.width > 0 ? `(${preset.width}x${preset.height})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Frame Rate Selection */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">Frame Rate</label>
                <select
                  value={recordingFps}
                  onChange={(e) => setRecordingFps(Number(e.target.value) as FpsOption)}
                  disabled={isRecording}
                  className={`w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent transition-all ${
                    isRecording ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {fpsPresets.map((preset) => (
                    <option key={preset.id} value={preset.id} className="bg-gray-900 text-white">
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Folder Selection */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">Save Location</label>
                {isElectron ? (
                  <button
                    onClick={handleFolderSelect}
                    disabled={isRecording}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-left hover:bg-white/10 hover:border-white/20 transition-all ${
                      isRecording ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">
                        {outputFolder || 'Select folder...'}
                      </div>
                    </div>
                  </button>
                ) : (
                  <div className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-gray-400">
                    Downloads to browser default location
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Zoom Settings */}
          {showScreenSettings && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                </svg>
                Zoom
              </h3>

              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={zoomConfig.enabled}
                    onChange={(e) => setZoomConfig({ enabled: e.target.checked })}
                    disabled={isRecording}
                    className="w-4 h-4 rounded border-gray-600 bg-white/5 text-purple-500 focus:ring-purple-500/50"
                  />
                  <span className="text-sm text-gray-400 group-hover:text-white transition-colors">
                    Enable zoom (hold Z key while recording)
                  </span>
                </label>

                {zoomConfig.enabled && (
                  <div>
                    <label className="flex items-center justify-between text-xs text-gray-500 mb-2">
                      <span>Zoom Level</span>
                      <span className="text-white font-medium">{zoomConfig.scale}x</span>
                    </label>
                    <input
                      type="range"
                      min="1.5"
                      max="4"
                      step="0.5"
                      value={zoomConfig.scale}
                      onChange={(e) => setZoomConfig({ scale: Number(e.target.value) })}
                      disabled={isRecording}
                      className="w-full"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Settings;
