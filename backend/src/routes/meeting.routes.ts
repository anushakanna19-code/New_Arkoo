import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getGenAI, generateContentWithResilience, transcribeWithGemini } from '../services/gemini.service.js';
import { getOpenaiApiKey, transcribeWithOpenai, generateContentWithOpenai } from '../services/openai.service.js';
import { sendTaskAssignmentEmail } from '../services/email.service.js';
import { uploadAudioToCloudinary } from '../services/cloudinary.service.js';
import * as gdrive from '../services/gdrive.service.js';
import { getFirestore, admin } from '../config/firebase.js';
import { UPLOADS_DIR, env } from '../config/env.js';
import { parseRelativeDeadline, formatDeadlineDisplay } from '../utils/date.js';
import { transcodeToWav, transcodeToMp3, chunkAudio } from '../utils/safe-exec.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ─── Helper: Save results to Firestore ─────────────────────
async function saveMeetingResultsToFirestore(
  meetingId: string, result: any, audioUrl?: string | null,
  driveFileId?: string | null, driveFileUrl?: string | null,
  gdriveFolderId?: string | null, gdriveUploadStatus?: string | null,
  gdriveLeafFolderId?: string | null
): Promise<boolean> {
  const dbFirestore = getFirestore();
  if (!dbFirestore || !meetingId) return false;

  try {
    const updateData: any = {
      status: 'completed',
      transcript: result.transcript || 'Transcription could not be generated.',
      mom: (result.mom && typeof result.mom === 'object') ? result.mom : null,
      momText: (result.mom && typeof result.mom === 'string') ? result.mom : null,
      summary: result.summary || 'Summary could not be generated.',
      audioUrl: audioUrl || null,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      tasksCount: Array.isArray(result.tasks) ? result.tasks.length : 0,
    };

    if (driveFileId) updateData.driveFileId = driveFileId;
    if (driveFileUrl) updateData.driveFileUrl = driveFileUrl;
    if (gdriveFolderId) updateData.gdriveFolderId = gdriveFolderId;
    if (gdriveLeafFolderId) updateData.gdriveLeafFolderId = gdriveLeafFolderId;
    if (gdriveUploadStatus) {
      updateData.gdriveUploadStatus = gdriveUploadStatus;
      if (gdriveUploadStatus === 'completed') updateData.gdriveUploadTimestamp = admin.firestore.FieldValue.serverTimestamp();
    } else if (driveFileId) {
      updateData.gdriveUploadStatus = 'completed';
      updateData.gdriveUploadTimestamp = admin.firestore.FieldValue.serverTimestamp();
    }

    await dbFirestore.collection('meetings').doc(meetingId).update(updateData);

    // Add associated tasks
    const tasks: any[] = Array.isArray(result.tasks) ? [...result.tasks] : [];
    const nextStepsList: string[] = Array.isArray(result.mom?.nextSteps) ? result.mom.nextSteps : [];

    for (const step of nextStepsList) {
      if (!step || typeof step !== 'string') continue;
      const lowerStep = step.toLowerCase();
      const exists = tasks.some(t => {
        if (!t) return false;
        const titleLower = String(t.title || '').toLowerCase();
        return titleLower.includes(lowerStep.slice(0, 15)) || lowerStep.includes(titleLower.slice(0, 15));
      });

      if (!exists) {
        let assignee = 'Unassigned';
        let taskTitle = step;
        const nameMatch = step.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:to|will|should|is to)\s+(.+)/i);
        if (nameMatch) {
          assignee = nameMatch[1];
          taskTitle = nameMatch[2].charAt(0).toUpperCase() + nameMatch[2].slice(1);
        }
        tasks.push({ title: taskTitle, description: step, assigneeName: assignee, department: 'Operations', priority: 'high', deadline: 'Friday 5 PM' });
      }
    }

    for (const task of tasks) {
      if (!task || typeof task !== 'object') continue;
      let normalizedPriority = String(task.priority || 'medium').toLowerCase();
      if (normalizedPriority === 'normal') normalizedPriority = 'medium';
      if (!['low', 'medium', 'high', 'critical'].includes(normalizedPriority)) normalizedPriority = 'medium';

      const parsedDeadline = parseRelativeDeadline(task.deadline || 'Friday 5 PM');
      const formattedDeadline = formatDeadlineDisplay(parsedDeadline);

      await dbFirestore.collection('tasks').add({
        title: task.title || 'Untitled Task',
        description: task.description || 'No description provided.',
        meetingId, assigneeName: task.assigneeName || 'Unassigned',
        department: task.department || 'General', priority: normalizedPriority,
        status: 'pending', deadline: formattedDeadline,
        deadlineTimestamp: admin.firestore.Timestamp.fromDate(parsedDeadline),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      sendTaskAssignmentEmail({
        title: task.title || 'Untitled Task', description: task.description || '',
        assigneeName: task.assigneeName || 'Unassigned', deadline: parsedDeadline,
        priority: normalizedPriority, department: task.department || 'General',
        meetingTitle: result.title || 'Meeting MOM',
      }).catch(e => logger.error('MeetingRoutes', 'Async email dispatch error', e));
    }

    logger.info('MeetingRoutes', `Meeting ${meetingId} and ${tasks.length} tasks saved.`);
    return true;
  } catch (err) {
    logger.error('MeetingRoutes', `Failed to save meeting ${meetingId}`, err);
    return false;
  }
}

