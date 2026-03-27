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
    { "type": "fuse", "objectIdA": "id-of-first-object", "objectIdB": "id-of-second-object" }
  ]
}
Rules:
- "response" is always required — a thoughtful 1-2 sentence response.
- "actions" can be empty if the user is just asking a question.
- Use "create" to materialize new workspace objects. Pick the most appropriate objectType.
- Use "focus" if the user asks about something already in the workspace.
- Use "dissolve" to remove objects the user no longer needs.
- Be concise, insightful, and proactive. You are a financial intelligence assistant.
- If the user asks something vague, respond helpfully and suggest workspace actions.`,

      document: `You are an expert document analyst. The user is reading a document and has a question about it.
Answer based on the document content provided. Be concise and precise. Reference specific parts of the document when possible.`,

      dataset: `You are a data analyst. The user is looking at a dataset and wants insights.
Analyze the data provided and give specific, actionable insights. Reference specific values and trends.
Be concise — 2-3 sentences max.`,

      brief: `You are a senior portfolio analyst. Synthesize the provided workspace context into a concise risk brief.
Cover: key risks, portfolio positioning, and recommended actions. Use data points when available.`,

      fusion: `You are a senior analyst performing a deep synthesis of two data objects from a financial workspace.
You receive two objects with their data. Your job is to find the NON-OBVIOUS connections, tensions, and implications between them.

RULES:
- Do NOT write generic introductions like "This synthesis combines..." or "By analyzing these two objects..."
- Start directly with the most important insight.
- Reference specific numbers, names, and data points from both objects.
- Be analytical, not descriptive. Tell the user something they didn't already know.
- Write the summary as 2-4 paragraphs of genuine analysis, not bullet points restated.
- Insights should be sharp, specific, and actionable — not restatements of the data.

Return a JSON object:
{
  "title": "A specific, insightful title (not just Object A + Object B)",
  "summary": "2-4 paragraphs of deep analytical synthesis with specific data references",
  "insights": ["3-5 sharp, specific insights that reveal non-obvious connections"]
}`,

      predict: `You are a workspace intelligence system. Given the current workspace state and recent user actions,
predict what the user is likely to need next. Return JSON:
{ "predictions": [{ "objectType": "...", "title": "...", "reason": "..." }] }
Return 1-2 predictions max.`,
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
