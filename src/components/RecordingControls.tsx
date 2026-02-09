import { useRef, useEffect, useCallback } from 'react';
import { useStore, resolutionPresets } from '../store/useStore';
import { isElectron, platform, FileStreamHandle } from '../platform';

function RecordingControls() {
  const {
    recordingMode,
    recordingState,
    setRecordingState,
    selectedSource,
    selectedCamera,
    microphoneEnabled,
    selectedMicrophone,
    recordingDuration,
    setRecordingDuration,
    incrementDuration,
    zoomConfig,
    isZooming,
    setIsZooming,
  } = useStore();

  // Refs for web-only MediaRecorder path
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tickWorkerRef = useRef<Worker | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const fileStreamRef = useRef<FileStreamHandle | null>(null);

  // Shared refs
  const durationIntervalRef = useRef<number | null>(null);

  const showScreen = recordingMode === 'screen' || recordingMode === 'screen-camera';
  const showCamera = recordingMode === 'camera' || recordingMode === 'screen-camera';

  const canStartRecording =
    (showScreen && selectedSource) || recordingMode === 'camera';

  const stopAllStreams = useCallback(() => {
    streamsRef.current.forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });
    streamsRef.current = [];
  }, []);

  // ========== ELECTRON: FFmpeg sidecar recording ==========

  const startRecordingElectron = async () => {
    setRecordingState('preparing');

    try {
      const state = useStore.getState();

      // Resolve camera label from device ID (with fallback to first available camera)
      let cameraLabel: string | null = null;
      const needsCameraForRecording = state.recordingMode === 'camera' || state.recordingMode === 'screen-camera';
      if (needsCameraForRecording) {
        if (state.selectedCamera) {
          cameraLabel = state.availableCameras.find((c) => c.deviceId === state.selectedCamera)?.label || null;
        }
        if (!cameraLabel && state.availableCameras.length > 0) {
          cameraLabel = state.availableCameras[0].label || null;
        }
      }

      // Resolve microphone label from device ID
      let micLabel: string | null = null;
      if (state.microphoneEnabled) {
        if (state.selectedMicrophone) {
          micLabel = state.availableMicrophones.find((m) => m.deviceId === state.selectedMicrophone)?.label || null;
        } else if (state.availableMicrophones.length > 0) {
          micLabel = state.availableMicrophones[0].label || null;
        }
      }

      // Ensure we have a valid output folder (defaults to empty string in store)
      let folder = state.outputFolder;
      if (!folder) {
        folder = await platform.getDefaultFolder();
        useStore.getState().setOutputFolder(folder);
      }

      // For desktop capture in screen-camera mode, use floating camera bubble
      // (gdigrab will capture it naturally — no need for FFmpeg camera overlay)
      const isDesktopCapture = !state.selectedSource || state.selectedSource.isScreen;
      const useFloatingCamera = state.recordingMode === 'screen-camera' && isDesktopCapture;

      const hasScreen = state.recordingMode === 'screen' || state.recordingMode === 'screen-camera';

      // Always use floating camera for desktop capture — dshow camera access
      // is unreliable on Windows (Intel OV01AS I/O errors even after 5s+ delay).
      const effectiveUseFloatingCamera = useFloatingCamera;

      // When FFmpeg needs dshow camera access, release the preview camera first.
      // Must be sequential (not overlapped) — Windows DirectShow needs the full
      // wait period with no concurrent media operations to properly release.
      const needsDshowCamera = needsCameraForRecording && !effectiveUseFloatingCamera;
      if (needsDshowCamera) {
        // Set flag first to prevent Preview from re-opening the camera
        useStore.getState().setPreviewCameraSuspended(true);
        // Wait a tick for React to process the state change
        await new Promise(r => setTimeout(r, 100));
        // Now stop any remaining camera tracks
        const previewCam = useStore.getState().previewCameraStream;
        if (previewCam) {
          previewCam.getTracks().forEach(track => track.stop());
          useStore.getState().setPreviewCameraStream(null);
        }
        // Wait for Windows to fully release the DirectShow device.
        // Intel cameras (OV01AS etc.) can take 3-5 seconds to fully release.
        await new Promise(r => setTimeout(r, 5000));
      }

      // Get screen size from the SELECTED source's display bounds (multi-monitor aware).
      // Falls back to platform.getScreenSize() (primary display) if bounds not available.
      let physicalScreenW = 0;
      let physicalScreenH = 0;
      let displayOffsetX = 0;
      let displayOffsetY = 0;

      if (hasScreen && state.selectedSource?.displayBounds && state.selectedSource?.scaleFactor) {
        const bounds = state.selectedSource.displayBounds;
        const sf = state.selectedSource.scaleFactor;
        physicalScreenW = Math.round(bounds.width * sf);
        physicalScreenH = Math.round(bounds.height * sf);
        displayOffsetX = bounds.x;
        displayOffsetY = bounds.y;
        console.log('Using selected source display bounds:', { bounds, sf, physicalScreenW, physicalScreenH, displayOffsetX, displayOffsetY });
      } else if (hasScreen) {
        console.log('No display bounds on selected source, falling back to getScreenSize(). Source:', state.selectedSource);
        const screenSize = await platform.getScreenSize();
        physicalScreenW = Math.round(screenSize.width * screenSize.scaleFactor);
        physicalScreenH = Math.round(screenSize.height * screenSize.scaleFactor);
      }

      const effectiveFps = state.recordingFps;

      // Compute screen capture region for gdigrab (constrains to selected monitor)
      let screenRegion: { x: number; y: number; w: number; h: number } | undefined;
      if (hasScreen && isDesktopCapture && physicalScreenW > 0) {
        screenRegion = { x: displayOffsetX, y: displayOffsetY, w: physicalScreenW, h: physicalScreenH };
      }

      const config = {
        mode: state.recordingMode,
        screenSource: state.selectedSource,
        cameraLabel,
        cameraSize: state.cameraSize,
        cameraPosition: state.cameraPosition,
        cameraShape: state.cameraShape,
        microphoneLabel: micLabel,
        outputFolder: folder,
        outputResolution: state.outputResolution,
        fps: effectiveFps,
        previewWidth: state.previewDimensions.width,
        previewHeight: state.previewDimensions.height,
        useFloatingCamera: effectiveUseFloatingCamera,
        screenRegion,
      };

      console.log('Starting FFmpeg recording with config:', config);

      const result = await platform.ffmpegStartRecording(config);
      if (!result.success) {
        console.error('FFmpeg start failed:', result.error);
        alert(`Recording failed to start:\n${result.error}`);
        platform.restoreMainWindow();
        useStore.getState().setPreviewCameraSuspended(false);
        setRecordingState('idle');
        return;
      }

      // Minimize main window for desktop capture so gdigrab doesn't record the app itself
      if (isDesktopCapture) {
        platform.minimizeMainWindow();
      }

      if (effectiveUseFloatingCamera) {
        // Show floating camera bubble for desktop screen-camera mode.
        // Position on the selected display so gdigrab captures it.
        platform.showCameraBubble({
          deviceId: state.selectedCamera,
          shape: state.cameraShape,
          size: state.cameraSize,
          position: state.cameraPosition,
          previewWidth: state.previewDimensions.width,
          previewHeight: state.previewDimensions.height,
          displayBounds: state.selectedSource?.displayBounds || undefined,
        });
      }

      // Start duration timer
      durationIntervalRef.current = window.setInterval(() => {
        incrementDuration();
      }, 1000);

      setRecordingState('recording');
    } catch (error) {
      console.error('Error starting FFmpeg recording:', error);
      platform.restoreMainWindow();
      useStore.getState().setPreviewCameraSuspended(false);
      setRecordingState('idle');
    }
  };

  const pauseRecordingElectron = useCallback(async () => {
    await platform.ffmpegPauseRecording();
    platform.hideCameraBubble();
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
    }
    setRecordingState('paused');
  }, []);

  const resumeRecordingElectron = useCallback(async () => {
    const result = await platform.ffmpegResumeRecording();
    if (!result.success) {
      console.error('FFmpeg resume failed:', result.error);
      return;
    }
    // Re-show camera bubble if in screen-camera mode (floating camera mode)
    const state = useStore.getState();
    if (state.recordingMode === 'screen-camera') {
      platform.showCameraBubble({
        deviceId: state.selectedCamera,
        shape: state.cameraShape,
        size: state.cameraSize,
        position: state.cameraPosition,
        previewWidth: state.previewDimensions.width,
        previewHeight: state.previewDimensions.height,
        displayBounds: state.selectedSource?.displayBounds || undefined,
      });
    }
    durationIntervalRef.current = window.setInterval(() => {
      incrementDuration();
    }, 1000);
    setRecordingState('recording');
  }, [incrementDuration]);

  const stopRecordingElectron = useCallback(async () => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
    }
    setRecordingState('saving');
    platform.hideCameraBubble();

    // Stop FFmpeg screen recording
    const result = await platform.ffmpegStopRecording();

    if (result.success) {
      console.log('Recording saved:', result.outputPath);
    } else {
      console.error('FFmpeg stop failed:', result.error);
    }

    // Restore main window and re-enable preview camera
    platform.restoreMainWindow();
    useStore.getState().setPreviewCameraSuspended(false);

    setRecordingState('idle');
    setRecordingDuration(0);
  }, []);

  // ========== WEB: MediaRecorder recording (unchanged) ==========

  const startRecordingWeb = async () => {
    setRecordingState('preparing');

    try {
      const streams: MediaStream[] = [];
      let screenStream: MediaStream | null = null;
      let cameraStream: MediaStream | null = null;
      let audioStream: MediaStream | null = null;

      // Get screen stream
      if (showScreen && selectedSource) {
        screenStream = useStore.getState().webScreenStream;
        if (!screenStream) {
          throw new Error('No screen stream available. Please select a source first.');
        }
      }

      // Get camera stream
      if (showCamera) {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: selectedCamera
            ? { deviceId: { exact: selectedCamera }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        streams.push(cameraStream);
      }

      // Get microphone stream
      if (microphoneEnabled) {
        audioStream = await navigator.mediaDevices.getUserMedia({
          audio: selectedMicrophone
            ? { deviceId: { exact: selectedMicrophone } }
            : true,
          video: false,
        });
        streams.push(audioStream);
      }

      streamsRef.current = streams;

      const { zoomConfig: zoomCfg } = useStore.getState();
      const needsCompositing =
        recordingMode === 'screen-camera' ||
        (showScreen && zoomCfg.enabled);

      let recordingStream: MediaStream;

      if (needsCompositing) {
        // --- COMPOSITED PATH: canvas pipeline ---
        if (screenStream) {
          const screenVideo = document.createElement('video');
          screenVideo.srcObject = screenStream;
          screenVideo.muted = true;
          await screenVideo.play();
          await new Promise<void>((resolve) => {
            const check = () => {
              if (screenVideo.videoWidth > 0 && screenVideo.videoHeight > 0) resolve();
              else requestAnimationFrame(check);
            };
            check();
          });
          screenVideoRef.current = screenVideo;
        }

        if (cameraStream) {
          const cameraVideo = document.createElement('video');
          cameraVideo.srcObject = cameraStream;
          cameraVideo.muted = true;
          await cameraVideo.play();
          cameraVideoRef.current = cameraVideo;
        }

        let screenSize: { width: number; height: number };
        if (screenVideoRef.current) {
          screenSize = { width: screenVideoRef.current.videoWidth, height: screenVideoRef.current.videoHeight };
        } else {
          screenSize = await platform.getScreenSize();
        }

        const canvas = document.createElement('canvas');
        const { outputResolution: resolution } = useStore.getState();
        const resolutionConfig = resolutionPresets.find((r) => r.id === resolution);

        if (resolution === 'source' || !resolutionConfig || !screenVideoRef.current) {
          canvas.width = screenSize.width & ~1;
          canvas.height = screenSize.height & ~1;
        } else {
          const srcW = screenSize.width;
          const srcH = screenSize.height;
          const scale = Math.min(resolutionConfig.width / srcW, resolutionConfig.height / srcH);
          canvas.width = Math.round(srcW * scale) & ~1;
          canvas.height = Math.round(srcH * scale) & ~1;
        }

        const ctx = canvas.getContext('2d')!;
        canvasRef.current = canvas;

        const drawFrame = () => {
          const state = useStore.getState();
          const { zoomConfig: zoom, isZooming: currentlyZooming,
                  cameraPosition: pos, cameraSize: size, cameraShape: shape, previewDimensions } = state;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (screenVideoRef.current) {
            ctx.save();
            if (zoom.enabled && currentlyZooming && zoom.x !== undefined) {
              const zx = (zoom.x / 100) * canvas.width, zy = (zoom.y / 100) * canvas.height;
              ctx.translate(zx, zy); ctx.scale(zoom.scale, zoom.scale); ctx.translate(-zx, -zy);
            }
            ctx.drawImage(screenVideoRef.current, 0, 0, canvas.width, canvas.height);
            ctx.restore();
          }
          if (cameraVideoRef.current && recordingMode === 'screen-camera') {
            ctx.save();
            const sx = canvas.width / previewDimensions.width, sy = canvas.height / previewDimensions.height;
            const cs = Math.min(sx, sy), ss = size * cs, scx = pos.x * sx, scy = pos.y * sy;
            ctx.beginPath();
            if (shape === 'rounded') ctx.roundRect(scx, scy, ss, ss, 16 * cs);
            else ctx.arc(scx + ss / 2, scy + ss / 2, ss / 2, 0, Math.PI * 2);
            ctx.clip();
            const v = cameraVideoRef.current, vw = v.videoWidth, vh = v.videoHeight;
            let srcX = 0, srcY = 0, srcW = vw, srcH = vh;
            if (vw > vh) { srcX = (vw - vh) / 2; srcW = vh; } else { srcY = (vh - vw) / 2; srcH = vw; }
            ctx.translate(scx + ss, scy); ctx.scale(-1, 1);
            ctx.drawImage(v, srcX, srcY, srcW, srcH, 0, 0, ss, ss);
            ctx.restore();
          }
        };

        const canvasStream = canvas.captureStream(0);
        const videoTrack = canvasStream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
        const { recordingFps } = useStore.getState();
        const minFrameInterval = 1000 / recordingFps;
        let lastFrameTime = 0;

        const worker = new Worker(
          new URL('../workers/tick.worker.ts', import.meta.url),
          { type: 'module' },
        );
        tickWorkerRef.current = worker;
        worker.onmessage = () => {
          const now = performance.now();
          if (now - lastFrameTime < minFrameInterval * 0.8) return;
          lastFrameTime = now;
          drawFrame();
          if (videoTrack.requestFrame) videoTrack.requestFrame();
        };
        worker.postMessage(recordingFps);

        recordingStream = new MediaStream();
        canvasStream.getVideoTracks().forEach((t) => recordingStream.addTrack(t));
      } else {
        // --- DIRECT PATH: record raw stream without canvas ---
        recordingStream = new MediaStream();
        const sourceStream = recordingMode === 'camera' ? cameraStream : screenStream;
        if (sourceStream) {
          sourceStream.getVideoTracks().forEach((t) => recordingStream.addTrack(t));
        }
      }

      // Add audio tracks
      if (audioStream) {
        audioStream.getAudioTracks().forEach((track) => {
          recordingStream.addTrack(track);
        });
      }

      // Create MediaRecorder
      const preferredMimeType = 'video/webm;codecs=vp8,opus';
      const actualMimeType = MediaRecorder.isTypeSupported(preferredMimeType)
        ? preferredMimeType
        : 'video/webm';

      const mediaRecorder = new MediaRecorder(recordingStream, {
        mimeType: actualMimeType,
        videoBitsPerSecond: 5000000,
        audioBitsPerSecond: 192000,
      });

      // Open file stream for incremental writing
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const webmFile = `Downloads/FancyCapture_${timestamp}.webm`;

      const streamResult = await platform.openFileStream(webmFile);
      if (!streamResult.success || !streamResult.stream) {
        console.error('Failed to open file stream:', streamResult.error);
        stopAllStreams();
        setRecordingState('idle');
        return;
      }
      fileStreamRef.current = streamResult.stream;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && fileStreamRef.current) {
          const stream = fileStreamRef.current;
          event.data.arrayBuffer().then((buffer) => {
            stream.append(buffer);
          });
        }
      };

      mediaRecorder.onstop = async () => {
        if (tickWorkerRef.current) {
          tickWorkerRef.current.postMessage('stop');
          tickWorkerRef.current.terminate();
          tickWorkerRef.current = null;
        }
        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current);
        }

        setRecordingState('saving');

        await new Promise((r) => setTimeout(r, 500));
        if (fileStreamRef.current) {
          await fileStreamRef.current.close();
          fileStreamRef.current = null;
        }

        stopAllStreams();
        setRecordingState('idle');
        setRecordingDuration(0);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(3000);

      durationIntervalRef.current = window.setInterval(() => {
        incrementDuration();
      }, 1000);

      setRecordingState('recording');
    } catch (error) {
      console.error('Error starting recording:', error);
      stopAllStreams();
      setRecordingState('idle');
    }
  };

  const pauseRecordingWeb = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      if (tickWorkerRef.current) {
        tickWorkerRef.current.postMessage('stop');
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      setRecordingState('paused');
    }
  }, []);

  const resumeRecordingWeb = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      if (tickWorkerRef.current) {
        const { recordingFps } = useStore.getState();
        tickWorkerRef.current.postMessage(recordingFps);
      }
      durationIntervalRef.current = window.setInterval(() => {
        incrementDuration();
      }, 1000);
      setRecordingState('recording');
    }
  }, [incrementDuration]);

  const stopRecordingWeb = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // ========== Unified handlers ==========

  const startRecording = async () => {
    if (!canStartRecording) return;
    if (isElectron) {
      await startRecordingElectron();
    } else {
      await startRecordingWeb();
    }
  };

  const pauseRecording = useCallback(() => {
    if (isElectron) {
      pauseRecordingElectron();
    } else {
      pauseRecordingWeb();
    }
  }, [pauseRecordingElectron, pauseRecordingWeb]);

  const resumeRecording = useCallback(() => {
    if (isElectron) {
      resumeRecordingElectron();
    } else {
      resumeRecordingWeb();
    }
  }, [resumeRecordingElectron, resumeRecordingWeb]);

  const stopRecording = useCallback(() => {
    if (isElectron) {
      stopRecordingElectron();
    } else {
      stopRecordingWeb();
    }
  }, [stopRecordingElectron, stopRecordingWeb]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tickWorkerRef.current) {
        tickWorkerRef.current.postMessage('stop');
        tickWorkerRef.current.terminate();
        tickWorkerRef.current = null;
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      if (fileStreamRef.current) {
        fileStreamRef.current.close();
        fileStreamRef.current = null;
      }
      stopAllStreams();
    };
  }, [stopAllStreams]);

  // Show/hide floating controls based on recording state
  useEffect(() => {
    if (recordingState === 'recording' || recordingState === 'paused') {
      platform.showFloatingControls();
    } else if (recordingState === 'idle') {
      platform.hideFloatingControls();
    }
  }, [recordingState]);

  // Send recording state to floating controls
  useEffect(() => {
    const showCam = recordingMode === 'screen-camera' || recordingMode === 'camera';
    platform.sendRecordingState({
      recordingState,
      duration: recordingDuration,
      showCamera: showCam,
      cameraDeviceId: useStore.getState().selectedCamera || undefined,
      cameraShape: useStore.getState().cameraShape,
    });
  }, [recordingState, recordingDuration, recordingMode]);

  // Listen for actions from floating controls
  useEffect(() => {
    const handleAction = (action: string) => {
      switch (action) {
        case 'pause':
          pauseRecording();
          break;
        case 'resume':
          resumeRecording();
          break;
        case 'stop':
          stopRecording();
          break;
      }
    };

    platform.onFloatingControlAction(handleAction);

    return () => {
      platform.removeFloatingControlListeners();
    };
  }, []);

  // Listen for FFmpeg errors
  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI.onFfmpegError((data) => {
      console.error('FFmpeg error:', data.error);
      alert(`FFmpeg error:\n${data.error}`);
      platform.hideCameraBubble();
      platform.restoreMainWindow();
      useStore.getState().setPreviewCameraSuspended(false);
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      setRecordingState('idle');
      setRecordingDuration(0);
    });
    return () => {
      window.electronAPI.removeFfmpegListeners();
    };
  }, []);

  const formatDuration = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="mt-4 flex items-center justify-center gap-3">
      {recordingState === 'idle' && (
        <button
          onClick={startRecording}
          disabled={!canStartRecording}
          className={`group flex items-center gap-3 px-8 py-4 rounded-2xl font-semibold text-lg transition-all ${
            canStartRecording
              ? 'gradient-danger text-white shadow-lg shadow-red-500/25 btn-hover'
              : 'bg-white/5 text-gray-600 cursor-not-allowed'
          }`}
        >
          <div className={`w-4 h-4 rounded-full ${canStartRecording ? 'bg-white' : 'bg-current'}`} />
          Start Recording
        </button>
      )}

      {recordingState === 'preparing' && (
        <div className="flex items-center gap-3 px-8 py-4 rounded-2xl font-semibold text-lg bg-white/5 text-gray-400">
          <div className="w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
          Preparing...
        </div>
      )}

      {(recordingState === 'recording' || recordingState === 'paused') && (
        <>
          {/* Pause/Resume */}
          <button
            onClick={recordingState === 'recording' ? pauseRecording : resumeRecording}
            className="flex items-center gap-2 px-5 py-3 rounded-xl font-medium bg-white/5 hover:bg-white/10 text-white border border-white/10 transition-all"
          >
            {recordingState === 'recording' ? (
              <>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
                Pause
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Resume
              </>
            )}
          </button>

          {/* Zoom toggle — only relevant for web composited path */}
          {!isElectron && zoomConfig.enabled && showScreen && (
            <button
              onClick={() => setIsZooming(!isZooming)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl font-medium border transition-all ${
                isZooming
                  ? 'gradient-primary text-white border-purple-500/50 shadow-lg shadow-purple-500/25'
                  : 'bg-white/5 hover:bg-white/10 text-white border-white/10'
              }`}
              title={isZooming ? 'Disable zoom' : 'Enable zoom (or hold Z)'}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
              {zoomConfig.scale}x
            </button>
          )}

          {/* Duration display */}
          <div className="px-6 py-3 rounded-xl glass font-mono text-xl text-white min-w-[120px] text-center">
            {formatDuration(recordingDuration)}
          </div>

          {/* Stop */}
          <button
            onClick={stopRecording}
            className="flex items-center gap-2 px-5 py-3 rounded-xl font-medium gradient-danger text-white shadow-lg shadow-red-500/25 transition-all hover:shadow-red-500/40"
          >
            <div className="w-4 h-4 rounded-sm bg-white" />
            Stop
          </button>
        </>
      )}

      {recordingState === 'saving' && (
        <div className="flex items-center gap-3 px-8 py-4 rounded-2xl font-semibold text-lg gradient-primary text-white shadow-lg">
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          Saving...
        </div>
      )}

      {recordingState === 'converting' && (
        <div className="flex items-center gap-3 px-8 py-4 rounded-2xl font-semibold text-lg gradient-success text-white shadow-lg">
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          Converting to MP4...
        </div>
      )}
    </div>
  );
}

export default RecordingControls;
