import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { messages, mode, documentIds } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY)
      throw new Error("LOVABLE_API_KEY is not configured");

    // If documentIds provided, fetch document context from DB
    let documentContext = "";
    if (documentIds && Array.isArray(documentIds) && documentIds.length > 0) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const sb = createClient(supabaseUrl, supabaseKey);

        const { data: docs } = await sb
          .from("documents")
          .select("id, filename, file_type, extracted_text, structured_data, metadata, data_profile")
          .in("id", documentIds);

        if (docs && docs.length > 0) {
          const docSummaries = docs.map((doc: any) => {
            let content = "";

            // For spreadsheets, include structured data
            if ((doc.file_type === "xlsx" || doc.file_type === "csv") && doc.structured_data?.sheets) {
              const sheets = doc.structured_data.sheets;
              for (const [sheetName, sheet] of Object.entries(sheets) as any) {
                const rowCount = sheet.rows?.length || 0;
                content += `\n[Sheet: ${sheetName}] (${rowCount} rows)\n`;
                content += `Columns: ${sheet.headers?.join(", ")}\n`;
                // Include all rows for full context (Let AI Be AI)
                if (sheet.rows && sheet.rows.length > 0) {
                  // For very large datasets, include first 50 + last 10 rows
                  const maxInline = 60;
                  if (sheet.rows.length <= maxInline) {
                    for (const row of sheet.rows) {
                      content += sheet.headers.map((h: string, i: number) => `${h}: ${row[i]}`).join(" | ") + "\n";
                    }
                  } else {
                    content += `(Showing first 50 and last 10 of ${rowCount} rows)\n`;
                    for (const row of sheet.rows.slice(0, 50)) {
                      content += sheet.headers.map((h: string, i: number) => `${h}: ${row[i]}`).join(" | ") + "\n";
                    }
                    content += "...\n";
                    for (const row of sheet.rows.slice(-10)) {
                      content += sheet.headers.map((h: string, i: number) => `${h}: ${row[i]}`).join(" | ") + "\n";
                    }
                  }
                }
              }
            }

            // For all document types, include extracted text
            if (doc.extracted_text) {
              content += `\n${doc.extracted_text}`;
            }

            // Include data profile if available
            if (doc.data_profile) {
              content += `\n[Data Analysis Profile]: ${JSON.stringify(doc.data_profile)}`;
            }

            // Include AI metadata insights
            if (doc.metadata?.aiSummary) {
              content += `\n[AI Summary]: ${doc.metadata.aiSummary}`;
            }

            return `--- DOCUMENT: ${doc.filename} (${doc.file_type}) ---${content}\n--- END DOCUMENT ---`;
          });

          documentContext = `\n\nThe following documents are available for reference:\n\n${docSummaries.join("\n\n")}`;
        }
      } catch (e) {
        console.error("Error fetching document context:", e);
      }
    }

    // System prompts by mode
    const systemPrompts: Record<string, string> = {
      intent: `You are the Sherpa — an AI intelligence layer for a cognitive workspace managing portfolio data.
You receive a user query and the current workspace state.
You MUST respond with valid JSON matching this schema:
{
  "response": "your natural language response to the user",
  "actions": [
    { "type": "create", "objectType": "metric|comparison|alert|inspector|brief|timeline|document|dataset", "title": "...", "relatedTo": [] },
    { "type": "update", "objectId": "id-of-existing-object", "instruction": "what to change about this object" },
    { "type": "focus", "objectId": "..." },
    { "type": "dissolve", "objectId": "..." },
    { "type": "fuse", "objectIdA": "id-of-first-object", "objectIdB": "id-of-second-object" },
    { "type": "refine-rules", "feedback": "user's prioritization change request" }
  ]
}
Rules:
- "response" is ALWAYS required — a thoughtful 1-2 sentence response.

CRITICAL — WHEN TO CREATE vs UPDATE vs JUST RESPOND:
- ONLY use "create" when the user explicitly asks to SEE, SHOW, or OPEN something NEW.
- Use "update" when the user wants to CHANGE, FILTER, LIMIT, MODIFY, or REFINE an EXISTING card/object. The "instruction" field should describe the change (e.g. "limit to top 25 vendors", "filter to Tier 1 only", "sort by balance descending"). The objectId must match an existing object from the workspace state.
- If the user asks a QUESTION (why, how, what, can you explain, etc.) — just set "response" with a helpful answer and leave "actions" as an EMPTY array [].
- If the user asks about something already in the workspace — use "focus" to highlight it, do NOT create a duplicate.
- Conversational follow-ups, explanations, complaints, feedback — RESPOND ONLY, no actions.
- NEVER rename or retitle existing objects. Objects keep their original titles.

IMPORTANT — DOCUMENT CONTEXT:
- You have access to uploaded documents. Use their content to give specific, data-backed answers.
- When answering questions, reference specific numbers, names, and facts from the documents.
- Cross-reference across multiple documents when relevant.

Other action rules:
- Use "focus" if the user asks about something already in the workspace.
- Use "dissolve" to remove objects the user no longer needs.
- Use "fuse" when the user wants to combine, merge, synthesize, or fuse two objects. Match object names to their IDs from the workspace state.
- IMPORTANT: When the user says "fuse", "combine", "merge", or "synthesize" — ALWAYS use the "fuse" action type, NEVER create a brief instead.
- Use "refine-rules" when the user wants to change how data is prioritized, sorted, filtered, or grouped.
- Be concise, insightful, and proactive.
- If the user asks something vague, respond helpfully and suggest workspace actions — but do NOT create cards speculatively.`,

      document: `You are an expert document analyst. The user is reading a document and has a question about it.
Answer based on the document content provided. Be concise and precise. Reference specific parts of the document when possible.
You also have access to other uploaded documents for cross-referencing.`,

      dataset: `You are a data analyst. The user is looking at a dataset and wants insights.
Analyze the data provided and give specific, actionable insights. Reference specific values and trends.
Be concise — 2-3 sentences max.
You have access to uploaded documents for additional context.`,

      brief: `You are a senior portfolio analyst. Synthesize the provided workspace context into a concise risk brief.
Cover: key risks, portfolio positioning, and recommended actions. Use data points when available.
You have access to uploaded documents — reference specific data points from them.`,

      fusion: `You are a senior analyst performing deep synthesis of two financial data objects.
Your job: find NON-OBVIOUS connections, tensions, and implications between them.

RULES:
- Do NOT write generic introductions. Start directly with the most important insight.
- Reference specific numbers, names, and data points from BOTH objects.
- Be analytical, not descriptive. Tell the user something they didn't already know.
- The summary should be 2-4 sentences of genuine cross-cutting analysis.
- Insights should be sharp, specific, and actionable.
- Follow the JSON schema specified in the user message exactly.`,

      predict: `You are a workspace intelligence system. Given the current workspace state and recent user actions,
predict what the user is likely to need next. Return JSON:
{ "predictions": [{ "objectType": "...", "title": "...", "reason": "..." }] }
Return 1-2 predictions max.`,

      'analyze-schema': `You are a data analyst. You receive column names and sample rows from a dataset.
Your job: analyze the schema and values to determine how to prioritize rows for preview displays.
You must be domain-agnostic — this could be financial data, sports stats, scientific measurements, etc.

CRITICAL RULE: If the dataset contains a column that represents an EXPLICIT priority/tier/rank hierarchy
(e.g. "Tier 1 — Act Now", "Priority: High", "Severity: Critical"), you MUST identify it as the
ordinalPriorityColumn. This column's rank order takes PRECEDENCE over numeric value sorting.
Do NOT let large numeric values override explicit priority rankings defined by the data.

Return ONLY a JSON object with these fields:
- "domain": string (what domain this data is about)
- "primaryIdColumn": string (which column is the entity identifier)
- "primaryMeasureColumn": string (the main numeric column to rank/sort by)
- "measureFormat": "currency" | "number" | "percentage"
- "sortDirection": "desc" | "asc"
- "groupByColumn": string or null (categorical grouping column)
- "ordinalPriorityColumn": { "column": string, "rankOrder": string[] } or null — If any column has values that form an explicit priority hierarchy (numbered tiers, severity levels, etc.), list them here from HIGHEST priority to LOWEST. This is the most important field for correct sorting.
- "urgencySignal": { "column": string, "hotValues": string[] } or null
- "previewStrategy": string (if ordinalPriorityColumn exists, MUST mention sorting by rank order first)
- "cardRecommendations": {
    "metric": { "title": string, "aggregateColumn": string },
    "alert": { "filterColumn": string, "filterValues": string[] },
    "inspector": { "sortBy": string, "limit": number },
    "comparison": { "contrastColumn": string }
  }

For urgencySignal.hotValues, order them from most urgent to least urgent.
Return ONLY the JSON, no markdown fences.`,

      'refine-profile': `You are a data analyst. The user has an existing DataProfile for a dataset and wants to change how data is prioritized.
You will receive the current profile, the user's instruction, and sample data.
Your job: update the profile based on the user's feedback while keeping the same JSON schema.

CRITICAL RULES:
1. If the profile has an ordinalPriorityColumn, NEVER remove it unless the user explicitly asks to ignore priorities/tiers.
2. The ordinalPriorityColumn.rankOrder defines the sorting hierarchy — NEVER override it with numeric sorting unless asked.
3. Within-tier sorting is determined by operational meaning (action tiers sort by deadline, monitoring tiers by exposure).
4. Only change what the user requested. Keep all other fields as they were.
5. Return the FULL updated JSON profile with the same schema — all fields must be present.

Return ONLY the updated JSON object, no markdown fences.`,

      'context-select': `You are a document relevance analyzer. Given a user query and a list of available documents with their summaries, determine which documents are relevant to answering the query.

Return ONLY a JSON object:
{
  "relevantDocIds": ["id1", "id2"],
  "reason": "Brief explanation of why these documents were selected"
}

Rules:
- Select documents that contain data or information relevant to the query
- If the query is about data analysis, include spreadsheet documents
- If the query mentions specific topics, select documents covering those topics
- When in doubt, include more documents rather than fewer (Let AI Be AI)
- Always include the active dataset's source document if it exists`,
    };

    const systemPrompt = systemPrompts[mode] || systemPrompts.intent;

    // Append document context to the system prompt if available
    const fullSystemPrompt = documentContext
      ? `${systemPrompt}${documentContext}`
      : systemPrompt;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: fullSystemPrompt },
            ...messages,
          ],
          stream: true,
          max_tokens: 8192,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited — please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Credits exhausted — please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
