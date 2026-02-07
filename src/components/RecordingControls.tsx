import { useRef, useEffect, useCallback } from 'react';
import { useStore, defaultBackgrounds, BackgroundOption, resolutionPresets } from '../store/useStore';
import { isElectron, platform } from '../platform';

function RecordingControls() {
  const {
    recordingMode,
    recordingState,
    setRecordingState,
    selectedSource,
    selectedCamera,
    microphoneEnabled,
    selectedMicrophone,
    systemAudioEnabled,
    outputFolder,
    recordingDuration,
    setRecordingDuration,
    incrementDuration,
    cameraShape,
    cameraSize,
    cameraPosition,
    zoomConfig,
    isZooming,
    setIsZooming,
    backgroundConfig,
    outputResolution,
  } = useStore();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tickWorkerRef = useRef<Worker | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);

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

  const startRecording = async () => {
    if (!canStartRecording) return;

    setRecordingState('preparing');
    recordedChunksRef.current = [];

    try {
      const streams: MediaStream[] = [];
      let screenStream: MediaStream | null = null;
      let cameraStream: MediaStream | null = null;
      let audioStream: MediaStream | null = null;

      // Get screen stream (video only - system audio on Windows is unreliable)
      if (showScreen && selectedSource) {
        if (isElectron) {
          screenStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: selectedSource.id,
              },
            } as MediaTrackConstraints,
          });
          streams.push(screenStream);
        } else {
          // Web: reuse the shared webScreenStream (don't push to streams[] so we don't stop it)
          screenStream = useStore.getState().webScreenStream;
          if (!screenStream) {
            throw new Error('No screen stream available. Please select a source first.');
          }
        }
      }

      // Get camera stream with high frame rate
      if (showCamera) {
        cameraStream = await navigator.mediaDevices.getUserMedia({
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

      // Create video elements first so we can read their real dimensions
      if (screenStream) {
        const screenVideo = document.createElement('video');
        screenVideo.srcObject = screenStream;
        screenVideo.muted = true;
        await screenVideo.play();
        // Poll until the browser has decoded at least one frame and
        // videoWidth/videoHeight are populated. loadedmetadata alone is
        // not reliable across all browsers.
        await new Promise<void>((resolve) => {
          const check = () => {
            if (screenVideo.videoWidth > 0 && screenVideo.videoHeight > 0) {
              resolve();
            } else {
              requestAnimationFrame(check);
            }
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

      // Use the actual decoded video dimensions — this is the only reliable
      // source and correctly handles all aspect ratios (16:9, 16:10, ultrawide, etc.)
      let screenSize: { width: number; height: number };
      if (screenVideoRef.current) {
        screenSize = {
          width: screenVideoRef.current.videoWidth,
          height: screenVideoRef.current.videoHeight,
        };
      } else {
        screenSize = await platform.getScreenSize();
      }

      // Set up canvas for compositing.
      // Scale the canvas to the target resolution while preserving the EXACT
      // source aspect ratio so drawImage never stretches or leaves gaps.
      const canvas = document.createElement('canvas');

      const { outputResolution: resolution } = useStore.getState();
      const resolutionConfig = resolutionPresets.find((r) => r.id === resolution);

      if (resolution === 'source' || !resolutionConfig || !screenVideoRef.current) {
        // Use exact source pixel dimensions — pixel-perfect, zero distortion
        canvas.width = screenSize.width & ~1;
        canvas.height = screenSize.height & ~1;
      } else {
        // Scale to fit within the preset bounds using a single uniform scale
        // factor so the source aspect ratio is preserved exactly.
        const srcW = screenSize.width;
        const srcH = screenSize.height;
        const scale = Math.min(
          resolutionConfig.width / srcW,
          resolutionConfig.height / srcH
        );

        // Ensure dimensions are even (required by some video codecs)
        canvas.width = Math.round(srcW * scale) & ~1;
        canvas.height = Math.round(srcH * scale) & ~1;
      }

      console.log(`Recording at resolution: ${canvas.width}x${canvas.height} (source: ${screenSize.width}x${screenSize.height})`);

      const ctx = canvas.getContext('2d')!;
      canvasRef.current = canvas;

      // Load background image if needed
      const { backgroundConfig: bgConfig } = useStore.getState();
      const allBackgrounds = [...defaultBackgrounds, ...bgConfig.customBackgrounds];
      const selectedBg = allBackgrounds.find((bg) => bg.id === bgConfig.selectedId);

      if (bgConfig.enabled && selectedBg && selectedBg.type === 'image') {
        const img = new Image();
        img.src = selectedBg.value;
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
        backgroundImageRef.current = img;
      }

      // Helper function to draw rounded rectangle
      const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      };

      // Helper function to parse CSS gradient and draw it
      const drawGradient = (gradientStr: string) => {
        // Parse linear-gradient(135deg, #667eea 0%, #764ba2 100%)
        const match = gradientStr.match(/linear-gradient\((\d+)deg,\s*(.+)\)/);
        if (!match) return;

        const angle = parseInt(match[1]);
        const colorStops = match[2].split(',').map(s => s.trim());

        // Convert angle to coordinates
        const angleRad = (angle - 90) * Math.PI / 180;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const length = Math.sqrt(canvas.width * canvas.width + canvas.height * canvas.height) / 2;

        const x1 = centerX - Math.cos(angleRad) * length;
        const y1 = centerY - Math.sin(angleRad) * length;
        const x2 = centerX + Math.cos(angleRad) * length;
        const y2 = centerY + Math.sin(angleRad) * length;

        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);

        colorStops.forEach(stop => {
          const parts = stop.match(/(#[a-fA-F0-9]+)\s+(\d+)%/);
          if (parts) {
            gradient.addColorStop(parseInt(parts[2]) / 100, parts[1]);
          }
        });

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      };

      // Drawing function
      const drawFrame = () => {
        const { zoomConfig: zoom, backgroundConfig: bg, isZooming } = useStore.getState();
        const allBgs = [...defaultBackgrounds, ...bg.customBackgrounds];
        const currentBg = allBgs.find((b) => b.id === bg.selectedId);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw background if enabled (for screen modes only)
        if (bg.enabled && currentBg && showScreen) {
          if (currentBg.type === 'gradient') {
            drawGradient(currentBg.value);
          } else if (currentBg.type === 'image' && backgroundImageRef.current) {
            // Draw image covering the canvas
            const img = backgroundImageRef.current;
            const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
            const x = (canvas.width - img.width * scale) / 2;
            const y = (canvas.height - img.height * scale) / 2;
            ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
          }
        }

        // Draw screen
        if (screenVideoRef.current) {
          const padding = bg.enabled ? bg.padding * (canvas.width / 1200) : 0;
          const radius = bg.enabled ? bg.borderRadius * (canvas.width / 1200) : 0;
          const titleBarHeight = bg.enabled ? 40 * (canvas.width / 1200) : 0;

          const windowX = padding;
          const windowY = padding;
          const windowW = canvas.width - padding * 2;
          const windowH = canvas.height - padding * 2;

          // Draw window container with shadow if background enabled
          if (bg.enabled) {
            ctx.save();

            // Draw drop shadow
            ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
            ctx.shadowBlur = 40 * (canvas.width / 1200);
            ctx.shadowOffsetY = 20 * (canvas.width / 1200);

            // Draw window background (for shadow)
            ctx.fillStyle = '#1e1e1e';
            roundRect(windowX, windowY, windowW, windowH, radius);
            ctx.fill();

            ctx.restore();

            // Draw title bar
            ctx.save();
            ctx.beginPath();
            // Top rounded corners only for title bar
            ctx.moveTo(windowX + radius, windowY);
            ctx.lineTo(windowX + windowW - radius, windowY);
            ctx.quadraticCurveTo(windowX + windowW, windowY, windowX + windowW, windowY + radius);
            ctx.lineTo(windowX + windowW, windowY + titleBarHeight);
            ctx.lineTo(windowX, windowY + titleBarHeight);
            ctx.lineTo(windowX, windowY + radius);
            ctx.quadraticCurveTo(windowX, windowY, windowX + radius, windowY);
            ctx.closePath();
            ctx.fillStyle = '#2d2d2d';
            ctx.fill();

            // Draw traffic light buttons
            const buttonRadius = 7 * (canvas.width / 1200);
            const buttonSpacing = 22 * (canvas.width / 1200);
            const buttonStartX = windowX + 18 * (canvas.width / 1200);
            const buttonY = windowY + titleBarHeight / 2;

            // Close button (red)
            ctx.beginPath();
            ctx.arc(buttonStartX, buttonY, buttonRadius, 0, Math.PI * 2);
            ctx.fillStyle = '#ff5f56';
            ctx.fill();

            // Minimize button (yellow)
            ctx.beginPath();
            ctx.arc(buttonStartX + buttonSpacing, buttonY, buttonRadius, 0, Math.PI * 2);
            ctx.fillStyle = '#ffbd2e';
            ctx.fill();

            // Maximize button (green)
            ctx.beginPath();
            ctx.arc(buttonStartX + buttonSpacing * 2, buttonY, buttonRadius, 0, Math.PI * 2);
            ctx.fillStyle = '#27ca3f';
            ctx.fill();

            ctx.restore();
          }

          // Draw screen content
          ctx.save();

          const contentX = windowX;
          const contentY = windowY + titleBarHeight;
          const contentW = windowW;
          const contentH = windowH - titleBarHeight;

          // Clip to content area with bottom rounded corners
          if (bg.enabled) {
            ctx.beginPath();
            ctx.moveTo(contentX, contentY);
            ctx.lineTo(contentX + contentW, contentY);
            ctx.lineTo(contentX + contentW, contentY + contentH - radius);
            ctx.quadraticCurveTo(contentX + contentW, contentY + contentH, contentX + contentW - radius, contentY + contentH);
            ctx.lineTo(contentX + radius, contentY + contentH);
            ctx.quadraticCurveTo(contentX, contentY + contentH, contentX, contentY + contentH - radius);
            ctx.lineTo(contentX, contentY);
            ctx.closePath();
            ctx.clip();
          }

          if (zoom.enabled && isZooming && zoom.x !== undefined) {
            const zoomX = contentX + (zoom.x / 100) * contentW;
            const zoomY = contentY + (zoom.y / 100) * contentH;
            ctx.translate(zoomX, zoomY);
            ctx.scale(zoom.scale, zoom.scale);
            ctx.translate(-zoomX, -zoomY);
          }

          if (bg.enabled) {
            // Preserve the video's native aspect ratio inside the content area
            // so the title bar doesn't cause horizontal stretching.
            const vidW = screenVideoRef.current.videoWidth;
            const vidH = screenVideoRef.current.videoHeight;
            const vidAspect = vidW / vidH;
            const areaAspect = contentW / contentH;

            let drawX = contentX;
            let drawY = contentY;
            let drawW = contentW;
            let drawH = contentH;

            if (vidAspect > areaAspect) {
              // Video wider than area — fit to width, center vertically
              drawH = contentW / vidAspect;
              drawY = contentY + (contentH - drawH) / 2;
            } else {
              // Video taller than area — fit to height, center horizontally
              drawW = contentH * vidAspect;
              drawX = contentX + (contentW - drawW) / 2;
            }

            ctx.drawImage(screenVideoRef.current, drawX, drawY, drawW, drawH);
          } else {
            ctx.drawImage(screenVideoRef.current, 0, 0, canvas.width, canvas.height);
          }

          ctx.restore();
        }

        // Draw camera overlay (for screen-camera mode)
        if (cameraVideoRef.current && recordingMode === 'screen-camera') {
          const { cameraPosition: pos, cameraSize: size, cameraShape: shape, previewDimensions } =
            useStore.getState();

          ctx.save();

          // Calculate position proportional to canvas size using actual preview dimensions
          const scaleX = canvas.width / previewDimensions.width;
          const scaleY = canvas.height / previewDimensions.height;
          const scale = Math.min(scaleX, scaleY);
          const scaledSize = size * scale;
          const scaledX = pos.x * scaleX;
          const scaledY = pos.y * scaleY;

          // Apply shape clipping
          ctx.beginPath();
          switch (shape) {
            case 'circle':
              ctx.arc(
                scaledX + scaledSize / 2,
                scaledY + scaledSize / 2,
                scaledSize / 2,
                0,
                Math.PI * 2
              );
              break;
            case 'rounded':
              ctx.roundRect(scaledX, scaledY, scaledSize, scaledSize, 16 * scale);
              break;
            default:
              ctx.arc(
                scaledX + scaledSize / 2,
                scaledY + scaledSize / 2,
                scaledSize / 2,
                0,
                Math.PI * 2
              );
          }
          ctx.clip();

          // Mirror the camera and draw with proper aspect ratio (crop to fit)
          const video = cameraVideoRef.current;
          const videoWidth = video.videoWidth;
          const videoHeight = video.videoHeight;

          // Calculate crop region to maintain aspect ratio (center crop)
          let srcX = 0, srcY = 0, srcW = videoWidth, srcH = videoHeight;
          if (videoWidth > videoHeight) {
            // Video is wider - crop sides
            srcX = (videoWidth - videoHeight) / 2;
            srcW = videoHeight;
          } else {
            // Video is taller - crop top/bottom
            srcY = (videoHeight - videoWidth) / 2;
            srcH = videoWidth;
          }

          ctx.translate(scaledX + scaledSize, scaledY);
          ctx.scale(-1, 1);
          ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, scaledSize, scaledSize);

          ctx.restore();
        }

        // Camera only mode - full canvas
        if (cameraVideoRef.current && recordingMode === 'camera') {
          ctx.save();
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(cameraVideoRef.current, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        }

        // Use setInterval instead of requestAnimationFrame for reliable background recording
        // requestAnimationFrame gets throttled when window is minimized
      };

      // Get canvas stream - use 0 to capture frame on every draw call
      // This works better with pause/resume than a fixed frame rate
      const canvasStream = canvas.captureStream(0);

      // Get the video track to manually request frames
      const videoTrack = canvasStream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };

      // Use a Web Worker for the tick so the drawing loop isn't throttled
      // when the browser tab is in the background.
      const worker = new Worker(
        new URL('../workers/tick.worker.ts', import.meta.url),
        { type: 'module' }
      );
      tickWorkerRef.current = worker;

      worker.onmessage = () => {
        drawFrame();
        if (videoTrack.requestFrame) {
          videoTrack.requestFrame();
        }
      };
      const { recordingFps } = useStore.getState();
      worker.postMessage(recordingFps);

      // Combine audio tracks
      const combinedStream = new MediaStream();
      canvasStream.getVideoTracks().forEach((track) => {
        combinedStream.addTrack(track);
      });

      // Add microphone audio
      if (audioStream) {
        const micTracks = audioStream.getAudioTracks();
        console.log('Microphone tracks found:', micTracks.length);
        micTracks.forEach((track) => {
          console.log('Adding mic track:', track.label, 'enabled:', track.enabled, 'readyState:', track.readyState, 'muted:', track.muted);
          combinedStream.addTrack(track);
        });
      }

      // Log all audio tracks in combined stream
      const allAudioTracks = combinedStream.getAudioTracks();
      console.log('Total audio tracks in recording:', allAudioTracks.length);
      allAudioTracks.forEach((track, i) => {
        console.log(`Audio track ${i}:`, track.label, 'enabled:', track.enabled, 'readyState:', track.readyState);
      });

      // Create MediaRecorder with audio+video codecs
      const preferredMimeType = 'video/webm;codecs=vp9,opus';
      const actualMimeType = MediaRecorder.isTypeSupported(preferredMimeType)
        ? preferredMimeType
        : 'video/webm;codecs=vp8,opus';

      // Calculate video bitrate based on resolution
      const pixels = canvas.width * canvas.height;
      let videoBitrate: number;
      if (pixels >= 3840 * 2160) {
        videoBitrate = 35000000; // 35 Mbps for 4K
      } else if (pixels >= 2560 * 1440) {
        videoBitrate = 16000000; // 16 Mbps for 1440p
      } else if (pixels >= 1920 * 1080) {
        videoBitrate = 8000000; // 8 Mbps for 1080p
      } else {
        videoBitrate = 5000000; // 5 Mbps for 720p and below
      }

      console.log('Using mimeType:', actualMimeType, 'bitrate:', videoBitrate);

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: actualMimeType,
        videoBitsPerSecond: videoBitrate,
        audioBitsPerSecond: 192000,
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
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

        // Save recording directly as WebM (no conversion needed)
        const recordedMimeType = mediaRecorder.mimeType || 'video/webm;codecs=vp9,opus';
        const blob = new Blob(recordedChunksRef.current, { type: recordedMimeType });
        console.log('Saving blob with mimeType:', blob.type, 'size:', blob.size);
        const arrayBuffer = await blob.arrayBuffer();

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const sep = isElectron ? '\\' : '/';
        const webmFile = `${outputFolder}${sep}FancyCapture_${timestamp}.webm`;

        // Save WebM file directly
        const saveResult = await platform.saveFile(webmFile, arrayBuffer);

        if (saveResult.success) {
          console.log('Recording saved:', saveResult.path);
        } else {
          console.error('Failed to save recording:', saveResult.error);
        }

        stopAllStreams();
        setRecordingState('idle');
        setRecordingDuration(0);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000);

      // Start duration timer
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

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      setRecordingState('paused');
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      durationIntervalRef.current = window.setInterval(() => {
        incrementDuration();
      }, 1000);
      setRecordingState('recording');
    }
  }, [incrementDuration]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
  }, []);

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
    const showCamera = recordingMode === 'screen-camera' || recordingMode === 'camera';
    platform.sendRecordingState({
      recordingState,
      duration: recordingDuration,
      showCamera,
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

          {/* Zoom toggle — visible when zoom is enabled in settings */}
          {zoomConfig.enabled && showScreen && (
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
