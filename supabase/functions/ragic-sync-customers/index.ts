/**
 * Ragic Sync Customers — Dream State Canvas
 * Syncs customer profiles from Ragic customer sheet into customer_profiles table.
 * Ported from Working Capital Wizard. Removed sync_log dependency.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { batchUpsert } from '../_shared/sync-utils.ts'
import { extractRagicRecords, fetchRagicJsonWithRetry, getRagicBaseUrl, getRagicInterRequestDelayMs, sleep, summarizeRagicPayload } from '../_shared/ragic-utils.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function safeStr(val: unknown): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') return val.trim()
  if (Array.isArray(val)) return val.join(', ').trim()
  return String(val).trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const ragicBaseUrl = getRagicBaseUrl()
  const interRequestDelayMs = getRagicInterRequestDelayMs()

  try {
    // Get Ragic connection
    const { data: connection, error: connError } = await supabase
      .from('ragic_connections')
      .select('*')
      .eq('is_active', true)
      .maybeSingle()

    if (connError || !connection) {
      throw new Error('No active Ragic connection found.')
    }

    const { account_name, api_key_encrypted, customer_database, customer_sheet_id } = connection
    if (!customer_database || !customer_sheet_id) {
      throw new Error('Customer database and sheet ID must be configured in Ragic settings.')
    }

    const apiKey = api_key_encrypted

    // Paginated fetch from Ragic
    const allRecords: Record<string, any> = {}
    let offset = 0
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
      const url = `${ragicBaseUrl}/${account_name}/${customer_database}/${customer_sheet_id}?api&limit=${pageSize}&offset=${offset}`
      console.log(`Fetching customers: offset=${offset}`)

      const data = await fetchRagicJsonWithRetry(url, apiKey, {
        label: `customer sync page offset=${offset}`,
      })
      const records = extractRagicRecords(data)
      const recordKeys = Object.keys(records)
      for (const key of recordKeys) allRecords[key] = records[key]
      hasMore = recordKeys.length >= pageSize
      offset += pageSize
      if (hasMore && interRequestDelayMs > 0) {
        await sleep(interRequestDelayMs)
      }
    }

    console.log(`Fetched ${Object.keys(allRecords).length} customer records from Ragic`)
    const endpoint = `${account_name}/${customer_database}/${customer_sheet_id}`
    const payloadSummary = summarizeRagicPayload(Object.keys(allRecords).length > 0 ? allRecords : {})

    // Parse records into profile objects
    const profiles: any[] = []
    let skipped = 0

    for (const [ragicId, record] of Object.entries(allRecords)) {
      if (ragicId.startsWith('_') || !/^\d+$/.test(ragicId)) continue
      const rec = record as any
      const accountName = safeStr(rec['Account Name'])
      if (!accountName) { skipped++; continue }

      profiles.push({
        account_name: accountName,
        account_short_name: safeStr(rec['Account Short Name']) || null,
        account_id: safeStr(rec['Account ID']) || ragicId,
        quickbooks_name: safeStr(rec['Quickbooks Name']) || null,
        parent_account: safeStr(rec['Parent Account']) || null,
        is_distributor_account: safeStr(rec['Distributor Account (?)']).toLowerCase() === 'yes',
        payment_terms: safeStr(rec['Payment Terms']) || null,
        payment_method: safeStr(rec['Payment Method']) || null,
        freight_terms: safeStr(rec['Freight Terms']) || null,
        account_type: safeStr(rec['Account Type']) || null,
        billing_company_name: safeStr(rec['Billing Company Name']) || null,
        billing_street: safeStr(rec['Billing Street']) || null,
        billing_city: safeStr(rec['Billing City']) || null,
        billing_state: safeStr(rec['Billing State/Province']) || null,
        billing_zip: safeStr(rec['Billing Zip Code']) || null,
        billing_country: safeStr(rec['Billing Country']) || null,
        shipping_company_name: safeStr(rec['Shipping Company Name']) || null,
        shipping_street: safeStr(rec['Shipping Street']) || null,
        shipping_city: safeStr(rec['Shipping City']) || null,
        shipping_state: safeStr(rec['Shipping State/Province']) || null,
        shipping_zip: safeStr(rec['Shipping Zip Code']) || null,
        shipping_country: safeStr(rec['Shipping Country']) || null,
        account_notes: safeStr(rec['Account Notes']) || null,
        po_required: safeStr(rec['PO Required (?)']).toLowerCase() === 'yes',
        updated_at: new Date().toISOString(),
      })
    }

    const synced = await batchUpsert(supabase, 'customer_profiles', profiles, 'account_name', 50)

    await supabase
      .from('ragic_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', connection.id)

    return new Response(
      JSON.stringify({
        success: true,
        totalFetched: Object.keys(allRecords).length,
        synced,
        skipped,
        diagnostic: Object.keys(allRecords).length === 0 ? {
          endpoint,
          ...payloadSummary,
          likelyCause: 'Ragic customer sheet returned 0 records. Most likely the Customer Database or Customer Sheet ID is wrong.'
        } : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Ragic customer sync error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
