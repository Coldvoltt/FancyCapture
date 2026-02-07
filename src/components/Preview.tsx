import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore, defaultBackgrounds } from '../store/useStore';
import { isElectron } from '../platform';

function Preview() {
  const {
    recordingMode,
    recordingState,
    selectedSource,
    cameraShape,
    cameraSize,
    cameraPosition,
    setCameraPosition,
    selectedCamera,
    zoomConfig,
    setZoomConfig,
    backgroundConfig,
    setPreviewDimensions,
    webScreenStream,
    isZooming,
    setIsZooming,
  } = useStore();

  const allBackgrounds = [...defaultBackgrounds, ...backgroundConfig.customBackgrounds];
  const selectedBackground = allBackgrounds.find((bg) => bg.id === backgroundConfig.selectedId);

  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const showScreen = recordingMode === 'screen' || recordingMode === 'screen-camera';
  const showCamera = recordingMode === 'camera' || recordingMode === 'screen-camera';

  // Track preview container dimensions
  useEffect(() => {
    const updateDimensions = () => {
      if (previewContainerRef.current) {
        const { width, height } = previewContainerRef.current.getBoundingClientRect();
        setPreviewDimensions({ width, height });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);

    // Use ResizeObserver for more accurate tracking
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (previewContainerRef.current) {
      resizeObserver.observe(previewContainerRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateDimensions);
      resizeObserver.disconnect();
    };
  }, [setPreviewDimensions]);

  // Get screen stream
  useEffect(() => {
    if (!showScreen || !selectedSource) {
      if (screenStream) {
        // Only stop streams we own (Electron streams), not the shared webScreenStream
        if (isElectron) {
          screenStream.getTracks().forEach((track) => track.stop());
        }
        setScreenStream(null);
      }
      return;
    }

    if (isElectron) {
      // Electron: use chromeMediaSource
      const getElectronScreenStream = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: selectedSource.id,
              },
            } as MediaTrackConstraints,
          });

          setScreenStream(stream);
          if (screenVideoRef.current) {
            screenVideoRef.current.srcObject = stream;
          }
        } catch (error) {
          console.error('Error getting screen stream:', error);
        }
      };
      getElectronScreenStream();
    } else {
      // Web: use the shared webScreenStream from the store
      if (webScreenStream) {
        setScreenStream(webScreenStream);
        if (screenVideoRef.current) {
          screenVideoRef.current.srcObject = webScreenStream;
        }
      }
    }

    return () => {
      if (isElectron && screenStream) {
        screenStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [showScreen, selectedSource?.id, webScreenStream]);

  // Get camera stream
  useEffect(() => {
    if (!showCamera) {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
        setCameraStream(null);
      }
      return;
    }

    const getCameraStream = async () => {
      try {
        const constraints: MediaStreamConstraints = {
          video: selectedCamera
            ? {
                deviceId: { exact: selectedCamera },
                frameRate: { ideal: 60, min: 30 },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }
            : {
                frameRate: { ideal: 60, min: 30 },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        setCameraStream(stream);
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error('Error getting camera stream:', error);
      }
    };

    getCameraStream();

    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [showCamera, selectedCamera]);

  // Handle camera dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (recordingMode !== 'screen-camera') return;

    const rect = (e.target as HTMLElement).getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    setIsDragging(true);
  }, [recordingMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !previewContainerRef.current) return;

    const containerRect = previewContainerRef.current.getBoundingClientRect();
    const x = e.clientX - containerRect.left - dragOffset.current.x;
    const y = e.clientY - containerRect.top - dragOffset.current.y;

    // Constrain to container bounds
    const maxX = containerRect.width - cameraSize;
    const maxY = containerRect.height - cameraSize;

    setCameraPosition({
      x: Math.max(0, Math.min(x, maxX)),
      y: Math.max(0, Math.min(y, maxY)),
    });
  }, [isDragging, cameraSize, setCameraPosition]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Handle zoom with keyboard
  useEffect(() => {
    if (!zoomConfig.enabled || recordingState !== 'recording') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'z' && !isZooming) {
        setIsZooming(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'z') {
        setIsZooming(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [zoomConfig.enabled, recordingState, isZooming]);

  // Track mouse position for zoom
  useEffect(() => {
    if (!isZooming || !previewContainerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = previewContainerRef.current!.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setZoomConfig({ x, y });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isZooming, setZoomConfig]);

  const getCameraShapeClass = () => {
    switch (cameraShape) {
      case 'circle':
        return 'camera-circle';
      case 'rounded':
        return 'camera-rounded';
      default:
        return 'camera-circle';
    }
  };

  const getZoomTransform = () => {
    if (!isZooming) return {};
    return {
      transform: `scale(${zoomConfig.scale})`,
      transformOrigin: `${zoomConfig.x}% ${zoomConfig.y}%`,
    };
  };

  const getBackgroundStyle = () => {
    if (!backgroundConfig.enabled || !selectedBackground) return {};
    return {
      background: selectedBackground.type === 'gradient'
        ? selectedBackground.value
        : `url(${selectedBackground.value}) center/cover`,
    };
  };

  return (
    <div
      ref={previewContainerRef}
      className="flex-1 glass-dark rounded-2xl overflow-hidden relative"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Background layer */}
      {backgroundConfig.enabled && showScreen && selectedSource && selectedBackground && (
        <div
          className="absolute inset-0"
          style={getBackgroundStyle()}
        />
      )}

      {/* Empty state */}
      {!selectedSource && showScreen && !showCamera && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
          <div className="w-20 h-20 rounded-2xl bg-white/5 flex items-center justify-center mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-lg font-medium text-gray-400">No source selected</p>
          <p className="text-sm text-gray-600 mt-1">Choose a screen or window to preview</p>
        </div>
      )}

      {/* Screen preview */}
      {showScreen && selectedSource && (
        <div
          className="absolute transition-transform duration-100 flex flex-col"
          style={{
            ...getZoomTransform(),
            ...(backgroundConfig.enabled ? {
              inset: `${backgroundConfig.padding}px`,
              borderRadius: `${backgroundConfig.borderRadius}px`,
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            } : {
              inset: 0,
            }),
          }}
        >
          {/* Window title bar */}
          {backgroundConfig.enabled && (
            <div
              className="flex items-center px-3 py-2 bg-[#2d2d2d] flex-shrink-0"
              style={{
                borderTopLeftRadius: `${backgroundConfig.borderRadius}px`,
                borderTopRightRadius: `${backgroundConfig.borderRadius}px`,
              }}
            >
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <div className="w-3 h-3 rounded-full bg-[#27ca3f]" />
              </div>
            </div>
          )}
          <video
            ref={screenVideoRef}
            autoPlay
            muted
            className="w-full flex-1 object-contain"
            style={backgroundConfig.enabled ? {
              borderBottomLeftRadius: `${backgroundConfig.borderRadius}px`,
              borderBottomRightRadius: `${backgroundConfig.borderRadius}px`,
            } : {}}
          />
        </div>
      )}

      {/* Camera preview - full screen for camera-only mode */}
      {recordingMode === 'camera' && (
        <video
          ref={cameraVideoRef}
          autoPlay
          muted
          className="w-full h-full object-cover transform scale-x-[-1]"
        />
      )}

      {/* Camera overlay for screen-camera mode */}
      {recordingMode === 'screen-camera' && showCamera && (
        <div
          className={`absolute cursor-move shadow-2xl ${getCameraShapeClass()} ${
            isDragging ? 'ring-4 ring-purple-500 ring-opacity-50' : ''
          } transition-shadow`}
          style={{
            width: cameraSize,
            height: cameraSize,
            left: cameraPosition.x,
            top: cameraPosition.y,
          }}
          onMouseDown={handleMouseDown}
        >
          <video
            ref={cameraVideoRef}
            autoPlay
            muted
            className={`w-full h-full object-cover transform scale-x-[-1] ${getCameraShapeClass()}`}
          />
        </div>
      )}

      {/* Zoom indicator */}
      {isZooming && (
        <div className="absolute top-4 right-4 gradient-primary text-white px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 shadow-lg">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
          </svg>
          {zoomConfig.scale}x Zoom
        </div>
      )}

      {/* Recording indicator */}
      {recordingState === 'recording' && (
        <div className="absolute top-4 left-4 flex items-center gap-2 bg-red-500/90 backdrop-blur-sm text-white px-4 py-2 rounded-full shadow-lg">
          <div className="w-2 h-2 rounded-full bg-white recording-pulse" />
          <span className="text-sm font-medium">REC</span>
        </div>
      )}

      {recordingState === 'paused' && (
        <div className="absolute top-4 left-4 flex items-center gap-2 bg-yellow-500/90 backdrop-blur-sm text-white px-4 py-2 rounded-full shadow-lg">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
          <span className="text-sm font-medium">Paused</span>
        </div>
      )}

      {/* Keyboard hint */}
      {zoomConfig.enabled && recordingState === 'recording' && !isZooming && (
        <div className="absolute bottom-4 right-4 text-xs text-gray-500 bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-full">
          Hold <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-gray-400 ml-1">Z</kbd> to zoom
        </div>
      )}
    </div>
  );
}

export default Preview;
