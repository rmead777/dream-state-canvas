/**
 * Ragic Fetch Orders — Dream State Canvas
 * Fetches orders from Ragic, resolves customer QB names, calculates due dates,
 * and caches in ragic_orders_cache table.
 *
 * Ported from Working Capital Wizard. Removed sync_log dependency.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { batchUpsert, parsePaymentTerms } from '../_shared/sync-utils.ts'
import { extractRagicRecords, fetchRagicJsonWithRetry, getRagicBaseUrl, getRagicInterRequestDelayMs, sleep, summarizeRagicPayload } from '../_shared/ragic-utils.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// Field Mappings — Ragic field names vary across sheets
// ============================================================================

const FIELD_MAPPINGS: Record<string, string[]> = {
  orderNumber: ['Sales Order Number:', 'Sales Order Number', 'Order Number'],
  customerName: ['Quickbooks Name', 'Customer Name', 'Customer'],
  productName: ['Product:', 'Product Name', 'Product'],
  weightLbs: ['Actual Weight (Lbs):', '_1001589', '1001589'],
  weightTons: ['Actual Weight (Tons):', '_1001510', '1001510'],
  requestedWeightTons: ['Requested Weight (Tons):', 'Requested Weight (Tons)'],
  lbsOnOrder: [
    'Total Lbs. on Order:', 'Total Lbs. on Order',
    'Pounds (Lbs.) On Order:', 'Pounds (Lbs.) On Order',
    'Subtotal Lbs. on Order:', 'Subtotal Lbs. on Order',
  ],
  pricePerLb: [
    'Deliverable Price/Lbs.:', 'Product Price (Lbs.):',
    'Deliverable Price/lb', 'Price/lb', 'Unit Price',
  ],
  pricePerTon: [
    'Deliverable Price/Ton:', 'Product Price (Tons):',
    'Deliverable Price/Ton',
  ],
  status: ['Status:', 'Status'],
  actualDeliveryDate: [
    'Actual Delivery Date', 'Actual Delivery Date:',
    'Actual Shipping Date', 'Actual Shipping Date:',
    '_1000604', '1000604', 'Date Completed:', 'Delivery Date:', 'Delivery Date',
  ],
  requestedDeliveryDate: [
    'Requested Delivery Date', 'Requested Delivery Date:',
    'Requested Shipping Date', 'Requested Shipping Date:',
    '_1000603', '1000603',
  ],
  customerPO: ['Customer PO Number:', 'Customer PO Number', 'Customer PO'],
  paymentTerms: ['Payment Terms:', 'Payment Terms', 'Terms'],
  className: ['Class:', 'Class', '_1000619', '1000619'],
}

function getFieldValue(record: any, fieldNames: string[]): any {
  for (const name of fieldNames) {
    const val = record[name]
    if (val !== undefined && val !== null && val !== '') return val
  }
  return null
}

// ============================================================================
// Date Parsing — Ragic uses multiple date formats
// ============================================================================

function parseRagicDate(dateStr: string | null): Date | null {
  if (!dateStr) return null
  const s = String(dateStr).trim()
  if (!s) return null

  const ymd = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/)
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))

  const mdy4 = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/)
  if (mdy4) return new Date(Number(mdy4[3]), Number(mdy4[1]) - 1, Number(mdy4[2]))

  const mdy2 = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2})$/)
  if (mdy2) return new Date(2000 + Number(mdy2[3]), Number(mdy2[1]) - 1, Number(mdy2[2]))

  const parsed = new Date(s)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDateISO(date: Date | null): string | null {
  if (!date) return null
  return date.toISOString().split('T')[0]
}

// ============================================================================
// Weight & Price Resolution
// ============================================================================

function resolveWeight(record: any, status: string): number {
  const isPreShipment = ['Order Confirmed', 'Packaged/Loaded'].includes(status)

  if (!isPreShipment) {
    const actualLbs = parseFloat(getFieldValue(record, FIELD_MAPPINGS.weightLbs)) || 0
    if (actualLbs > 0) return actualLbs
    const actualTons = parseFloat(getFieldValue(record, FIELD_MAPPINGS.weightTons)) || 0
    if (actualTons > 0) return actualTons * 2000
  }

  const requestedTons = parseFloat(getFieldValue(record, FIELD_MAPPINGS.requestedWeightTons)) || 0
  if (requestedTons > 0) return requestedTons * 2000

  const lbsOnOrder = parseFloat(getFieldValue(record, FIELD_MAPPINGS.lbsOnOrder)) || 0
  if (lbsOnOrder > 0) return lbsOnOrder

  const actualTons = parseFloat(getFieldValue(record, FIELD_MAPPINGS.weightTons)) || 0
  if (actualTons > 0) return actualTons * 2000

  return 0
}

const CLASS_TO_SUFFIX: Record<string, string> = {
  'Bulk': 'BLK',
  'Transload Bulk': 'BLK',
  'Semi-Bulk': '2000SS',
  '50# Bags': '50B',
  'Bucket Lg': '50B',
  'Bucket Sm': '50B',
}

function normalizeCustomerName(name: string): string[] {
  const lower = name.toLowerCase().trim()
  const candidates = [lower]

  const stripped = lower
    .replace(/\s*-\s*li$/i, '')
    .replace(/\s*-li$/i, '')
    .replace(/\s*-\s*p2$/i, '')
    .replace(/\s*tb\s*warehouse$/i, '')
    .replace(/\s*lintech$/i, '')
    .trim()
  if (stripped !== lower) candidates.push(stripped)

  const noParens = stripped.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
  if (noParens !== stripped) candidates.push(noParens)

  const noLegal = noParens
    .replace(/,?\s*(inc\.?|llc|corp\.?|co\.?|company|mfg\.?|ltd\.?)$/i, '')
    .trim()
  if (noLegal !== noParens) candidates.push(noLegal)

  const noPunct = noLegal.replace(/[.,]+$/, '').trim()
  if (noPunct !== noLegal) candidates.push(noPunct)

  return [...new Set(candidates)]
}

function resolvePrice(
  record: any,
  customerName: string,
  productName: string,
  className: string,
  priceOverrides: Map<string, number>
): number {
  const custCandidates = normalizeCustomerName(customerName)
  const suffix = CLASS_TO_SUFFIX[className] || ''
  const productCandidates: string[] = []
  if (suffix) {
    productCandidates.push(`${productName}-${suffix}/DR`)
    productCandidates.push(`${productName}-${suffix}DR`)
    productCandidates.push(`${productName}-${suffix}`)
  }
  productCandidates.push(productName)

  for (const cust of custCandidates) {
    for (const prod of productCandidates) {
      const key = `${cust}|${prod.toLowerCase()}`
      if (priceOverrides.has(key)) return priceOverrides.get(key)!
    }
  }

  const priceLb = parseFloat(getFieldValue(record, FIELD_MAPPINGS.pricePerLb)) || 0
  if (priceLb > 0) return priceLb

  const priceTon = parseFloat(getFieldValue(record, FIELD_MAPPINGS.pricePerTon)) || 0
  if (priceTon > 0) return priceTon / 2000

  return 0
}

// ============================================================================
// Paginated Ragic Fetcher
// ============================================================================

async function fetchAllPages(
  ragicBaseUrl: string,
  accountName: string,
  sheetPath: string,
  apiKey: string,
  options: { label: string; interRequestDelayMs: number; dateFrom?: string }
): Promise<Record<string, any>> {
  const allRecords: Record<string, any> = {}
  let offset = 0
  const pageSize = 500
  let hasMore = true

  let whereClause = ''
  if (options.dateFrom) {
    const ragicDate = options.dateFrom.replace(/-/g, '/')
    whereClause = `&where=1000603,gte,${ragicDate}`
    console.log(`[Ragic] ${options.label}: API filter where=1000603 gte ${ragicDate}`)
  }

  while (hasMore) {
    const url = `${ragicBaseUrl}/${accountName}/${sheetPath}?api&limit=${pageSize}&offset=${offset}${whereClause}`
    console.log(`Fetching ${options.label}: offset=${offset}`)

    const data = await fetchRagicJsonWithRetry(url, apiKey, {
      label: `${options.label} offset=${offset}`,
      timeoutMs: 45000,
      maxRetries: 2,
    })
    const records = extractRagicRecords(data)
    const keys = Object.keys(records)
    for (const k of keys) allRecords[k] = records[k]
    hasMore = keys.length >= pageSize
    offset += pageSize
    if (hasMore && options.interRequestDelayMs > 0) {
      await sleep(options.interRequestDelayMs)
    }
  }

  return allRecords
}

// ============================================================================
// Main Handler
// ============================================================================

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
    const body = await req.json().catch(() => ({}))
    const { statusFilter, deliveryDateFrom, deliveryDateTo } = body

    // 1. Get Ragic connection
    const { data: connection, error: connError } = await supabase
      .from('ragic_connections')
      .select('*')
      .eq('is_active', true)
      .maybeSingle()

    if (connError || !connection) {
      throw new Error('No active Ragic connection found.')
    }

    const { account_name, api_key_encrypted, sheet_path, shipment_sheet_path } = connection
    const apiKey = api_key_encrypted

    // 2. Load customer profiles + price overrides in parallel
    const [{ data: profiles }, { data: priceData }] = await Promise.all([
      supabase
        .from('customer_profiles')
        .select('account_name, account_short_name, quickbooks_name, payment_terms'),
      supabase
        .from('customer_product_prices')
        .select('customer_name, product_name, price_per_lb'),
    ])

    const profileMap = new Map<string, any>()
    for (const p of (profiles || [])) {
      if (p.account_name) profileMap.set(p.account_name.toLowerCase(), p)
      if (p.quickbooks_name) profileMap.set(p.quickbooks_name.toLowerCase(), p)
      if (p.account_short_name) profileMap.set(p.account_short_name.toLowerCase(), p)
    }

    const priceOverrides = new Map<string, number>()
    for (const p of (priceData || [])) {
      priceOverrides.set(`${p.customer_name.toLowerCase()}|${p.product_name.toLowerCase()}`, p.price_per_lb)
    }

    // 3. Fetch orders then shipments from Ragic SEQUENTIALLY
    const fetchOpts = { interRequestDelayMs, dateFrom: deliveryDateFrom }
    const allRecords = await fetchAllPages(ragicBaseUrl, account_name, sheet_path, apiKey, {
      ...fetchOpts, label: 'orders',
    })

    let shipmentRecords: Record<string, any> = {}
    if (shipment_sheet_path) {
      try {
        shipmentRecords = await fetchAllPages(ragicBaseUrl, account_name, shipment_sheet_path, apiKey, {
          ...fetchOpts, label: 'shipments',
        })
      } catch (err) {
        console.warn('Shipment sheet fetch failed, continuing without it', err)
      }
    }

    console.log(`Fetched ${Object.keys(allRecords).length} order records from Ragic`)
    const endpoint = `${account_name}/${sheet_path}`
    const payloadSummary = summarizeRagicPayload(Object.keys(allRecords).length > 0 ? allRecords : {})

    // 4. Build shipment lookup maps
    const shipmentWeights = new Map<string, number>()
    const shipmentDates = new Map<string, string>()

    for (const [, rec] of Object.entries(shipmentRecords)) {
      const orderNum = getFieldValue(rec, FIELD_MAPPINGS.orderNumber)
      if (!orderNum) continue
      const weightTons = parseFloat(getFieldValue(rec, FIELD_MAPPINGS.weightTons)) || 0
      const weightLbs = parseFloat(getFieldValue(rec, FIELD_MAPPINGS.weightLbs)) || 0
      const weight = weightLbs > 0 ? weightLbs : weightTons * 2000
      if (weight > 0) shipmentWeights.set(orderNum, weight)
      const delivDate = getFieldValue(rec, FIELD_MAPPINGS.actualDeliveryDate)
      if (delivDate) shipmentDates.set(orderNum, delivDate)
    }

    // 5. Parse and transform orders
    const orders: any[] = []
    let skipped = 0

    for (const [ragicId, record] of Object.entries(allRecords)) {
      if (ragicId.startsWith('_') || !/^\d+$/.test(ragicId)) continue

      const status = String(getFieldValue(record, FIELD_MAPPINGS.status) || '').trim()
      const customerName = String(getFieldValue(record, FIELD_MAPPINGS.customerName) || '').trim()
      const productName = String(getFieldValue(record, FIELD_MAPPINGS.productName) || '').trim()
      const orderNumber = String(getFieldValue(record, FIELD_MAPPINGS.orderNumber) || '').trim()

      if (!customerName) { skipped++; continue }

      const EXCLUDED_STATUSES = ['Cancelled', 'HOLD', 'Rescheduled', 'Submitted', 'Approval Needed']
      if (EXCLUDED_STATUSES.includes(status)) { skipped++; continue }

      if (statusFilter && statusFilter !== 'All' && status !== statusFilter) {
        skipped++; continue
      }

      const actualDateStr = getFieldValue(record, FIELD_MAPPINGS.actualDeliveryDate)
      const requestedDateStr = getFieldValue(record, FIELD_MAPPINGS.requestedDeliveryDate)
      const shipDateStr = orderNumber ? shipmentDates.get(orderNumber) : null

      // Actual ship date — Shipments sheet is authoritative, falls back to order's own field
      let actualShipDate: Date | null = null
      if (shipDateStr) actualShipDate = parseRagicDate(shipDateStr)
      if (!actualShipDate && actualDateStr) actualShipDate = parseRagicDate(actualDateStr)

      // Requested delivery date — direct from order
      const requestedDeliveryDate: Date | null = requestedDateStr ? parseRagicDate(requestedDateStr) : null

      // Backward-compat: delivery_date = actual ?? requested
      const deliveryDate: Date | null = actualShipDate ?? requestedDeliveryDate
      const hasShipped = actualShipDate !== null

      if (deliveryDateFrom && deliveryDate) {
        if (deliveryDate < new Date(deliveryDateFrom)) { skipped++; continue }
      }
      if (deliveryDateTo && deliveryDate) {
        if (deliveryDate > new Date(deliveryDateTo)) { skipped++; continue }
      }

      let quantity = 0
      if (orderNumber && shipmentWeights.has(orderNumber)) {
        quantity = shipmentWeights.get(orderNumber)!
      } else {
        quantity = resolveWeight(record, status)
      }

      const profile = profileMap.get(customerName.toLowerCase())
      const resolvedQbName = profile?.quickbooks_name || customerName
      const paymentTerms = String(
        getFieldValue(record, FIELD_MAPPINGS.paymentTerms) || profile?.payment_terms || 'Net 30'
      )

      const className = String(getFieldValue(record, FIELD_MAPPINGS.className) || '').trim()
      const customerPO = getFieldValue(record, FIELD_MAPPINGS.customerPO)
      const unitPrice = resolvePrice(record, customerName, productName, className, priceOverrides)
      const totalAmount = quantity * unitPrice

      let dueDate: Date | null = null
      if (deliveryDate) {
        const termDays = parsePaymentTerms(paymentTerms)
        dueDate = new Date(deliveryDate)
        dueDate.setDate(dueDate.getDate() + termDays)
      }

      orders.push({
        ragic_id: ragicId,
        order_number: orderNumber || null,
        customer_name: customerName,
        resolved_qb_customer_name: resolvedQbName,
        product_name: productName || null,
        quantity,
        unit_price: unitPrice,
        total_amount: totalAmount,
        invoice_date: formatDateISO(deliveryDate),
        due_date: formatDateISO(dueDate),
        payment_terms: paymentTerms,
        customer_po: customerPO || null,
        status,
        class_name: className || null,
        delivery_date: formatDateISO(deliveryDate),
        raw_record: record,
        updated_at: new Date().toISOString(),
      })
    }

    console.log(`Parsed ${orders.length} orders, skipped ${skipped}`)

    // 6. Cache orders — delete existing and re-insert for clean state
    await supabase.from('ragic_orders_cache').delete().neq('id', '00000000-0000-0000-0000-000000000000')

    let synced = 0
    if (orders.length > 0) {
      synced = await batchUpsert(supabase, 'ragic_orders_cache', orders, 'ragic_id', 100)
    }

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
          likelyCause: 'Ragic orders sheet returned 0 records. Most likely the Orders Sheet Path is wrong or the sheet is currently empty.'
        } : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Ragic order sync error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
