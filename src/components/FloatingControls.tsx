import { useEffect, useState, useRef } from 'react';
import { isElectron } from '../platform';

interface RecordingStateUpdate {
  recordingState: string;
  duration: number;
  showCamera?: boolean;
  cameraDeviceId?: string;
  cameraShape?: string;
}

function FloatingControlsInner() {
  const [recordingState, setRecordingState] = useState<string>('idle');
  const [duration, setDuration] = useState(0);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
  const [cameraShape, setCameraShape] = useState<string>('circle');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    // Listen for recording state updates from main window
    window.electronAPI.onRecordingStateUpdate((state: RecordingStateUpdate) => {
      console.log('Floating received state:', state);
      setRecordingState(state.recordingState);
      setDuration(state.duration);
      if (state.showCamera !== undefined) {
        console.log('Setting cameraEnabled to:', state.showCamera);
        setCameraEnabled(state.showCamera);
      }
      if (state.cameraDeviceId !== undefined) {
        console.log('Setting cameraDeviceId to:', state.cameraDeviceId);
        setCameraDeviceId(state.cameraDeviceId || null);
      }
      if (state.cameraShape !== undefined) {
        setCameraShape(state.cameraShape);
      }
    });

    // Add draggable style to document for Electron
    document.body.style.setProperty('-webkit-app-region', 'drag');
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';

    return () => {
      window.electronAPI.removeFloatingControlListeners();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Start camera stream when camera is enabled and shown
  useEffect(() => {
    console.log('Camera effect triggered:', { showCamera, cameraEnabled, cameraDeviceId });

    let mounted = true;

    const startCamera = async () => {
      if (showCamera && cameraEnabled) {
        try {
          // Stop any existing stream
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
          }

          console.log('Starting camera stream...', { cameraDeviceId });

          // Small delay to ensure video element is mounted and visible
          await new Promise(resolve => setTimeout(resolve, 100));

          if (!mounted) return;

          // First, enumerate devices to see what's available
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter(d => d.kind === 'videoinput');
          console.log('Available video devices:', videoDevices);

          // Use simple constraints - don't specify exact deviceId which can fail
          const constraints: MediaStreamConstraints = {
            video: {
              width: { ideal: 320 },
              height: { ideal: 320 },
            },
            audio: false,
          };

          console.log('Requesting camera with constraints:', constraints);
          const stream = await navigator.mediaDevices.getUserMedia(constraints);

          if (!mounted) {
            stream.getTracks().forEach(track => track.stop());
            return;
          }

          console.log('Camera stream obtained:', stream, 'tracks:', stream.getVideoTracks());
          streamRef.current = stream;

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            // Force play after a short delay
            setTimeout(() => {
              if (videoRef.current && mounted) {
                console.log('Attempting to play video...');
                videoRef.current.play()
                  .then(() => console.log('Video playing successfully'))
                  .catch(e => console.error('Play failed:', e));
              }
            }, 100);
            console.log('Video srcObject set, videoRef:', videoRef.current);
          } else {
            console.error('videoRef.current is null!');
          }
        } catch (err) {
          console.error('Failed to start camera:', err);
        }
      } else if (!showCamera && streamRef.current) {
        console.log('Stopping camera stream');
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
      }
    };

    startCamera();

    return () => {
      mounted = false;
    };
  }, [showCamera, cameraEnabled, cameraDeviceId]);

  const handlePauseResume = () => {
    if (recordingState === 'recording') {
      window.electronAPI.sendFloatingControlAction('pause');
    } else if (recordingState === 'paused') {
      window.electronAPI.sendFloatingControlAction('resume');
    }
  };

  const handleStop = () => {
    window.electronAPI.sendFloatingControlAction('stop');
  };

  const toggleCamera = () => {
    const newValue = !showCamera;
    setShowCamera(newValue);
    // Adjust window position to keep it on screen
    window.electronAPI.adjustFloatingPosition(newValue && cameraEnabled);
  };

  const formatDuration = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getCameraShapeClass = () => {
    switch (cameraShape) {
      case 'circle': return 'rounded-full';
      case 'rounded': return 'rounded-2xl';
      default: return 'rounded-full';
    }
  };

  const isActive = recordingState === 'recording' || recordingState === 'paused';

  if (!isActive) {
    return null;
  }

  return (
    <div className="drag-region w-full h-full flex flex-col items-center justify-start pt-2 gap-2">
      {/* Camera preview - always render video element, control visibility with opacity */}
      <div
        className={`no-drag w-32 h-32 overflow-hidden shadow-2xl border-2 border-white/20 bg-gray-800 ${getCameraShapeClass()} transition-opacity duration-200 ${
          showCamera && cameraEnabled ? 'opacity-100' : 'opacity-0 pointer-events-none absolute'
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`w-full h-full object-cover transform scale-x-[-1] bg-gray-800 ${getCameraShapeClass()}`}
        />
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-3 bg-gray-900 rounded-full px-4 py-2 shadow-2xl border border-white/10">
        {/* Recording indicator */}
        <div className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${
              recordingState === 'recording'
                ? 'bg-red-500 animate-pulse'
                : 'bg-yellow-500'
            }`}
          />
          <span className="text-white text-sm font-medium">
            {recordingState === 'recording' ? 'REC' : 'PAUSED'}
          </span>
        </div>

        {/* Duration */}
        <div className="text-white font-mono text-sm min-w-[60px] text-center">
          {formatDuration(duration)}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-white/20" />

        {/* Camera toggle button (only show if camera is enabled in recording mode) */}
        {cameraEnabled && (
          <button
            onClick={toggleCamera}
            className={`no-drag p-2 rounded-full transition-colors ${
              showCamera ? 'bg-purple-500/30 text-purple-300' : 'hover:bg-white/10 text-white'
            }`}
            title={showCamera ? 'Hide Camera' : 'Show Camera'}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        )}

        {/* Pause/Resume button */}
        <button
          onClick={handlePauseResume}
          className="no-drag p-2 rounded-full hover:bg-white/10 transition-colors text-white"
          title={recordingState === 'recording' ? 'Pause' : 'Resume'}
        >
          {recordingState === 'recording' ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Stop button */}
        <button
          onClick={handleStop}
          className="no-drag p-2 rounded-full bg-red-500/20 hover:bg-red-500/30 transition-colors text-red-400"
          title="Stop Recording"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h12v12H6z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function FloatingControls() {
  if (!isElectron) return null;
  return <FloatingControlsInner />;
}

export default FloatingControls;
