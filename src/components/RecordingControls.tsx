import { useRef, useEffect, useCallback } from 'react';
import { useStore, defaultBackgrounds, resolutionPresets } from '../store/useStore';
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
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const fileStreamRef = useRef<FileStreamHandle | null>(null);

  // Refs for Electron post-process camera overlay (background mode)
  const cameraRecorderRef = useRef<MediaRecorder | null>(null);
  const cameraChunksRef = useRef<Blob[]>([]);
  const camerStreamRef = useRef<MediaStream | null>(null);
  const postProcessConfigRef = useRef<{
    cameraSize: number;
    cameraPosition: { x: number; y: number };
    cameraShape: string;
    outputWidth: number;
    outputHeight: number;
    previewWidth: number;
    previewHeight: number;
  } | null>(null);

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

  /**
   * Render background + window chrome as a static PNG for FFmpeg to use as base layer.
   * Returns { dataUrl, contentArea } or null if background is not enabled.
   */
  const renderBackgroundPng = async (
    outputW: number,
    outputH: number,
    bg: typeof defaultBackgrounds[0] | undefined,
    bgConfig: { padding: number; borderRadius: number },
  ): Promise<{ dataUrl: string; contentArea: { x: number; y: number; w: number; h: number }; outputSize: { w: number; h: number } } | null> => {
    if (!bg) return null;

    const canvas = document.createElement('canvas');
    canvas.width = outputW;
    canvas.height = outputH;
    const ctx = canvas.getContext('2d')!;

    // Scale factor based on 1200px reference width (matches Preview layout)
    const sf = canvas.width / 1200;
    const p = bgConfig.padding * sf;
    const r = bgConfig.borderRadius * sf;
    const tbh = 40 * sf; // title bar height

    // Draw background fill
    if (bg.type === 'gradient') {
      const match = bg.value.match(/linear-gradient\((\d+)deg,\s*(.+)\)/);
      if (match) {
        const angle = parseInt(match[1]);
        const angleRad = ((angle - 90) * Math.PI) / 180;
        const cx = canvas.width / 2, cy = canvas.height / 2;
        const len = Math.sqrt(canvas.width * canvas.width + canvas.height * canvas.height) / 2;
        const grad = ctx.createLinearGradient(
          cx - Math.cos(angleRad) * len, cy - Math.sin(angleRad) * len,
          cx + Math.cos(angleRad) * len, cy + Math.sin(angleRad) * len,
        );
        match[2].split(',').map(s => s.trim()).forEach(stop => {
          const parts = stop.match(/(#[a-fA-F0-9]+)\s+(\d+)%/);
          if (parts) grad.addColorStop(parseInt(parts[2]) / 100, parts[1]);
        });
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    } else if (bg.type === 'image') {
      const img = new Image();
      img.src = bg.value;
      await new Promise<void>(resolve => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
      if (img.naturalWidth > 0) {
        const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
        ctx.drawImage(img,
          (canvas.width - img.width * scale) / 2,
          (canvas.height - img.height * scale) / 2,
          img.width * scale, img.height * scale,
        );
      }
    }

    // Draw window chrome (shadow + title bar + traffic lights)
    const wx = p, wy = p, ww = canvas.width - p * 2, wh = canvas.height - p * 2;

    // Window shadow — fully rounded corners (all 4)
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 40 * sf;
    ctx.shadowOffsetY = 20 * sf;
    ctx.fillStyle = '#1e1e1e';
    ctx.beginPath();
    ctx.moveTo(wx + r, wy); ctx.lineTo(wx + ww - r, wy);
    ctx.quadraticCurveTo(wx + ww, wy, wx + ww, wy + r); ctx.lineTo(wx + ww, wy + wh - r);
    ctx.quadraticCurveTo(wx + ww, wy + wh, wx + ww - r, wy + wh); ctx.lineTo(wx + r, wy + wh);
    ctx.quadraticCurveTo(wx, wy + wh, wx, wy + wh - r); ctx.lineTo(wx, wy + r);
    ctx.quadraticCurveTo(wx, wy, wx + r, wy);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // Title bar
    ctx.beginPath();
    ctx.moveTo(wx + r, wy); ctx.lineTo(wx + ww - r, wy);
    ctx.quadraticCurveTo(wx + ww, wy, wx + ww, wy + r); ctx.lineTo(wx + ww, wy + tbh);
    ctx.lineTo(wx, wy + tbh); ctx.lineTo(wx, wy + r);
    ctx.quadraticCurveTo(wx, wy, wx + r, wy);
    ctx.closePath(); ctx.fillStyle = '#2d2d2d'; ctx.fill();

    // Traffic light buttons
    const br = 7 * sf, bs = 22 * sf, bx = wx + 18 * sf, by = wy + tbh / 2;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fillStyle = '#ff5f56'; ctx.fill();
    ctx.beginPath(); ctx.arc(bx + bs, by, br, 0, Math.PI * 2); ctx.fillStyle = '#ffbd2e'; ctx.fill();
    ctx.beginPath(); ctx.arc(bx + bs * 2, by, br, 0, Math.PI * 2); ctx.fillStyle = '#27ca3f'; ctx.fill();

    // Content area (where screen capture will be overlaid by FFmpeg).
    // Compute from window edges. Stop before bottom rounded corners (leave r pixels
    // of window fill visible as a small bottom bar — prevents screen bleeding).
    const caX = Math.round(wx);
    const caY = Math.round(wy + tbh);
    const caRight = Math.round(wx + ww);
    const caBottom = Math.round(wy + wh - r);
    let caW = caRight - caX;
    let caH = caBottom - caY;
    // Make width/height even for FFmpeg codec compatibility
    if (caW % 2 !== 0) caW--;
    if (caH % 2 !== 0) caH--;
    const contentArea = { x: caX, y: caY, w: caW, h: caH };

    return {
      dataUrl: canvas.toDataURL('image/png'),
      contentArea,
      outputSize: { w: canvas.width, h: canvas.height },
    };
  };

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

      // Render background PNG if background is enabled and we're recording screen
      let backgroundData: string | undefined;
      let backgroundContentArea: { x: number; y: number; w: number; h: number } | undefined;
      let backgroundOutputSize: { w: number; h: number } | undefined;
      const hasScreen = state.recordingMode === 'screen' || state.recordingMode === 'screen-camera';
      const hasBackgroundEnabled = hasScreen && state.backgroundConfig.enabled;

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

      // Get screen size once — used for both background rendering and gdigrab region
      const screenSize = hasScreen ? await platform.getScreenSize() : null;
      const physicalScreenW = screenSize ? Math.round(screenSize.width * screenSize.scaleFactor) : 0;
      const physicalScreenH = screenSize ? Math.round(screenSize.height * screenSize.scaleFactor) : 0;

      if (hasBackgroundEnabled) {
        const allBgs = [...defaultBackgrounds, ...state.backgroundConfig.customBackgrounds];
        const selectedBg = allBgs.find(bg => bg.id === state.backgroundConfig.selectedId);

        if (selectedBg) {
          const srcW = physicalScreenW;
          const srcH = physicalScreenH;

          // The background canvas includes padding + title bar around the content area.
          // We must size the canvas so the CONTENT AREA matches the screen's aspect ratio.
          const bgPadding = state.backgroundConfig.padding;
          const TITLE_BAR_REF = 40;
          const REF_WIDTH = 1200;

          const resPreset = resolutionPresets.find(r => r.id === state.outputResolution);

          // Step 1: Determine target content area dimensions (must match screen aspect ratio)
          let contentW: number, contentH: number;
          if (!resPreset || resPreset.id === 'source' || resPreset.width === 0) {
            // Cap content height for performance (filter_complex + scaling is expensive)
            const maxContentH = 720;
            if (srcH > maxContentH) {
              const scale = maxContentH / srcH;
              contentW = Math.round(srcW * scale);
              contentH = maxContentH;
            } else {
              contentW = srcW;
              contentH = srcH;
            }
          } else {
            const scale = Math.min(resPreset.width / srcW, resPreset.height / srcH);
            contentW = Math.round(srcW * scale);
            contentH = Math.round(srcH * scale);
          }

          // Step 2: Derive full canvas size from content area + padding + title bar + bottom radius
          // The bottom radius is reserved for the rounded corner strip (not part of content area)
          let outW = Math.round(contentW / (1 - 2 * bgPadding / REF_WIDTH));
          const sf = outW / REF_WIDTH;
          const paddingPx = Math.round(bgPadding * sf);
          const tbhPx = Math.round(TITLE_BAR_REF * sf);
          const borderRadiusPx = Math.round(state.backgroundConfig.borderRadius * sf);
          let outH = contentH + 2 * paddingPx + tbhPx + borderRadiusPx;

          // Make dimensions even for FFmpeg
          outW = outW & ~1;
          outH = outH & ~1;

          const bgResult = await renderBackgroundPng(outW, outH, selectedBg, state.backgroundConfig);
          if (bgResult) {
            backgroundData = bgResult.dataUrl;
            backgroundContentArea = bgResult.contentArea;
            backgroundOutputSize = bgResult.outputSize;
          }
        }
      }

      // Cap fps when background is enabled — filter_complex + scaling can't keep up at 30fps
      const effectiveFps = hasBackgroundEnabled ? Math.min(state.recordingFps, 24) : state.recordingFps;

      // Compute screen capture region for gdigrab (constrains to single monitor)
      let screenRegion: { x: number; y: number; w: number; h: number } | undefined;
      if (hasScreen && isDesktopCapture && physicalScreenW > 0) {
        screenRegion = { x: 0, y: 0, w: physicalScreenW, h: physicalScreenH };
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
        backgroundData,
        backgroundContentArea,
        backgroundOutputSize,
      };

      console.log('Starting FFmpeg recording with config:', { ...config, backgroundData: backgroundData ? `(${Math.round(backgroundData.length / 1024)}KB PNG)` : undefined });

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

      // Determine if we need post-process camera (background mode + camera)
      // In this case, record camera separately via MediaRecorder and overlay after FFmpeg stops
      const usePostProcessCamera = hasBackgroundEnabled && needsCameraForRecording && backgroundOutputSize;

      if (usePostProcessCamera) {
        // Start camera MediaRecorder separately — will be overlaid in post-processing
        try {
          const camStream = await navigator.mediaDevices.getUserMedia({
            video: state.selectedCamera
              ? { deviceId: { exact: state.selectedCamera }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
              : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
            audio: false,
          });
          camerStreamRef.current = camStream;
          cameraChunksRef.current = [];

          const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
            ? 'video/webm;codecs=vp8'
            : 'video/webm';
          const camRecorder = new MediaRecorder(camStream, {
            mimeType,
            videoBitsPerSecond: 2000000,
          });

          camRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) cameraChunksRef.current.push(e.data);
          };
          camRecorder.start(1000); // 1s timeslice for regular chunks
          cameraRecorderRef.current = camRecorder;

          // Store post-process config
          postProcessConfigRef.current = {
            cameraSize: state.cameraSize,
            cameraPosition: state.cameraPosition,
            cameraShape: state.cameraShape,
            outputWidth: backgroundOutputSize!.w,
            outputHeight: backgroundOutputSize!.h,
            previewWidth: state.previewDimensions.width,
            previewHeight: state.previewDimensions.height,
          };
        } catch (err) {
          console.warn('Failed to start camera MediaRecorder for post-processing, continuing without camera:', err);
          postProcessConfigRef.current = null;
        }
      } else if (effectiveUseFloatingCamera) {
        // Show floating camera bubble for desktop screen-camera mode (non-background)
        platform.showCameraBubble({
          deviceId: state.selectedCamera,
          shape: state.cameraShape,
          size: state.cameraSize,
          position: state.cameraPosition,
          previewWidth: state.previewDimensions.width,
          previewHeight: state.previewDimensions.height,
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
    // Also pause camera MediaRecorder if running (post-process mode)
    if (cameraRecorderRef.current && cameraRecorderRef.current.state === 'recording') {
      cameraRecorderRef.current.pause();
    }
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
    // Resume camera MediaRecorder if in post-process mode
    if (cameraRecorderRef.current && cameraRecorderRef.current.state === 'paused') {
      cameraRecorderRef.current.resume();
    } else {
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
        });
      }
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

    // Stop camera MediaRecorder if running (post-process mode)
    let cameraBlob: Blob | null = null;
    if (cameraRecorderRef.current && cameraRecorderRef.current.state !== 'inactive') {
      // Wait for final data chunk before building blob
      await new Promise<void>((resolve) => {
        const recorder = cameraRecorderRef.current!;
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      if (cameraChunksRef.current.length > 0) {
        cameraBlob = new Blob(cameraChunksRef.current, { type: 'video/webm' });
      }
      cameraRecorderRef.current = null;
      cameraChunksRef.current = [];
    }
    // Stop camera stream tracks
    if (camerStreamRef.current) {
      camerStreamRef.current.getTracks().forEach(t => t.stop());
      camerStreamRef.current = null;
    }

    // Stop FFmpeg screen recording
    const result = await platform.ffmpegStopRecording();

    // Post-process: overlay camera on screen recording
    if (result.success && cameraBlob && postProcessConfigRef.current && result.outputPath) {
      setRecordingState('converting');
      try {
        // Save camera blob to temp file
        const cameraBuffer = await cameraBlob.arrayBuffer();
        const cameraTempPath = result.outputPath.replace(/\.mp4$/, '_cam_temp.webm');
        const saveResult = await platform.saveFile(cameraTempPath, cameraBuffer);
        if (!saveResult.success) {
          console.error('Failed to save camera temp file:', saveResult.error);
        } else {
          // Run post-processing: overlay camera onto screen recording.
          // postProcessCamera handles the case where screenPath === outputPath
          // by renaming the screen file to a temp path before processing.
          const ppConfig = postProcessConfigRef.current;
          const ppResult = await platform.ffmpegPostProcessCamera({
            screenPath: result.outputPath,
            cameraPath: cameraTempPath,
            outputPath: result.outputPath,
            cameraSize: ppConfig.cameraSize,
            cameraPosition: ppConfig.cameraPosition,
            cameraShape: ppConfig.cameraShape,
            outputWidth: ppConfig.outputWidth,
            outputHeight: ppConfig.outputHeight,
            previewWidth: ppConfig.previewWidth,
            previewHeight: ppConfig.previewHeight,
          });
          if (ppResult.success) {
            console.log('Post-processed recording saved:', ppResult.outputPath);
          } else {
            console.error('Post-processing failed:', ppResult.error);
            // The original screen recording still exists as fallback
            console.log('Original screen recording available at:', result.outputPath);
          }
        }
      } catch (err) {
        console.error('Post-processing error:', err);
      }
      postProcessConfigRef.current = null;
    } else if (result.success) {
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

      const { backgroundConfig: bgConfig, zoomConfig: zoomCfg } = useStore.getState();
      const needsCompositing =
        recordingMode === 'screen-camera' ||
        (showScreen && bgConfig.enabled) ||
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

        // Gradient cache
        let cachedGradientSource = '';
        let cachedGradientCoords: { x1: number; y1: number; x2: number; y2: number } | null = null;
        let cachedGradientStops: Array<{ color: string; offset: number }> = [];

        const drawGradient = (gradientStr: string) => {
          if (gradientStr !== cachedGradientSource) {
            const match = gradientStr.match(/linear-gradient\((\d+)deg,\s*(.+)\)/);
            if (!match) return;
            const angle = parseInt(match[1]);
            const angleRad = ((angle - 90) * Math.PI) / 180;
            const cx2 = canvas.width / 2, cy2 = canvas.height / 2;
            const len = Math.sqrt(canvas.width * canvas.width + canvas.height * canvas.height) / 2;
            cachedGradientCoords = {
              x1: cx2 - Math.cos(angleRad) * len, y1: cy2 - Math.sin(angleRad) * len,
              x2: cx2 + Math.cos(angleRad) * len, y2: cy2 + Math.sin(angleRad) * len,
            };
            cachedGradientStops = [];
            match[2].split(',').map((s) => s.trim()).forEach((stop) => {
              const parts = stop.match(/(#[a-fA-F0-9]+)\s+(\d+)%/);
              if (parts) cachedGradientStops.push({ color: parts[1], offset: parseInt(parts[2]) / 100 });
            });
            cachedGradientSource = gradientStr;
          }
          if (!cachedGradientCoords) return;
          const { x1, y1, x2, y2 } = cachedGradientCoords;
          const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
          cachedGradientStops.forEach((s) => gradient.addColorStop(s.offset, s.color));
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        };

        // Pre-rendered window chrome cache
        let windowChromeCanvas: HTMLCanvasElement | null = null;
        let windowChromeKey = '';
        const getWindowChrome = (bg: { padding: number; borderRadius: number }) => {
          const key = `${bg.padding}-${bg.borderRadius}`;
          if (windowChromeCanvas && key === windowChromeKey) return windowChromeCanvas;
          const sf = canvas.width / 1200;
          const p = bg.padding * sf, r = bg.borderRadius * sf, tbh = 40 * sf;
          const wx = p, wy = p, ww = canvas.width - p * 2, wh = canvas.height - p * 2;
          const oc = document.createElement('canvas');
          oc.width = canvas.width; oc.height = canvas.height;
          const o = oc.getContext('2d')!;
          o.save(); o.shadowColor = 'rgba(0,0,0,0.4)'; o.shadowBlur = 40 * sf; o.shadowOffsetY = 20 * sf;
          o.fillStyle = '#1e1e1e'; o.beginPath();
          o.moveTo(wx + r, wy); o.lineTo(wx + ww - r, wy);
          o.quadraticCurveTo(wx + ww, wy, wx + ww, wy + r); o.lineTo(wx + ww, wy + wh - r);
          o.quadraticCurveTo(wx + ww, wy + wh, wx + ww - r, wy + wh); o.lineTo(wx + r, wy + wh);
          o.quadraticCurveTo(wx, wy + wh, wx, wy + wh - r); o.lineTo(wx, wy + r);
          o.quadraticCurveTo(wx, wy, wx + r, wy); o.closePath(); o.fill(); o.restore();
          o.beginPath(); o.moveTo(wx + r, wy); o.lineTo(wx + ww - r, wy);
          o.quadraticCurveTo(wx + ww, wy, wx + ww, wy + r); o.lineTo(wx + ww, wy + tbh);
          o.lineTo(wx, wy + tbh); o.lineTo(wx, wy + r);
          o.quadraticCurveTo(wx, wy, wx + r, wy); o.closePath(); o.fillStyle = '#2d2d2d'; o.fill();
          const br = 7 * sf, bs = 22 * sf, bx = wx + 18 * sf, by = wy + tbh / 2;
          o.beginPath(); o.arc(bx, by, br, 0, Math.PI * 2); o.fillStyle = '#ff5f56'; o.fill();
          o.beginPath(); o.arc(bx + bs, by, br, 0, Math.PI * 2); o.fillStyle = '#ffbd2e'; o.fill();
          o.beginPath(); o.arc(bx + bs * 2, by, br, 0, Math.PI * 2); o.fillStyle = '#27ca3f'; o.fill();
          windowChromeCanvas = oc; windowChromeKey = key; return oc;
        };

        const drawFrame = () => {
          const state = useStore.getState();
          const { zoomConfig: zoom, backgroundConfig: bg, isZooming: currentlyZooming,
                  cameraPosition: pos, cameraSize: size, cameraShape: shape, previewDimensions } = state;
          const allBgs = [...defaultBackgrounds, ...bg.customBackgrounds];
          const currentBg = allBgs.find((b) => b.id === bg.selectedId);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (bg.enabled && currentBg && showScreen) {
            if (currentBg.type === 'gradient') drawGradient(currentBg.value);
            else if (currentBg.type === 'image' && backgroundImageRef.current) {
              const img = backgroundImageRef.current;
              const is2 = Math.max(canvas.width / img.width, canvas.height / img.height);
              ctx.drawImage(img, (canvas.width - img.width * is2) / 2, (canvas.height - img.height * is2) / 2, img.width * is2, img.height * is2);
            }
          }
          if (screenVideoRef.current) {
            const sf = canvas.width / 1200;
            const pad = bg.enabled ? bg.padding * sf : 0;
            const rad = bg.enabled ? bg.borderRadius * sf : 0;
            const tbh = bg.enabled ? 40 * sf : 0;
            const wx = pad, wy = pad, ww = canvas.width - pad * 2, wh = canvas.height - pad * 2;
            if (bg.enabled) ctx.drawImage(getWindowChrome(bg), 0, 0);
            ctx.save();
            const cx2 = wx, cy2 = wy + tbh, cw = ww, ch = wh - tbh;
            if (bg.enabled) {
              ctx.beginPath(); ctx.moveTo(cx2, cy2); ctx.lineTo(cx2 + cw, cy2);
              ctx.lineTo(cx2 + cw, cy2 + ch - rad);
              ctx.quadraticCurveTo(cx2 + cw, cy2 + ch, cx2 + cw - rad, cy2 + ch);
              ctx.lineTo(cx2 + rad, cy2 + ch);
              ctx.quadraticCurveTo(cx2, cy2 + ch, cx2, cy2 + ch - rad);
              ctx.lineTo(cx2, cy2); ctx.closePath(); ctx.clip();
            }
            if (zoom.enabled && currentlyZooming && zoom.x !== undefined) {
              const zx = cx2 + (zoom.x / 100) * cw, zy = cy2 + (zoom.y / 100) * ch;
              ctx.translate(zx, zy); ctx.scale(zoom.scale, zoom.scale); ctx.translate(-zx, -zy);
            }
            if (bg.enabled) {
              const vw = screenVideoRef.current.videoWidth, vh = screenVideoRef.current.videoHeight;
              const va = vw / vh, aa = cw / ch;
              let dx = cx2, dy = cy2, dw = cw, dh = ch;
              if (va > aa) { dh = cw / va; dy = cy2 + (ch - dh) / 2; }
              else { dw = ch * va; dx = cx2 + (cw - dw) / 2; }
              ctx.drawImage(screenVideoRef.current, dx, dy, dw, dh);
            } else {
              ctx.drawImage(screenVideoRef.current, 0, 0, canvas.width, canvas.height);
            }
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
      // Clean up post-process camera recorder if running
      if (cameraRecorderRef.current && cameraRecorderRef.current.state !== 'inactive') {
        cameraRecorderRef.current.stop();
        cameraRecorderRef.current = null;
      }
      if (camerStreamRef.current) {
        camerStreamRef.current.getTracks().forEach(t => t.stop());
        camerStreamRef.current = null;
      }
      cameraChunksRef.current = [];
      postProcessConfigRef.current = null;
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
