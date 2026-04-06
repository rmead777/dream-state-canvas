/**
 * Email Store — Outlook email sync + Supabase persistence.
 *
 * Flow:
 *   1. syncEmails() pulls from Graph API, stores full body in Supabase ap_emails table
 *   2. getStoredEmails() reads from Supabase (fast, no Graph API call)
 *   3. searchStoredEmails() does full-text search in Supabase
 *   4. getStoredEmail() reads a single email from Supabase by graph_message_id
 *   5. Only hits Graph API when syncing — all reads come from Supabase
 *
 * MSAL auth is still client-side (delegated permissions).
 * Supabase is the persistence layer for email content.
 */

import { PublicClientApplication, InteractionRequiredAuthError, type AccountInfo } from '@azure/msal-browser';
import { loginRequest } from './msal-config';
import { supabase } from '@/integrations/supabase/client';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EmailSummary {
  id: string;
  graphMessageId: string;
  subject: string;
  bodyPreview: string;
  from: { name: string; address: string };
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  importance: string;
}

export interface EmailFull extends EmailSummary {
  bodyText: string;
  bodyContentType: string;
  toRecipients: Array<{ name: string; address: string }>;
}

export interface SyncResult {
  newEmails: number;
  totalStored: number;
  lastMessageDate: string | null;
  error?: string;
}

// ─── MSAL Instance (set by MsalProvider in App.tsx) ────────────────────────

let msalInstance: PublicClientApplication | null = null;

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

// ─── Folder Discovery ─────────────────────────────────────────────────────

export async function listMailFolders(): Promise<Array<{ id: string; displayName: string; totalItemCount: number; childFolderCount: number }>> {
  const folders: Array<{ id: string; displayName: string; totalItemCount: number; childFolderCount: number }> = [];

  // Top-level folders
  const topLevel = await graphFetch<{ value: Array<{ id: string; displayName: string; totalItemCount: number; childFolderCount: number }> }>(
    `/me/mailFolders?$top=100`
  );
  if (topLevel?.value) {
    for (const f of topLevel.value) {
      folders.push(f);
      // Also fetch child folders
      if (f.childFolderCount > 0) {
        const children = await graphFetch<{ value: Array<{ id: string; displayName: string; totalItemCount: number; childFolderCount: number }> }>(
          `/me/mailFolders/${f.id}/childFolders?$top=100`
        );
        if (children?.value) {
          folders.push(...children.value.map(c => ({ ...c, displayName: `${f.displayName} / ${c.displayName}` })));
        }
      }
    }
  }

  return folders;
}

const folderIdCache = new Map<string, string>();
const DEFAULT_FOLDER_NAME = 'Incoa AP Automated';

async function resolveFolderId(folderName: string = DEFAULT_FOLDER_NAME): Promise<string | null> {
  const cached = folderIdCache.get(folderName.toLowerCase());
  if (cached) return cached;

  const target = folderName.toLowerCase();

  // 1. Try all top-level mail folders (case-insensitive client-side match)
  const topLevel = await graphFetch<{ value: Array<{ id: string; displayName: string }> }>(
    `/me/mailFolders?$top=100`
  );

  if (topLevel?.value) {
    const match = topLevel.value.find(f => f.displayName.toLowerCase() === target);
    if (match) {
      folderIdCache.set(target, match.id);
      return match.id;
    }

    // 2. Search child folders of every top-level folder (handles nested folders)
    for (const parent of topLevel.value) {
      const children = await graphFetch<{ value: Array<{ id: string; displayName: string }> }>(
        `/me/mailFolders/${parent.id}/childFolders?$top=100`
      );
      const childMatch = children?.value?.find(f => f.displayName.toLowerCase() === target);
      if (childMatch) {
        folderIdCache.set(target, childMatch.id);
        return childMatch.id;
      }
    }
  }

  // 3. Log available folders for debugging
  const available = topLevel?.value?.map(f => f.displayName).join(', ') || 'none';
  console.error(`[email-store] Folder "${folderName}" not found. Available top-level folders: ${available}`);

  return null;
}

