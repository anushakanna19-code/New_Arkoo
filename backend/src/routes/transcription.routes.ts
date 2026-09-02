import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getGenAI, generateContentWithResilience } from '../services/gemini.service.js';
import { getOpenaiApiKey, transcribeWithOpenai } from '../services/openai.service.js';
import { UPLOADS_DIR } from '../config/env.js';
import { transcodeToWav } from '../utils/safe-exec.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ─── Live Audio Chunk Transcription ────────────────────────
router.post('/transcribe-chunk', async (req, res) => {
  const { chunkBase64, mimeType, chunkIndex, meetingId = 'temp', knownNames } = req.body;

  if (!chunkBase64) {
    return res.status(400).json({ error: 'Missing chunkBase64 audio data' });
  }

  const safeMeetingId = (meetingId || 'temp').toString().replace(/[^a-zA-Z0-9_-]/g, '') || 'temp';
  const safeChunkIndex = parseInt(chunkIndex, 10) || 0;
  const cleanMimeType = (mimeType || 'audio/webm').split(';')[0];
  const rawExtension = (cleanMimeType.split('/')[1] || 'webm').replace(/[^a-zA-Z0-9]/g, '');

  const chunkRawFilename = `chunk_${safeMeetingId}_${safeChunkIndex}_raw.${rawExtension}`;
  const chunkRawPath = path.join(UPLOADS_DIR, chunkRawFilename);
  const chunkWavFilename = `chunk_${safeMeetingId}_${safeChunkIndex}_converted.wav`;
  const chunkWavPath = path.join(UPLOADS_DIR, chunkWavFilename);

  try {
    // 1. Save raw chunk to disk
    fs.writeFileSync(chunkRawPath, Buffer.from(chunkBase64, 'base64'));

    let finalBase64 = chunkBase64;
    let finalMime = cleanMimeType;

    // 2. Downsample audio using ffmpeg (safe execution)
    try {
      await transcodeToWav(chunkRawPath, chunkWavPath);
      if (fs.existsSync(chunkWavPath)) {
        finalBase64 = fs.readFileSync(chunkWavPath).toString('base64');
        finalMime = 'audio/wav';
      }
    } catch (transcodeErr) {
      logger.warn('TranscriptionRoutes', `ffmpeg transcode failed for chunk ${chunkIndex}, using raw fallback`);
    }

    // 3. Transcribe with OpenAI Whisper or Gemini
    let text = '';
    const openaiKey = getOpenaiApiKey();

    if (openaiKey) {
      try {
        const audioFile = fs.existsSync(chunkWavPath) ? chunkWavPath : chunkRawPath;
        text = await transcribeWithOpenai(audioFile, path.basename(audioFile), knownNames);
        logger.info('TranscriptionRoutes', `Chunk ${chunkIndex} transcribed with OpenAI Whisper: "${text.substring(0, 80)}..."`);
      } catch (openaiErr: any) {
        logger.warn('TranscriptionRoutes', `OpenAI Whisper transcription failed: ${openaiErr.message}. Falling back to Gemini.`);
      }
    }

    if (!text) {
      const ai = getGenAI();
      const response = await generateContentWithResilience(ai, {
        contents: [
          {
            inlineData: { mimeType: finalMime, data: finalBase64 },
          },
          `Transcribe the spoken words in the audio. Keep it completely literal. IMPORTANT: If the speech is in Hindi or Hinglish, write it in Roman/English letters (transliteration) instead of Devanagari script. Output ONLY the raw transcribed text without preamble or markup. If the audio has no human speaking, respond with nothing.${knownNames ? `\n\nKNOWN TEAM MEMBERS: ${knownNames}` : ''}`,
        ],
      });
      text = response.text ? response.text.trim() : '';
      logger.info('TranscriptionRoutes', `Chunk ${chunkIndex} transcribed with Gemini: "${text.substring(0, 80)}..."`);
    }

    // 4. Cleanup temp files
    try {
      if (fs.existsSync(chunkRawPath)) fs.unlinkSync(chunkRawPath);
      if (fs.existsSync(chunkWavPath)) fs.unlinkSync(chunkWavPath);
    } catch (cleanupErr) {
      logger.error('TranscriptionRoutes', 'Chunk cleanup failed', cleanupErr);
    }

    res.json({ text, chunkIndex });
  } catch (err: any) {
    logger.error('TranscriptionRoutes', `Chunk transcription failed for index ${chunkIndex}`, err);
    try {
      if (fs.existsSync(chunkRawPath)) fs.unlinkSync(chunkRawPath);
      if (fs.existsSync(chunkWavPath)) fs.unlinkSync(chunkWavPath);
    } catch (_e) {}
    res.status(500).json({ error: err.message || 'Failed to process audio chunk' });
  }
});

