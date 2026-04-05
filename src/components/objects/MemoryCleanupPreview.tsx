/**
 * MemoryCleanupPreview — confirmation card for AI-proposed memory consolidation.
 *
 * Shows which memories will be deleted (with reasons), which new consolidated
 * memories will replace them, and Apply/Cancel buttons.
 */

import { useState } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { deleteMemory, createMemory } from '@/lib/memory-store';
import { toast } from 'sonner';

interface MemoryCleanupPreviewProps {
  object: WorkspaceObject;
}

export function MemoryCleanupPreview({ object }: MemoryCleanupPreviewProps) {
  const { dispatch } = useWorkspace();
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const ctx = object.context || {};
  const deleteIds = (ctx.deleteIds || []) as string[];
  const deleteReasons = (ctx.deleteReasons || []) as string[];
  const newMemories = (ctx.newMemories || []) as Array<{ type: string; content: string; reasoning?: string }>;
  const summary = ctx.summary as string;
  const operationCount = ctx.operationCount as number;

  const handleApply = async () => {
    setApplying(true);
    try {
      // Delete redundant memories
      for (const id of deleteIds) {
        await deleteMemory(id);
      }

      // Create consolidated replacements
      for (const mem of newMemories) {
        await createMemory({
          type: mem.type as any,
          trigger: { always: true },
          content: mem.content,
          reasoning: mem.reasoning || 'Consolidated from memory cleanup',
          confidence: 0.9,
          source: 'explicit',
          tags: ['consolidated'],
        });
      }

      setApplied(true);
      toast.success(`Cleaned up: ${deleteIds.length} removed, ${newMemories.length} consolidated`);
      dispatch({
        type: 'UPDATE_OBJECT_CONTEXT',
        payload: { id: object.id, context: { ...ctx, applied: true } },
      });
    } catch (err) {
      toast.error(`Cleanup failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setApplying(false);
    }
  };

  const handleCancel = () => {
    dispatch({ type: 'DISSOLVE_OBJECT', payload: { id: object.id } });
    toast('Memory cleanup cancelled');
  };

  const isApplied = applied || ctx.applied;

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="px-3 py-2 rounded-lg bg-purple-50/50 border border-purple-200/30">
        <p className="text-[11px] text-purple-700 font-medium">{summary}</p>
        <p className="text-[10px] text-workspace-text-secondary mt-0.5">
          {deleteIds.length} to remove · {newMemories.length} consolidated replacement{newMemories.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Deletions */}
      {deleteIds.length > 0 && (
        <div className="space-y-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-red-400/80 px-1">
            Removing ({deleteIds.length})
          </span>
          <div className="max-h-[40vh] overflow-y-auto space-y-0.5">
            {deleteIds.map((id, i) => (
              <div key={id} className="flex items-start gap-2 rounded px-2 py-1.5 bg-red-50/30">
                <span className="shrink-0 text-red-400 mt-0.5">✕</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-workspace-text-secondary/70 truncate" title={deleteReasons[i]}>
                    {deleteReasons[i] || `Memory ${id.slice(0, 8)}...`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New consolidated memories */}
      {newMemories.length > 0 && (
        <div className="space-y-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-500/80 px-1">
            Replacing with ({newMemories.length})
          </span>
          <div className="max-h-[30vh] overflow-y-auto space-y-0.5">
            {newMemories.map((mem, i) => (
              <div key={i} className="flex items-start gap-2 rounded px-2 py-1.5 bg-emerald-50/30">
                <span className="shrink-0 text-emerald-500 mt-0.5">+</span>
                <div className="min-w-0">
                  <p className="text-[10px] text-workspace-text leading-relaxed">{mem.content}</p>
                  <span className="text-[9px] text-workspace-text-secondary/40 uppercase">{mem.type}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {isApplied ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-400/5 border border-emerald-400/15">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-[11px] text-emerald-400/80 font-medium">
            Memories cleaned up — {deleteIds.length} removed, {newMemories.length} consolidated
          </span>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handleApply}
            disabled={applying}
            className="flex-1 rounded-lg px-3 py-2 text-[11px] font-medium transition-colors
              bg-purple-600 text-white hover:bg-purple-700
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying ? 'Cleaning up...' : `Apply Cleanup (${operationCount} changes)`}
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
