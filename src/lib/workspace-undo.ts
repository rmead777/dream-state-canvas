/**
 * workspace-undo — module-level undo stack for reversible workspace actions.
 *
 * Consumers call recordUndo(description, inverseAction) BEFORE dispatching
 * the forward action. WorkspaceShell listens for Cmd+Z and calls popUndo()
 * to retrieve the inverse action to dispatch + the description to toast.
 *
 * Max depth: 20 entries. Oldest entries are evicted when the stack is full.
 */

import type { WorkspaceReducerAction } from './workspace-types';

interface UndoEntry {
  description: string;
  inverseAction: WorkspaceReducerAction;
}

const MAX_DEPTH = 20;
const stack: UndoEntry[] = [];

/** Push an undo entry before performing a destructive action. */
export function recordUndo(description: string, inverseAction: WorkspaceReducerAction): void {
  if (stack.length >= MAX_DEPTH) stack.shift();
  stack.push({ description, inverseAction });
}

/** Pop the most recent undo entry. Returns null if stack is empty. */
export function popUndo(): UndoEntry | null {
  return stack.pop() ?? null;
}

/** Peek at the top entry without removing it. */
export function peekUndo(): UndoEntry | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/** How many entries are in the undo stack (for optional UI affordances). */
export function undoDepth(): number {
  return stack.length;
}

/** Clear the entire stack (e.g. on sign-out or workspace reset). */
export function clearUndoStack(): void {
  stack.length = 0;
}