// ─── Public API: Connection ────────────────────────────────────────────────

export function isOutlookConnected(): boolean {
  if (!msalInstance) return false;
  return msalInstance.getAllAccounts().length > 0;
}

export function getOutlookAccount(): AccountInfo | null {
  if (!msalInstance) return null;
  return msalInstance.getAllAccounts()[0] || null;
}

export async function signInToOutlook(): Promise<boolean> {
  if (!msalInstance) return false;
  try {
    await msalInstance.loginRedirect(loginRequest);
    return true;
  } catch {
    return false;
  }
}

export async function signOutOfOutlook(): Promise<void> {
  if (!msalInstance) return;
  try { await msalInstance.logoutPopup(); } catch {}
}

// ─── Sync: Pull from Graph API → Store in Supabase ────────────────────────

/**
 * Sync emails from Outlook to Supabase. Pulls only emails newer than
 * the last sync timestamp. Stores full body text for AI analysis.
 *
 * Paginates at 50 per request (Graph API max).
 */
export async function syncEmails(
  folderName: string = DEFAULT_FOLDER_NAME,
  options?: { fullResync?: boolean; daysBack?: number },
): Promise<SyncResult> {
  const account = getOutlookAccount();
  if (!account) throw new Error('Not signed in to Outlook');
  const userId = account.username || account.homeAccountId;

  // Get last sync timestamp (unless full resync requested)
  let afterDate: string | null = null;
  if (!options?.fullResync) {
    const { data: syncState } = await supabase
      .from('ap_email_sync')
      .select('last_message_date')
      .eq('user_id', userId)
      .eq('folder_name', folderName)
      .single();

    if (syncState?.last_message_date) {
      // Ensure ISO 8601 with timezone — Graph API requires the Z suffix
      const raw = syncState.last_message_date;
      afterDate = raw.endsWith('Z') || raw.includes('+') ? raw : new Date(raw + 'Z').toISOString();
    }
  }

  // On first sync with daysBack specified, use that as the lookback window
  if (!afterDate && options?.daysBack && options.daysBack > 0) {
    const d = new Date();
    d.setDate(d.getDate() - options.daysBack);
    afterDate = d.toISOString();
  }

  // Update sync status to 'syncing'
  await supabase
    .from('ap_email_sync')
    .upsert({
      user_id: userId,
      folder_name: folderName,
      sync_status: 'syncing',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,folder_name' });

  const folderId = await resolveFolderId(folderName);
  if (!folderId) {
    await updateSyncState(userId, folderName, 'error', 0, null, `Folder "${folderName}" not found`);
    throw new Error(`Folder "${folderName}" not found`);
  }

  // Paginate through all new emails
  let newCount = 0;
  let latestDate: string | null = null;
  let offset = 0;
  const PAGE_SIZE = 50;

  while (true) {
    let url = `/me/mailFolders/${folderId}/messages?$top=${PAGE_SIZE}&$skip=${offset}&$orderby=receivedDateTime desc&$select=id,subject,body,bodyPreview,from,toRecipients,receivedDateTime,isRead,hasAttachments,importance`;

    if (afterDate) {
      url += `&$filter=receivedDateTime gt ${afterDate}`;
    }

    const result = await graphFetch<{ value: any[] }>(url);
    const messages = result?.value || [];

    if (messages.length === 0) break;

    // Upsert each email into Supabase with cross-folder dedup
    for (const msg of messages) {
      const bodyText = msg.body?.contentType === 'html'
        ? msg.body.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        : msg.body?.content || '';

      const senderAddress = msg.from?.emailAddress?.address || '';
      const subject = msg.subject || '(no subject)';
      // Normalize to full ISO 8601 — Graph API sometimes omits the Z suffix
      const rawDate = msg.receivedDateTime;
      const receivedAt = rawDate && !rawDate.endsWith('Z') && !rawDate.includes('+')
        ? rawDate + 'Z'
        : rawDate;

      // Cross-folder dedup: check if an email with same subject + sender + ~same time
      // already exists from a different folder (e.g. same email forwarded to two people)
      const { data: existing } = await supabase
        .from('ap_emails')
        .select('id')
        .eq('sender_address', senderAddress)
        .eq('subject', subject)
        .gte('received_at', new Date(new Date(receivedAt).getTime() - 60000).toISOString())
        .lte('received_at', new Date(new Date(receivedAt).getTime() + 60000).toISOString())
        .neq('graph_message_id', msg.id)
        .limit(1);

      if (existing && existing.length > 0) {
        // Duplicate from another folder — skip
        continue;
      }

      const row = {
        graph_message_id: msg.id,
        subject,
        sender_name: msg.from?.emailAddress?.name || '',
        sender_address: senderAddress,
        received_at: receivedAt,
        importance: msg.importance || 'normal',
        has_attachments: msg.hasAttachments ?? false,
        is_read: msg.isRead ?? true,
        body_preview: msg.bodyPreview || '',
        body_text: bodyText,
        body_content_type: msg.body?.contentType || 'text',
        to_recipients: (msg.toRecipients || []).map((r: any) => ({
          name: r.emailAddress?.name || '',
          address: r.emailAddress?.address || '',
        })),
        folder_name: folderName,
        user_id: userId,
        synced_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('ap_emails')
        .upsert(row, { onConflict: 'graph_message_id' });

      if (!error) {
        newCount++;
        if (!latestDate || receivedAt > latestDate) {
          latestDate = receivedAt;
        }
      }
    }

    if (messages.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // Get total stored count
  const { count } = await supabase
    .from('ap_emails')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('folder_name', folderName);

  await updateSyncState(userId, folderName, 'complete', count || 0, latestDate, null);

  return {
    newEmails: newCount,
    totalStored: count || 0,
    lastMessageDate: latestDate,
  };
}

async function updateSyncState(
  userId: string,
  folderName: string,
  status: string,
  emailsSynced: number,
  lastMessageDate: string | null,
  error: string | null,
): Promise<void> {
  await supabase
    .from('ap_email_sync')
    .upsert({
      user_id: userId,
      folder_name: folderName,
      sync_status: status,
      emails_synced: emailsSynced,
      last_sync_at: new Date().toISOString(),
      last_message_date: lastMessageDate || undefined,
      last_error: error,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,folder_name' });
}

// ─── Read: Query from Supabase (no Graph API call) ─────────────────────────

/**
 * Get stored emails from Supabase, ordered by date descending.
 * No Graph API call — reads from the synced cache.
 */
export async function getStoredEmails(
  limit: number = 20,
  afterDate?: string,
  folderName: string = DEFAULT_FOLDER_NAME,
): Promise<EmailSummary[]> {
  const account = getOutlookAccount();
  const userId = account?.username || account?.homeAccountId || '';

  let query = supabase
    .from('ap_emails')
    .select('graph_message_id, subject, body_preview, sender_name, sender_address, received_at, is_read, has_attachments, importance')
    .eq('folder_name', folderName)
    .order('received_at', { ascending: false })
    .limit(limit);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  if (afterDate) {
    query = query.gte('received_at', afterDate);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[email-store] Supabase read failed:', error);
    return [];
  }

  return (data || []).map(row => ({
    id: row.graph_message_id,
    graphMessageId: row.graph_message_id,
    subject: row.subject || '(no subject)',
    bodyPreview: row.body_preview || '',
    from: { name: row.sender_name || '', address: row.sender_address || '' },
    receivedDateTime: row.received_at,
    isRead: row.is_read ?? true,
    hasAttachments: row.has_attachments ?? false,
    importance: row.importance || 'normal',
  }));
}

/**
 * Full-text search across stored emails in Supabase.
 */
export async function searchStoredEmails(
  query: string,
  limit: number = 20,
): Promise<EmailSummary[]> {
  const account = getOutlookAccount();
  const userId = account?.username || account?.homeAccountId || '';

  // Use Postgres full-text search
  const tsQuery = query.split(/\s+/).filter(Boolean).join(' & ');

  const { data, error } = await supabase
    .from('ap_emails')
    .select('graph_message_id, subject, body_preview, sender_name, sender_address, received_at, is_read, has_attachments, importance')
    .eq('user_id', userId)
    .textSearch('subject', tsQuery, { type: 'websearch' })
    .order('received_at', { ascending: false })
    .limit(limit);

  // Fallback: if full-text search returns nothing, try ilike on subject + sender
  if ((!data || data.length === 0) && !error) {
    const { data: fallbackData } = await supabase
      .from('ap_emails')
      .select('graph_message_id, subject, body_preview, sender_name, sender_address, received_at, is_read, has_attachments, importance')
      .eq('user_id', userId)
      .or(`subject.ilike.%${query}%,sender_name.ilike.%${query}%,sender_address.ilike.%${query}%,body_text.ilike.%${query}%`)
      .order('received_at', { ascending: false })
      .limit(limit);

    return (fallbackData || []).map(rowToEmailSummary);
  }

  if (error) {
    console.error('[email-store] Search failed:', error);
    return [];
  }

  return (data || []).map(rowToEmailSummary);
}

/**
 * Read a single email's full body from Supabase.
 */
export async function getStoredEmail(graphMessageId: string): Promise<EmailFull | null> {
  const { data, error } = await supabase
    .from('ap_emails')
    .select('*')
    .eq('graph_message_id', graphMessageId)
    .single();

  if (error || !data) return null;

  return {
    id: data.graph_message_id,
    graphMessageId: data.graph_message_id,
    subject: data.subject || '(no subject)',
    bodyPreview: data.body_preview || '',
    bodyText: data.body_text || '',
    bodyContentType: data.body_content_type || 'text',
    from: { name: data.sender_name || '', address: data.sender_address || '' },
    toRecipients: (data.to_recipients as any[] || []).map((r: any) => ({
      name: r.name || '',
      address: r.address || '',
    })),
    receivedDateTime: data.received_at,
    isRead: data.is_read ?? true,
    hasAttachments: data.has_attachments ?? false,
    importance: data.importance || 'normal',
  };
}

/**
 * Get sync state for a folder.
 */
export async function getSyncState(folderName: string = DEFAULT_FOLDER_NAME) {
  const account = getOutlookAccount();
  const userId = account?.username || account?.homeAccountId || '';

  const { data } = await supabase
    .from('ap_email_sync')
    .select('*')
    .eq('user_id', userId)
    .eq('folder_name', folderName)
    .single();

  return data;
}

/**
 * Get total stored email count for a folder.
 */
export async function getStoredEmailCount(folderName: string = DEFAULT_FOLDER_NAME): Promise<number> {
  const account = getOutlookAccount();
  const userId = account?.username || account?.homeAccountId || '';

  const { count } = await supabase
    .from('ap_emails')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('folder_name', folderName);

  return count || 0;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function rowToEmailSummary(row: any): EmailSummary {
  return {
    id: row.graph_message_id,
    graphMessageId: row.graph_message_id,
    subject: row.subject || '(no subject)',
    bodyPreview: row.body_preview || '',
    from: { name: row.sender_name || '', address: row.sender_address || '' },
    receivedDateTime: row.received_at,
    isRead: row.is_read ?? true,
    hasAttachments: row.has_attachments ?? false,
    importance: row.importance || 'normal',
  };
}

// Legacy exports for backward compat with OutlookStatusPanel
export function clearEmailCache(): void {
  folderIdCache.clear();
}
