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
  const lastObservationCountRef = useRef(0);

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

  // Also scan when object count changes (something was created/dissolved)
  const objectCount = Object.values(state.objects).filter(
    (o) => o.status !== 'dissolved'
  ).length;

  useEffect(() => {
    if (objectCount > 0) {
      // Delay observation scan slightly so state settles
      const timer = setTimeout(triggerObservationScan, 2000);
      return () => clearTimeout(timer);
    }
  }, [objectCount]);

  // Update suggestions reactively
  useEffect(() => {
    const suggestions = generateSuggestions(state.objects);
    dispatch({ type: 'SET_SHERPA_SUGGESTIONS', payload: suggestions });
  }, [objectCount]);

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
