/**
 * Ragic API Utilities — shared by ragic-fetch-orders, ragic-sync-customers, ragic-status.
 * Ported from Working Capital Wizard. Handles auth, retries, record extraction.
 */

type RagicRecordMap = Record<string, any>

export function getRagicError(payload: any): { code?: number | string; message: string } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null

  const status = typeof payload.status === 'string' ? payload.status.toUpperCase() : ''
  const message = payload.msg || payload.message || payload.error

  if (status === 'ERROR' && message) {
    return {
      code: payload.code,
      message: String(message),
    }
  }

  return null
}

export function getRagicBaseUrl(): string {
  return (Deno.env.get('RAGIC_BASE_URL') || 'https://na4.ragic.com').replace(/\/$/, '')
}

function tryDecodeBase64(value: string): string | null {
  try {
    const decoded = atob(value)
    return decoded && decoded !== value ? decoded : null
  } catch {
    return null
  }
}

function isLikelyApiKey(value: string): boolean {
  return /^[A-Za-z0-9._\-+/=]+$/.test(value) && value.length >= 20
}

export function getRagicApiKeyCandidates(rawValue: string): string[] {
  const normalized = String(rawValue || '').trim()
  const candidates: string[] = []

  const decoded = normalized ? tryDecodeBase64(normalized)?.trim() : null
  if (decoded && decoded !== normalized && isLikelyApiKey(decoded)) {
    candidates.push(decoded)
  }

  if (normalized) {
    candidates.push(normalized)
  }

  return [...new Set(candidates)]
}

function getNumberEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name)
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function getRagicTimeoutMs(): number {
  return getNumberEnv('RAGIC_TIMEOUT_MS', 45000)
}

export function getRagicMaxRetries(): number {
  return getNumberEnv('RAGIC_MAX_RETRIES', 2)
}

export function getRagicRetryBaseDelayMs(): number {
  return getNumberEnv('RAGIC_RETRY_BASE_DELAY_MS', 2000)
}

export function getRagicInterRequestDelayMs(): number {
  return getNumberEnv('RAGIC_INTER_REQUEST_DELAY_MS', 50)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export async function fetchRagicJsonWithRetry(
  url: string,
  apiKey: string,
  options?: {
    timeoutMs?: number
    maxRetries?: number
    retryBaseDelayMs?: number
    label?: string
  }
): Promise<any> {
  const timeoutMs = options?.timeoutMs ?? getRagicTimeoutMs()
  const maxRetries = options?.maxRetries ?? getRagicMaxRetries()
  const retryBaseDelayMs = options?.retryBaseDelayMs ?? getRagicRetryBaseDelayMs()
  const label = options?.label ?? 'Ragic request'
  const keyCandidates = getRagicApiKeyCandidates(apiKey)

  let lastError: Error | null = null

  for (const [keyIndex, candidateKey] of keyCandidates.entries()) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const startedAt = Date.now()
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      try {
        console.log(`[Ragic] ${label} attempt ${attempt}/${maxRetries} with key candidate ${keyIndex + 1}/${keyCandidates.length}: ${url}`)
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${candidateKey}`,
            'Accept': 'application/json',
          },
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text()
          const durationMs = Date.now() - startedAt
          const message = `Ragic API error (${label}) ${response.status} after ${durationMs}ms: ${errorText}`
          if (isRetryableStatus(response.status) && attempt < maxRetries) {
            const backoffMs = retryBaseDelayMs * Math.pow(2, attempt - 1)
            console.warn(`[Ragic] ${message}. Retrying in ${backoffMs}ms.`)
            await sleep(backoffMs)
            continue
          }
          throw new Error(message)
        }

        const durationMs = Date.now() - startedAt
        const payload = await response.json()
        const ragicError = getRagicError(payload)

        if (ragicError) {
          const message = `Ragic API returned an error (${label})${ragicError.code !== undefined ? ` code ${ragicError.code}` : ''} after ${durationMs}ms: ${ragicError.message}`

          if (String(ragicError.code) === '106' && keyIndex < keyCandidates.length - 1) {
            console.warn(`[Ragic] ${message}. Trying next API key candidate.`)
            break
          }

          throw new Error(message)
        }

        console.log(`[Ragic] ${label} succeeded in ${durationMs}ms on attempt ${attempt}/${maxRetries}`)
        return payload
      } catch (error: any) {
        clearTimeout(timeoutId)
        const durationMs = Date.now() - startedAt
        const isAbort = error?.name === 'AbortError'
        const message = isAbort
          ? `Ragic request timed out (${label}) after ${timeoutMs}ms`
          : `Ragic request failed (${label}) after ${durationMs}ms: ${error?.message || String(error)}`

        lastError = new Error(message)

        if (attempt < maxRetries) {
          const backoffMs = retryBaseDelayMs * Math.pow(2, attempt - 1)
          console.warn(`[Ragic] ${message}. Retrying in ${backoffMs}ms.`)
          await sleep(backoffMs)
          continue
        }
      }
    }
  }

  throw lastError || new Error('Ragic request failed after all retry attempts.')
}

function toRecordMapFromArray(records: any[]): RagicRecordMap {
  const map: RagicRecordMap = {}
  records.forEach((record, index) => {
    const key = String(record?.id ?? record?._ragicId ?? record?.ragic_id ?? index)
    map[key] = record
  })
  return map
}

function extractNumericKeyMap(obj: Record<string, any>): RagicRecordMap {
  const keys = Object.keys(obj).filter(k => /^\d+$/.test(k))
  if (keys.length === 0) return {}

  const out: RagicRecordMap = {}
  for (const key of keys) out[key] = obj[key]
  return out
}

export function extractRagicRecords(payload: any): RagicRecordMap {
  if (!payload) return {}

  if (Array.isArray(payload)) {
    return toRecordMapFromArray(payload)
  }

  if (typeof payload !== 'object') return {}

  const directRecords = extractNumericKeyMap(payload)
  if (Object.keys(directRecords).length > 0) return directRecords

  const candidateKeys = ['data', 'records', 'items', 'result', 'results']
  for (const key of candidateKeys) {
    const candidate = payload[key]
    if (!candidate) continue

    if (Array.isArray(candidate)) {
      return toRecordMapFromArray(candidate)
    }

    if (typeof candidate === 'object') {
      const nestedNumericRecords = extractNumericKeyMap(candidate)
      if (Object.keys(nestedNumericRecords).length > 0) return nestedNumericRecords

      const nestedValues = Object.values(candidate).filter(v => v && typeof v === 'object')
      if (nestedValues.length > 0) {
        return toRecordMapFromArray(nestedValues)
      }
    }
  }

  const objectValues = Object.values(payload).filter(v => v && typeof v === 'object')
  if (objectValues.length > 0) {
    return toRecordMapFromArray(objectValues)
  }

  return {}
}

export function summarizeRagicPayload(payload: any) {
  if (payload === null || payload === undefined) {
    return { payloadType: String(payload), topLevelKeys: [] as string[] }
  }

  if (Array.isArray(payload)) {
    return {
      payloadType: 'array',
      topLevelKeys: [],
      arrayLength: payload.length,
    }
  }

  if (typeof payload === 'object') {
    return {
      payloadType: 'object',
      topLevelKeys: Object.keys(payload).slice(0, 20),
    }
  }

  return {
    payloadType: typeof payload,
    topLevelKeys: [] as string[],
  }
}
