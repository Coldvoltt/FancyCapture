import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getFFmpegPath } from './ffmpeg-path';

export interface RecordingConfig {
  mode: 'screen' | 'camera' | 'screen-camera';
  // Screen capture
  screenSource: { id: string; name: string; isScreen: boolean } | null;
  // Camera (dshow device label, NOT device ID)
  cameraLabel: string | null;
  cameraSize: number;
  cameraPosition: { x: number; y: number };
  cameraShape: 'circle' | 'rounded';
  // Audio
  microphoneLabel: string | null;
  // Output
  outputFolder: string;
  outputResolution: 'source' | '720p' | '1080p' | '1440p' | '4k';
  fps: number;
  // Preview dimensions for scaling camera position
  previewWidth: number;
  previewHeight: number;
  // When true, floating camera bubble is shown on screen and captured by gdigrab
  // so FFmpeg should NOT add its own camera overlay (avoids double camera)
  useFloatingCamera?: boolean;
  // Constrain gdigrab to a specific region (for single-monitor capture)
  screenRegion?: { x: number; y: number; w: number; h: number };
  // Pre-rendered background PNG (base64 data URL) and content area for overlay
  backgroundData?: string;
  // Foreground overlay PNG for corner clipping (base64 data URL)
  foregroundData?: string;
  backgroundContentArea?: { x: number; y: number; w: number; h: number };
  backgroundOutputSize?: { w: number; h: number };
}

export interface EncoderInfo {
  encoder: string;
  type: 'hardware' | 'software';
}

type RecorderState = 'idle' | 'recording' | 'paused' | 'stopping';

export class FFmpegRecorder {
  private ffmpegPath: string;
  private process: ChildProcess | null = null;
  private segments: string[] = [];
  private segmentIndex = 0;
  private config: RecordingConfig | null = null;
  private outputFile = '';
  private cachedEncoder: EncoderInfo | null = null;
  private state: RecorderState = 'idle';
  private stderrLog = '';
  private onError: ((error: string) => void) | null = null;
  private cachedDshowDevices: { video: string[]; audio: string[] } | null = null;
  private backgroundTempFile: string | null = null;
  private foregroundTempFile: string | null = null;

  constructor() {
    this.ffmpegPath = getFFmpegPath();
    console.log('FFmpeg path:', this.ffmpegPath);
  }

  /**
   * Probe available hardware encoders by attempting a short test encode.
   * Tries NVENC → AMF → QSV → libx264 fallback. Caches result.
   */
  async detectEncoder(): Promise<EncoderInfo> {
    if (this.cachedEncoder) return this.cachedEncoder;

    const candidates: EncoderInfo[] = [
      { encoder: 'h264_nvenc', type: 'hardware' },
      { encoder: 'h264_amf', type: 'hardware' },
      { encoder: 'h264_qsv', type: 'hardware' },
    ];

    for (const candidate of candidates) {
      const works = await this.testEncoder(candidate.encoder);
      if (works) {
        console.log(`Detected hardware encoder: ${candidate.encoder}`);
        this.cachedEncoder = candidate;
        return candidate;
      }
    }

    console.log('No hardware encoder found, falling back to libx264');
    this.cachedEncoder = { encoder: 'libx264', type: 'software' };
    return this.cachedEncoder;
  }

