/**
 * useAgentEvents — subscribe to the agent loop's event stream for UI rendering.
 *
 * The agent emits AgentLoopEvent through a window CustomEvent channel
 * (mirroring the existing `sherpa-particle-converge` / `sherpa-shader-pulse`
 * patterns). This hook accumulates events for the CURRENT in-flight intent
 * and resets when a new `loop_start` arrives.
 *
 * Events for completed intents persist until the next loop_start, so the
 * Thinking Strip stays visible on the most-recent response after completion.
 */
import { useEffect, useState } from 'react';
import type { AgentLoopEvent } from '@/lib/manifestation-types';

const EVENT_NAME = 'sherpa-agent-event';

export interface AgentEventsState {
  events: AgentLoopEvent[];
  isLive: boolean;
  /** ms timestamp of the loop_start event, or null if no loop has run */
  startedAt: number | null;
  /** ms timestamp of loop_complete or loop_error, or null if still running / never run */
  endedAt: number | null;
}

export function useAgentEvents(): AgentEventsState {
  const [state, setState] = useState<AgentEventsState>({
    events: [],
    isLive: false,
    startedAt: null,
    endedAt: null,
  });

  useEffect(() => {
    const onEvent = (e: Event) => {
      const event = (e as CustomEvent<AgentLoopEvent>).detail;
      if (!event || typeof event !== 'object' || !('type' in event)) return;

      setState(prev => {
        if (event.type === 'loop_start') {
          return { events: [event], isLive: true, startedAt: event.t, endedAt: null };
        }
        if (event.type === 'loop_complete' || event.type === 'loop_error') {
          return {
            events: [...prev.events, event],
            isLive: false,
            startedAt: prev.startedAt,
            endedAt: event.t,
          };
        }
        return { ...prev, events: [...prev.events, event] };
      });
    };
    window.addEventListener(EVENT_NAME, onEvent as EventListener);
    return () => window.removeEventListener(EVENT_NAME, onEvent as EventListener);
  }, []);

  return state;
}

/** Dispatch an AgentLoopEvent to all subscribers. Called from useWorkspaceActions. */
export function dispatchAgentEvent(event: AgentLoopEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: event }));
}
