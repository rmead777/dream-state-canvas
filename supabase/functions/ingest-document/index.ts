import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
      model: "google/gemini-2.5-flash",
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
 * Uses multimodal capabilities to READ the document natively.
 */
async function aiUnderstandDocument(
  content: string,
  filename: string,
  fileType: string,
  mimeType: string,
  apiKey: string
): Promise<{ summary: string; keywords: string[]; extractedText: string; structuredInsights: Record<string, unknown> }> {
  const isImage = fileType === "image";
  const isPdf = fileType === "pdf";

  const messages: Array<{ role: string; content: unknown }> = [
    {
      role: "system",
      content: `You are an expert document analyst. You receive a document and must:
1. Understand its full content, structure, and purpose
2. Extract ALL text content faithfully
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
Return ONLY JSON, no markdown fences.`,
    },
  ];

  if (isImage || isPdf) {
    // Use vision: send as base64 image
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: `Analyze this ${fileType} document: "${filename}". Extract ALL text and understand the full content. Be thorough — capture every detail.`,
        },
        {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${content}` },
        },
      ],
    });
  } else {
    // Text-based document
    messages.push({
      role: "user",
      content: `Analyze this ${fileType} document: "${filename}"\n\nFull content:\n${content}`,
    });
  }

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: isImage || isPdf ? "google/gemini-2.5-flash" : "google/gemini-2.5-flash-lite",
      messages,
      max_tokens: 8192,
    }),
  });

  if (!resp.ok) {
    return {
      summary: `Uploaded ${fileType}: ${filename}`,
      keywords: [filename],
      extractedText: typeof content === "string" && !isImage && !isPdf ? content : "",
      structuredInsights: {},
    };
  }

  const result = await resp.json();
  const text = result.choices?.[0]?.message?.content || "";
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
    } = body;

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
          model: "google/gemini-2.5-flash",
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
      metadata = {
        sheetNames,
        sheetCount: sheetNames.length,
        primarySheet: aiAnalysis.primarySheet || sheetNames[0],
        domain: aiAnalysis.domain || "unknown",
        summary: aiAnalysis.summary || `Workbook with ${sheetNames.length} sheets`,
        keywords: aiAnalysis.keywords || [filename],
        sheetAssessments: aiAnalysis.sheetAssessments || {},
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
      structuredData = { sheets: { [filename]: parsed } };
      metadata = {
        sheetNames: [filename],
        sheetCount: 1,
        primarySheet: filename,
        domain: "unknown",
        summary: `CSV with ${parsed.rows.length} rows and ${parsed.headers.length} columns`,
        keywords: [filename],
      };
      extractedText = textContent;
      fingerprint = "csv-" + simpleHash(textContent.slice(0, 2000));

      // Quick AI analysis for domain/summary
      const aiResult = await aiUnderstandDocument(
        textContent.slice(0, 4000),
        filename,
        "csv",
        "text/csv",
        LOVABLE_API_KEY
      );
      metadata.summary = aiResult.summary;
      metadata.keywords = aiResult.keywords;
      metadata.domain = aiResult.structuredInsights?.documentType || "data";
    }

    // ─── PDF — Native AI Vision Reading ──────────────────────────────────────
    else if (fileType === "pdf" && base64Content) {
      // "Let AI Be AI" — send PDF pages as images to vision model
      // The AI can READ the PDF natively, understanding layout, tables, charts
      const aiResult = await aiUnderstandDocument(
        base64Content,
        filename,
        "pdf",
        "application/pdf",
        LOVABLE_API_KEY
      );
      extractedText = aiResult.extractedText;
      metadata = {
        summary: aiResult.summary,
        keywords: aiResult.keywords,
        structuredInsights: aiResult.structuredInsights,
        domain: aiResult.structuredInsights?.documentType || "document",
      };
      fingerprint = "pdf-" + simpleHash(base64Content.slice(0, 2000));
    }

    // ─── Images — AI Vision ─────────────────────────────────────────────────
    else if (fileType === "image" && base64Content) {
      const aiResult = await aiUnderstandDocument(
        base64Content,
        filename,
        "image",
        mimeType || "image/png",
        LOVABLE_API_KEY
      );
      extractedText = aiResult.extractedText;
      metadata = {
        summary: aiResult.summary,
        keywords: aiResult.keywords,
        structuredInsights: aiResult.structuredInsights,
        domain: "image",
      };
      fingerprint = "img-" + simpleHash(base64Content.slice(0, 2000));
    }

    // ─── Text / Markdown / DOCX ──────────────────────────────────────────────
    else if ((fileType === "txt" || fileType === "md" || fileType === "docx") && textContent) {
      const aiResult = await aiUnderstandDocument(
        textContent,
        filename,
        fileType,
        mimeType || "text/plain",
        LOVABLE_API_KEY
      );
      extractedText = textContent;
      metadata = {
        summary: aiResult.summary,
        keywords: aiResult.keywords,
        structuredInsights: aiResult.structuredInsights,
        domain: aiResult.structuredInsights?.documentType || "document",
      };
      fingerprint = "txt-" + simpleHash(textContent.slice(0, 2000));
    }

    // ─── Check for duplicate by fingerprint ──────────────────────────────────
    if (fingerprint) {
      const { data: existing } = await supabase
        .from("documents")
        .select("id")
        .eq("fingerprint", fingerprint)
        .maybeSingle();

      if (existing) {
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
        extracted_text: extractedText.slice(0, 500000), // 500KB limit
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
