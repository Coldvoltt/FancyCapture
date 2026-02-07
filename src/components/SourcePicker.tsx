import { useEffect, useState } from 'react';
import { useStore, ScreenSource } from '../store/useStore';
import { isElectron } from '../platform';

function SourcePickerInner() {
  const {
    setShowSourcePicker,
    setSelectedSource,
    availableSources,
    setAvailableSources,
  } = useStore();

  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'screen' | 'window'>('all');

  useEffect(() => {
    const loadSources = async () => {
      setLoading(true);
      try {
        const sources = await window.electronAPI.getSources();
        setAvailableSources(sources);
      } catch (error) {
        console.error('Error loading sources:', error);
      }
      setLoading(false);
    };

    loadSources();
  }, [setAvailableSources]);

  const handleSelectSource = (source: ScreenSource) => {
    setSelectedSource(source);
    setShowSourcePicker(false);
  };

  const handleClose = () => {
    setShowSourcePicker(false);
  };

  const filteredSources = availableSources.filter((source) => {
    if (filter === 'all') return true;
    if (filter === 'screen') return source.isScreen;
    return !source.isScreen;
  });

  const screens = availableSources.filter((s) => s.isScreen);
  const windows = availableSources.filter((s) => !s.isScreen);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-8">
      <div className="glass rounded-3xl shadow-2xl max-w-4xl w-full max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-xl font-bold text-white">Select Source</h2>
            <p className="text-sm text-gray-500 mt-1">
              Choose a screen or window to record
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-xl hover:bg-white/5 transition-colors text-gray-400 hover:text-white"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 p-4 border-b border-white/5">
          {[
            { key: 'all', label: 'All', count: availableSources.length },
            { key: 'screen', label: 'Screens', count: screens.length },
            { key: 'window', label: 'Windows', count: windows.length },
          ].map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilter(key as typeof filter)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                filter === key
                  ? 'gradient-primary text-white shadow-lg'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {label}
              <span className={`ml-2 ${filter === key ? 'text-white/70' : 'text-gray-600'}`}>
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-500">Loading sources...</p>
              </div>
            </div>
          ) : filteredSources.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-500">
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <p>No sources found</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {filteredSources.map((source) => (
                <button
                  key={source.id}
                  onClick={() => handleSelectSource(source)}
                  className="group relative bg-white/5 rounded-2xl overflow-hidden border border-transparent hover:border-purple-500/50 transition-all hover:bg-white/10"
                >
                  {/* Thumbnail */}
                  <div className="aspect-video bg-black/50 relative overflow-hidden">
                    <img
                      src={source.thumbnail}
                      alt={source.name}
                      className="w-full h-full object-contain"
                    />
                    {/* Type badge */}
                    <div
                      className={`absolute top-2 left-2 px-2 py-1 rounded-lg text-xs font-medium backdrop-blur-sm ${
                        source.isScreen
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      }`}
                    >
                      {source.isScreen ? 'Screen' : 'Window'}
                    </div>
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-purple-600/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="gradient-primary text-white px-4 py-2 rounded-xl font-medium text-sm shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                        Select
                      </div>
                    </div>
                  </div>
                  {/* Name */}
                  <div className="p-3 flex items-center gap-2">
                    {source.appIcon && (
                      <img
                        src={source.appIcon}
                        alt=""
                        className="w-5 h-5 flex-shrink-0 rounded"
                      />
                    )}
                    <span className="text-sm text-gray-300 truncate group-hover:text-white transition-colors">
                      {source.name}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/5 flex justify-end">
          <button
            onClick={handleClose}
            className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl transition-all font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function SourcePicker() {
  if (!isElectron) return null;
  return <SourcePickerInner />;
}

export default SourcePicker;
