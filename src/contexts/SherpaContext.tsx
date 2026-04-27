import React, { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { generateSuggestions, generateObservations } from '@/lib/sherpa-engine';
import { Suggestion } from '@/lib/workspace-types';
import { getMemories } from '@/lib/memory-store';
import { parseThreshold, checkAlertThresholds } from '@/lib/alert-monitor';
import { useDocuments } from '@/contexts/DocumentContext';
import { loadTriggers, checkTriggers, markTriggerFired } from '@/lib/automation-triggers';
import { supabase } from '@/integrations/supabase/client';
import { isOutlookConnected } from '@/lib/email-store';
import { getAttentionSignals } from '@/lib/ambient-attention';
import { loadFavorites } from '@/lib/next-moves-ranker';

/**
 * SherpaContext — decoupled Sherpa intelligence layer.
 * Observes workspace state and proactively generates suggestions and observations.
 * Any component can read Sherpa state; the intelligence runs independently of UI.
 */

interface SherpaContextValue {
  suggestions: Suggestion[];
  observations: string[];
  lastResponse: string | null;
  processingStatus: string | null;
  isProcessing: boolean;
  triggerObservationScan: () => void;
}

const SherpaCtx = createContext<SherpaContextValue | null>(null);

export function SherpaProvider({ children }: { children: React.ReactNode }) {
  const { state, dispatch } = useWorkspace();
  const { activeDataset } = useDocuments();

  // Favorites — kept in component state so toggling from the UI (via the
  // `toggleFavorite` helper + window event below) triggers a re-rank.
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => loadFavorites());
  useEffect(() => {
    const handler = () => setFavoriteIds(loadFavorites());
    window.addEventListener('sherpa-favorites-changed', handler);
    return () => window.removeEventListener('sherpa-favorites-changed', handler);
  }, []);

  // Connection state — poll lightweight sync checks every 30s so suggestions
  // auto-filter based on what's actually available. QB/Ragic are optimistic
  // (default true) since their status checks are async and the AI surfaces
  // integration errors gracefully.
  const [connections, setConnections] = useState({
    qb: true,
    ragic: true,
    email: isOutlookConnected(),
    documents: true,
  });
  useEffect(() => {
    const poll = () => setConnections((c) => ({ ...c, email: isOutlookConnected() }));
    const timer = setInterval(poll, 30_000);
    return () => clearInterval(timer);
  }, []);

  // Active triggers — automation-trigger IDs that fired in the last 5 minutes.
  // Used by the ranker to slam relevant catalog entries toward #1.
  const activeTriggersRef = useRef<{ id: string; at: number }[]>([]);

  // Stable ref for the scan function — prevents interval reset on every state change.
  // The interval calls scanRef.current which always points to the latest closure.
  const scanRef = useRef<() => void>(() => {});

  // Ref to current observations — allows async alert scan to dedup without stale closure
  const observationsRef = useRef<string[]>(state.sherpa.observations);
  observationsRef.current = state.sherpa.observations;
  const dismissedRef = useRef<string[]>(state.sherpa.dismissedObservations || []);
  dismissedRef.current = state.sherpa.dismissedObservations || [];

  // Proactive observation scanning — runs periodically
  const triggerObservationScan = useCallback(() => {
    const newObservations = generateObservations(state.objects, activeDataset.columns, activeDataset.rows);
    const dismissed = state.sherpa.dismissedObservations || [];

    // Only dispatch truly new observations — skip duplicates AND dismissed ones
    for (const obs of newObservations) {
      if (!state.sherpa.observations.includes(obs) && !dismissed.includes(obs)) {
        dispatch({ type: 'ADD_SHERPA_OBSERVATION', payload: obs });
      }
    }
  }, [state.objects, state.sherpa.observations, state.sherpa.dismissedObservations, dispatch]);

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

  // Alert threshold scan — runs every 60 seconds.
  // Retrieves threshold memories, evaluates against active dataset, fires observations.
  useEffect(() => {
    const runAlertScan = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const memories = await getMemories(user.id);
        const thresholds = memories
          .filter((m) => m.type === 'threshold')
          .map((m) => {
            const t = parseThreshold(m.content);
            return t ? { ...t, id: m.id } : null;
          })
          .filter((t): t is NonNullable<typeof t> => t !== null);

        if (thresholds.length === 0) return;

        const { columns, rows } = activeDataset;
        const firing = checkAlertThresholds(thresholds, columns, rows);

        for (const alert of firing) {
          const obs = `[Alert] ${alert.message}`;
          // Dedup + skip dismissed
          if (!observationsRef.current.includes(obs) && !dismissedRef.current.includes(obs)) {
            dispatch({ type: 'ADD_SHERPA_OBSERVATION', payload: obs });
          }
        }
      } catch (err) {
        console.warn('[SherpaContext] Alert scan failed:', err);
      }
    };

    const alertTimer = setInterval(runAlertScan, 60000);
    return () => clearInterval(alertTimer);
  }, [dispatch]); // dispatch is stable from useWorkspace

  // Automation trigger scan — runs every 30 seconds (in sync with observation scan).
  // Loads triggers from Supabase, evaluates conditions, dispatches observations or card events.
  useEffect(() => {
    const runTriggerScan = async () => {
      try {
        const triggers = await loadTriggers();
        if (triggers.length === 0) return;

        const firings = checkTriggers(triggers, activeDataset.columns, activeDataset.rows);
        const now = Date.now();
        // Prune trigger records older than 5 minutes
        activeTriggersRef.current = activeTriggersRef.current.filter((t) => now - t.at < 5 * 60_000);
        for (const firing of firings) {
          const obs = firing.observation;
          if (!observationsRef.current.includes(obs) && !dismissedRef.current.includes(obs)) {
            dispatch({ type: 'ADD_SHERPA_OBSERVATION', payload: obs });
          }
          // Remember this trigger ID for catalog ranking — entries that declare
          // this as a critical trigger get slammed toward #1 for 5 minutes.
          const trigType = (firing.trigger as { type?: string } | undefined)?.type || firing.trigger.id;
          activeTriggersRef.current.push({ id: trigType, at: now });
          // For create_card actions, emit a synthetic sherpa-query event
          if (firing.actionType === 'create_card' && firing.actionParams.query) {
            document.dispatchEvent(new CustomEvent('sherpa-query', { detail: firing.actionParams.query }));
          }
          // Mark as fired in Supabase (fire-and-forget)
          markTriggerFired(firing.trigger.id).catch(() => {});
        }
      } catch (err) {
        console.warn('[SherpaContext] Trigger scan failed:', err);
      }
    };

    const triggerTimer = setInterval(runTriggerScan, 30000);
    return () => clearInterval(triggerTimer);
  }, [dispatch]); // dispatch is stable

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

  // Update suggestions reactively — responds to pin/unpin, type changes, not just count.
  // Skips regeneration for 30s after AI dispatches nextMoves (lastAISuggestionsAt guard)
  // to prevent the engine from immediately clobbering AI-tailored suggestions.
  useEffect(() => {
    const AI_SUGGESTION_HOLDOFF_MS = 30_000;
    if (Date.now() - state.sherpa.lastAISuggestionsAt < AI_SUGGESTION_HOLDOFF_MS) return;
    const suggestions = generateSuggestions(
      state.objects,
      state.activeContext,
      activeDataset.columns,
      activeDataset.rows,
      {
        connections,
        activeTriggers: activeTriggersRef.current.map((t) => t.id),
        favoriteIds,
        limit: 5,
        ambientAttention: getAttentionSignals(),
      },
    );
    dispatch({ type: 'SET_SHERPA_SUGGESTIONS', payload: suggestions });
  }, [objectFingerprint, state.activeContext, state.objects, state.sherpa.lastAISuggestionsAt, dispatch, connections, favoriteIds]);

  const value: SherpaContextValue = {
    suggestions: state.sherpa.suggestions,
    observations: state.sherpa.observations,
    lastResponse: state.sherpa.lastResponse,
    processingStatus: state.sherpa.processingStatus,
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
