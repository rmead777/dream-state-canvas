/**
 * Shared sync utilities — used by Ragic edge functions.
 * Subset of WCW's sync-utils.ts: batch upsert + payment terms parsing.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Batch upsert records in chunks to avoid Supabase limits
 */
export async function batchUpsert<T extends Record<string, any>>(
  supabaseClient: SupabaseClient,
  tableName: string,
  records: T[],
  conflictColumn: string = 'id',
  chunkSize: number = 100
): Promise<number> {
  let totalInserted = 0

  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize)
    const { error } = await supabaseClient
      .from(tableName)
      .upsert(chunk, { onConflict: conflictColumn })

    if (error) {
      console.error(`Batch upsert error for ${tableName}:`, error)
      throw error
    }

    totalInserted += chunk.length
  }

  return totalInserted
}

/**
 * Parse payment terms to get number of days
 */
export function parsePaymentTerms(terms: string | undefined): number {
  if (!terms) return 30

  const termMap: Record<string, number> = {
    'Net 15': 15,
    'Net 30': 30,
    'Net 45': 45,
    'Net 60': 60,
    'Net 90': 90,
    'Net 120': 120,
    'Due on receipt': 0,
    'COD': 0,
  }

  if (termMap[terms] !== undefined) {
    return termMap[terms]
  }

  const match = terms.match(/Net\s*(\d+)/i)
  if (match) {
    return parseInt(match[1], 10)
  }

  return 30
}
