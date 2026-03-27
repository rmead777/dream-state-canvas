import { useRef, useEffect } from 'react';

interface VoiceIndicatorProps {
  volume: number;
  isListening: boolean;
}

export function VoiceIndicator({ volume, isListening }: VoiceIndicatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isListening) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const bars = 12;
    const barW = 2;
    const gap = (w - bars * barW) / (bars + 1);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'hsl(234 60% 60% / 0.6)';

    for (let i = 0; i < bars; i++) {
      const x = gap + i * (barW + gap);
      const barHeight = Math.max(2, (volume * 0.6 + Math.random() * 0.4) * h * 0.8);
      const y = (h - barHeight) / 2;
      ctx.fillRect(x, y, barW, barHeight);
    }
  }, [volume, isListening]);

  if (!isListening) return null;

  return (
    <div className="flex items-center gap-2 animate-[materialize_0.2s_ease-out_forwards]">
      <canvas
        ref={canvasRef}
        width={60}
        height={20}
        className="opacity-80"
      />
      <span className="text-[10px] text-workspace-accent animate-pulse">Listening...</span>
    </div>
  );
}
