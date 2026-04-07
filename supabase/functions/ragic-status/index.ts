/**
 * Ragic Connection Status — lightweight health check endpoint.
 * Checks if a Ragic connection is configured and reports cached order/customer counts.
 * Does NOT hit the Ragic API — reads from local DB cache only.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Check for active connection
    const { data: connection, error: connError } = await supabase
      .from('ragic_connections')
      .select('id, account_name, last_sync_at, sheet_path, customer_database')
      .eq('is_active', true)
      .maybeSingle()

    if (connError || !connection) {
      return new Response(
        JSON.stringify({
          connected: false,
          message: 'No active Ragic connection configured.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get counts from cached data
    const [{ count: orderCount }, { count: customerCount }] = await Promise.all([
      supabase.from('ragic_orders_cache').select('*', { count: 'exact', head: true }),
      supabase.from('customer_profiles').select('*', { count: 'exact', head: true }),
    ])

    // Get order status breakdown
    const { data: statusBreakdown } = await supabase
      .from('ragic_orders_cache')
      .select('status')

    const statusCounts: Record<string, number> = {}
    for (const row of (statusBreakdown || [])) {
      const s = row.status || 'Unknown'
      statusCounts[s] = (statusCounts[s] || 0) + 1
    }

    return new Response(
      JSON.stringify({
        connected: true,
        account: connection.account_name,
        lastSyncAt: connection.last_sync_at,
        sources: {
          orders: {
            label: 'Orders',
            status: (orderCount ?? 0) > 0 ? 'connected' : 'empty',
            recordCount: orderCount ?? 0,
            statusBreakdown: statusCounts,
          },
          customers: {
            label: 'Customers',
            status: (customerCount ?? 0) > 0 ? 'connected' : 'empty',
            recordCount: customerCount ?? 0,
          },
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Ragic status check error:', error)
    return new Response(
      JSON.stringify({ connected: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
