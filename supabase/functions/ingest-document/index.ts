import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { routeToProvider } from "../_shared/provider-router.ts";

// ─── Ingest model config (overridable per-request via body) ───────────────────
const DEFAULT_INGEST_MODEL = "anthropic/claude-sonnet-4-6";
const DEFAULT_INGEST_MAX_TOKENS = 64000;
// Lightweight summary uses a cheaper model + smaller budget
const SUMMARY_MODEL = "anthropic/claude-haiku-4-5-20251001";
const SUMMARY_MAX_TOKENS = 2048;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── XLSX/CSV parsing helpers ────────────────────────────────────────────────

/**
 * Parse CSV text into { headers, rows }.
 */
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  // Simple CSV split (handles most cases, not full RFC 4180)
  const split = (line: string) => {
    const result: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { result.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    result.push(cur.trim());
    return result;
  };
  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

/**
 * Minimal XLSX parser — reads shared strings + sheets from the zip.
 * Returns all worksheets with their data.
 */
async function parseXLSX(
  buffer: ArrayBuffer
): Promise<{ sheets: Record<string, { headers: string[]; rows: string[][] }> }> {
  // We'll use a minimal approach: send raw base64 to AI for understanding
  // But first try structured parsing via a lightweight approach
  
  // For XLSX we need to decompress the zip. Deno has no built-in xlsx parser,
  // so we'll extract what we can and let AI do the heavy lifting.
  // Strategy: convert to base64, send to AI with vision for full workbook understanding.
  
  // Fallback: return raw bytes for AI processing
  return { sheets: {} };
}

/**
 * Ask AI to analyze an XLSX workbook — understands ALL sheets, structure, relationships.
 * This is the "Let AI Be AI" approach: give it the full document and let it reason.
 */
async function aiAnalyzeSpreadsheet(
  base64: string,
  filename: string,
  apiKey: string
): Promise<{
  sheets: Record<string, { headers: string[]; rows: string[][]; aiAssessment: string }>;
  primarySheet: string;
  domain: string;
  summary: string;
  keywords: string[];
}> {
  // Send file content description to AI for structural analysis
  // For XLSX, we need to parse it first — use SheetJS-compatible approach
  // Since we can't parse XLSX natively in Deno edge functions reliably,
  // we'll ask the client to send pre-parsed sheet data
  
  // This endpoint accepts either:
  // 1. Raw file (we extract what we can)  
  // 2. Pre-parsed sheets from client-side parsing (preferred for XLSX)
  
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: `You are a document analyst. You receive structured data from a spreadsheet workbook.
Analyze ALL sheets and determine:
1. Which sheet(s) contain the primary operational data
2. Which are reference/lookup tables
3. The domain of the data
4. A concise summary
5. Keywords for search/retrieval

Return JSON:
{
  "primarySheet": "sheet name",
  "domain": "string",
  "summary": "1-2 sentence summary",
  "keywords": ["keyword1", "keyword2", ...],
  "sheetAssessments": { "SheetName": "assessment of what this sheet contains and its role" }
}
Return ONLY JSON, no markdown.`,
        },
        {
          role: "user",
          content: `Workbook: "${filename}"\n\nSheet data provided by the client. Analyze the structure and content.`,
        },
      ],
    }),
  });

  if (!resp.ok) {
    return {
      sheets: {},
      primarySheet: "",
      domain: "unknown",
      summary: `Uploaded spreadsheet: ${filename}`,
      keywords: [filename],
    };
  }

  const result = await resp.json();
  const content = result.choices?.[0]?.message?.content || "";
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fallback */ }

  return {
    sheets: {},
    primarySheet: "",
    domain: "unknown",
    summary: `Uploaded spreadsheet: ${filename}`,
    keywords: [filename],
  };
}

/**
 * AI-powered document understanding for PDFs, images, and text docs.
 * Routes through provider-router so any supported model (Claude, Gemini, etc.) can be used.
 *
 * For Anthropic models with PDFs: the router translates image_url data URIs to native
 * document content blocks, which gives layout-aware extraction with up to 64K output tokens.
 */
