/**
 * DatasetEditPreview — confirmation card for AI-proposed dataset edits.
 *
 * Shows a list of proposed changes (cell updates, row adds/deletes,
 * column adds/renames) with Apply/Cancel buttons. Apply commits the
 * changes to the active dataset + Supabase in one shot.
 */

import { useState } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDocuments } from '@/contexts/DocumentContext';
import { updateDocumentData } from '@/lib/document-store';
import { toast } from 'sonner';

interface DatasetEditPreviewProps {
  object: WorkspaceObject;
}

const CHANGE_ICONS: Record<string, string> = {
  'update': '✏️',
  'add-row': '➕',
  'delete-row': '🗑️',
  'add-column': '📊',
  'rename-column': '🏷️',
};

export function DatasetEditPreview({ object }: DatasetEditPreviewProps) {
  const { dispatch } = useWorkspace();
  const { updateActiveDataset, activeDataset } = useDocuments();
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const ctx = object.context || {};
  const changes = (ctx.changes || []) as Array<{ type: string; description: string; before?: string; after?: string }>;
  const errors = (ctx.errors || []) as string[];
  const reason = ctx.reason as string;
  const newColumns = ctx.newColumns as string[];
  const newRows = ctx.newRows as string[][];
  const operationCount = ctx.operationCount as number;
  const sourceLabel = ctx.sourceLabel as string;
  const sourceDocId = ctx.sourceDocId as string | undefined;

  const handleApply = async () => {
    if (!newColumns || !newRows) {
      toast.error('No changes to apply');
      return;
    }

    setApplying(true);
    try {
      // If the edit targets a specific document (e.g. a scratchpad), write
      // directly to that document — don't touch the active dataset.
      let success: boolean;
      if (sourceDocId && sourceDocId !== activeDataset.sourceDocId) {
        success = await updateDocumentData(sourceDocId, newColumns, newRows);
      } else {
        success = await updateActiveDataset(newColumns, newRows);
      }
      if (success) {
        setApplied(true);
        toast.success(`Applied ${operationCount} change${operationCount !== 1 ? 's' : ''} to ${sourceLabel}`);
        // Update the card to show applied state
        dispatch({
          type: 'UPDATE_OBJECT_CONTEXT',
          payload: { id: object.id, context: { ...ctx, applied: true } },
        });
      } else {
        toast.error('Failed to save changes to database');
      }
    } catch (err) {
      toast.error(`Error applying changes: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setApplying(false);
    }
  };

  const handleCancel = () => {
    dispatch({ type: 'DISSOLVE_OBJECT', payload: { id: object.id } });
    toast('Changes discarded');
  };

  const isApplied = applied || ctx.applied;

  return (
    <div className="space-y-3">
      {/* Reason header */}
      <div className="px-3 py-2 rounded-lg bg-workspace-accent/5 border border-workspace-accent/10">
        <p className="text-[11px] text-workspace-accent font-medium">{reason}</p>
        <p className="text-[10px] text-workspace-text-secondary mt-0.5">
          {operationCount} change{operationCount !== 1 ? 's' : ''} to {sourceLabel}
        </p>
      </div>

      {/* Changes list */}
      <div className="space-y-0.5 max-h-[60vh] overflow-y-auto">
        {changes.map((change, i) => (
          <div
            key={i}
            className="flex items-start gap-2 px-2 py-1.5 rounded text-[10px] bg-workspace-surface/30"
          >
            <span className="shrink-0 mt-0.5">{CHANGE_ICONS[change.type] || '•'}</span>
            <span className="text-workspace-text">{change.description}</span>
          </div>
        ))}
      </div>

      {/* Errors (if partial) */}
      {errors.length > 0 && (
        <div className="px-2 py-1.5 rounded bg-amber-400/5 border border-amber-400/10">
          <p className="text-[9px] text-amber-400/70 font-medium mb-0.5">
            {errors.length} operation{errors.length !== 1 ? 's' : ''} skipped:
          </p>
          {errors.map((err, i) => (
            <p key={i} className="text-[9px] text-amber-400/50">• {err}</p>
          ))}
        </div>
      )}

      {/* Action buttons */}
      {isApplied ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-400/5 border border-emerald-400/15">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-[11px] text-emerald-400/80 font-medium">
            Changes applied to {sourceLabel}
          </span>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handleApply}
            disabled={applying}
            className="flex-1 rounded-lg px-3 py-2 text-[11px] font-medium transition-colors
              bg-workspace-accent text-white hover:bg-workspace-accent/90
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying ? 'Applying...' : `Apply ${operationCount} Change${operationCount !== 1 ? 's' : ''}`}
          </button>
          <button
            onClick={handleCancel}
            disabled={applying}
            className="rounded-lg px-3 py-2 text-[11px] font-medium transition-colors
              border border-workspace-border/30 text-workspace-text-secondary
              hover:border-workspace-border/50 hover:text-workspace-text
              disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
