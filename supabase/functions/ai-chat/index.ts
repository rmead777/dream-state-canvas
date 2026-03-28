import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { messages, mode } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY)
      throw new Error("LOVABLE_API_KEY is not configured");

    // System prompts by mode
    const systemPrompts: Record<string, string> = {
      intent: `You are the Sherpa — an AI intelligence layer for a cognitive workspace managing financial portfolio data.
You receive a user query and the current workspace state.
You MUST respond with valid JSON matching this schema:
{
  "response": "your natural language response to the user",
  "actions": [
    { "type": "create", "objectType": "metric|comparison|alert|inspector|brief|timeline|document|dataset", "title": "...", "relatedTo": [] },
    { "type": "focus", "objectId": "..." },
    { "type": "dissolve", "objectId": "..." },
    { "type": "fuse", "objectIdA": "id-of-first-object", "objectIdB": "id-of-second-object" },
    { "type": "refine-rules", "feedback": "user's prioritization change request" }
  ]
}
Rules:
- "response" is always required — a thoughtful 1-2 sentence response.
- "actions" can be empty if the user is just asking a question.
- Use "create" to materialize new workspace objects. Pick the most appropriate objectType.
- Use "focus" if the user asks about something already in the workspace.
- Use "dissolve" to remove objects the user no longer needs.
- Use "fuse" when the user wants to combine, merge, synthesize, or fuse two objects. Match object names to their IDs from the workspace state. If the user doesn't specify which objects, pick the two most relevant active objects.
- IMPORTANT: When the user says "fuse", "combine", "merge", or "synthesize" — ALWAYS use the "fuse" action type, NEVER create a brief instead.
- Be concise, insightful, and proactive. You are a financial intelligence assistant.
- If the user asks something vague, respond helpfully and suggest workspace actions.`,

      document: `You are an expert document analyst. The user is reading a document and has a question about it.
Answer based on the document content provided. Be concise and precise. Reference specific parts of the document when possible.`,

      dataset: `You are a data analyst. The user is looking at a dataset and wants insights.
Analyze the data provided and give specific, actionable insights. Reference specific values and trends.
Be concise — 2-3 sentences max.`,

      brief: `You are a senior portfolio analyst. Synthesize the provided workspace context into a concise risk brief.
Cover: key risks, portfolio positioning, and recommended actions. Use data points when available.`,

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

Return ONLY a JSON object with these fields:
- "domain": string (what domain this data is about)
- "primaryIdColumn": string (which column is the entity identifier)
- "primaryMeasureColumn": string (the main numeric column to rank/sort by)
- "measureFormat": "currency" | "number" | "percentage"
- "sortDirection": "desc" | "asc"
- "groupByColumn": string or null (categorical grouping column)
- "urgencySignal": { "column": string, "hotValues": string[] } or null
- "previewStrategy": string (one sentence: how to pick the most important rows)
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
Only change what the user asked for. Keep all other fields as they were.
Return ONLY the updated JSON object, no markdown fences.`,
    };

    const systemPrompt = systemPrompts[mode] || systemPrompts.intent;

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
            { role: "system", content: systemPrompt },
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
