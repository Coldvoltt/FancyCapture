import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Resolves the FFmpeg binary path, handling both development
 * and ASAR-packaged scenarios.
 *
 * In dev: uses @ffmpeg-installer/ffmpeg's resolved path
 * In packaged: looks for ffmpeg.exe in the resources directory (--extra-resource)
 */
export function getFFmpegPath(): string {
  const binary = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

  if (app.isPackaged) {
    // Packaged builds: --extra-resource places the binary in the resources/ directory
    const resourcePath = path.join(process.resourcesPath, binary);
    if (fs.existsSync(resourcePath)) {
      console.log('FFmpeg found at:', resourcePath);
      return resourcePath;
    }

    // Fallback: check ASAR-unpacked paths (in case --asar-unpack-dir is used instead)
    const platformDir = `${process.platform}-${process.arch}`;
    const asarUnpackedPath = path.join(
      app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
      'node_modules', '@ffmpeg-installer', platformDir, binary
    );
    if (fs.existsSync(asarUnpackedPath)) {
      console.log('FFmpeg found at:', asarUnpackedPath);
      return asarUnpackedPath;
    }

    console.error(`FFmpeg not found in packaged build. Checked: ${resourcePath}, ${asarUnpackedPath}`);
    throw new Error(`FFmpeg binary not found in packaged build. Checked: ${resourcePath}`);
  }

  // Development: use @ffmpeg-installer/ffmpeg's resolved path
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer?.path && fs.existsSync(installer.path)) {
      console.log('FFmpeg found at:', installer.path);
      return installer.path;
    }
  } catch (err) {
    console.error('Failed to load @ffmpeg-installer/ffmpeg:', err);
  }

  // Last resort: manual resolution
  const platformDir = `${process.platform}-${process.arch}`;
  const devPath = path.join(
    app.getAppPath(), 'node_modules', '@ffmpeg-installer', platformDir, binary
  );
  if (fs.existsSync(devPath)) {
    console.log('FFmpeg found at:', devPath);
    return devPath;
  }

  throw new Error(`FFmpeg binary not found. Searched for ${binary} in multiple locations.`);
}
