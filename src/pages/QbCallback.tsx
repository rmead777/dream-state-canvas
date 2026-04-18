/**
 * QuickBooks OAuth Callback Page
 *
 * Intuit redirects the user here after the consent screen with:
 *   ?code=<auth_code>&realmId=<qb_realm>&state=<csrf_state>
 *
 * This page:
 *   1. Verifies the CSRF `state` matches what we stashed before starting.
 *   2. POSTs {code, realmId, redirectUri} to the `qbo-callback` edge function,
 *      which does the server-side token exchange (keeps client_secret hidden).
 *   3. On success → clear QB caches so `QBOStatusPanel` picks up the new
 *      connection on its next poll, then redirect to the canvas.
 *   4. On failure → show a clear error with a "Return to Sherpa" link.
 *
 * This page runs behind ProtectedRoute — the user must still be logged into
 * DSC after returning from Intuit. Supabase's auth session cookie survives
 * the OAuth redirect round-trip.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { clearQBOCache } from '@/lib/quickbooks-store';

const STATE_KEY = 'qbo_oauth_state';

type Status = 'working' | 'success' | 'error';

export default function QbCallback() {
  const [status, setStatus] = useState<Status>('working');
  const [message, setMessage] = useState('Completing QuickBooks connection...');
  const navigate = useNavigate();
  const hasRun = useRef(false);

  useEffect(() => {
    // Auth codes are single-use. If this effect fires twice (React StrictMode,
    // router quirks, browser retry after a 404), the second run would send the
    // already-burned code to Intuit and get `invalid_grant`. Guard against that.
    if (hasRun.current) return;
    hasRun.current = true;

    async function handleCallback() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const realmId = params.get('realmId');
      const state = params.get('state');
      const oauthError = params.get('error');
      const oauthErrorDescription = params.get('error_description');

      // User denied consent or Intuit reported an error
      if (oauthError) {
        setStatus('error');
        setMessage(
          oauthErrorDescription
            ? `QuickBooks authorization failed: ${oauthErrorDescription}`
            : `QuickBooks authorization was denied (${oauthError}).`,
        );
        return;
      }

      if (!code || !realmId || !state) {
        setStatus('error');
        setMessage(
          'Callback is missing required parameters. Please try connecting again from the Context tab.',
        );
        return;
      }

      // Verify CSRF state — must match what initiateQBOConnect() stashed
      const expectedState = sessionStorage.getItem(STATE_KEY);
      sessionStorage.removeItem(STATE_KEY);
      if (!expectedState || expectedState !== state) {
        setStatus('error');
        setMessage(
          'Security check failed — state parameter did not match. Please try connecting again from the Context tab.',
        );
        return;
      }

      try {
        const session = (await supabase.auth.getSession()).data.session;
        const token =
          session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const redirectUri = `${window.location.origin}/qb-callback`;

        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbo-callback`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ code, realmId, redirectUri }),
          },
        );

        const result = await resp.json();
        if (!resp.ok) {
          setStatus('error');
          setMessage(
            result.message || result.error || `Connection failed (HTTP ${resp.status}).`,
          );
          return;
        }

        // Clear any stale cache so the status panel re-reads on next poll
        clearQBOCache();

        setStatus('success');
        setMessage(`Connected to ${result.companyName}. Redirecting to Sherpa...`);
        setTimeout(() => navigate('/', { replace: true }), 1500);
      } catch (err) {
        setStatus('error');
        setMessage((err as Error).message || 'Connection failed unexpectedly.');
      }
    }

    handleCallback();
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-workspace-bg p-6">
      <div className="w-full max-w-md rounded-lg border border-workspace-border bg-workspace-surface/60 p-6 shadow-lg backdrop-blur">
        <div className="flex items-center gap-3">
          {status === 'working' && (
            <span className="inline-block h-4 w-4 rounded-full border-2 border-workspace-accent/30 border-t-workspace-accent animate-spin" />
          )}
          {status === 'success' && (
            <span className="inline-block h-4 w-4 rounded-full bg-emerald-400" />
          )}
          {status === 'error' && (
            <span className="inline-block h-4 w-4 rounded-full bg-red-400" />
          )}
          <h1 className="text-sm font-medium text-workspace-text">
            {status === 'working' && 'Connecting to QuickBooks'}
            {status === 'success' && 'Connected'}
            {status === 'error' && 'Connection failed'}
          </h1>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-workspace-text-secondary/70">
          {message}
        </p>
        {status === 'error' && (
          <button
            onClick={() => navigate('/', { replace: true })}
            className="mt-4 rounded-md border border-workspace-border px-3 py-1.5 text-xs text-workspace-text transition-colors hover:bg-workspace-surface"
          >
            Return to Sherpa
          </button>
        )}
      </div>
    </div>
  );
}
