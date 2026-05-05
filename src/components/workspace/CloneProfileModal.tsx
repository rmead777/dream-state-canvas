/**
 * CloneProfileModal — super-admin UI to clone the current user's tuned Sherpa
 * (memories + documents) to another user account by email.
 *
 * Calls the `clone-profile` edge function. The function enforces:
 *   - caller user_id is in CLONE_PROFILE_ALLOWED_SOURCE_USERS allowlist
 *   - request passphrase matches CLONE_PROFILE_PASSPHRASE
 * If either fails, the caller sees a clear error string returned by the function.
 *
 * Behavior is skip-existing on both memories and documents — running it twice
 * is safe and idempotent.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const RECIPIENTS_KEY = 'clone-profile-recipients';

function loadRecipients(): string[] {
  try {
    const raw = localStorage.getItem(RECIPIENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecipients(list: string[]) {
  try {
    localStorage.setItem(RECIPIENTS_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

interface CloneResult {
  ok: boolean;
  targetEmail: string;
  memories: { total: number; copied: number; skipped: number };
  documents: { total: number; copied: number; skipped: number; errors: string[] };
}

interface CloneProfileModalProps {
  open: boolean;
  onClose: () => void;
}

export function CloneProfileModal({ open, onClose }: CloneProfileModalProps) {
  const [targetEmail, setTargetEmail] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CloneResult | null>(null);

  const reset = () => {
    setTargetEmail('');
    setPassphrase('');
    setError(null);
    setResult(null);
    setLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleClone = async () => {
    setError(null);
    setResult(null);

    const email = targetEmail.trim();
    if (!email) {
      setError('Target email is required.');
      return;
    }
    if (!passphrase) {
      setError('Passphrase is required.');
      return;
    }

    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setError('You must be signed in to clone a profile.');
        setLoading(false);
        return;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

      const resp = await fetch(`${supabaseUrl}/functions/v1/clone-profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
        },
        body: JSON.stringify({ targetEmail: email, passphrase }),
      });

      const json = await resp.json().catch(() => ({}));

      if (!resp.ok || !json.ok) {
        setError(json.error ?? `Clone failed (HTTP ${resp.status})`);
        setLoading(false);
        return;
      }

      setResult(json as CloneResult);
      setPassphrase('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-workspace-border bg-workspace-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-workspace-text">Clone Profile to User</h3>
            <p className="mt-0.5 text-[11px] text-workspace-text-secondary">
              Copies your memories and documents to another account. Skip-existing on both — safe to re-run.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-md px-2 py-1 text-xs text-workspace-text-secondary hover:bg-workspace-bg/40 hover:text-workspace-text"
          >
            ✕
          </button>
        </div>

        {!result && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary/80">
                Target user email
              </span>
              <input
                type="email"
                value={targetEmail}
                onChange={(e) => setTargetEmail(e.target.value)}
                disabled={loading}
                placeholder="teammate@example.com"
                className="mt-1 w-full rounded-lg border border-workspace-border bg-workspace-bg/50 px-3 py-2 text-xs text-workspace-text placeholder:text-workspace-text-secondary/50 focus:border-workspace-accent focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-wider text-workspace-text-secondary/80">
                Super-admin passphrase
              </span>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                disabled={loading}
                placeholder="••••••••"
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-workspace-border bg-workspace-bg/50 px-3 py-2 text-xs text-workspace-text placeholder:text-workspace-text-secondary/50 focus:border-workspace-accent focus:outline-none"
              />
            </label>

            {error && (
              <div className="rounded-lg border border-red-200/50 bg-red-50/30 px-3 py-2 text-[11px] text-red-600">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={handleClose}
                disabled={loading}
                className="rounded-full px-3 py-1.5 text-[11px] text-workspace-text-secondary hover:text-workspace-text disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleClone}
                disabled={loading || !targetEmail.trim() || !passphrase}
                className="rounded-full bg-workspace-accent px-3.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-workspace-accent/90 disabled:opacity-50"
              >
                {loading ? 'Cloning…' : 'Clone Profile'}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-200/40 bg-emerald-50/30 px-3 py-2.5">
              <p className="text-xs font-medium text-emerald-700">
                Clone complete → {result.targetEmail}
              </p>
            </div>

            <div className="space-y-2 text-[11px] text-workspace-text-secondary">
              <div className="flex items-center justify-between rounded-md bg-workspace-bg/40 px-3 py-1.5">
                <span>Memories</span>
                <span className="tabular-nums text-workspace-text">
                  {result.memories.copied} copied · {result.memories.skipped} skipped (of {result.memories.total})
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-workspace-bg/40 px-3 py-1.5">
                <span>Documents</span>
                <span className="tabular-nums text-workspace-text">
                  {result.documents.copied} copied · {result.documents.skipped} skipped (of {result.documents.total})
                </span>
              </div>
              {result.documents.errors.length > 0 && (
                <div className="rounded-md border border-amber-200/40 bg-amber-50/30 px-3 py-2 text-[10px] text-amber-700">
                  <p className="mb-1 font-medium">Document errors ({result.documents.errors.length}):</p>
                  <ul className="space-y-0.5">
                    {result.documents.errors.slice(0, 5).map((msg, i) => (
                      <li key={i} className="truncate" title={msg}>
                        • {msg}
                      </li>
                    ))}
                    {result.documents.errors.length > 5 && (
                      <li>…{result.documents.errors.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => {
                  setResult(null);
                }}
                className="rounded-full px-3 py-1.5 text-[11px] text-workspace-text-secondary hover:text-workspace-text"
              >
                Clone Another
              </button>
              <button
                onClick={handleClose}
                className="rounded-full bg-workspace-accent px-3.5 py-1.5 text-[11px] font-medium text-white hover:bg-workspace-accent/90"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
