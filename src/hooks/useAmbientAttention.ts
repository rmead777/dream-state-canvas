/**
 * useAmbientAttention — wires passive DOM event listeners that feed the
 * ambient-attention signal store.
 *
 * Installs on mount, cleans up on unmount. Call once from WorkspaceShell.
 *
 * Signals collected:
 *   - Dwell: delegated mouseenter/mouseleave on [data-sherpa-id] elements
 *   - Scroll-back: wheel events with deltaY < 0 (throttled to one per 2s)
 */
import { useEffect } from 'react';
import {
  recordHoverStart,
  recordHoverEnd,
  recordScrollBack,
} from '@/lib/ambient-attention';

export function useAmbientAttention(): void {
  useEffect(() => {
    // ─── Dwell via event delegation ───────────────────────────────────────────
    const onEnter = (e: MouseEvent) => {
      const el = (e.target as Element).closest('[data-sherpa-id]');
      if (el) recordHoverStart(el.getAttribute('data-sherpa-id')!);
    };
    const onLeave = (e: MouseEvent) => {
      const el = (e.target as Element).closest('[data-sherpa-id]');
      if (el) recordHoverEnd();
    };
    document.addEventListener('mouseover', onEnter, { passive: true });
    document.addEventListener('mouseout', onLeave, { passive: true });

    // ─── Scroll-back (wheel up) ───────────────────────────────────────────────
    let lastScrollBack = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < -20) {
        const now = Date.now();
        if (now - lastScrollBack > 2_000) {
          recordScrollBack();
          lastScrollBack = now;
        }
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });

    return () => {
      document.removeEventListener('mouseover', onEnter);
      document.removeEventListener('mouseout', onLeave);
      window.removeEventListener('wheel', onWheel);
    };
  }, []);
}