// ─── Task Voice Note Transcription ─────────────────────────
router.post('/tasks/voice-note', async (req, res) => {
  const { audioBase64, mimeType, taskId } = req.body;
  if (!audioBase64) {
    return res.status(400).json({ error: 'Missing audioBase64 content' });
  }

  const safeTaskId = (taskId || 'temp').toString().replace(/[^a-zA-Z0-9_-]/g, '') || 'temp';
  const cleanMimeType = (mimeType || 'audio/webm').split(';')[0];
  const rawExtension = (cleanMimeType.split('/')[1] || 'webm').replace(/[^a-zA-Z0-9]/g, '');
  const filename = `task_${safeTaskId}_voice_${Date.now()}_raw.${rawExtension}`;
  const rawPath = path.join(UPLOADS_DIR, filename);

  const wavFilename = `task_${safeTaskId}_voice_${Date.now()}_converted.wav`;
  const wavPath = path.join(UPLOADS_DIR, wavFilename);

  try {
    fs.writeFileSync(rawPath, Buffer.from(audioBase64, 'base64'));

    let finalBase64 = audioBase64;
    let finalMime = cleanMimeType;
    let usedFilename = filename;

    try {
      await transcodeToWav(rawPath, wavPath);
      if (fs.existsSync(wavPath)) {
        finalBase64 = fs.readFileSync(wavPath).toString('base64');
        finalMime = 'audio/wav';
        usedFilename = wavFilename;
        try { fs.unlinkSync(rawPath); } catch (_e) {}
      }
    } catch (_err) {
      logger.warn('TranscriptionRoutes', 'Voice note transcode failed, using raw fallback');
    }

    const ai = getGenAI();
    let text = '';
    try {
      const response = await generateContentWithResilience(ai, {
        contents: [
          { inlineData: { mimeType: finalMime, data: finalBase64 } },
          'Transcribe the spoken audio text accurately. IMPORTANT: If Hindi or Hinglish, write in Roman/English letters. Return ONLY the transcribed text.',
        ],
      });
      text = response.text ? response.text.trim() : '';
    } catch (aiErr: any) {
      logger.error('TranscriptionRoutes', 'Gemini voice note transcription failed', aiErr);
    }

    res.json({
      audioUrl: `/uploads/${usedFilename}`,
      transcript: text || 'Silence/No speech detected',
    });
  } catch (err: any) {
    logger.error('TranscriptionRoutes', 'Voice note processing failed', err);
    res.status(500).json({ error: err.message || 'Failed to process voice note' });
  }
});

// ─── Serve Audio Files ─────────────────────────────────────
router.get('/audio/:meetingId', (req, res) => {
  const { meetingId } = req.params;
  try {
    const safeMeetingId = (meetingId || '').toString().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeMeetingId) {
      return res.status(400).json({ error: 'Invalid meeting ID' });
    }

    res.setHeader('Accept-Ranges', 'bytes');

    const convertedWavPath = path.join(UPLOADS_DIR, `${safeMeetingId}_converted.wav`);
    const convertedMp3Path = path.join(UPLOADS_DIR, `${safeMeetingId}_converted.mp3`);

    if (fs.existsSync(convertedWavPath)) {
      res.setHeader('Content-Type', 'audio/wav');
      return res.sendFile(convertedWavPath);
    } else if (fs.existsSync(convertedMp3Path)) {
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.sendFile(convertedMp3Path);
    }

    const files = fs.readdirSync(UPLOADS_DIR);
    const rawFile = files.find(f => f.startsWith(`${safeMeetingId}_input.`));
    if (rawFile) {
      const rawPath = path.join(UPLOADS_DIR, rawFile);
      const ext = path.extname(rawFile).substring(1);
      const mime = ext === 'm4a' ? 'audio/m4a' : ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav' : 'audio/webm';
      res.setHeader('Content-Type', mime);
      return res.sendFile(rawPath);
    }

    res.status(404).json({ error: 'Audio recording not found' });
  } catch (error) {
    logger.error('TranscriptionRoutes', 'Error serving audio file', error);
    res.status(500).json({ error: 'Failed to read audio file' });
  }
});

export default router;
