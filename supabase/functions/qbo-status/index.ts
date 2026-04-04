/**
 * QuickBooks Connection Status — lightweight health check endpoint.
 *
 * Probes the live QuickBooks API to verify each data source is reachable.
 * Reads the OAuth token from WCW's Supabase (same as qbo-data), then
 * fires lightweight queries against QB to confirm each source works.
 *
 * DSC always fetches live from QB — no dependency on WCW sync schedules.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { getQBOToken, queryQBO, fetchQBOReport } from '../_shared/qbo-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SourceProbe {
  label: string;
  query: () => Promise<{ ok: boolean; count: number }>;
}

serve(async (req) => {
  // Handle CORS preflight and accept both GET and POST
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Step 1: Can we get a valid token?
    let token: string;
    let connection: any;
    try {
      const result = await getQBOToken();
      token = result.token;
      connection = result.connection;
    } catch (tokenErr) {
      return new Response(
        JSON.stringify({
          connected: false,
          error: (tokenErr as Error).message,
          sources: {},
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Step 2: Probe each data source with a lightweight query (COUNT or MAXRESULTS 1)
    const probes: Record<string, SourceProbe> = {
      ap: {
        label: 'Accounts Payable',
        query: async () => {
          const data = await queryQBO(token, connection,
            "SELECT COUNT(*) FROM Bill WHERE Balance > '0'");
          return { ok: true, count: data.QueryResponse?.totalCount ?? 0 };
        },
      },
      ar: {
        label: 'Accounts Receivable',
        query: async () => {
          const data = await queryQBO(token, connection,
            "SELECT COUNT(*) FROM Invoice WHERE Balance > '0'");
          return { ok: true, count: data.QueryResponse?.totalCount ?? 0 };
        },
      },
      bank: {
        label: 'Bank Balances',
        query: async () => {
          const data = await queryQBO(token, connection,
            "SELECT Id FROM Account WHERE AccountType = 'Bank' AND Active = true MAXRESULTS 1");
          const accounts = data.QueryResponse?.Account || [];
          return { ok: true, count: accounts.length > 0 ? -1 : 0 }; // -1 = "available, count unknown"
        },
      },
      vendors: {
        label: 'Vendors',
        query: async () => {
          const data = await queryQBO(token, connection,
            "SELECT COUNT(*) FROM Vendor WHERE Active = true");
          return { ok: true, count: data.QueryResponse?.totalCount ?? 0 };
        },
      },
      customers: {
        label: 'Customers',
        query: async () => {
          const data = await queryQBO(token, connection,
            "SELECT COUNT(*) FROM Customer WHERE Active = true");
          return { ok: true, count: data.QueryResponse?.totalCount ?? 0 };
        },
      },
      bill_payments: {
        label: 'Bill Payments',
        query: async () => {
          const data = await queryQBO(token, connection,
            "SELECT Id FROM BillPayment MAXRESULTS 1");
          return { ok: true, count: -1 };
        },
      },
      pnl: {
        label: 'Profit & Loss',
        query: async () => {
          // Just verify the report endpoint responds
          await fetchQBOReport(token, connection, 'ProfitAndLoss', {
            start_date: new Date().toISOString().split('T')[0],
            end_date: new Date().toISOString().split('T')[0],
          });
          return { ok: true, count: -1 };
        },
      },
    };

    // Run all probes in parallel
    const probeEntries = Object.entries(probes);
    const results = await Promise.allSettled(
      probeEntries.map(([, probe]) => probe.query()),
    );

    const sources: Record<string, any> = {};
    for (let i = 0; i < probeEntries.length; i++) {
      const [key, probe] = probeEntries[i];
      const result = results[i];

      if (result.status === 'fulfilled' && result.value.ok) {
        sources[key] = {
          label: probe.label,
          status: 'connected',
          recordCount: result.value.count,
        };
      } else {
        const errorMsg = result.status === 'rejected'
          ? (result.reason as Error).message
          : 'Query returned no data';
        sources[key] = {
          label: probe.label,
          status: 'not_connected',
          error: errorMsg,
        };
      }
    }

    return new Response(
      JSON.stringify({
        connected: true,
        company: connection.company_name,
        realmId: connection.realm_id,
        tokenHealthy: true,
        sources,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('qbo-status error:', error);
    return new Response(
      JSON.stringify({ connected: false, error: (error as Error).message, sources: {} }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
