# Email Integration Build Plan

## Objective
Add Microsoft 365 email ingestion to Dream State Canvas so Sherpa can pull, search, and analyze AP correspondence from the "Incoa AP Automated" Outlook folder on demand.

## Architecture

```
User signs in via MSAL popup (one-time)
  → Browser holds delegated access token
  → Sherpa tool calls Graph API directly from client
  → Emails cached in memory for session
  → AI analyzes, cross-references with QB data + tracker
```

**No server-side secrets. No edge functions. Purely browser-delegated auth.**

## MSAL Configuration

- **App Registration:** Reuse Tarn's existing registration
- **Client ID:** `f62b40cb-7685-4cda-b7ce-fc91124c6477`
- **Authority:** `https://login.microsoftonline.com/common`
- **Redirect URI:** `window.location.origin` (same as Tarn)
- **Scopes:** `Mail.Read`, `offline_access`
- **Cache Location:** `localStorage`
- **Auth Flow:** Interactive popup → silent token renewal via `offline_access`

**Reference implementation:** `C:\Users\Ryan\tarn\src\lib\msalConfig.ts` and `C:\Users\Ryan\tarn\src\hooks\useOutlook.ts`

## Target Mailbox

- **User:** `rmead@fairleadadvisors.com`
- **Folder:** `Incoa AP Automated` (auto-forwarded from `ap@incoa.com`)
- **Content:** Vendor invoices, past-due notices, lien threats, shipment suspensions, payment demands, general AP correspondence

## Build Steps

### Step 1: Install MSAL packages
```bash
npm install @azure/msal-browser @azure/msal-react
```

### Step 2: Create MSAL config (`src/lib/msal-config.ts`)
- PublicClientApplication configuration
- Login request with `Mail.Read` + `offline_access` scopes
- Match Tarn's pattern exactly

### Step 3: Create email store (`src/lib/email-store.ts`)
Client-side module (same pattern as `quickbooks-store.ts`):

- `signInToOutlook()` — trigger MSAL popup, return success/failure
- `isOutlookConnected()` — check if MSAL has a cached account
- `fetchEmails(options)` — call Graph API:
  - `GET /me/mailFolders/{folderId}/messages` with `$top`, `$orderby`, `$filter`
  - Or `GET /me/messages?$search="query"&$top=N` for search
  - First call: resolve folder ID for "Incoa AP Automated" via `GET /me/mailFolders?$filter=displayName eq 'Incoa AP Automated'`
  - Cache folder ID after first lookup
- `getEmailById(id)` — fetch full email body via `GET /me/messages/{id}`
- `searchEmails(query, limit)` — full-text search scoped to the AP folder
- Session cache with no TTL (same as QB store — user clicks refresh to re-fetch)
- `clearEmailCache()` — manual refresh

### Step 4: Add MSAL provider to app root (`src/pages/Index.tsx`)
- Wrap app in `MsalProvider` from `@azure/msal-react`
- Initialize `PublicClientApplication` with config from Step 2
- Handle redirect callback (for browsers that block popups)

### Step 5: Add Outlook status to Context tab (`src/components/workspace/QBOStatusPanel.tsx` or new panel)
- Show connection status (signed in / not signed in)
- "Sign In to Outlook" button (triggers MSAL popup)
- Once signed in: show folder name, email count
- "Refresh" button to re-fetch

### Step 6: Add `queryEmails` Sherpa tool (`src/lib/sherpa-tools.ts`)
Tool definition:
```
queryEmails({
  action: "recent" | "search" | "read",
  query?: string,          // for search
  limit?: number,          // default 20, max 50
  afterDate?: string,      // ISO date filter
  emailId?: string,        // for read (full body)
})
```

Returns:
- `recent`: list of emails (subject, from, date, snippet, hasAttachments, id)
- `search`: filtered list matching query
- `read`: full email body + metadata for a specific email

### Step 7: Add `refreshEmails` Sherpa tool
Same pattern as `refreshQuickBooks` — clears cache, re-fetches.

### Step 8: Update agent context (`src/lib/sherpa-agent.ts`)
Add email hint to the system prompt:
```
OUTLOOK INTEGRATION: AP email data available via queryEmails tool.
  - "recent" — latest emails from Incoa AP Automated folder
  - "search" — search by vendor name, invoice number, keyword
  - "read" — get full email body by ID
Use when user asks about vendor communications, escalations, latest
correspondence, "what did [vendor] say?", invoice status, etc.
Cross-reference with QuickBooks data and the vendor tracker.
```

### Step 9: Update workspace persistence
- Don't persist raw email content to Supabase (per spec: "do NOT store full email bodies long-term")
- Cache is session-only (in-memory Map, same as QB)

## Graph API Endpoints Used

| Operation | Endpoint |
|-----------|----------|
| Find folder | `GET /me/mailFolders?$filter=displayName eq 'Incoa AP Automated'` |
| List emails | `GET /me/mailFolders/{folderId}/messages?$top=50&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview,from,receivedDateTime,isRead,hasAttachments,importance` |
| Search | `GET /me/messages?$search="query"&$top=20&$select=id,subject,bodyPreview,from,receivedDateTime,hasAttachments` |
| Read email | `GET /me/messages/{id}?$select=id,subject,body,from,toRecipients,receivedDateTime,hasAttachments,importance` |
| Filter by date | Add `&$filter=receivedDateTime ge 2026-03-01T00:00:00Z` |

## Edge Cases

- **Forwarded chains:** Emails from `ap@incoa.com` have nested "From:" in body. Parse inner sender from body text for vendor identification.
- **Folder not found:** If "Incoa AP Automated" doesn't exist, try searching child folders of Inbox.
- **Token expiry:** MSAL handles refresh via `offline_access`. If popup is needed, show a "Reconnect to Outlook" button.
- **Popup blocked:** Fall back to redirect flow.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/lib/msal-config.ts` | **CREATE** — MSAL configuration |
| `src/lib/email-store.ts` | **CREATE** — Graph API client + cache |
| `src/pages/Index.tsx` | **MODIFY** — Add MsalProvider wrapper |
| `src/components/workspace/OutlookStatusPanel.tsx` | **CREATE** — Connection status + sign-in button |
| `src/components/workspace/SherpaRail.tsx` | **MODIFY** — Add OutlookStatusPanel to Context tab |
| `src/lib/sherpa-tools.ts` | **MODIFY** — Add queryEmails + refreshEmails tools |
| `src/lib/sherpa-agent.ts` | **MODIFY** — Add email hint to agent context |
| `package.json` | **MODIFY** — Add @azure/msal-browser, @azure/msal-react |

## What NOT to Do

- Do NOT build a separate email client UI — Sherpa IS the interface
- Do NOT store full email bodies in Supabase — extract intel, discard raw text
- Do NOT reply to or send emails — read-only
- Do NOT hardcode folder names — make them configurable
- Do NOT use application permissions — delegated only (no admin consent needed)
- Do NOT create edge functions for this — it's all client-side via MSAL
