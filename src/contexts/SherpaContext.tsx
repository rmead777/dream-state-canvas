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

  // Stable ref for the scan function — prevents interval reset on every state change.
  // The interval calls scanRef.current which always points to the latest closure.
  const scanRef = useRef<() => void>(() => {});

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

  // Keep the ref pointing to the latest scan function
  scanRef.current = triggerObservationScan;

  // Auto-scan for observations every 30 seconds — interval is STABLE,
  // never resets on state changes. Calls through scanRef to get latest state.
  useEffect(() => {
    const timer = setInterval(() => {
      scanRef.current();
    }, 30000);

    return () => clearInterval(timer);
  }, []); // Empty deps = runs once, stable interval

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
  }, [objectFingerprint, triggerObservationScan]);

  // Update suggestions reactively — responds to pin/unpin, type changes, not just count
  useEffect(() => {
    const suggestions = generateSuggestions(state.objects, state.activeContext);
    dispatch({ type: 'SET_SHERPA_SUGGESTIONS', payload: suggestions });
  }, [objectFingerprint, state.activeContext, state.objects, dispatch]);

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
