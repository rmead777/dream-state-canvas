import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { routeToProvider, DEFAULT_MODEL } from "../_shared/provider-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, mode, adminModel, adminMaxTokens, memories } = await req.json();

    // System prompts by mode
    const systemPrompts: Record<string, string> = {
      intent: `You are Sherpa — the intelligence layer for a cognitive workspace.
    You receive a user query, a structured workspace snapshot, a dataset profile, and recent intent outcomes.
You MUST respond with valid JSON matching this schema:
{
  "response": "your natural language response to the user",
  "actions": [
    { "type": "create", "objectType": "metric|comparison|alert|inspector|brief|timeline|document|dataset", "title": "...", "relatedTo": [] },
    { "type": "focus", "objectId": "..." },
    { "type": "dissolve", "objectId": "..." },
        { "type": "update", "objectId": "...", "instruction": "..." },
    { "type": "fuse", "objectIdA": "id-of-first-object", "objectIdB": "id-of-second-object" },
    { "type": "refine-rules", "feedback": "user's prioritization change request" }
  ]
}
Rules:
- "response" is always required — a thoughtful 1-2 sentence response.
- "actions" can be empty if the user is just asking a question.
    - The dataset profile defines the domain. It can be finance, sports, operations, science, or anything else. Do not assume a financial domain unless the payload says so.
    - Use "focus" when the user wants to inspect or return to an existing object.
    - Use "update" when the user wants to modify an existing object's filters, sort order, visible columns, chart/view mode, framing, narrative, or title.
    - Use "create" only when no existing object can satisfy the request.
- Use "dissolve" to remove objects the user no longer needs.
- Use "fuse" when the user wants to combine, merge, synthesize, or fuse two objects. Match object names to their IDs from the workspace state. If the user doesn't specify which objects, pick the two most relevant active objects.
- IMPORTANT: When the user says "fuse", "combine", "merge", or "synthesize" — ALWAYS use the "fuse" action type, NEVER create a brief instead.
- Use "refine-rules" when the user wants to change how data is prioritized, sorted, filtered, or grouped. Extract their instruction as "feedback". Examples: "sort by name", "prioritize low balances", "group by status instead of tier", "show oldest first", "change the priority column".
    - Pronouns like "this", "that", "it", and "current view" refer to the focused object first. If there is no focused object, prefer the most recently interacted relevant object.
    - NEVER create a duplicate object when an existing one of the same semantic purpose can be focused or updated instead.
    - If the user asks to rename, reframe, filter, sort, tighten, expand, change columns, or change chart type, prefer "update" over "create".
    - If multiple existing objects are plausible targets and the request is ambiguous, ask a clarifying question instead of guessing.
    - Be concise, insightful, and proactive.`,

      "update-plan": `You are a structured object-update planner for a cognitive workspace.
    Your job is to translate a user instruction into a precise JSON update plan for ONE existing object.
    You will receive the object summary, current view state, dataset profile, and user instruction.

    Rules:
    - Return ONLY valid JSON.
    - Only include fields the user explicitly wants to change.
    - Use null to clear an existing setting.
    - Use view.preferredColumns when the user changes which columns are visible.
    - Use view.displayMode + chartType + chartXAxis + chartYAxis when the user requests a chart or chart-type change.
    - Use content.regenerateNarrative when the user wants rewritten analysis, reframing, tightening, expansion, or a new angle.
    - Use renameTo only when the user explicitly wants a new title.
    - Do not invent filters, titles, or chart settings that were not asked for.`,

      document: `You are an expert document analyst. The user is reading a document and has a question about it.
Answer based on the document content provided. Be concise and precise. Reference specific parts of the document when possible.`,

      dataset: `You are a data analyst. The user is looking at a dataset and wants insights.
Analyze the data provided and give specific, actionable insights. Reference specific values and trends.
Be concise — 2-3 sentences max.`,

      brief: `You are a senior analytical writer.
    Synthesize the provided workspace context into a concise, decision-useful brief.
    Cover: the main takeaway, why it matters, and recommended actions. Use concrete data points when available.`,

      fusion: `You are a senior analyst performing deep synthesis of two workspace data objects.
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

      "analyze-schema": `You are a data analyst. You receive column names and sample rows from a dataset.
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

      "refine-profile": `You are a data analyst. The user has an existing DataProfile for a dataset and wants to change how data is prioritized.
You will receive the current profile, the user's instruction, and sample data.
Your job: update the profile based on the user's feedback while keeping the same JSON schema.

CRITICAL RULES:
1. If the profile has an ordinalPriorityColumn, NEVER remove it unless the user explicitly asks to ignore priorities/tiers.
2. The ordinalPriorityColumn.rankOrder defines the sorting hierarchy — NEVER override it with numeric sorting unless asked.
3. Within-tier sorting is determined by operational meaning (action tiers sort by deadline, monitoring tiers by exposure).
4. Only change what the user requested. Keep all other fields as they were.
5. Return the FULL updated JSON profile with the same schema — all fields must be present.

Return ONLY the updated JSON object, no markdown fences.`,
    };

    let systemPrompt = systemPrompts[mode] || systemPrompts.intent;

    // Inject Sherpa memories into the system prompt (Tier 1: soft influence)
    if (memories && typeof memories === 'string' && memories.length > 0) {
      systemPrompt = systemPrompt + '\n\n' + memories;
    }

    // Use admin model override if provided, otherwise default
    const modelId = adminModel || DEFAULT_MODEL;
    const maxTokens = adminMaxTokens || 16192;

    const response = await routeToProvider(modelId, systemPrompt, messages, maxTokens, true);

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited — please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted — please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
