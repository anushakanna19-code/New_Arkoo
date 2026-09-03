// ─── Live Audio Visualizer Component ────────────────────────
// Extracted from MeetingModule.tsx — zero behavior changes.
// Renders a canvas-based waveform during live recording.

import { useRef, useEffect } from 'react';

export function LiveAudioVisualizer({ stream }: { stream: MediaStream | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream) return;

    let audioContext: AudioContext | null = null;
    try {
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const canvasCtx = canvas.getContext('2d');
      if (!canvasCtx) return;

      const draw = () => {
        if (!analyser || !canvas) return;
        animationRef.current = requestAnimationFrame(draw);

        analyser.getByteFrequencyData(dataArray);

        // Fill background
        canvasCtx.fillStyle = '#f8fafc'; // slate-50 background
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw volume bar bars
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const value = dataArray[i];
          const percent = value / 255;
          const barHeight = Math.max(4, percent * canvas.height * 0.85);

          // Deep bold sunset orange gradient
          const gradient = canvasCtx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
          gradient.addColorStop(0, '#f97316'); // Orange-500
          gradient.addColorStop(1, '#ffedd5'); // Orange-100

          canvasCtx.fillStyle = gradient;
          
          // Draw symmetric rounded pill-shaped bars
          const yPos = (canvas.height - barHeight) / 2;
          
          canvasCtx.beginPath();
          if ((canvasCtx as any).roundRect) {
            (canvasCtx as any).roundRect(x, yPos, barWidth - 2, barHeight, 4);
          } else {
            canvasCtx.rect(x, yPos, barWidth - 2, barHeight);
          }
          canvasCtx.fill();

          x += barWidth;
        }
      };

      draw();
    } catch (err) {
      console.error('[Visualizer Error] Analyser failed:', err);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (audioContext) {
        try {
          audioContext.close();
        } catch (e) {}
      }
    };
  }, [stream]);

  return (
    <div className="w-full flex flex-col items-center justify-center bg-slate-50 border border-slate-100 rounded-xl p-4 shadow-inner">
      <div className="flex items-center gap-2 mb-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
        </span>
        <span className="text-xs font-mono text-slate-500 uppercase tracking-widest font-bold">Voice Energetics Waveform</span>
      </div>
      <canvas ref={canvasRef} className="w-full h-16 bg-slate-50 rounded-lg hover:brightness-95 transition-all" width={500} height={64} />
    </div>
  );
}
