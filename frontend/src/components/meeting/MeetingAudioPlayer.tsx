import { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Square, Download, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { getApiUrl } from '@/lib/api';
import { getAudioFromLocalCache } from '@/lib/audio-cache';

export function MeetingAudioPlayer({ 
  audioUrl, 
  driveFileUrl,
  title, 
  meetingId 
}: { 
  audioUrl?: string; 
  driveFileUrl?: string;
  title: string; 
  meetingId?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  const [checkingCache, setCheckingCache] = useState(true);

  // Check locally cached audio in IndexedDB
  useEffect(() => {
    let active = true;
    if (meetingId) {
      setCheckingCache(true);
      getAudioFromLocalCache(meetingId).then((blob) => {
        if (active) {
          if (blob && blob.size > 0) {
            const url = URL.createObjectURL(blob);
            setLocalBlobUrl(url);
            setIsLoaded(true);
            setHasError(false);
          }
          setCheckingCache(false);
        }
      }).catch(() => {
        if (active) setCheckingCache(false);
      });
    } else {
      setCheckingCache(false);
    }

    return () => {
      active = false;
      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
      }
    };
  }, [meetingId]);

  const effectiveAudioUrl = useMemo(() => {
    if (localBlobUrl) return localBlobUrl;
    if (checkingCache) return '';
    if (!audioUrl) return '';
    return getApiUrl(audioUrl);
  }, [localBlobUrl, checkingCache, audioUrl]);

  const effectiveDriveUrl = useMemo(() => {
    if (driveFileUrl && (driveFileUrl.includes('drive.google.com') || driveFileUrl.includes('googleapis.com/drive'))) {
      return driveFileUrl;
    }
    if (audioUrl && (audioUrl.includes('drive.google.com') || audioUrl.includes('googleapis.com/drive'))) {
      return audioUrl;
    }
    return null;
  }, [driveFileUrl, audioUrl]);

  const isDriveOnly = !localBlobUrl && effectiveDriveUrl && (!audioUrl || audioUrl.includes('drive.google.com') || audioUrl.startsWith('/api/audio/'));

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.warn('[Audio Player] Play failed:', err);
        setIsPlaying(false);
      });
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const dur = audioRef.current.duration;
      if (dur && dur !== Infinity && !isNaN(dur)) {
        setDuration(dur);
      }
      setIsLoaded(true);
      setHasError(false);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (audioRef.current) audioRef.current.volume = v;
    setVolume(v);
  };

  const handleEnded = () => setIsPlaying(false);

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isDriveOnly) {
      window.open(effectiveDriveUrl || audioUrl, '_blank');
      return;
    }

    if (!effectiveAudioUrl && !audioUrl) {
      toast.error('No audio file is available for this session.');
      return;
    }

    if (hasError && !localBlobUrl) {
      if (effectiveDriveUrl) {
        window.open(effectiveDriveUrl, '_blank');
        return;
      }
      toast.error('Audio recording is unavailable for this previous session.');
      return;
    }

    const targetUrl = effectiveAudioUrl || getApiUrl(audioUrl || '');
    const safeTitle = (title || 'meeting').replace(/[/\\?%*:|"<>]/g, '_').trim();

    try {
      setIsDownloading(true);

      // If it's already a blob URL, trigger instant direct download
      if (targetUrl.startsWith('blob:')) {
        const a = document.createElement('a');
        a.href = targetUrl;
        a.download = `${safeTitle}_recording.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }

      // Fetch file as blob to force browser download dialog and set proper filename
      const response = await fetch(targetUrl);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Recording file not found on server.');
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();

      let ext = 'webm';
      if (blob.type.includes('mpeg') || blob.type.includes('mp3')) ext = 'mp3';
      else if (blob.type.includes('wav')) ext = 'wav';
      else if (blob.type.includes('m4a')) ext = 'm4a';
      else if (targetUrl.includes('.mp3')) ext = 'mp3';
      else if (targetUrl.includes('.wav')) ext = 'wav';

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${safeTitle}_recording.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
      toast.success('Audio downloaded successfully!');
    } catch (err: any) {
      console.warn('[MeetingAudioPlayer] Direct download fetch failed:', err);
      if (effectiveDriveUrl) {
        toast.info('Opening recording backup on Google Drive...');
        window.open(effectiveDriveUrl, '_blank');
      } else {
        toast.error(err.message || 'Audio recording unavailable for this previous session.');
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const fmt = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
          <div className="w-6 h-6 rounded-lg bg-blue-100/70 text-blue-500 flex items-center justify-center text-xs">
            🎙️
          </div>
          Meeting Audio Recording
        </div>
        {localBlobUrl && (
          <span className="text-[10px] bg-emerald-50 text-emerald-700 font-semibold px-2.5 py-0.5 rounded-full border border-emerald-200">
            ✓ HD Recording
          </span>
        )}
      </div>

      {hasError ? (
        effectiveDriveUrl ? (
          /* Audio stream expired locally, but Drive backup exists! */
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 flex flex-col items-center gap-3 text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xl">🎵</div>
            <div>
              <p className="text-xs font-bold text-slate-800">Recording Archived on Google Drive</p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-sm">
                The local audio stream cache has expired, but this recording is preserved on Google Drive.
              </p>
            </div>
            <a
              href={effectiveDriveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors shadow-xs"
            >
              <Play className="w-3.5 h-3.5" /> Open & Play in Google Drive <ExternalLink className="w-3.5 h-3.5 ml-0.5" />
            </a>
          </div>
        ) : (
          /* Neither local stream nor Drive backup available */
          <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-4 flex items-center gap-3 text-left">
            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center text-sm shrink-0">
              🎙️
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-700">
                Audio Stream Unavailable
              </p>
              <p className="text-[11px] text-slate-500 leading-normal mt-0.5">
                The temporary server audio cache for this earlier session has expired. Full verbatim transcript and AI meeting minutes are preserved below.
              </p>
            </div>
          </div>
        )
      ) : isDriveOnly ? (
        /* Drive file — cannot stream directly, show open link */
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-2xl">🎵</div>
          <p className="text-xs text-slate-500 font-medium leading-relaxed">
            This meeting's audio is stored on Google Drive.<br />
            Click below to open and play it directly in Drive.
          </p>
          <a
            href={effectiveDriveUrl || audioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" /> Open in Google Drive <ExternalLink className="w-3.5 h-3.5 ml-1" />
          </a>
        </div>
      ) : (
        /* Local / Cloud audio — stream inline */
        <div className="space-y-4">
          {/* Hidden native audio element */}
          {effectiveAudioUrl ? (
            <audio
              ref={audioRef}
              src={effectiveAudioUrl}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onDurationChange={handleLoadedMetadata}
              onCanPlay={handleLoadedMetadata}
              onEnded={handleEnded}
              onError={(e) => {
                console.warn('[Audio Player] Audio load error for', effectiveAudioUrl, e);
                setHasError(true);
              }}
              preload="auto"
            />
          ) : null}

          {/* Waveform visual placeholder + play button */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 flex items-center gap-4">
            {/* Play / Pause button */}
            <button
              onClick={togglePlay}
              className="w-11 h-11 rounded-full bg-blue-500 hover:bg-blue-700 flex items-center justify-center text-white shadow-lg transition-all active:scale-95 shrink-0 cursor-pointer"
            >
              {isPlaying ? (
                <Square className="w-4 h-4 fill-white" />
              ) : (
                <Play className="w-4 h-4 fill-white ml-0.5" />
              )}
            </button>

            {/* Waveform bars animation */}
            <div className="flex items-center gap-[3px] h-8 shrink-0">
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full bg-orange-400 transition-all"
                  style={{
                    height: isPlaying
                      ? `${20 + Math.sin((Date.now() / 200 + i * 0.7)) * 12}px`
                      : `${8 + (i % 3) * 6}px`,
                    animation: isPlaying ? `pulse ${0.4 + i * 0.05}s ease-in-out infinite alternate` : 'none',
                    opacity: isPlaying ? 1 : 0.4
                  }}
                />
              ))}
            </div>

            {/* Title & time */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white truncate">{title}</p>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                {fmt(currentTime)} / {fmt(duration)}
              </p>
            </div>
          </div>

          {/* Seek bar */}
          <div className="relative w-full h-4 flex items-center group cursor-pointer mb-2">
            {/* Background track */}
            <div className="absolute w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              {/* Fill track */}
              <div
                className="absolute left-0 top-0 h-full bg-blue-500 rounded-full transition-all pointer-events-none"
                style={{ width: `${progress}%` }}
              />
            </div>
            {/* Range input slider */}
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              disabled={!isLoaded || duration === 0}
              className="absolute w-full h-full opacity-0 cursor-pointer z-10"
            />
          </div>

          {/* Volume + Download */}
          <div className="flex items-center justify-between gap-4">
            {/* Volume */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">🔈</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={handleVolumeChange}
                className="w-20 accent-blue-500 cursor-pointer"
              />
              <span className="text-xs text-slate-400 font-mono w-7">{Math.round(volume * 100)}%</span>
            </div>

            {/* Download */}
            <button
              onClick={handleDownload}
              disabled={isDownloading || (!effectiveAudioUrl && !audioUrl)}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-blue-700 disabled:opacity-50 transition-colors cursor-pointer bg-transparent border-none p-0"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" /> Downloading...
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" /> Download Audio
                </>
              )}
            </button>
          </div>

          {!isLoaded && !hasError && (
            <p className="text-[10px] text-slate-400 text-center font-medium animate-pulse">
              Buffering audio stream...
            </p>
          )}
        </div>
      )}
    </div>
  );
}
