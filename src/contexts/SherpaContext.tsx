import React, { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { generateSuggestions, generateObservations } from '@/lib/sherpa-engine';
import { Suggestion } from '@/lib/workspace-types';

/**
 * SherpaContext — decoupled Sherpa intelligence layer.
 * Observes workspace state and proactively generates suggestions and observations.
 * Any component can read Sherpa state; the intelligence runs independently of UI.
 */

interface SherpaContextValue {
  suggestions: Suggestion[];
  observations: string[];
  lastResponse: string | null;
  isProcessing: boolean;
  triggerObservationScan: () => void;
}

const SherpaCtx = createContext<SherpaContextValue | null>(null);

export function SherpaProvider({ children }: { children: React.ReactNode }) {
  const { state, dispatch } = useWorkspace();
  const observationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Proactive observation scanning — runs periodically
  const triggerObservationScan = useCallback(() => {
    const newObservations = generateObservations(state.objects);

    // Only dispatch truly new observations
    for (const obs of newObservations) {
      if (!state.sherpa.observations.includes(obs)) {
        dispatch({ type: 'ADD_SHERPA_OBSERVATION', payload: obs });
      }
    }
  }, [state.objects, state.sherpa.observations, dispatch]);

  // Auto-scan for observations every 30 seconds
  useEffect(() => {
    observationTimerRef.current = setInterval(() => {
      triggerObservationScan();
    }, 30000);

    return () => {
      if (observationTimerRef.current) {
        clearInterval(observationTimerRef.current);
      }
    };
  }, [triggerObservationScan]);

  // Compute a lightweight fingerprint of object state for reactivity.
  // Captures count, types, statuses, and pinned flags — not just count.
  const objectFingerprint = Object.values(state.objects)
    .filter((o) => o.status !== 'dissolved')
    .map((o) => `${o.id}:${o.type}:${o.status}:${o.pinned ? 1 : 0}`)
    .sort()
    .join('|');

  useEffect(() => {
    if (objectFingerprint) {
      // Delay observation scan slightly so state settles
      const timer = setTimeout(triggerObservationScan, 2000);
      return () => clearTimeout(timer);
    }
  }, [objectFingerprint]);

  // Update suggestions reactively — responds to pin/unpin, type changes, not just count
  useEffect(() => {
    const suggestions = generateSuggestions(state.objects);
    dispatch({ type: 'SET_SHERPA_SUGGESTIONS', payload: suggestions });
  }, [objectFingerprint]);

  const value: SherpaContextValue = {
    suggestions: state.sherpa.suggestions,
    observations: state.sherpa.observations,
    lastResponse: state.sherpa.lastResponse,
    isProcessing: state.sherpa.isProcessing,
    triggerObservationScan,
  };

  return <SherpaCtx.Provider value={value}>{children}</SherpaCtx.Provider>;
}

export function useSherpa() {
  const ctx = useContext(SherpaCtx);
  if (!ctx) throw new Error('useSherpa must be used within SherpaProvider');
  return ctx;
}
