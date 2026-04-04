/**
 * QuickBooks Connection Status — lightweight health check endpoint.
 *
 * Reads qbo_connections and sync_log from WCW's Supabase to report
 * connection health and data freshness per data type.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const wcwUrl = Deno.env.get('WCW_SUPABASE_URL');
    const wcwKey = Deno.env.get('WCW_SUPABASE_SERVICE_ROLE_KEY');

    if (!wcwUrl || !wcwKey) {
      return new Response(
        JSON.stringify({
          connected: false,
          error: 'QuickBooks integration not configured',
          sources: {},
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const wcw = createClient(wcwUrl, wcwKey);

    // Get active connection
    const { data: connection, error: connError } = await wcw
      .from('qbo_connections')
      .select('id, realm_id, company_name, is_active, connection_status, token_expires_at, last_sync_at, last_error, updated_at')
      .eq('is_active', true)
      .eq('connection_status', 'active')
      .single();

    if (connError || !connection) {
      return new Response(
        JSON.stringify({
          connected: false,
          error: 'No active QuickBooks connection',
          sources: {},
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get latest sync log per sync type
    const { data: syncLogs } = await wcw
      .from('sync_log')
      .select('sync_type, sync_status, completed_at, records_synced, error_message')
      .eq('sync_status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(50);

    // Build per-type freshness map (latest completed sync per type)
    const latestByType: Record<string, { completedAt: string; recordsSynced: number }> = {};
    for (const log of syncLogs || []) {
      if (!latestByType[log.sync_type]) {
        latestByType[log.sync_type] = {
          completedAt: log.completed_at,
          recordsSynced: log.records_synced || 0,
        };
      }
    }

    // Map WCW sync types to DSC data source labels
    const sourceMap: Record<string, { label: string; wcwTypes: string[] }> = {
      ap: { label: 'Accounts Payable', wcwTypes: ['ap_detail', 'ap_aging'] },
      ar: { label: 'Accounts Receivable', wcwTypes: ['ar_detail', 'ar_aging'] },
      bank: { label: 'Bank Balances', wcwTypes: ['bank_balances'] },
      vendors: { label: 'Vendors', wcwTypes: ['entities'] },
      customers: { label: 'Customers', wcwTypes: ['entities'] },
      payments: { label: 'Bill Payments', wcwTypes: ['bill_payments'] },
    };

    const now = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    const sources: Record<string, any> = {};
    for (const [key, { label, wcwTypes }] of Object.entries(sourceMap)) {
      // Find the most recent sync across all related WCW sync types
      let latestSync: string | null = null;
      let totalRecords = 0;
      for (const wcwType of wcwTypes) {
        const entry = latestByType[wcwType];
        if (entry) {
          if (!latestSync || new Date(entry.completedAt) > new Date(latestSync)) {
            latestSync = entry.completedAt;
          }
          totalRecords += entry.recordsSynced;
        }
      }

      let status: 'connected' | 'stale' | 'not_connected';
      if (!latestSync) {
        status = 'not_connected';
      } else if (now - new Date(latestSync).getTime() > ONE_DAY_MS) {
        status = 'stale';
      } else {
        status = 'connected';
      }

      sources[key] = {
        label,
        status,
        lastSync: latestSync,
        recordCount: totalRecords,
      };
    }

    // Token health
    const tokenExpiresAt = new Date(connection.token_expires_at);
    const tokenHealthy = tokenExpiresAt.getTime() > now;

    return new Response(
      JSON.stringify({
        connected: true,
        company: connection.company_name,
        realmId: connection.realm_id,
        tokenHealthy,
        tokenExpiresAt: connection.token_expires_at,
        lastSync: connection.last_sync_at,
        sources,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('qbo-status error:', error);
    return new Response(
      JSON.stringify({ connected: false, error: error.message, sources: {} }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
