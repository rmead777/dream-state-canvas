import { useCallback, useRef, useEffect, useState } from 'react';

type SoundType = 'materialize' | 'immersive-enter' | 'immersive-exit' | 'alert' | 'dissolve' | 'focus';

const SOUND_CONFIGS: Record<SoundType, { freq: number; duration: number; type: OscillatorType; gain: number; ramp?: number }> = {
  materialize: { freq: 880, duration: 0.15, type: 'sine', gain: 0.03, ramp: 440 },
  'immersive-enter': { freq: 330, duration: 0.4, type: 'sine', gain: 0.025, ramp: 660 },
  'immersive-exit': { freq: 660, duration: 0.3, type: 'sine', gain: 0.02, ramp: 330 },
  alert: { freq: 520, duration: 0.12, type: 'triangle', gain: 0.04 },
  dissolve: { freq: 440, duration: 0.2, type: 'sine', gain: 0.015, ramp: 220 },
  focus: { freq: 660, duration: 0.08, type: 'sine', gain: 0.02 },
};

export function useAmbientAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem('ws-audio-muted') === 'true'; } catch { return false; }
  });

  const getCtx = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  }, []);

  const play = useCallback(
    (type: SoundType) => {
      if (muted) return;
      try {
        const ctx = getCtx();
        if (ctx.state === 'suspended') ctx.resume();

        const cfg = SOUND_CONFIGS[type];
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = cfg.type;
        osc.frequency.setValueAtTime(cfg.freq, ctx.currentTime);
        if (cfg.ramp) {
          osc.frequency.exponentialRampToValueAtTime(cfg.ramp, ctx.currentTime + cfg.duration);
        }

        gain.gain.setValueAtTime(cfg.gain, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + cfg.duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + cfg.duration + 0.05);
      } catch { /* Web Audio not available */ }
    },
    [muted, getCtx]
  );

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try { localStorage.setItem('ws-audio-muted', String(next)); } catch {}
      return next;
    });
  }, []);

  return { play, muted, toggleMute };
}
