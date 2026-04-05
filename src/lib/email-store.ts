/**
 * Email Store — client-side module for fetching Outlook emails via Microsoft Graph API.
 *
 * Uses MSAL for authentication (delegated permissions — user's own mailbox only).
 * Caches results in memory for the session, same pattern as quickbooks-store.ts.
 *
 * The Sherpa tool calls into this module. No server-side secrets needed.
 */

import { PublicClientApplication, InteractionRequiredAuthError, type AccountInfo } from '@azure/msal-browser';
import { loginRequest } from './msal-config';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EmailSummary {
  id: string;
  subject: string;
  bodyPreview: string;
  from: { name: string; address: string };
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  importance: string;
}

export interface EmailFull extends EmailSummary {
  body: { content: string; contentType: string };
  toRecipients: Array<{ emailAddress: { name: string; address: string } }>;
}

// ─── MSAL Instance (set by MsalProvider in App.tsx) ────────────────────────

let msalInstance: PublicClientApplication | null = null;

/** Called once from App.tsx after MSAL initializes */
export function setMsalInstance(instance: PublicClientApplication): void {
  msalInstance = instance;
}

// ─── Token Acquisition ─────────────────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  if (!msalInstance) return null;

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return null;

  try {
    const response = await msalInstance.acquireTokenSilent({
      ...loginRequest,
      account: accounts[0],
    });
    return response.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      try {
        const response = await msalInstance.acquireTokenPopup(loginRequest);
        return response.accessToken;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ─── Graph API Fetch ───────────────────────────────────────────────────────

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

async function graphFetch<T>(endpoint: string): Promise<T | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const response = await fetch(`${GRAPH_BASE}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Graph API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

// ─── Folder Resolution ─────────────────────────────────────────────────────

let cachedFolderId: string | null = null;
const DEFAULT_FOLDER_NAME = 'Incoa AP Automated';

async function resolveFolderId(folderName: string = DEFAULT_FOLDER_NAME): Promise<string | null> {
  if (cachedFolderId) return cachedFolderId;

  // Search top-level mail folders
  const result = await graphFetch<{ value: Array<{ id: string; displayName: string }> }>(
    `/me/mailFolders?$filter=displayName eq '${folderName}'`
  );

  if (result?.value?.[0]) {
    cachedFolderId = result.value[0].id;
    return cachedFolderId;
  }

  // Try child folders of Inbox
  const inbox = await graphFetch<{ value: Array<{ id: string; displayName: string }> }>(
    `/me/mailFolders/inbox/childFolders`
  );

  const match = inbox?.value?.find(f => f.displayName.toLowerCase() === folderName.toLowerCase());
  if (match) {
    cachedFolderId = match.id;
    return cachedFolderId;
  }

  return null;
}

// ─── Session Cache ─────────────────────────────────────────────────────────

const cache = new Map<string, { data: any; fetchedAt: number }>();

function getCached(key: string): any | null {
  return cache.get(key)?.data ?? null;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

export function clearEmailCache(): void {
  cache.clear();
  cachedFolderId = null;
}

// ─── Public API ────────────────────────────────────────────────────────────

/** Check if user is signed in to Outlook */
export function isOutlookConnected(): boolean {
  if (!msalInstance) return false;
  return msalInstance.getAllAccounts().length > 0;
}

/** Get the signed-in account info */
export function getOutlookAccount(): AccountInfo | null {
  if (!msalInstance) return null;
  return msalInstance.getAllAccounts()[0] || null;
}

/** Trigger MSAL login — tries popup first, falls back to redirect */
export async function signInToOutlook(): Promise<boolean> {
  if (!msalInstance) return false;
  try {
    const result = await msalInstance.loginPopup(loginRequest);
    if (result?.account) {
      msalInstance.setActiveAccount(result.account);
    }
    return msalInstance.getAllAccounts().length > 0;
  } catch (popupErr) {
    // Popup blocked or failed — try redirect flow
    try {
      await msalInstance.loginRedirect(loginRequest);
      return true; // Won't reach here — page redirects
    } catch {
      return false;
    }
  }
}

/** Sign out of Outlook */
export async function signOutOfOutlook(): Promise<void> {
  if (!msalInstance) return;
  try {
    await msalInstance.logoutPopup();
  } catch {}
}

/**
 * Fetch recent emails from the AP folder.
 * Cached for the session — call clearEmailCache() to re-fetch.
 */
export async function fetchRecentEmails(
  limit: number = 20,
  afterDate?: string,
  folderName?: string,
): Promise<EmailSummary[]> {
  const cacheKey = `recent:${limit}:${afterDate || ''}:${folderName || ''}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const folderId = await resolveFolderId(folderName);
  if (!folderId) throw new Error(`Folder "${folderName || DEFAULT_FOLDER_NAME}" not found`);

  let url = `/me/mailFolders/${folderId}/messages?$top=${Math.min(limit, 50)}&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview,from,receivedDateTime,isRead,hasAttachments,importance`;

  if (afterDate) {
    url += `&$filter=receivedDateTime ge ${afterDate}`;
  }

  const result = await graphFetch<{ value: any[] }>(url);
  const emails: EmailSummary[] = (result?.value || []).map(normalizeEmail);
  setCache(cacheKey, emails);
  return emails;
}

/**
 * Search emails across the mailbox.
 * Graph API note: $search and $orderby cannot be combined — results come by relevance.
 */
export async function searchEmails(
  query: string,
  limit: number = 20,
): Promise<EmailSummary[]> {
  const cacheKey = `search:${query}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const result = await graphFetch<{ value: any[] }>(
    `/me/messages?$search="${encodeURIComponent(query)}"&$top=${Math.min(limit, 50)}&$select=id,subject,bodyPreview,from,receivedDateTime,isRead,hasAttachments,importance`
  );
  const emails: EmailSummary[] = (result?.value || []).map(normalizeEmail);
  setCache(cacheKey, emails);
  return emails;
}

/**
 * Read a single email's full body by ID.
 */
export async function readEmail(emailId: string): Promise<EmailFull | null> {
  const cacheKey = `email:${emailId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const result = await graphFetch<any>(
    `/me/messages/${emailId}?$select=id,subject,body,bodyPreview,from,toRecipients,receivedDateTime,isRead,hasAttachments,importance`
  );

  if (!result) return null;

  const email: EmailFull = {
    id: result.id,
    subject: result.subject || '(no subject)',
    bodyPreview: result.bodyPreview || '',
    body: result.body || { content: '', contentType: 'text' },
    from: {
      name: result.from?.emailAddress?.name || '',
      address: result.from?.emailAddress?.address || '',
    },
    toRecipients: (result.toRecipients || []).map((r: any) => ({
      emailAddress: { name: r.emailAddress?.name || '', address: r.emailAddress?.address || '' },
    })),
    receivedDateTime: result.receivedDateTime || '',
    isRead: result.isRead ?? true,
    hasAttachments: result.hasAttachments ?? false,
    importance: result.importance || 'normal',
  };

  setCache(cacheKey, email);
  return email;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function normalizeEmail(raw: any): EmailSummary {
  return {
    id: raw.id,
    subject: raw.subject || '(no subject)',
    bodyPreview: raw.bodyPreview || '',
    from: {
      name: raw.from?.emailAddress?.name || '',
      address: raw.from?.emailAddress?.address || '',
    },
    receivedDateTime: raw.receivedDateTime || '',
    isRead: raw.isRead ?? true,
    hasAttachments: raw.hasAttachments ?? false,
    importance: raw.importance || 'normal',
  };
}