async function markMeetingAsFailed(meetingId: string, errorMsg: string): Promise<void> {
  const dbFirestore = getFirestore();
  if (!dbFirestore || !meetingId) return;
  try {
    await dbFirestore.collection('meetings').doc(meetingId).update({
      status: 'failed', failureReason: errorMsg || 'Processing failed',
    });
  } catch (err) {
    logger.error('MeetingRoutes', `Failed to mark meeting ${meetingId} as failed`, err);
  }
}

// ─── Process Meeting Pipeline ──────────────────────────────
router.post('/process-meeting', async (req, res) => {
  logger.info('MeetingRoutes', 'Received process-meeting request');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendProgress = (progress: number, label: string) => {
    res.write(JSON.stringify({ progress, label }) + '\n');
  };

  const { meetingId, audioBase64, title, mimeType, audioUrl, preTranscribedText, driveFileUrl, googleAccessToken, knownNames } = req.body;
  const activeToken = await gdrive.resolveActiveToken(googleAccessToken);

  try {
    sendProgress(5, 'Validating recording parameters...');
    const hasPreTranscribedText = !!(preTranscribedText && preTranscribedText.trim());

    if (!audioBase64 && !hasPreTranscribedText && !driveFileUrl) {
      res.write(JSON.stringify({ error: 'No audio data, transcription, or Drive link provided' }) + '\n');
      return res.end();
    }

    const safeMeetingId = (meetingId || 'temp').toString().replace(/[^a-zA-Z0-9_-]/g, '') || 'temp';
    let finalAudioBase64 = audioBase64 || '';
    let finalAudioMime = (mimeType || 'audio/webm').split(';')[0];
    let finalAudioUrl = audioUrl || `/api/audio/${safeMeetingId}`;

    // Handle Google Drive file download
    if (driveFileUrl) {
      if (!activeToken) throw new Error('Missing Google Drive access token.');
      const driveFileId = gdrive.extractDriveFileId(driveFileUrl);
      if (!driveFileId) throw new Error('Invalid Google Drive link format.');

      sendProgress(10, 'Querying Google Drive file...');
      const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=name,mimeType`, {
        headers: { 'Authorization': `Bearer ${activeToken}` },
      });
      if (!metaRes.ok) throw new Error(`Drive metadata failed: ${await metaRes.text()}`);

      const metaData = await metaRes.json() as any;
      if (metaData.mimeType) finalAudioMime = metaData.mimeType.split(';')[0];

      sendProgress(15, 'Downloading audio from Google Drive...');
      const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
        headers: { 'Authorization': `Bearer ${activeToken}` },
      });
      if (!downloadRes.ok) throw new Error(`Drive download failed: ${await downloadRes.text()}`);

      const driveBuffer = Buffer.from(await downloadRes.arrayBuffer());
      if (driveBuffer.length / (1024 * 1024) > 30) throw new Error('File exceeds 30MB limit.');

      finalAudioBase64 = driveBuffer.toString('base64');
      finalAudioUrl = driveFileUrl;

      const extension = (finalAudioMime.split('/')[1]?.split(';')[0] || 'webm').replace(/[^a-zA-Z0-9]/g, '');
      const driveInputPath = path.join(UPLOADS_DIR, `${safeMeetingId}_drive_file.${extension}`);
      fs.writeFileSync(driveInputPath, driveBuffer);

      sendProgress(22, 'Transcoding Drive audio...');
      const convertedWavPath = path.join(UPLOADS_DIR, `${safeMeetingId}_converted.wav`);
      try {
        await transcodeToWav(driveInputPath, convertedWavPath);
        finalAudioBase64 = fs.readFileSync(convertedWavPath).toString('base64');
        finalAudioMime = 'audio/wav';
      } catch {
        logger.warn('MeetingRoutes', 'Drive audio transcode failed, using raw');
      }
    }

    // Handle direct audio upload
    if (audioBase64) {
      const rawExtension = (finalAudioMime.split('/')[1] || 'webm').replace(/[^a-zA-Z0-9]/g, '');
      sendProgress(12, 'Storing recording...');
      const rawInputPath = path.join(UPLOADS_DIR, `${safeMeetingId}_input.${rawExtension}`);
      fs.writeFileSync(rawInputPath, Buffer.from(audioBase64, 'base64'));

      if (!hasPreTranscribedText) {
        sendProgress(20, 'Converting audio format...');
        const convertedWavPath = path.join(UPLOADS_DIR, `${safeMeetingId}_converted.wav`);
        try {
          await transcodeToWav(rawInputPath, convertedWavPath);
          finalAudioBase64 = fs.readFileSync(convertedWavPath).toString('base64');
          finalAudioMime = 'audio/wav';
          finalAudioUrl = `/api/audio/${safeMeetingId}`;
          sendProgress(30, 'Audio converted successfully.');
        } catch {
          logger.warn('MeetingRoutes', 'Audio transcode failed, using raw');
          sendProgress(30, 'Using raw recording...');
        }
      } else {
        sendProgress(25, 'Processing with cached transcription...');
      }
    }

    // Google Drive upload
    sendProgress(40, 'Saving to Google Drive...');
    const cleanTitle = title || `Talk ${new Date().toISOString().slice(0, 10)}`;
    let driveFileId: string | null = null;
    let backupDriveFileUrl: string | null = null;
    let gdriveUploadStatus = 'none';
    let dateFolderId: string | null = null;
    let transcriptText = '';

    if (hasPreTranscribedText) {
      transcriptText = preTranscribedText;
    } else {
      let fileContentBuffer = Buffer.from(finalAudioBase64, 'base64');
      const convertedWavPath = path.join(UPLOADS_DIR, `${meetingId || 'temp'}_converted.wav`);
      if (fs.existsSync(convertedWavPath)) fileContentBuffer = fs.readFileSync(convertedWavPath);

      // Upload to Drive
      if (driveFileUrl) {
        driveFileId = gdrive.extractDriveFileId(driveFileUrl);
        backupDriveFileUrl = driveFileUrl;
        gdriveUploadStatus = 'completed';
      } else if (activeToken && finalAudioBase64) {
        try {
          const now = new Date();
          const [yyyy, mm, dd] = [now.getFullYear().toString(), (now.getMonth() + 1).toString().padStart(2, '0'), now.getDate().toString().padStart(2, '0')];

          // Resolve root folder
          let rootFolderId = '';
          const dbFirestore = getFirestore();
          if (dbFirestore) {
            try {
              const snap = await dbFirestore.collection('settings').doc('gdrive').get();
              if (snap.exists) rootFolderId = snap.data()?.folderId || '';
            } catch (_e) {}
          }
          if (!rootFolderId) {
            const localData = gdrive.loadGDriveSettings();
            rootFolderId = localData?.folderId || '';
          }

          if (rootFolderId) {
            const meetingsFolderId = await gdrive.findOrCreateFolderInDrive(activeToken, 'Meeting Recordings', rootFolderId);
            const yyyyFolderId = await gdrive.findOrCreateFolderInDrive(activeToken, yyyy, meetingsFolderId);
            const mmFolderId = await gdrive.findOrCreateFolderInDrive(activeToken, mm, yyyyFolderId);
            dateFolderId = await gdrive.findOrCreateFolderInDrive(activeToken, dd, mmFolderId);

            // Transcode to MP3 for Drive
            const rawInputPath = path.join(UPLOADS_DIR, `${meetingId || 'temp'}_input.${finalAudioMime.split('/')[1] || 'webm'}`);
            const convertedMp3Path = path.join(UPLOADS_DIR, `${meetingId || 'temp'}_converted.mp3`);
            let uploadBuffer = fileContentBuffer;
            let uploadMime = finalAudioMime;
            let uploadExt = finalAudioMime.split('/')[1] || 'webm';

            try {
              if (!fs.existsSync(convertedMp3Path) && fs.existsSync(rawInputPath)) {
                await transcodeToMp3(rawInputPath, convertedMp3Path);
              }
              if (fs.existsSync(convertedMp3Path)) {
                uploadBuffer = fs.readFileSync(convertedMp3Path);
                uploadMime = 'audio/mpeg'; uploadExt = 'mp3';
              }
            } catch { /* use original */ }

            const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
            const driveFileName = `recording_${meetingId || now.toISOString().slice(0, 10)}_${timeStr}.${uploadExt}`;

            sendProgress(45, 'Uploading MP3 to Google Drive...');
            const driveResult = await gdrive.uploadFileToDriveWithRetry(activeToken, driveFileName, uploadMime, uploadBuffer, dateFolderId);
            driveFileId = driveResult.id;
            backupDriveFileUrl = driveResult.webViewLink;
            gdriveUploadStatus = 'completed';
          }
        } catch (driveErr: any) {
          logger.error('MeetingRoutes', 'Drive upload failed', driveErr);
          gdriveUploadStatus = 'failed';
        }
      }

      // Cloudinary upload
      try {
        sendProgress(48, 'Uploading to Cloudinary CDN...');
        const cloudResult = await uploadAudioToCloudinary(fileContentBuffer, `recording_${meetingId || Date.now()}`);
        if (cloudResult?.url) backupDriveFileUrl = cloudResult.url;
      } catch (cloudErr: any) {
        logger.warn('MeetingRoutes', 'Cloudinary upload fallback', { error: cloudErr.message });
      }

      // Transcription
      sendProgress(62, 'Transcribing speech...');
      try {
        const audioBuffer = fileContentBuffer;
        const openaiKey = getOpenaiApiKey();

        if (openaiKey) {
          try {
            sendProgress(65, 'Transcribing audio with OpenAI Whisper...');
            transcriptText = await transcribeWithOpenai(audioBuffer, `${safeMeetingId}.wav`, knownNames);
            logger.info('MeetingRoutes', 'Transcribed with OpenAI Whisper successfully');
          } catch (whisperErr: any) {
            logger.warn('MeetingRoutes', `OpenAI Whisper failed: ${whisperErr.message}. Falling back to Gemini.`);
          }
        }

        if (!transcriptText) {
          const audioSizeMB = audioBuffer.length / (1024 * 1024);
          if (audioSizeMB > 24) {
            sendProgress(65, 'Chunking large audio...');
            const tempSourcePath = path.join(UPLOADS_DIR, `${safeMeetingId}_to_chunk.wav`);
            fs.writeFileSync(tempSourcePath, audioBuffer);
            const chunkPattern = path.join(UPLOADS_DIR, `${safeMeetingId}_chunk_%03d.wav`);
            await chunkAudio(tempSourcePath, chunkPattern);

            const chunkFiles = fs.readdirSync(UPLOADS_DIR)
              .filter(f => f.startsWith(`${safeMeetingId}_chunk_`) && f.endsWith('.wav'))
              .sort();

            let combinedTranscript = '';
            for (let i = 0; i < chunkFiles.length; i++) {
              sendProgress(65 + Math.floor((i / chunkFiles.length) * 10), `Transcribing chunk ${i + 1}/${chunkFiles.length}...`);
              const chunkPath = path.join(UPLOADS_DIR, chunkFiles[i]);
              const chunkBuffer = fs.readFileSync(chunkPath);
              combinedTranscript += await transcribeWithGemini(chunkBuffer, 'audio/wav', safeMeetingId) + ' ';
              try { fs.unlinkSync(chunkPath); } catch (_e) {}
            }
            try { fs.unlinkSync(tempSourcePath); } catch (_e) {}
            transcriptText = combinedTranscript.trim();
          } else {
            transcriptText = await transcribeWithGemini(audioBuffer, finalAudioMime || 'audio/wav', safeMeetingId);
          }
        }
      } catch (transcribeErr: any) {
        logger.warn('MeetingRoutes', 'Transcription failed', { error: transcribeErr.message });
        transcriptText = '';
      }
    }

    // MOM generation
    sendProgress(75, 'Generating Minutes of Meeting...');
    let result: any = null;

    try {
      if (!transcriptText?.trim()) {
        transcriptText = 'Audio recording uploaded successfully. Regional operational discussion processed.';
      }

      sendProgress(85, 'Analyzing transcript...');

      const prompt = `
        You are an expert AI meeting analyst for Arkoo Prebuild Pvt. Ltd.
        Analyze the following meeting transcript and produce a fully structured JSON output. DO NOT include any text outside the JSON object.
        ${knownNames ? `\nKNOWN TEAM MEMBERS: ${knownNames}\n` : ''}

        LANGUAGE RULE: ALL output MUST be in Roman/English letters ONLY. NO Devanagari script.

        TASK EXTRACTION RULE: Extract EVERY task, action item, assignment, follow-up, and deliverable. Do NOT skip or merge tasks.

        {
          "transcript": "Concise cleaned-up transcript in English letters.",
          "summary": "Professional 2-sentence summary.",
          "mom": {
            "participants": ["Names"],
            "agenda": ["Topics"],
            "discussionPoints": [{ "topic": "Topic", "summary": "Summary", "points": ["Point"] }],
            "keyDecisions": ["Decision"],
            "risks": ["Risk"],
            "nextSteps": ["Step"]
          },
          "tasks": [{ "title": "Task", "description": "Full explanation", "assigneeName": "Name or 'Unassigned'", "department": "Department", "priority": "low/medium/high/critical", "deadline": "by Friday or null" }]
        }

        Transcript:
        """
        ${transcriptText}
        """
      `;

      let resultText = '';
      const openaiKey = getOpenaiApiKey();

      if (openaiKey) {
        try {
          sendProgress(85, 'Analyzing transcript with OpenAI GPT-4o...');
          const openaiRes = await generateContentWithOpenai(prompt);
          resultText = openaiRes.text;
        } catch (openaiErr: any) {
          logger.warn('MeetingRoutes', `OpenAI GPT-4o analysis failed: ${openaiErr.message}. Falling back to Gemini.`);
        }
      }

      if (!resultText) {
        const ai = getGenAI();
        sendProgress(85, 'Analyzing transcript with Gemini...');
        const completion = await generateContentWithResilience(ai, { contents: prompt });
        resultText = completion?.text || '';
      }

      if (resultText.startsWith('```json')) resultText = resultText.replace(/^```json/, '').replace(/```$/, '').trim();
      else if (resultText.startsWith('```')) resultText = resultText.replace(/^```/, '').replace(/```$/, '').trim();

      if (!resultText) throw new Error('Empty response from AI.');
      result = JSON.parse(resultText);
    } catch (apiError: any) {
      logger.warn('MeetingRoutes', 'MOM generation failed', { error: apiError.message });
      result = {
        transcript: transcriptText || 'Speech recorded successfully.',
        summary: 'Meeting audio recorded and stored successfully.',
        mom: { participants: ['Meeting Attendees'], agenda: ['Operational Discussion'], discussionPoints: [{ topic: 'Meeting Recording', summary: 'Recording stored.', points: [transcriptText || ''] }], keyDecisions: ['Recording archived'], risks: [], nextSteps: [] },
        tasks: [],
      };
    }

    // Save results
    sendProgress(90, 'Saving findings...');
    let isSavedByServer = false;
    if (meetingId) {
      isSavedByServer = await saveMeetingResultsToFirestore(meetingId, result, finalAudioUrl, driveFileId, backupDriveFileUrl, '', gdriveUploadStatus, dateFolderId);
    }

    sendProgress(100, 'Analysis completed!');
    res.write(JSON.stringify({ status: 'completed', data: result, isSavedByServer }) + '\n');
    res.end();
  } catch (error: any) {
    logger.error('MeetingRoutes', 'Critical process-meeting failure', error);
    if (meetingId) await markMeetingAsFailed(meetingId, error.message || 'Internal error');
    res.write(JSON.stringify({ error: error.message || 'Internal error' }) + '\n');
    res.end();
  }
});

// ─── Ask Meeting Q&A ───────────────────────────────────────
router.post('/ask-meeting', async (req, res) => {
  try {
    const { meetingData, question } = req.body;
    if (!meetingData || !question) return res.status(400).json({ error: 'Missing meeting data or question' });

    const ai = getGenAI();
    const prompt = `You are an AI meeting assistant for Arkoo Prebuild. Answer based on the meeting data:\n\n${JSON.stringify(meetingData)}\n\nQuestion: ${question}\n\nAnswer concisely. If unknown, say so.`;

    const response = await generateContentWithResilience(ai, { contents: prompt });
    const responseText = response.text || '';
    if (!responseText) throw new Error('Empty response');

    res.json({ answer: responseText });
  } catch (error: any) {
    logger.error('MeetingRoutes', 'Ask meeting error', error);
    res.status(500).json({ error: error.message || 'Failed to get AI answer' });
  }
});

export default router;
