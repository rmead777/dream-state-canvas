/**
 * Client-side QuickBooks OAuth initiation.
 *
 * Called when the user clicks "Connect to QuickBooks" in the status panel.
 * Generates a CSRF state, asks the `qbo-connect` edge function for the
 * Intuit authorize URL, and navigates the browser there. Upon consent
 * Intuit redirects to `/qb-callback` which finishes the exchange.
 */

import { supabase } from '@/integrations/supabase/client';

const STATE_KEY = 'qbo_oauth_state';

export async function initiateQBOConnect(): Promise<void> {
  // Generate a fresh CSRF state. sessionStorage auto-clears on tab close.
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);

  const redirectUri = `${window.location.origin}/qb-callback`;

  const session = (await supabase.auth.getSession()).data.session;
  const token = session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbo-connect`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ redirectUri, state }),
    },
  );

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    sessionStorage.removeItem(STATE_KEY);
    throw new Error(body.error || `Failed to start QuickBooks OAuth (HTTP ${resp.status})`);
  }

  const { authorizeUrl } = await resp.json();
  if (!authorizeUrl) {
    sessionStorage.removeItem(STATE_KEY);
    throw new Error('No authorizeUrl returned from qbo-connect');
  }

  // Navigate the whole page to Intuit's consent screen.
  window.location.href = authorizeUrl;
}
