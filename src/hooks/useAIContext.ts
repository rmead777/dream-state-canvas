/**
 * useAIContext — automatic context injection for every AI call.
 *
 * Synthesizes the current workspace state, focused card, dataset info,
 * document scope, and user context into a typed WorkspaceAIContext object.
 * This is injected into every AI call so Sherpa always knows what the
 * user is looking at without being told.
 *
 * Pattern borrowed from Solar Insight's useAIContext hook.
 */
import { useMemo } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDocuments } from '@/contexts/DocumentContext';
import { useAuth } from '@/hooks/useAuth';
import { getActiveDataset } from '@/lib/active-dataset';
import { getAllTurns } from '@/lib/conversation-memory';

export interface WorkspaceAIContext {
  focusedCard: {
    id: string;
    type: string;
    title: string;
    rowCount: number | null;
    currentLimit: number | null;
    currentFilters: Record<string, any>;
    columnCount: number | null;
  } | null;

  activeCardCount: number;
  activeCardTypes: string[];
  cardSummaries: Array<{
    id: string;
    type: string;
    title: string;
    status: string;
    isFocused: boolean;
    rowCount?: number;
    pinned?: boolean;
  }>;

  datasetLoaded: boolean;
  datasetName: string | null;
  datasetRowCount: number;
  datasetColumnCount: number;
  datasetColumns: string[];

  documentCount: number;

  userEmail: string | null;

  conversationTurnCount: number;
}

export function useAIContext(): WorkspaceAIContext {
  const { state } = useWorkspace();
  const { documents } = useDocuments();
  const { user } = useAuth();

  return useMemo(() => {
    const activeObjects = Object.values(state.objects).filter(
      o => o.status !== 'dissolved'
    );

    const focusedId = state.activeContext?.focusedObjectId;
    const focusedObj = focusedId ? state.objects[focusedId] : null;

    let focusedCard: WorkspaceAIContext['focusedCard'] = null;
    if (focusedObj && focusedObj.status !== 'dissolved') {
      const rows = Array.isArray(focusedObj.context?.rows) ? focusedObj.context.rows : null;
      const columns = Array.isArray(focusedObj.context?.columns) ? focusedObj.context.columns : null;
      focusedCard = {
        id: focusedObj.id,
        type: focusedObj.type,
        title: focusedObj.title,
        rowCount: rows ? rows.length : null,
        currentLimit: focusedObj.context?.dataQuery?.limit ?? focusedObj.context?.view?.limit ?? null,
        currentFilters: focusedObj.context?.dataQuery || {},
        columnCount: columns ? columns.length : null,
      };
    }

    const dataset = getActiveDataset();
    const turns = getAllTurns();

    return {
      focusedCard,

      activeCardCount: activeObjects.length,
      activeCardTypes: [...new Set(activeObjects.map(o => o.type))],
      cardSummaries: activeObjects
        .sort((a, b) => b.lastInteractedAt - a.lastInteractedAt)
        .slice(0, 12)
        .map(o => ({
          id: o.id,
          type: o.type,
          title: o.title,
          status: o.status,
          isFocused: o.id === focusedId,
          rowCount: Array.isArray(o.context?.rows) ? o.context.rows.length : undefined,
          pinned: o.pinned || undefined,
        })),

      datasetLoaded: dataset.rows.length > 0,
      datasetName: dataset.sourceLabel || null,
      datasetRowCount: dataset.rows.length,
      datasetColumnCount: dataset.columns.length,
      datasetColumns: dataset.columns.slice(0, 20),

      documentCount: documents.length,

      userEmail: user?.email || null,

      conversationTurnCount: turns.length,
    };
  }, [state.objects, state.activeContext, documents, user]);
}
