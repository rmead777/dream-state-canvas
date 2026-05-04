/**
 * Clone Profile — Super-admin operation to copy a tuned Sherpa profile
 * (memories + documents) from a source user (the caller) to a target user.
 *
 * Auth gates (all three required):
 *   1. Caller must present a valid Supabase JWT (Authorization: Bearer <token>).
 *   2. Caller's user_id must appear in CLONE_PROFILE_ALLOWED_SOURCE_USERS env var
 *      (comma-separated UUIDs). If unset/empty, the function refuses to run.
 *   3. Request body must include `passphrase` matching CLONE_PROFILE_PASSPHRASE.
 *
 * Behavior:
 *   - Memories: skip-existing via the unique (user_id, type, content) constraint.
 *     Hit/miss counters are reset on the target side so the new user starts fresh.
 *   - Documents: skip-existing per (target_user_id, fingerprint). For each new doc,
 *     the storage object is copied to a clone-scoped path so each user owns their
 *     own bytes — deleting the source's file won't orphan the target's row.
 *   - Workspace layout, QB tokens, Ragic data, and customer profiles are NOT
 *     copied (layout is ephemeral; the others are global, not per-user).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    // ─── 1. Parse body + passphrase gate ──────────────────────────────────
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const targetEmail = typeof body.targetEmail === 'string' ? body.targetEmail.trim() : '';
    const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';

    if (!targetEmail) return json({ error: 'targetEmail required' }, 400);
    if (!passphrase) return json({ error: 'passphrase required' }, 400);

    const expectedPassphrase = Deno.env.get('CLONE_PROFILE_PASSPHRASE') ?? '';
    if (!expectedPassphrase) {
      return json(
        { error: 'Server not configured: CLONE_PROFILE_PASSPHRASE secret is missing' },
        500
      );
    }
    if (passphrase !== expectedPassphrase) {
      return json({ error: 'Invalid passphrase' }, 403);
    }

    // ─── 2. Identify caller (source user) via JWT ─────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Missing auth token' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Server not configured: Supabase env vars missing' }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: 'Invalid auth token' }, 401);
    }
    const sourceUserId = userData.user.id;

    // ─── 3. Allowlist gate ────────────────────────────────────────────────
    const allowedSourceUsers = (Deno.env.get('CLONE_PROFILE_ALLOWED_SOURCE_USERS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (allowedSourceUsers.length === 0) {
      return json(
        { error: 'Server not configured: CLONE_PROFILE_ALLOWED_SOURCE_USERS is empty' },
        500
      );
    }
    if (!allowedSourceUsers.includes(sourceUserId)) {
      return json({ error: 'Source user not authorized to clone profile' }, 403);
    }

    // ─── 4. Look up target user by email ──────────────────────────────────
    let targetUserId: string | null = null;
    const targetEmailLower = targetEmail.toLowerCase();
    const perPage = 200;
    for (let page = 1; page <= 50; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) return json({ error: `Failed to list users: ${error.message}` }, 500);
      const match = data.users.find((u) => u.email?.toLowerCase() === targetEmailLower);
      if (match) {
        targetUserId = match.id;
        break;
      }
      if (data.users.length < perPage) break;
    }
    if (!targetUserId) {
      return json({ error: `No user found with email ${targetEmail}` }, 404);
    }
    if (targetUserId === sourceUserId) {
      return json({ error: 'Source and target are the same user' }, 400);
    }

    // ─── 5. Clone memories (skip-existing via unique constraint) ──────────
    const { data: srcMemories, error: memReadErr } = await admin
      .from('sherpa_memories')
      .select('type, trigger, content, reasoning, confidence, source, tier, tags')
      .eq('user_id', sourceUserId);

    if (memReadErr) {
      return json({ error: `Failed to read memories: ${memReadErr.message}` }, 500);
    }

    let memoriesCopied = 0;
    const totalMemories = srcMemories?.length ?? 0;

    if (srcMemories && srcMemories.length > 0) {
      const rows = srcMemories.map((m) => ({
        ...m,
        user_id: targetUserId,
        hit_count: 0,
        miss_count: 0,
        last_activated_at: null,
      }));

      const { data: inserted, error: insErr } = await admin
        .from('sherpa_memories')
        .upsert(rows, {
          onConflict: 'user_id,type,content',
          ignoreDuplicates: true,
        })
        .select('id');

      if (insErr) {
        return json({ error: `Failed to insert memories: ${insErr.message}` }, 500);
      }
      memoriesCopied = inserted?.length ?? 0;
    }

    // ─── 6. Clone documents (storage copy + table row, skip dup fingerprints) ───
    const { data: srcDocs, error: docReadErr } = await admin
      .from('documents')
      .select('*')
      .eq('user_id', sourceUserId);

    if (docReadErr) {
      return json({ error: `Failed to read documents: ${docReadErr.message}` }, 500);
    }

    const { data: existingTargetDocs, error: existingErr } = await admin
      .from('documents')
      .select('fingerprint')
      .eq('user_id', targetUserId);

    if (existingErr) {
      return json(
        { error: `Failed to check target documents: ${existingErr.message}` },
        500
      );
    }

    const targetFingerprints = new Set(
      (existingTargetDocs ?? [])
        .map((d) => d.fingerprint)
        .filter((f): f is string => typeof f === 'string' && f.length > 0)
    );

    const docResults = {
      copied: 0,
      skipped: 0,
      errors: [] as string[],
      total: srcDocs?.length ?? 0,
    };

    const safeName = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);

    for (const doc of srcDocs ?? []) {
      try {
        if (doc.fingerprint && targetFingerprints.has(doc.fingerprint)) {
          docResults.skipped += 1;
          continue;
        }

        // Scratchpads are virtual documents — content lives in structured_data,
        // there's no real file in the storage bucket. Detect via metadata flag
        // OR the scratchpad mime_type so we don't try to copy a non-existent
        // storage object.
        const meta = (doc.metadata ?? {}) as Record<string, unknown>;
        const isScratchpad =
          meta.isScratchpad === true || doc.mime_type === 'application/x-scratchpad';

        let newStoragePath: string;
        let storageObjectCopied = false;

        if (isScratchpad) {
          // Generate a fresh virtual storage_path; nothing to copy in storage.
          newStoragePath = `scratchpad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        } else {
          newStoragePath = `clone-${targetUserId.slice(0, 8)}-${Date.now()}-${safeName(doc.filename ?? 'document')}`;
          const { error: copyErr } = await admin.storage
            .from('documents')
            .copy(doc.storage_path, newStoragePath);

          if (copyErr) {
            docResults.errors.push(`${doc.filename}: storage copy failed (${copyErr.message})`);
            continue;
          }
          storageObjectCopied = true;
        }

        // Strip immutable/source-specific fields. Generate a new fingerprint
        // for scratchpads so re-running the clone doesn't trip the dup check
        // on subsequent runs (each clone produces fresh scratchpad rows).
        const {
          id: _id,
          created_at: _createdAt,
          user_id: _origUser,
          storage_path: _origPath,
          fingerprint: origFingerprint,
          ...docFields
        } = doc;

        const newFingerprint = isScratchpad
          ? `scratchpad-clone-${Date.now()}-${Math.random().toString(36).slice(2)}`
          : origFingerprint;

        const { error: insertErr } = await admin.from('documents').insert({
          ...docFields,
          user_id: targetUserId,
          storage_path: newStoragePath,
          fingerprint: newFingerprint,
        });

        if (insertErr) {
          // Rollback storage copy on insert failure (only if we actually copied).
          if (storageObjectCopied) {
            await admin.storage
              .from('documents')
              .remove([newStoragePath])
              .catch(() => {
                /* best effort */
              });
          }
          docResults.errors.push(`${doc.filename}: insert failed (${insertErr.message})`);
          continue;
        }

        docResults.copied += 1;
        if (newFingerprint) targetFingerprints.add(newFingerprint);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown error';
        docResults.errors.push(`${doc.filename ?? '(unknown)'}: ${msg}`);
      }
    }

    return json({
      ok: true,
      sourceUserId,
      targetUserId,
      targetEmail,
      memories: {
        total: totalMemories,
        copied: memoriesCopied,
        skipped: totalMemories - memoriesCopied,
      },
      documents: docResults,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    console.error('clone-profile error', err);
    return json({ error: msg }, 500);
  }
});
