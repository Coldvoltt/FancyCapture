import { useStore } from '../store/useStore';

function Header() {
  const { recordingState, recordingDuration, setShowSettings } = useStore();

  const formatDuration = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isRecording = recordingState === 'recording' || recordingState === 'paused';

  return (
    <header className="h-14 glass flex items-center justify-between px-6 drag-region">
      <div className="flex items-center gap-4 no-drag">
        <div className="relative">
          <div className="w-10 h-10 gradient-primary rounded-xl flex items-center justify-center shadow-lg">
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
          {isRecording && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full recording-pulse" />
          )}
        </div>
        <div>
          <h1 className="font-bold text-lg bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            FancyCapture
          </h1>
          <p className="text-xs text-gray-500">Screen Recording Studio</p>
        </div>
      </div>

      {isRecording && (
        <div className="flex items-center gap-3 no-drag">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${
            recordingState === 'recording'
              ? 'bg-red-500/20 border border-red-500/30'
              : 'bg-yellow-500/20 border border-yellow-500/30'
          }`}>
            <div
              className={`w-2 h-2 rounded-full ${
                recordingState === 'recording'
                  ? 'bg-red-500 recording-pulse'
                  : 'bg-yellow-500'
              }`}
            />
            <span className={`text-sm font-medium ${
              recordingState === 'recording' ? 'text-red-400' : 'text-yellow-400'
            }`}>
              {recordingState === 'recording' ? 'Recording' : 'Paused'}
            </span>
          </div>
          <div className="px-4 py-2 rounded-full bg-white/5 border border-white/10">
            <span className="font-mono text-sm text-white">
              {formatDuration(recordingDuration)}
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 no-drag">
        <button
          onClick={() => setShowSettings(true)}
          className="p-2 rounded-lg hover:bg-white/5 transition-colors text-gray-400 hover:text-white"
          title="Settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    </header>
  );
}

export default Header;
