import { execFile } from 'child_process';
import path from 'path';

/**
 * Sanitized shell execution for ffmpeg commands.
 * Uses execFile (NOT exec) to prevent command injection by avoiding shell interpretation.
 * File paths are validated before use.
 */

const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9._\-\s/\\:]+$/;

function validatePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  // Check for null bytes (common injection technique)
  if (resolved.includes('\0')) {
    throw new Error(`Invalid file path: contains null bytes`);
  }
  // Check for shell metacharacters in basename
  const basename = path.basename(resolved);
  if (!SAFE_FILENAME_REGEX.test(basename)) {
    throw new Error(`Invalid filename: "${basename}" contains unsafe characters`);
  }
  return resolved;
}

/**
 * Execute ffmpeg with safe argument passing.
 * Uses execFile which does NOT invoke a shell, preventing command injection.
 */
export function safeExecFfmpeg(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: 120000 }, (error, _stdout, stderr) => {
      if (error) {
        console.error('[ffmpeg] Execution failed:', error.message);
        if (stderr) console.error('[ffmpeg] stderr:', stderr);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Transcode audio to 16kHz mono WAV (optimal for speech-to-text).
 */
export async function transcodeToWav(inputPath: string, outputPath: string): Promise<void> {
  const safeInput = validatePath(inputPath);
  const safeOutput = validatePath(outputPath);
  await safeExecFfmpeg(['-y', '-i', safeInput, '-vn', '-ar', '16000', '-ac', '1', safeOutput]);
}

/**
 * Transcode audio to MP3 (for Google Drive / CDN upload).
 */
export async function transcodeToMp3(inputPath: string, outputPath: string): Promise<void> {
  const safeInput = validatePath(inputPath);
  const safeOutput = validatePath(outputPath);
  await safeExecFfmpeg(['-y', '-i', safeInput, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '128k', safeOutput]);
}

/**
 * Split audio into chunks of a specified segment duration (in seconds).
 */
export async function chunkAudio(inputPath: string, outputPattern: string, segmentSeconds: number = 600): Promise<void> {
  const safeInput = validatePath(inputPath);
  const safeOutput = validatePath(outputPattern);
  await safeExecFfmpeg(['-y', '-i', safeInput, '-f', 'segment', '-segment_time', String(segmentSeconds), '-c', 'copy', safeOutput]);
}