async function aiUnderstandDocument(
  content: string,
  filename: string,
  fileType: string,
  mimeType: string,
  modelId: string = DEFAULT_INGEST_MODEL,
  maxTokens: number = DEFAULT_INGEST_MAX_TOKENS,
): Promise<{ summary: string; keywords: string[]; extractedText: string; structuredInsights: Record<string, unknown> }> {
  const isImage = fileType === "image";
  const isPdf = fileType === "pdf";

  const systemPrompt = `You are an expert document analyst. You receive a document and must:
1. Understand its full content, structure, and purpose
2. Extract ALL text content faithfully — do not summarize or skip sections
3. Identify key entities, numbers, dates, and relationships
4. Provide a concise summary
5. Generate search keywords

Return JSON:
{
  "summary": "comprehensive 2-3 sentence summary",
  "keywords": ["keyword1", "keyword2", ...],
  "extractedText": "full extracted text content preserving structure",
  "structuredInsights": {
    "documentType": "contract/report/invoice/memo/etc",
    "keyEntities": ["entity1", "entity2"],
    "keyNumbers": [{"label": "...", "value": "..."}],
    "keyDates": [{"label": "...", "date": "..."}],
    "sections": ["section1", "section2"]
  }
}
Return ONLY JSON, no markdown fences.`;

  const messages: Array<{ role: string; content: any }> = [];

  if (isImage || isPdf) {
    // Vision/document input: base64 data URI is translated per-provider in provider-router
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: `Analyze this ${fileType} document: "${filename}". Extract ALL text and understand the full content. Be thorough — capture every detail from the first page to the last.`,
        },
        {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${content}` },
        },
      ],
    });
  } else {
    // Plain text document
    messages.push({
      role: "user",
      content: `Analyze this ${fileType} document: "${filename}"\n\nFull content:\n${content}`,
    });
  }

  const { response: resp, meta } = await routeToProvider(
    modelId,
    systemPrompt,
    messages,
    maxTokens,
    false, // no streaming for ingestion
  );

  console.log(
    `[ingest] aiUnderstandDocument filename="${filename}" fileType=${fileType} model=${meta.model} auth=${meta.authMode}${meta.fallback ? " (fallback)" : ""}`,
  );

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    console.warn(`[ingest] ${meta.provider} returned ${resp.status}: ${errBody.slice(0, 200)}`);
    return {
      summary: `Uploaded ${fileType}: ${filename}`,
      keywords: [filename],
      extractedText: typeof content === "string" && !isImage && !isPdf ? content : "",
      structuredInsights: {},
    };
  }

  const result = await resp.json();

  // Handle both OpenAI-format (google/openai) and Anthropic-format responses
  let text = "";
  if (result.choices?.[0]?.message?.content) {
    // OpenAI format
    text = result.choices[0].message.content;
  } else if (result.content && Array.isArray(result.content)) {
    // Anthropic format: content is an array of blocks
    text = result.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fallback */ }

  return {
    summary: `Uploaded ${fileType}: ${filename}`,
    keywords: [filename],
    extractedText: text,
    structuredInsights: {},
  };
}

/**
 * Lightweight summary-only AI call. Used when we already have the full raw text
 * and only need metadata (summary + keywords + structured insights).
 *
 * Samples the first ~8K chars of the document since the opening usually characterizes
 * the whole doc, and avoids sending 500K chars through an AI call for a 2-sentence summary.
 */
async function aiLightweightSummary(
  rawText: string,
  filename: string,
  fileType: string,
): Promise<{ summary: string; keywords: string[]; structuredInsights: Record<string, unknown> }> {
  const sample = rawText.slice(0, 8000);
  const systemPrompt = `You are a document analyst. You receive the opening portion of a document.
Generate metadata WITHOUT extracting the full text (the caller already has it).

Return JSON:
{
  "summary": "concise 2-3 sentence summary of what this document is about",
  "keywords": ["keyword1", "keyword2", ...],
  "structuredInsights": {
    "documentType": "contract/report/invoice/memo/transcript/etc",
    "keyEntities": ["entity1", "entity2"],
    "sections": ["section1", "section2"]
  }
}
Return ONLY JSON, no markdown fences.`;

  const messages = [
    {
      role: "user",
      content: `Document: "${filename}" (${fileType})\n\nOpening content:\n${sample}${
        rawText.length > 8000 ? `\n\n[... ${rawText.length - 8000} additional characters follow ...]` : ""
      }`,
    },
  ];

  const { response: resp, meta } = await routeToProvider(
    SUMMARY_MODEL,
    systemPrompt,
    messages,
    SUMMARY_MAX_TOKENS,
    false,
  );

  console.log(
    `[ingest] aiLightweightSummary filename="${filename}" model=${meta.model} auth=${meta.authMode}`,
  );

  if (!resp.ok) {
    return {
      summary: `${fileType.toUpperCase()}: ${filename} (${rawText.length.toLocaleString()} chars)`,
      keywords: [filename, fileType],
      structuredInsights: { documentType: fileType },
    };
  }

  const result = await resp.json();
  let text = "";
  if (result.choices?.[0]?.message?.content) {
    text = result.choices[0].message.content;
  } else if (result.content && Array.isArray(result.content)) {
    text = result.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fallback */ }

  return {
    summary: `${fileType.toUpperCase()}: ${filename}`,
    keywords: [filename, fileType],
    structuredInsights: { documentType: fileType },
  };
}

/**
 * AI Structural Scan — runs on upload to build a "map" of the document's layout.
 *
 * For spreadsheets: detects header rows, wide-vs-long format, entity/measure/date
 * columns, subtotal/section rows, and generates query hints. This map is stored
 * in metadata.structuralProfile so Sherpa sees the layout BEFORE answering
 * questions — no more guessing which row is a header or whether "Total Acadia"
 * is a data row.
 *
 * For PDFs/docs: detects document type, sections, and query hints (e.g.,
 * "Revenue figures in table on page 3; narrative in sections 1-2").
 *
 * Design principles:
 *  - One AI call per upload (not per query) — cost amortized across all future reads
 *  - Small sample (first ~30 rows per sheet) — don't burn tokens on full file
 *  - Haiku model — scanning is a structured-extraction task, not reasoning
 *  - Graceful failure — if the scan errors, we still save the doc without profile
 */
interface StructuralProfile {
  kind: 'spreadsheet' | 'document';
  summary: string;
  // Spreadsheet fields (undefined for PDFs/docs)
  sheetType?: 'wide' | 'long' | 'hybrid' | 'unknown';
  headerRows?: number[];           // row indices (0-based) that together form the header
  entityColumns?: string[];        // columns that identify entities/rows (e.g., "Vendor", "Account")
  measureColumns?: string[];       // columns with numeric measures
  dateColumns?: string[];          // columns representing dates/periods (in wide format: month columns)
  subtotalRows?: number[];         // row indices that are aggregates, not data (exclude from sums)
  multiHeader?: boolean;           // true when header spans multiple rows
  // Document fields (undefined for spreadsheets)
  documentType?: string;           // "report" | "contract" | "memo" | "transcript" | etc.
  sections?: string[];             // section titles or headings
  hasTables?: boolean;             // true if tabular regions are present
  // Universal
  queryHints: string[];            // plain-English tips for Sherpa on how to read this doc
  scanModel?: string;              // which model produced the profile (for debugging)
  scannedAt?: string;              // ISO timestamp
}

async function aiStructuralScanSpreadsheet(
  filename: string,
  sheets: Record<string, { headers: string[]; rows: string[][] }>,
): Promise<StructuralProfile | null> {
  // Build a compact sample: first 30 rows of each sheet (capped at 4 sheets to keep prompt small)
  const sheetNames = Object.keys(sheets).slice(0, 4);
  const sampleBlocks: string[] = [];
  for (const name of sheetNames) {
    const s = sheets[name];
    const preview = [
      `  Headers row: [${(s.headers || []).map(h => JSON.stringify(h)).join(', ')}]`,
      ...(s.rows || []).slice(0, 30).map((r, i) =>
        `  Row ${i}: [${r.map(v => JSON.stringify(v ?? '')).join(', ')}]`
      ),
    ].join('\n');
    sampleBlocks.push(`--- Sheet "${name}" (${s.rows?.length ?? 0} total rows) ---\n${preview}`);
  }

  const systemPrompt = `You are a spreadsheet-layout analyst. Given a sample of a workbook, produce a JSON "structural profile" that lets a downstream AI answer questions about the file without guessing its layout.

DETECT:
- Header rows: which rows (0-based indices) are header/label rows? Often row 0, but may be rows 1, 2, or multiple consecutive rows (multi-tier headers).
- Sheet type: "wide" = dates/periods as columns (e.g. Jan-2026, Feb-2026 as column headers), "long" = one row per observation with a date column, "hybrid" = mixed.
- Entity columns: which column(s) identify entities/rows (e.g. "Vendor", "Account", "Case")?
- Measure columns: which columns contain numeric measures?
- Date columns: which columns represent dates or periods? In wide format these are the date-named columns.
- Subtotal rows: which row indices (0-based, in the sample) are aggregate/subtotal rows that should be EXCLUDED from sums/averages? Indicators: "Total", "Subtotal", "Grand Total", bolded-looking rows, rows where entity column is empty but measures are populated.
- Query hints: 2-5 plain-English tips for how to query this file correctly.

Return STRICT JSON:
{
  "summary": "1-2 sentence description of what this file contains and how it's laid out",
  "sheetType": "wide" | "long" | "hybrid" | "unknown",
  "headerRows": [0] or [0,1] (array of row indices),
  "entityColumns": ["ColumnName", ...],
  "measureColumns": ["ColumnName", ...],
  "dateColumns": ["ColumnName", ...],
  "subtotalRows": [row_index, ...],
  "multiHeader": true|false,
  "queryHints": ["hint 1", "hint 2", ...]
}
No markdown. No explanation. ONLY the JSON object.`;

  const userMsg = `Workbook: "${filename}"\n\n${sampleBlocks.join('\n\n')}`;

  try {
    const { response: resp } = await routeToProvider(
      SUMMARY_MODEL,  // Haiku is plenty for structured extraction
      systemPrompt,
      [{ role: 'user', content: userMsg }],
      SUMMARY_MAX_TOKENS,
      false,
    );
    if (!resp.ok) {
      console.warn('[ingest] structural scan HTTP error:', resp.status);
      return null;
    }
    const result = await resp.json();
    let text = '';
    if (result.choices?.[0]?.message?.content) text = result.choices[0].message.content;
    else if (result.content && Array.isArray(result.content)) {
      text = result.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      kind: 'spreadsheet',
      summary: String(parsed.summary ?? ''),
      sheetType: parsed.sheetType ?? 'unknown',
      headerRows: Array.isArray(parsed.headerRows) ? parsed.headerRows.map(Number).filter(Number.isFinite) : [0],
      entityColumns: Array.isArray(parsed.entityColumns) ? parsed.entityColumns.map(String) : [],
      measureColumns: Array.isArray(parsed.measureColumns) ? parsed.measureColumns.map(String) : [],
      dateColumns: Array.isArray(parsed.dateColumns) ? parsed.dateColumns.map(String) : [],
      subtotalRows: Array.isArray(parsed.subtotalRows) ? parsed.subtotalRows.map(Number).filter(Number.isFinite) : [],
      multiHeader: Boolean(parsed.multiHeader),
      queryHints: Array.isArray(parsed.queryHints) ? parsed.queryHints.map(String) : [],
      scanModel: SUMMARY_MODEL,
      scannedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.warn('[ingest] structural scan failed:', e);
    return null;
  }
}

async function aiStructuralScanDocument(
  filename: string,
  extractedText: string,
  fileType: string,
): Promise<StructuralProfile | null> {
  // Sample: first 6K chars. Enough to characterize most documents' structure.
  const sample = extractedText.slice(0, 6000);
  if (sample.length < 100) return null; // Not enough text to scan

  const systemPrompt = `You are a document-structure analyst. Given the opening of an uploaded document, produce a JSON "structural profile" that helps a downstream AI answer questions about the doc without re-reading the whole thing.

Return STRICT JSON:
{
  "summary": "1-2 sentence description of this document",
  "documentType": "report" | "contract" | "memo" | "transcript" | "invoice" | "email-thread" | "policy" | "other",
  "sections": ["Section title 1", "Section title 2", ...],
  "hasTables": true|false,
  "queryHints": ["hint 1", "hint 2", ...]
}
No markdown. ONLY the JSON object.`;

  const userMsg = `Document: "${filename}" (${fileType})\n\nOpening content:\n${sample}${
    extractedText.length > 6000 ? `\n\n[... ${extractedText.length - 6000} more characters ...]` : ''
  }`;

  try {
    const { response: resp } = await routeToProvider(
      SUMMARY_MODEL,
      systemPrompt,
      [{ role: 'user', content: userMsg }],
      SUMMARY_MAX_TOKENS,
      false,
    );
    if (!resp.ok) return null;
    const result = await resp.json();
    let text = '';
    if (result.choices?.[0]?.message?.content) text = result.choices[0].message.content;
    else if (result.content && Array.isArray(result.content)) {
      text = result.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      kind: 'document',
      summary: String(parsed.summary ?? ''),
      documentType: String(parsed.documentType ?? 'other'),
      sections: Array.isArray(parsed.sections) ? parsed.sections.map(String) : [],
      hasTables: Boolean(parsed.hasTables),
      queryHints: Array.isArray(parsed.queryHints) ? parsed.queryHints.map(String) : [],
      scanModel: SUMMARY_MODEL,
      scannedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.warn('[ingest] document scan failed:', e);
    return null;
  }
}

/**
 * Compute a serialized size estimate for raw cell data so we can gate
 * storage in metadata (Supabase JSONB column — keep metadata reasonable).
 */
function estimateBytes(obj: unknown): number {
  try { return JSON.stringify(obj).length; } catch { return Infinity; }
}
const RAW_CELLS_SIZE_CAP = 2_000_000; // 2 MB — safe for JSONB metadata

/**
 * Extract tabular data from an image (screenshot of a spreadsheet, table, report).
 * Returns { headers, rows } suitable for the structured_data.sheets format.
 * Only called when the initial analysis suggests tabular content is present.
 */
async function aiExtractTableFromImage(
  base64: string,
  mimeType: string,
  filename: string,
  apiKey: string,
): Promise<{ headers: string[]; rows: string[][] } | null> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      max_tokens: 8192,
      messages: [
        {
          role: "system",
          content: `You are a precise data extraction assistant. Your ONLY job is to extract tabular data from images.

Extract ALL rows and columns from any table, spreadsheet, or data grid visible in the image.

Rules:
- Include ALL rows, even if there are many
- Preserve column headers EXACTLY as shown
- Preserve cell values EXACTLY (numbers, text, dates, currency symbols)
- Use null for empty cells
- If multiple tables exist, extract the LARGEST/MOST COMPLETE one

Return ONLY valid JSON with no markdown:
{
  "headers": ["Column A", "Column B", ...],
  "rows": [
    ["value1", "value2", ...],
    ["value1", "value2", ...]
  ]
}

If NO tabular data is visible, return: {"headers": [], "rows": []}`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract the tabular data from this image: "${filename}"`,
            },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) return null;

  const result = await resp.json();
  const text = result.choices?.[0]?.message?.content || "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.headers) || !Array.isArray(parsed.rows)) return null;
    if (parsed.headers.length === 0) return null;
    return {
      headers: parsed.headers.map((h: unknown) => String(h ?? "")),
      rows: parsed.rows.map((row: unknown[]) => row.map((v) => String(v ?? ""))),
    };
  } catch {
    return null;
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      filename,
      mimeType,
      fileType,
      storagePath,
      // For XLSX: client sends pre-parsed sheet data (since edge functions can't parse xlsx natively)
      parsedSheets,
      // For CSV: raw text content
      textContent,
      // For PDF/images: base64 content
      base64Content,
      // Admin-configurable ingestion settings (optional)
      ingestModel,
      ingestMaxTokens,
      bypassAiForText,
    } = body;

    // Resolve ingest settings with fallbacks
    const resolvedModel: string = typeof ingestModel === "string" && ingestModel ? ingestModel : DEFAULT_INGEST_MODEL;
    const resolvedMaxTokens: number = typeof ingestMaxTokens === "number" && ingestMaxTokens > 0
      ? Math.max(1000, Math.min(64000, ingestMaxTokens))
      : DEFAULT_INGEST_MAX_TOKENS;
    const resolvedBypassText: boolean = bypassAiForText !== false; // default true

    if (!filename || !fileType || !storagePath) {
      return jsonResp({ error: "filename, fileType, and storagePath are required" }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Extract user_id from the authorization header for RLS-compliant inserts
    let userId: string | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || supabaseKey;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id || null;
    }

    let extractedText = "";
    let structuredData: Record<string, unknown> = {};
    let metadata: Record<string, unknown> = {};
    let fingerprint = "";

    // ─── XLSX (all sheets) ───────────────────────────────────────────────────
    if (fileType === "xlsx" && parsedSheets) {
      // Client parsed the XLSX and sent all sheet data
      // parsedSheets: { [sheetName]: { headers: string[], rows: string[][] } }
      const sheetNames = Object.keys(parsedSheets);
      const sheetSummaries: string[] = [];

      for (const name of sheetNames) {
        const sheet = parsedSheets[name];
        sheetSummaries.push(
          `Sheet "${name}" (${sheet.rows?.length || 0} rows, columns: ${(sheet.headers || []).join(", ")})`
        );
      }

      // Let AI analyze which sheets matter and how they relate
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: `You are a data analyst. A workbook has been uploaded with multiple sheets.
Analyze ALL sheets to determine:
1. Which sheet(s) contain the primary operational data the user would want to query
2. Which are reference/lookup/summary tables
3. The domain of the data
4. A comprehensive summary covering ALL sheets
5. Keywords for search

For each sheet, provide an assessment of its role and importance.

Return JSON:
{
  "primarySheet": "name of the main data sheet",
  "domain": "what this data is about",
  "summary": "2-3 sentence comprehensive summary covering all sheets",
  "keywords": ["keyword1", ...],
  "sheetAssessments": { "SheetName": "1-sentence assessment" }
}
Return ONLY JSON.`,
            },
            {
              role: "user",
              content: `Workbook: "${filename}"\n\nSheets found:\n${sheetSummaries.join("\n")}\n\nSample data from each sheet:\n${sheetNames
                .map((name) => {
                  const s = parsedSheets[name];
                  const preview = [
                    s.headers?.join(" | ") || "",
                    ...(s.rows?.slice(0, 5) || []).map((r: string[]) => r.join(" | ")),
                  ].join("\n");
                  return `--- ${name} ---\n${preview}`;
                })
                .join("\n\n")}`,
            },
          ],
          max_tokens: 4096,
        }),
      });

      let aiAnalysis: Record<string, unknown> = {};
      if (aiResp.ok) {
        const aiResult = await aiResp.json();
        const text = aiResult.choices?.[0]?.message?.content || "";
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) aiAnalysis = JSON.parse(jsonMatch[0]);
        } catch { /* use empty */ }
      }

      structuredData = { sheets: parsedSheets };

      // ─── Structural scan (gives Sherpa the layout map upfront) ──────────
      const structuralProfile = await aiStructuralScanSpreadsheet(filename, parsedSheets);

      // ─── Raw cells for surgical access (getCells tool) ──────────────────
      // Only persist when it fits comfortably in JSONB metadata. Large workbooks
      // skip this — Sherpa falls back to queryDataset + structured_data.sheets.
      const rawCellsSize = estimateBytes(parsedSheets);
      const rawCells = rawCellsSize <= RAW_CELLS_SIZE_CAP ? parsedSheets : null;

      metadata = {
        sheetNames,
        sheetCount: sheetNames.length,
        primarySheet: aiAnalysis.primarySheet || sheetNames[0],
        domain: aiAnalysis.domain || "unknown",
        summary: aiAnalysis.summary || `Workbook with ${sheetNames.length} sheets`,
        keywords: aiAnalysis.keywords || [filename],
        sheetAssessments: aiAnalysis.sheetAssessments || {},
        structuralProfile,
        rawCells,
        rawCellsBytes: rawCellsSize,
      };

      // Build extracted text from all sheets for search
      for (const name of sheetNames) {
        const s = parsedSheets[name];
        extractedText += `=== ${name} ===\n`;
        extractedText += (s.headers || []).join("\t") + "\n";
        for (const row of (s.rows || []).slice(0, 100)) {
          extractedText += row.join("\t") + "\n";
        }
        extractedText += "\n";
      }

      // Fingerprint based on structure
      const sigParts = sheetNames.map((n) => `${n}:${parsedSheets[n].rows?.length || 0}`);
      fingerprint = "xlsx-" + simpleHash(sigParts.join("|") + ":" + filename);
    }

    // ─── CSV ─────────────────────────────────────────────────────────────────
    else if (fileType === "csv" && textContent) {
      const parsed = parseCSV(textContent);
      const csvSheets = { [filename]: parsed };
      structuredData = { sheets: csvSheets };
      extractedText = textContent;
      fingerprint = "csv-" + simpleHash(textContent.slice(0, 2000));

      // Quick AI analysis for domain/summary (lightweight — uses Haiku, 2K output)
      const aiResult = await aiLightweightSummary(textContent, filename, "csv");

      // Structural scan + raw cells (same treatment as XLSX)
      const structuralProfile = await aiStructuralScanSpreadsheet(filename, csvSheets);
      const rawCellsSize = estimateBytes(csvSheets);
      const rawCells = rawCellsSize <= RAW_CELLS_SIZE_CAP ? csvSheets : null;

      metadata = {
        sheetNames: [filename],
        sheetCount: 1,
        primarySheet: filename,
        domain: (aiResult.structuredInsights?.documentType as string) || "data",
        summary: aiResult.summary,
        keywords: aiResult.keywords,
        structuralProfile,
        rawCells,
        rawCellsBytes: rawCellsSize,
      };
    }

    // ─── PDF — Native document reading via provider-router ──────────────────
    else if (fileType === "pdf" && base64Content) {
      // For Anthropic models: provider-router translates to native document type
      // with layout-aware extraction and up to 64K output tokens.
      // For other models: falls back to image_url vision.
      const aiResult = await aiUnderstandDocument(
        base64Content,
        filename,
        "pdf",
        "application/pdf",
        resolvedModel,
        resolvedMaxTokens,
      );
      extractedText = aiResult.extractedText;

      // Structural scan for PDFs — runs on the already-extracted text, so it's cheap.
      const structuralProfile = await aiStructuralScanDocument(filename, extractedText, "pdf");

      metadata = {
        summary: aiResult.summary,
        keywords: aiResult.keywords,
        structuredInsights: aiResult.structuredInsights,
        domain: (aiResult.structuredInsights?.documentType as string) || "document",
        ingestModel: resolvedModel,
        structuralProfile,
      };
      fingerprint = "pdf-" + simpleHash(base64Content.slice(0, 2000));
    }

    // ─── Images — AI Vision + Structured Data Extraction ────────────────────
    else if (fileType === "image" && base64Content) {
      const aiResult = await aiUnderstandDocument(
        base64Content,
        filename,
        "image",
        mimeType || "image/png",
        resolvedModel,
        resolvedMaxTokens,
      );
      extractedText = aiResult.extractedText;

      // Detect if image appears to contain tabular/spreadsheet data
      const looksTabular = (
        ["table", "spreadsheet", "report", "ledger", "invoice", "csv", "list", "rows", "columns", "data"]
          .some((kw) => (aiResult.summary + extractedText).toLowerCase().includes(kw))
        || (aiResult.structuredInsights?.documentType as string || "").toLowerCase().includes("table")
        || (aiResult.structuredInsights?.documentType as string || "").toLowerCase().includes("spreadsheet")
      );

      if (looksTabular) {
        // Second AI call: extract table as structured rows
        const tableResult = await aiExtractTableFromImage(
          base64Content,
          mimeType || "image/png",
          filename,
          LOVABLE_API_KEY
        );
        if (tableResult && tableResult.headers.length > 0 && tableResult.rows.length > 0) {
          structuredData = {
            sheets: {
              [filename]: { headers: tableResult.headers, rows: tableResult.rows },
            },
          };
        }
      }

      // Structural scan for images: use extracted text if tabular extraction
      // happened too, profile will reflect the table layout.
      let imgProfile: StructuralProfile | null = null;
      if (looksTabular && structuredData.sheets) {
        imgProfile = await aiStructuralScanSpreadsheet(filename, structuredData.sheets as any);
      } else if (extractedText && extractedText.length > 100) {
        imgProfile = await aiStructuralScanDocument(filename, extractedText, "image");
      }

      metadata = {
        summary: aiResult.summary,
        keywords: aiResult.keywords,
        structuredInsights: aiResult.structuredInsights,
        domain: looksTabular ? "data" : "image",
        hasStructuredData: Object.keys(structuredData).length > 0,
        structuralProfile: imgProfile,
      };
      fingerprint = "img-" + simpleHash(base64Content.slice(0, 2000));
    }

    // ─── Text / Markdown / DOCX ──────────────────────────────────────────────
    else if ((fileType === "txt" || fileType === "md" || fileType === "docx") && textContent) {
      // Raw text is ALWAYS preserved verbatim — we never truncate via AI output caps.
      extractedText = textContent;
      fingerprint = "txt-" + simpleHash(textContent.slice(0, 2000));

      // Structural scan runs in parallel with whichever summary path — it's
      // always a useful map for Sherpa regardless of bypass mode.
      const structuralProfile = await aiStructuralScanDocument(filename, textContent, fileType);

      if (resolvedBypassText) {
        // Fast path: lightweight summary only (uses opening sample, Haiku, 2K output).
        // The full raw text is still saved — this call only generates metadata.
        const aiResult = await aiLightweightSummary(textContent, filename, fileType);
        metadata = {
          summary: aiResult.summary,
          keywords: aiResult.keywords,
          structuredInsights: aiResult.structuredInsights,
          domain: (aiResult.structuredInsights?.documentType as string) || "document",
          rawChars: textContent.length,
          extractionMode: "bypass",
          structuralProfile,
        };
      } else {
        // Full-fat path: send entire text to the main ingest model for deep analysis.
        // Use this when you need rich entity/number/date extraction from long docs.
        const aiResult = await aiUnderstandDocument(
          textContent,
          filename,
          fileType,
          mimeType || "text/plain",
          resolvedModel,
          resolvedMaxTokens,
        );
        metadata = {
          summary: aiResult.summary,
          keywords: aiResult.keywords,
          structuredInsights: aiResult.structuredInsights,
          domain: (aiResult.structuredInsights?.documentType as string) || "document",
          rawChars: textContent.length,
          extractionMode: "full",
          ingestModel: resolvedModel,
          structuralProfile,
        };
      }
    }

    // ─── Check for duplicate by fingerprint ──────────────────────────────────
    if (fingerprint) {
      const { data: existing } = await supabase
        .from("documents")
        .select("id")
        .eq("fingerprint", fingerprint)
        .maybeSingle();

      if (existing) {
        // If the duplicate has no user_id, claim it for the current user
        if (userId) {
          await supabase
            .from("documents")
            .update({ user_id: userId })
            .eq("id", existing.id)
            .is("user_id", null);
        }
        return jsonResp({
          id: existing.id,
          status: "duplicate",
          message: "This document has already been ingested.",
        });
      }
    }

    // ─── Insert into DB ──────────────────────────────────────────────────────
    const { data: doc, error } = await supabase
      .from("documents")
      .insert({
        filename,
        mime_type: mimeType || "application/octet-stream",
        file_type: fileType,
        storage_path: storagePath,
        extracted_text: extractedText.slice(0, 5_000_000), // 5MB limit — fits ~800K words / full meeting transcripts
        structured_data: structuredData,
        metadata,
        fingerprint,
        user_id: userId,
      })
      .select()
      .single();

    if (error) {
      console.error("DB insert error:", error);
      return jsonResp({ error: "Failed to save document" }, 500);
    }

    return jsonResp({
      id: doc.id,
      status: "ingested",
      metadata,
      hasStructuredData: Object.keys(structuredData).length > 0,
    });
  } catch (e) {
    console.error("ingest error:", e);
    return jsonResp(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500
    );
  }
});

function simpleHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