  private testEncoder(encoder: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const proc = spawn(this.ffmpegPath, [
          '-f', 'lavfi', '-i', 'nullsrc=s=256x256:d=0.1',
          '-frames:v', '1',
          '-c:v', encoder,
          '-f', 'null', '-',
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        const timeout = setTimeout(() => {
          proc.kill();
          resolve(false);
        }, 5000);

        proc.on('close', (code) => {
          clearTimeout(timeout);
          resolve(code === 0);
        });

        proc.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });
      } catch {
        resolve(false);
      }
    });
  }

  setErrorHandler(handler: (error: string) => void): void {
    this.onError = handler;
  }

  /**
   * List available dshow video and audio devices by parsing FFmpeg output.
   */
  async listDshowDevices(): Promise<{ video: string[]; audio: string[] }> {
    if (this.cachedDshowDevices) return this.cachedDshowDevices;

    return new Promise((resolve) => {
      const proc = spawn(this.ffmpegPath, [
        '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', () => {
        const video: string[] = [];
        const audio: string[] = [];
        let section: 'video' | 'audio' | null = null;

        for (const line of stderr.split('\n')) {
          if (line.includes('DirectShow video devices')) {
            section = 'video';
          } else if (line.includes('DirectShow audio devices')) {
            section = 'audio';
          } else if (section) {
            // Device names are in quotes: "Device Name"
            const match = line.match(/"\s*(.+?)\s*"/);
            if (match && !line.includes('Alternative name')) {
              (section === 'video' ? video : audio).push(match[1]);
            }
          }
        }

        console.log('dshow video devices:', video);
        console.log('dshow audio devices:', audio);
        this.cachedDshowDevices = { video, audio };
        resolve({ video, audio });
      });

      proc.on('error', () => {
        resolve({ video: [], audio: [] });
      });

      setTimeout(() => {
        try { proc.kill(); } catch { /* ignore */ }
      }, 5000);
    });
  }

  /**
   * Find the best matching dshow device name for a browser label.
   * Browser labels may differ from dshow names (e.g. ® vs (R), extra suffixes).
   */
  private matchDshowDevice(browserLabel: string, dshowDevices: string[]): string | null {
    if (!browserLabel) return null;

    // Exact match first
    const exact = dshowDevices.find(d => d === browserLabel);
    if (exact) return exact;

    // Normalize for comparison: lowercase, strip special chars
    const normalize = (s: string) => s.toLowerCase()
      .replace(/®/g, '(r)')
      .replace(/™/g, '(tm)')
      .replace(/[^\w\s()]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const normalizedLabel = normalize(browserLabel);

    // Try normalized exact match
    const normalizedMatch = dshowDevices.find(d => normalize(d) === normalizedLabel);
    if (normalizedMatch) return normalizedMatch;

    // Try substring match: browser label contains dshow name or vice versa
    const substringMatch = dshowDevices.find(d =>
      normalizedLabel.includes(normalize(d)) || normalize(d).includes(normalizedLabel)
    );
    if (substringMatch) return substringMatch;

    return null;
  }

  async start(config: RecordingConfig): Promise<{ success: boolean; error?: string }> {
    if (this.state !== 'idle') {
      return { success: false, error: `Cannot start: recorder is ${this.state}` };
    }

    if (!config.outputFolder) {
      return { success: false, error: 'Output folder is not set' };
    }

    console.log('FFmpegRecorder.start() config:', JSON.stringify({
      mode: config.mode,
      screenSource: config.screenSource ? { name: config.screenSource.name, isScreen: config.screenSource.isScreen } : null,
      cameraLabel: config.cameraLabel,
      microphoneLabel: config.microphoneLabel,
      outputFolder: config.outputFolder,
      fps: config.fps,
    }));

    // Validate and match dshow device names
    // Skip camera validation when floating camera bubble handles it
    const needsCamera = config.cameraLabel
      && (config.mode === 'camera' || config.mode === 'screen-camera')
      && !config.useFloatingCamera;
    const needsMic = !!config.microphoneLabel;

    if (needsCamera || needsMic) {
      const devices = await this.listDshowDevices();

      if (needsCamera && config.cameraLabel) {
        const matched = this.matchDshowDevice(config.cameraLabel, devices.video);
        if (matched) {
          console.log(`Camera: browser="${config.cameraLabel}" → dshow="${matched}"`);
          config.cameraLabel = matched;
        } else {
          return {
            success: false,
            error: `Camera "${config.cameraLabel}" not found in dshow devices.\n\nAvailable video devices: ${devices.video.map(d => `"${d}"`).join(', ') || 'none'}`,
          };
        }
      }

      if (needsMic && config.microphoneLabel) {
        const matched = this.matchDshowDevice(config.microphoneLabel, devices.audio);
        if (matched) {
          console.log(`Mic: browser="${config.microphoneLabel}" → dshow="${matched}"`);
          config.microphoneLabel = matched;
        } else {
          return {
            success: false,
            error: `Microphone "${config.microphoneLabel}" not found in dshow devices.\n\nAvailable audio devices: ${devices.audio.map(d => `"${d}"`).join(', ') || 'none'}`,
          };
        }
      }
    }

    this.config = config;
    this.segments = [];
    this.segmentIndex = 0;

    // Generate output filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.outputFile = path.join(config.outputFolder, `FancyCapture_${timestamp}.mp4`);

    // Ensure output directory exists
    try {
      await fs.promises.mkdir(config.outputFolder, { recursive: true });
    } catch (err) {
      return { success: false, error: `Cannot create output folder: ${err}` };
    }

    // Save background and foreground PNGs to temp files if provided
    this.backgroundTempFile = null;
    this.foregroundTempFile = null;
    if (config.backgroundData && config.backgroundContentArea) {
      try {
        const ts = Date.now();
        const bgPath = path.join(config.outputFolder, `_bg_temp_${ts}.png`);
        const base64 = config.backgroundData.split(',')[1];
        if (base64) {
          await fs.promises.writeFile(bgPath, Buffer.from(base64, 'base64'));
          this.backgroundTempFile = bgPath;
          console.log('Background saved to:', bgPath);
        }
        // Save foreground corner-clip overlay
        if (config.foregroundData) {
          const fgPath = path.join(config.outputFolder, `_fg_temp_${ts}.png`);
          const fgBase64 = config.foregroundData.split(',')[1];
          if (fgBase64) {
            await fs.promises.writeFile(fgPath, Buffer.from(fgBase64, 'base64'));
            this.foregroundTempFile = fgPath;
            console.log('Foreground saved to:', fgPath);
          }
        }
      } catch (err) {
        console.error('Failed to save background/foreground temp files:', err);
      }
    }

    return this.startSegment();
  }

  private async startSegment(): Promise<{ success: boolean; error?: string }> {
    const config = this.config!;
    const segmentPath = this.getSegmentPath();
    this.segments.push(segmentPath);

    const encoder = await this.detectEncoder();
    const args = this.buildArgs(config, segmentPath, encoder);

    const cmdLine = `${this.ffmpegPath} ${args.join(' ')}`;
    console.log('FFmpeg command:', cmdLine);

    // Write debug log to output folder
    const debugLogPath = segmentPath.replace(/\.mp4$/, '_ffmpeg_debug.log');
    fs.promises.writeFile(debugLogPath, `FFmpeg command:\n${cmdLine}\n\n`).catch(() => {});

    return new Promise((resolve) => {
      try {
        this.stderrLog = '';
        this.process = spawn(this.ffmpegPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let resolved = false;

        this.process.stderr?.on('data', (data: Buffer) => {
          const text = data.toString();
          this.stderrLog += text;

          // Once we see frame output, recording has started successfully
          if (!resolved && /frame=\s*\d+/.test(this.stderrLog)) {
            resolved = true;
            this.state = 'recording';
            resolve({ success: true });
          }
        });

        this.process.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            this.state = 'idle';
            resolve({ success: false, error: `Failed to spawn FFmpeg: ${err.message}` });
          }
        });

        this.process.on('close', (code) => {
          // Append stderr to debug log
          fs.promises.appendFile(debugLogPath, `\nExit code: ${code}\nStderr:\n${this.stderrLog}\n`).catch(() => {});

          if (!resolved) {
            resolved = true;
            this.state = 'idle';
            // Include stderr details in all error messages for debugging
            const stderrSummary = this.getStderrSummary();
            if (this.stderrLog.includes('Could not find')) {
              if (this.stderrLog.includes('window')) {
                resolve({ success: false, error: `Window not found. The window title may have changed.\n\nDetails: ${stderrSummary}` });
              } else {
                resolve({ success: false, error: `Device not found. Check camera/microphone settings.\n\nDetails: ${stderrSummary}` });
              }
            } else {
              resolve({ success: false, error: `FFmpeg exited with code ${code}.\n\nDetails: ${stderrSummary}` });
            }
          } else if (this.state === 'recording') {
            // Unexpected exit during recording
            if (code !== 0 && this.onError) {
              this.onError(`FFmpeg crashed with code ${code}`);
            }
            this.state = 'idle';
          }
        });

        // Give FFmpeg time to start, then timeout if no frames
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            if (this.stderrLog.includes('Could not find')) {
              this.process?.kill();
              this.state = 'idle';
              resolve({ success: false, error: 'Window or device not found.' });
            } else if (this.stderrLog.includes('real-time buffer')) {
              // gdigrab is running but hasn't encoded a frame yet — likely still OK
              this.state = 'recording';
              resolve({ success: true });
            } else {
              // Still starting, give it the benefit of the doubt
              this.state = 'recording';
              resolve({ success: true });
            }
          }
        }, 5000);
      } catch (err) {
        this.state = 'idle';
        resolve({ success: false, error: `Exception spawning FFmpeg: ${err}` });
      }
    });
  }

  async pause(): Promise<{ success: boolean; error?: string }> {
    if (this.state !== 'recording' || !this.process) {
      return { success: false, error: `Cannot pause: recorder is ${this.state}` };
    }

    this.state = 'paused';
    this.gracefulStop();
    await this.waitForExit();
    this.process = null;
    this.segmentIndex++;
    return { success: true };
  }

  async resume(): Promise<{ success: boolean; error?: string }> {
    if (this.state !== 'paused') {
      return { success: false, error: `Cannot resume: recorder is ${this.state}` };
    }

    return this.startSegment();
  }

  async stop(): Promise<{ success: boolean; outputPath?: string; error?: string }> {
    if (this.state !== 'recording' && this.state !== 'paused') {
      return { success: false, error: `Cannot stop: recorder is ${this.state}` };
    }

    this.state = 'stopping';

    // If currently recording, stop the FFmpeg process
    if (this.process) {
      this.gracefulStop();
      await this.waitForExit();
      this.process = null;
    }

    // If multiple segments, concatenate
    if (this.segments.length > 1) {
      try {
        await this.concatSegments();
      } catch (err) {
        this.state = 'idle';
        return { success: false, error: `Concatenation failed: ${err}`, outputPath: this.segments[0] };
      }
    } else if (this.segments.length === 1) {
      // Single segment — rename to final output path
      const seg = this.segments[0];
      if (seg !== this.outputFile) {
        try {
          await fs.promises.rename(seg, this.outputFile);
        } catch {
          // If rename fails (e.g., cross-device), the segment path IS the output
          this.outputFile = seg;
        }
      }
    }

    // Clean up background and foreground temp files
    if (this.backgroundTempFile) {
      try { await fs.promises.unlink(this.backgroundTempFile); } catch { /* ignore */ }
      this.backgroundTempFile = null;
    }
    if (this.foregroundTempFile) {
      try { await fs.promises.unlink(this.foregroundTempFile); } catch { /* ignore */ }
      this.foregroundTempFile = null;
    }

    this.state = 'idle';
    return { success: true, outputPath: this.outputFile };
  }

  getState(): RecorderState {
    return this.state;
  }

  private buildArgs(config: RecordingConfig, outputPath: string, encoder: EncoderInfo): string[] {
    const args: string[] = ['-y', '-sws_flags', 'fast_bilinear']; // Overwrite output, fast scaler

    const hasScreen = config.mode === 'screen' || config.mode === 'screen-camera';
    // Skip camera in FFmpeg when floating camera bubble handles it (desktop capture)
    const hasCamera = config.cameraLabel
      && (config.mode === 'camera' || config.mode === 'screen-camera')
      && !config.useFloatingCamera;
    const hasMic = !!config.microphoneLabel;
    const hasBackground = !!this.backgroundTempFile && !!config.backgroundContentArea;

    // Track input indices for filter mapping
    let inputIndex = 0;
    let bgInputIdx = -1;
    let screenInputIdx = -1;
    let cameraInputIdx = -1;
    let micInputIdx = -1;

    // --- Inputs ---

    // Background image (if enabled) — static PNG looped as base layer
    if (hasBackground) {
      args.push('-loop', '1', '-framerate', String(config.fps), '-i', this.backgroundTempFile!);
      bgInputIdx = inputIndex++;
    }

    // Screen input (gdigrab)
    // Each input uses its own device timestamps. The setpts/asetpts filters
    // in the output normalize both to start at PTS=0, and aresample=async
    // handles any ongoing clock drift — no wallclock override needed.
    if (hasScreen) {
      args.push('-thread_queue_size', '512');
      args.push('-f', 'gdigrab');
      args.push('-framerate', String(config.fps));
      args.push('-draw_mouse', '1');

      if (config.screenSource && !config.screenSource.isScreen) {
        // Window capture by title
        args.push('-i', `title=${config.screenSource.name}`);
      } else {
        // Desktop capture — constrain to selected monitor region to avoid
        // capturing the entire virtual desktop on multi-monitor setups
        if (config.screenRegion) {
          args.push('-offset_x', String(config.screenRegion.x));
          args.push('-offset_y', String(config.screenRegion.y));
          args.push('-video_size', `${config.screenRegion.w}x${config.screenRegion.h}`);
        }
        args.push('-i', 'desktop');
      }
      screenInputIdx = inputIndex++;
    }

    // Camera input (dshow)
    // NOTE: Do NOT specify -video_size or -framerate — some cameras (e.g. OV01AS)
    // reject specific settings with I/O errors. Let FFmpeg negotiate the camera's
    // defaults; the crop filter in buildFilterGraph handles sizing to square.
    if (hasCamera) {
      args.push('-thread_queue_size', '512');
      args.push('-f', 'dshow');
      args.push('-rtbufsize', '100M');
      args.push('-i', `video=${config.cameraLabel}`);
      cameraInputIdx = inputIndex++;
    }

    // Microphone input (dshow)
    if (hasMic) {
      args.push('-thread_queue_size', '512');
      args.push('-f', 'dshow');
      args.push('-i', `audio=${config.microphoneLabel}`);
      micInputIdx = inputIndex++;
    }

    // --- Filters and mapping ---

    if (hasBackground && hasScreen) {
      // Background mode: overlay screen on pre-rendered background PNG
      const ca = config.backgroundContentArea!;
      let filterParts: string[] = [];

      // Normalize screen PTS to start at 0 (eliminates startup offset), then scale
      filterParts.push(`[${screenInputIdx}:v]setpts=PTS-STARTPTS,scale=${ca.w}:${ca.h}[screen]`);

      // Overlay screen on background
      filterParts.push(`[${bgInputIdx}:v][screen]overlay=${ca.x}:${ca.y}:shortest=1[bg_out]`);

      let lastLabel = 'bg_out';

      // If camera overlay needed (window capture mode with camera)
      if (hasCamera && cameraInputIdx >= 0) {
        const camFilterGraph = this.buildFilterGraph(config, -1, cameraInputIdx, lastLabel);
        filterParts.push(camFilterGraph);
        lastLabel = 'out';
      }

      // Offset audio PTS by 1s to compensate for gdigrab→dshow startup delay,
      // aresample fills the gap with silence and corrects ongoing drift
      if (micInputIdx >= 0) {
        filterParts.push(`[${micInputIdx}:a]asetpts=PTS-STARTPTS+1/TB,aresample=async=1000,apad[aout]`);
      }

      args.push('-filter_complex', filterParts.join(';'));
      args.push('-map', `[${lastLabel}]`);
      if (micInputIdx >= 0) {
        args.push('-map', '[aout]');
        args.push('-shortest');
      }
    } else if (config.mode === 'screen-camera' && hasScreen && hasCamera) {
      // Screen + camera overlay with filter graph (no background)
      const filterGraph = this.buildFilterGraph(config, screenInputIdx, cameraInputIdx);
      // Offset audio PTS by 1s to compensate for gdigrab→dshow startup delay
      const audioFilter = micInputIdx >= 0 ? `;[${micInputIdx}:a]asetpts=PTS-STARTPTS+1/TB,aresample=async=1000,apad[aout]` : '';
      args.push('-filter_complex', filterGraph + audioFilter);
      args.push('-map', '[out]');
      if (micInputIdx >= 0) {
        args.push('-map', '[aout]');
        args.push('-shortest');
      }
    } else if (config.mode === 'camera' && hasCamera) {
      // Camera-only: normalize PTS to eliminate startup offset, then hflip
      args.push('-vf', 'setpts=PTS-STARTPTS,hflip');
      args.push('-map', `${cameraInputIdx}:v`);
      if (micInputIdx >= 0) {
        args.push('-map', `${micInputIdx}:a`);
        args.push('-af', 'asetpts=PTS-STARTPTS,aresample=async=1000,apad');
        args.push('-shortest');
      }
    } else {
      // Screen-only (or fallback): normalize PTS to eliminate startup offset
      if (screenInputIdx >= 0) {
        args.push('-map', `${screenInputIdx}:v`);
        args.push('-vf', 'setpts=PTS-STARTPTS');
      }
      if (micInputIdx >= 0) {
        args.push('-map', `${micInputIdx}:a`);
        // Offset audio by 1s to compensate for gdigrab→dshow startup delay
        args.push('-af', 'asetpts=PTS-STARTPTS+1/TB,aresample=async=1000,apad');
        args.push('-shortest');
      }
    }

    // --- Resolution scaling (only when no background — background already sets output size) ---
    if (!hasBackground && config.outputResolution !== 'source' && hasScreen && config.mode !== 'screen-camera') {
      const res = this.getResolution(config.outputResolution);
      if (res) {
        const existingVf = args.indexOf('-vf');
        if (existingVf >= 0) {
          args[existingVf + 1] += `,scale=${res.w}:${res.h}:force_original_aspect_ratio=decrease,pad=${res.w}:${res.h}:(ow-iw)/2:(oh-ih)/2`;
        } else {
          args.push('-vf', `scale=${res.w}:${res.h}:force_original_aspect_ratio=decrease,pad=${res.w}:${res.h}:(ow-iw)/2:(oh-ih)/2`);
        }
      }
    }

    // --- Encoding ---
    args.push('-threads', '0'); // Auto-detect thread count
    args.push('-c:v', encoder.encoder);

    if (encoder.encoder === 'libx264') {
      args.push('-preset', 'ultrafast');
      args.push('-crf', '18');
    } else if (encoder.encoder === 'h264_nvenc') {
      args.push('-preset', 'p4');
      args.push('-cq', '18');
      args.push('-rc', 'vbr');
    } else if (encoder.encoder === 'h264_amf') {
      args.push('-quality', 'speed');
      args.push('-rc', 'cqp');
      args.push('-qp_i', '18');
      args.push('-qp_p', '18');
    } else if (encoder.encoder === 'h264_qsv') {
      args.push('-preset', 'fast');
      args.push('-global_quality', '18');
    }

    args.push('-pix_fmt', 'yuv420p');

    // Fragmented MP4: crash-safe segments (data is usable even if process is killed)
    args.push('-movflags', '+frag_keyframe+empty_moov+default_base_moof');

    // Audio encoding
    if (hasMic) {
      args.push('-c:a', 'aac');
      args.push('-b:a', '192k');
    }

    args.push(outputPath);
    return args;
  }

  private buildFilterGraph(config: RecordingConfig, screenIdx: number, camIdx: number, baseLabel?: string): string {
    // Scale camera position and size from preview coordinates to output coordinates.
    // When background is enabled (baseLabel provided), map to full background output size
    // so the camera can extend into the padding area. Otherwise map to screen resolution.
    let targetW = 1920, targetH = 1080;
    if (baseLabel && config.backgroundOutputSize) {
      targetW = config.backgroundOutputSize.w;
      targetH = config.backgroundOutputSize.h;
    } else if (config.outputResolution !== 'source') {
      const res = this.getResolution(config.outputResolution);
      if (res) { targetW = res.w; targetH = res.h; }
    }
    const scaleFactor = Math.min(targetW / config.previewWidth, targetH / config.previewHeight);
    const camSize = Math.round(config.cameraSize * scaleFactor);
    const r = Math.floor(camSize / 2);
    const camX = Math.round(config.cameraPosition.x * (targetW / config.previewWidth));
    const camY = Math.round(config.cameraPosition.y * (targetH / config.previewHeight));

    // Center-crop camera to square first (avoids squeezing 16:9 into a square),
    // then scale to the target size
    const cropAndScale = `crop='min(iw,ih)':'min(iw,ih)',scale=${camSize}:${camSize}`;

    let camFilter: string;
    if (config.cameraShape === 'circle') {
      // Circle mask using geq alpha filter; setpts normalizes PTS to start at 0
      camFilter = [
        `[${camIdx}:v]setpts=PTS-STARTPTS,hflip,${cropAndScale},format=yuva420p,`,
        `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':`,
        `a='if(lte(pow(X-${r},2)+pow(Y-${r},2),pow(${r},2)),255,0)'`,
        `[cam]`,
      ].join('');
    } else {
      // Rounded rectangle — crop to square, scale, no mask; setpts normalizes PTS
      camFilter = `[${camIdx}:v]setpts=PTS-STARTPTS,hflip,${cropAndScale}[cam]`;
    }

    // When baseLabel is provided (background mode), overlay camera on that label
    if (baseLabel) {
      return `${camFilter};[${baseLabel}][cam]overlay=${camX}:${camY}[out]`;
    }

    // Apply resolution scaling to screen if needed; setpts normalizes PTS to start at 0
    let screenFilter = '';
    if (config.outputResolution !== 'source') {
      const res = this.getResolution(config.outputResolution);
      if (res) {
        screenFilter = `[${screenIdx}:v]setpts=PTS-STARTPTS,scale=${res.w}:${res.h}:force_original_aspect_ratio=decrease,pad=${res.w}:${res.h}:(ow-iw)/2:(oh-ih)/2[screen];`;
        return `${screenFilter}${camFilter};[screen][cam]overlay=${camX}:${camY}[out]`;
      }
    }

    return `${camFilter};[${screenIdx}:v]setpts=PTS-STARTPTS[sp];[sp][cam]overlay=${camX}:${camY}[out]`;
  }

  private getResolution(preset: string): { w: number; h: number } | null {
    const map: Record<string, { w: number; h: number }> = {
      '720p': { w: 1280, h: 720 },
      '1080p': { w: 1920, h: 1080 },
      '1440p': { w: 2560, h: 1440 },
      '4k': { w: 3840, h: 2160 },
    };
    return map[preset] || null;
  }

  private getSegmentPath(): string {
    if (this.segments.length === 0) {
      // First segment: use a temp name if pause/resume might happen
      const ext = path.extname(this.outputFile);
      const base = this.outputFile.slice(0, -ext.length);
      return `${base}_seg${this.segmentIndex}${ext}`;
    }
    const ext = path.extname(this.outputFile);
    const base = this.outputFile.slice(0, -ext.length);
    return `${base}_seg${this.segmentIndex}${ext}`;
  }

  private async concatSegments(): Promise<void> {
    // Write concat list file
    const listPath = this.outputFile.replace('.mp4', '_segments.txt');
    const listContent = this.segments
      .map((seg) => `file '${seg.replace(/\\/g, '/')}'`)
      .join('\n');
    await fs.promises.writeFile(listPath, listContent, 'utf-8');

    // Concatenate with copy (no re-encoding)
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        this.outputFile,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Concat exited with code ${code}`));
      });

      proc.on('error', (err) => reject(err));
    });

    // Clean up segment files and list file
    for (const seg of this.segments) {
      try { await fs.promises.unlink(seg); } catch { /* ignore */ }
    }
    try { await fs.promises.unlink(listPath); } catch { /* ignore */ }
  }

  private gracefulStop(): void {
    if (!this.process) return;

    // Try stdin 'q' first (graceful FFmpeg quit)
    try {
      this.process.stdin?.write('q\n');
    } catch {
      // stdin might be closed, fall back to kill
      try { this.process.kill(); } catch { /* ignore */ }
    }
  }

  private waitForExit(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const proc = this.process;

      const timeout = setTimeout(() => {
        // Force kill if graceful quit didn't work within 5 seconds
        try { proc.kill(); } catch { /* ignore */ }
        resolve();
      }, 5000);

      proc.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });

      // Also handle case where process is already dead
      if (proc.exitCode !== null) {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  /**
   * Post-process: overlay a separately-recorded camera WebM on top of the
   * screen MP4 at the given position. Used in background mode where the
   * floating camera bubble can't be positioned in the padding area.
   */
  async postProcessCamera(config: {
    screenPath: string;
    cameraPath: string;
    outputPath: string;
    cameraSize: number;
    cameraPosition: { x: number; y: number };
    cameraShape: 'circle' | 'rounded';
    outputWidth: number;
    outputHeight: number;
    previewWidth: number;
    previewHeight: number;
  }): Promise<{ success: boolean; outputPath?: string; error?: string }> {
    const encoder = await this.detectEncoder();

    // If input and output are the same file, rename the input to a temp path
    // so FFmpeg can read the input while writing the output
    let actualScreenPath = config.screenPath;
    if (path.resolve(config.screenPath) === path.resolve(config.outputPath)) {
      actualScreenPath = config.screenPath.replace(/\.mp4$/, '_screen_temp.mp4');
      try {
        await fs.promises.rename(config.screenPath, actualScreenPath);
        console.log('Renamed screen file for post-processing:', config.screenPath, '→', actualScreenPath);
      } catch (err) {
        return { success: false, error: `Failed to rename screen file for post-processing: ${err}` };
      }
    }

    // Map camera preview position → output pixel coordinates
    const scaleX = config.outputWidth / config.previewWidth;
    const scaleY = config.outputHeight / config.previewHeight;
    const scaleFactor = Math.min(scaleX, scaleY);
    const camSize = Math.round(config.cameraSize * scaleFactor);
    const r = Math.floor(camSize / 2);
    const camX = Math.round(config.cameraPosition.x * scaleX);
    const camY = Math.round(config.cameraPosition.y * scaleY);

    const cropAndScale = `crop='min(iw,ih)':'min(iw,ih)',scale=${camSize}:${camSize}`;

    let camFilter: string;
    if (config.cameraShape === 'circle') {
      camFilter = [
        `[1:v]hflip,${cropAndScale},format=yuva420p,`,
        `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':`,
        `a='if(lte(pow(X-${r},2)+pow(Y-${r},2),pow(${r},2)),255,0)'`,
        `[cam]`,
      ].join('');
    } else {
      camFilter = `[1:v]hflip,${cropAndScale}[cam]`;
    }

    const filterComplex = `${camFilter};[0:v][cam]overlay=${camX}:${camY}[out]`;

    const args: string[] = [
      '-y',
      '-i', actualScreenPath,
      '-i', config.cameraPath,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-map', '0:a?',
      '-c:v', encoder.encoder,
    ];

    // Encoder-specific settings
    if (encoder.encoder === 'libx264') {
      args.push('-preset', 'fast', '-crf', '18');
    } else if (encoder.encoder === 'h264_nvenc') {
      args.push('-preset', 'p4', '-cq', '18', '-rc', 'vbr');
    } else if (encoder.encoder === 'h264_amf') {
      args.push('-quality', 'speed', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '18');
    } else if (encoder.encoder === 'h264_qsv') {
      args.push('-preset', 'fast', '-global_quality', '18');
    }

    args.push('-pix_fmt', 'yuv420p');
    args.push('-c:a', 'copy');
    args.push('-movflags', '+faststart');
    args.push(config.outputPath);

    console.log('Post-process camera command:', this.ffmpegPath, args.join(' '));

    return new Promise((resolve) => {
      try {
        const proc = spawn(this.ffmpegPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stderr = '';
        proc.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0) {
            // Clean up temp files
            try { fs.unlinkSync(actualScreenPath); } catch { /* ignore */ }
            try { fs.unlinkSync(config.cameraPath); } catch { /* ignore */ }
            resolve({ success: true, outputPath: config.outputPath });
          } else {
            const errLines = stderr.split('\n').filter(l =>
              /error|could not|cannot|failed|invalid/i.test(l)
            ).slice(-5).join('\n');
            resolve({ success: false, error: `Post-process failed (code ${code}): ${errLines || stderr.slice(-500)}` });
          }
        });

        proc.on('error', (err) => {
          resolve({ success: false, error: `Failed to spawn FFmpeg for post-processing: ${err.message}` });
        });

        // Timeout: 5 minutes max for post-processing
        setTimeout(() => {
          try { proc.kill(); } catch { /* ignore */ }
          resolve({ success: false, error: 'Post-processing timed out after 5 minutes' });
        }, 300000);
      } catch (err) {
        resolve({ success: false, error: `Exception during post-processing: ${err}` });
      }
    });
  }

  private getStderrSummary(): string {
    // Return last meaningful lines from stderr, focusing on error info
    const lines = this.stderrLog.split('\n').filter(l => l.trim());
    // Look for lines containing error-related keywords
    const errorLines = lines.filter(l =>
      /error|could not|cannot|failed|invalid|not found|denied/i.test(l)
    );
    if (errorLines.length > 0) {
      return errorLines.slice(-5).join('\n');
    }
    return lines.slice(-5).join('\n');
  }
}
