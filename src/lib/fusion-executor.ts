import { WorkspaceObject } from './workspace-types';
import { canFuse, SynthesisType } from './fusion-rules';
import { callAI } from '@/hooks/useAI';

export interface FusionResult {
  success: boolean;
  lowValue?: boolean;
  id?: string;
  title?: string;
  context?: Record<string, any>;
  errorMessage?: string;
}

/**
 * Execute a fusion between two workspace objects via AI synthesis.
 * Returns the fusion result without dispatching — caller handles state updates.
 */
export async function executeFusion(
  source: WorkspaceObject,
  target: WorkspaceObject
): Promise<FusionResult> {
  if (!canFuse(source.type, target.type)) {
    return { success: false, errorMessage: `Cannot fuse ${source.type} with ${target.type}.` };
  }

  try {
    const result = await callAI(
      [
        {
          role: 'user',
          content: `You are an analytical synthesis engine. You must produce NEW analysis that NEITHER input contains on its own.

OBJECT A — [${source.type}] "${source.title}":
${JSON.stringify(source.context).slice(0, 1200)}

OBJECT B — [${target.type}] "${target.title}":
${JSON.stringify(target.context).slice(0, 1200)}

CRITICAL RULES:
1. Your output must be ORIGINAL — do NOT copy, paraphrase, or summarize either input. Instead, find the RELATIONSHIP between them.
2. Identify cross-cutting patterns, contradictions, or implications that only emerge when both are viewed together.
3. If the two objects are too similar or unrelated to produce a non-obvious insight, set synthesisType to "low-value".
4. Do NOT write generic introductions. Go straight into the novel analysis.
5. Reference specific data points from BOTH objects to support your synthesis.
6. The title must be a new concept name, NOT a combination of the input titles.

Return ONLY valid JSON:
{
  "title": "a new concept name (not 'A + B')",
  "summary": "2-4 sentences of original cross-cutting analysis",
  "insights": ["novel insight 1", "novel insight 2", "novel insight 3"],
  "synthesisType": "direct-extraction" | "inferred-pattern" | "speculative-synthesis" | "low-value",
  "confidence": 0.0-1.0
}`,
        },
      ],
      'fusion'
    );

    let title = `${source.title} ✦ ${target.title}`;
    let summary = '';
    let insights: string[] = [];
    let synthesisType: SynthesisType = 'inferred-pattern';
    let confidence = 0.7;

    try {
      const jsonMatch = (result || '').match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.title) title = parsed.title;
        if (parsed.summary) summary = parsed.summary;
        if (parsed.insights && Array.isArray(parsed.insights)) insights = parsed.insights;
        if (parsed.synthesisType) synthesisType = parsed.synthesisType as SynthesisType;
        if (parsed.confidence) confidence = parsed.confidence;
      }
    } catch { /* fallback */ }

    if (synthesisType === 'low-value') {
      return { success: false, lowValue: true, errorMessage: 'These objects don\'t reveal non-obvious relationships when combined. Try a different pair.' };
    }

    if (!summary && result) {
      summary = result.replace(/```json[\s\S]*?```/g, '').replace(/\{[\s\S]*\}/g, '').trim();
    }
    if (!summary) summary = 'Synthesis could not be generated. Try again.';

    const id = `wo-fusion-${Date.now()}`;
    const fusionData: Record<string, any> = {
      content: summary,
      summary,
      insights: insights.length > 0 ? insights : undefined,
      synthesisType,
      confidence,
      sourceObjects: [
        { id: source.id, type: source.type, title: source.title },
        { id: target.id, type: target.type, title: target.title },
      ],
      generatedAt: new Date().toISOString(),
    };

    return { success: true, id, title, context: fusionData };
  } catch {
    return { success: false, errorMessage: 'Fusion failed — try again or ask the Sherpa directly.' };
  }
}
