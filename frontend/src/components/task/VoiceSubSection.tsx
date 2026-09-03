// ─── Voice Notes Sub-Section Component ───────────────────────
// Extracted from TaskModule.tsx — zero behavior changes.
// Handles recording/uploading voice memos, transcribing via Gemini API, and audio playback.

import { useState, useEffect, useRef } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  addDoc,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { Mic, Square, Loader2, Upload, UserCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { format } from 'date-fns';

export function VoiceSubSection({ taskId, profile, onLogActivity }: { taskId: string; profile: any; onLogActivity: (m: string) => void }) {
  const [voiceNotes, setVoiceNotes] = useState<any[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const timerRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'tasks', taskId, 'voiceNotes'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setVoiceNotes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error('Voice Notes fetch error:', error);
    });
    return unsubscribe;
  }, [taskId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleStartRecord = async () => {
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await handleSaveVoiceMemo(audioBlob);

        // Stop all tracks on the stream
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(250);
      setRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 120) { // Auto-stop at 2 minutes
            handleStopRecord();
            return 120;
          }
          return prev + 1;
        });
      }, 1000);

      toast.info('Speak now, recording task memo...');
    } catch (e: any) {
      console.error('Audio recorder initialization failed:', e);
      toast.error('Could not grant microphone authorization');
    }
  };

  const handleStopRecord = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const handleSaveVoiceMemo = async (audioBlob: Blob) => {
    setIsProcessing(true);
    const toastId = toast.loading('Synchronizing voice, compiling Gemini transcription...');

    try {
      // FileReader to Base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64data = String(reader.result).split(',')[1];

        // Call server transcribing Proxy route
        const resp = await fetch('/api/tasks/voice-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: base64data,
            mimeType: audioBlob.type,
            taskId
          })
        });

        if (!resp.ok) {
          throw new Error('Server Voice-to-Text conversion failure');
        }

        const data = await resp.json();

        // Write record to tasks/{taskId}/voiceNotes
        await addDoc(collection(db, 'tasks', taskId, 'voiceNotes'), {
          userId: auth.currentUser?.uid || '',
          userName: profile?.fullName || auth.currentUser?.displayName || auth.currentUser?.email || 'Anonymous',
          audioUrl: data.audioUrl,
          transcript: data.transcript || "Speech not registered.",
          createdAt: serverTimestamp()
        });

        toast.dismiss(toastId);
        toast.success('Voice memo transcribed and synced successfully!');
        onLogActivity('Added audio voice memo with automated AI transcription');
        setIsProcessing(false);
      };
    } catch (err: any) {
      console.error('Failed saving memo:', err);
      toast.dismiss(toastId);
      toast.error('Voice Assistant was unable to complete transcription.');
      setIsProcessing(false);
    }
  };

  const handleDeleteVoice = async (id: string) => {
    if (!confirm('Are you sure you want to retract this audio attachment?')) return;
    try {
      await deleteDoc(doc(db, 'tasks', taskId, 'voiceNotes', id));
      toast.success('Audio memo removed');
      onLogActivity('Deleted a voice memo attachment');
    } catch (e) {
      toast.error('Retraction failed');
    }
  };

  const formatSec = (total: number) => {
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadAudioClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      toast.error('Only audio files are supported');
      return;
    }

    setIsProcessing(true);
    const toastId = toast.loading('Uploading and transcribing audio with Gemini...');

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = async () => {
        const base64data = String(reader.result).split(',')[1];

        const resp = await fetch('/api/tasks/voice-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: base64data,
            mimeType: file.type || 'audio/wav',
            taskId
          })
        });

        if (!resp.ok) {
          throw new Error('Server Voice-to-Text conversion failure');
        }

        const data = await resp.json();

        await addDoc(collection(db, 'tasks', taskId, 'voiceNotes'), {
          userId: auth.currentUser?.uid || '',
          userName: profile?.fullName || auth.currentUser?.displayName || auth.currentUser?.email || 'Anonymous',
          audioUrl: data.audioUrl,
          transcript: data.transcript || "Silence/No speech detected",
          createdAt: serverTimestamp()
        });

        toast.dismiss(toastId);
        toast.success('Audio file processed and transcribed successfully!');
        onLogActivity(`Uploaded audio memo (${file.name}) with automated AI transcription`);
        setIsProcessing(false);
      };
    } catch (err: any) {
      console.error('Failed processing uploaded file:', err);
      toast.dismiss(toastId);
      toast.error('Unable to complete audio file transcription.');
      setIsProcessing(false);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const currentUid = auth.currentUser?.uid;
  const isAuthorized = (item: any) => {
    return item.userId === currentUid || String(profile?.role).toLowerCase() === 'admin';
  };

  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center gap-2 border-b pb-2">
        <Mic className="w-4 h-4 text-slate-500" />
        <span className="text-xs font-black uppercase text-slate-700 tracking-wider">Voice Memo Assist ({voiceNotes.length})</span>
      </div>

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="audio/*"
        className="hidden"
      />

      {/* Interactive Recording Panel Deck */}
      <Card className="bg-slate-50/50 border-slate-200 shadow-sm overflow-hidden border">
        <CardContent className="p-5 flex flex-col items-center justify-center space-y-4">
          {recording ? (
            <div className="flex flex-col items-center space-y-3">
              <div className="relative">
                <span className="absolute inline-flex h-12 w-12 animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white">
                  <Mic className="w-6 h-6 animate-pulse" />
                </span>
              </div>
              <p className="text-xs font-black text-rose-600 tracking-wider uppercase flex items-center gap-1.5">
                <span className="inline-block w-20 text-right">{formatSec(recordingTime)}</span>
                <span className="animate-blink">● RECORDING ACTIVE</span>
              </p>

              {/* Aesthetic CSS wave visualizer bars */}
              <div className="flex items-center gap-1 h-5 pl-2">
                {[1, 2, 3, 4, 5, 4, 3, 2, 1].map((h, i) => (
                  <span
                    key={i}
                    style={{ animationDelay: `${i * 0.1}s`, height: `${h * 4}px` }}
                    className="w-1 bg-rose-500 rounded-full animate-wave"
                  />
                ))}
              </div>

              <Button onClick={handleStopRecord} className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs h-9 rounded-xl px-6 cursor-pointer">
                <Square className="w-3.5 h-3.5 mr-2" /> Stop & Transcribe
              </Button>
            </div>
          ) : isProcessing ? (
            <div className="flex flex-col items-center space-y-2 py-3 text-center">
              <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-1" />
              <p className="text-xs font-bold text-slate-700">Analyzing voice waveforms...</p>
              <p className="text-[10px] text-slate-400 font-medium max-w-sm leading-relaxed">
                Gemini is transcribing spoken words. Hold on, indexing audio in Firestore...
              </p>
            </div>
          ) : (
            <div className="w-full flex flex-col sm:flex-row items-center justify-center gap-3 py-3">
              <Button
                onClick={handleStartRecord}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold h-11 px-5 rounded-xl shadow-md shadow-blue-500/20 transition-all cursor-pointer flex items-center gap-2 w-full sm:w-auto justify-center"
              >
                <Mic className="w-4 h-4" /> Record Voice
              </Button>
              <Button
                onClick={handleUploadAudioClick}
                variant="outline"
                className="bg-white hover:bg-slate-50 text-slate-700 border-slate-200 font-bold h-11 px-5 rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-2 w-full sm:w-auto justify-center"
              >
                <Upload className="w-4 h-4" /> Upload Audio
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Chronological memos library list */}
      <div className="space-y-4 max-h-[440px] overflow-y-auto pr-1">
        {voiceNotes.length === 0 ? (
          <div className="text-center py-10 bg-slate-50/30 rounded-2xl border border-dashed border-slate-200">
            <Mic className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400 italic">No task memos or dictations saved.</p>
          </div>
        ) : (
          voiceNotes.map(item => (
            <div key={item.id} className="bg-white p-4 rounded-xl border border-slate-200 relative group/memo shadow-xs">
              <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 mb-2 gap-2 border-b border-slate-50 pb-1.5">
                <span className="text-slate-800 font-extrabold flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-blue-600" /> {item.userName}
                </span>
                <span className="text-slate-400 font-semibold">
                  {item.createdAt?.toDate ? format(item.createdAt.toDate(), 'PP p') : 'Just now'}
                </span>
              </div>

              {/* Playback player */}
              <div className="bg-slate-50 p-2 rounded-xl border border-slate-100/50">
                <audio src={item.audioUrl} controls className="w-full h-8 max-w-full text-slate-700" />
              </div>

              {/* Transcript block */}
              <div className="mt-3 bg-blue-50/40 p-3 rounded-xl border border-blue-100/60">
                <span className="text-[9px] uppercase font-black text-blue-600 tracking-wider block mb-1">
                  AI Transcribed Transcription Notes
                </span>
                <p className="text-xs text-slate-700 font-semibold leading-relaxed break-words">
                  "{item.transcript}"
                </p>
              </div>

              {isAuthorized(item) && (
                <button
                  onClick={() => handleDeleteVoice(item.id)}
                  className="absolute right-3 top-3 opacity-0 group-memo:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-red-500 cursor-pointer bg-white border shadow-xs"
                  title="Remove memo"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
