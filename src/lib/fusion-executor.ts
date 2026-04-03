import { WorkspaceObject } from './workspace-types';
import { canFuse, SynthesisType } from './fusion-rules';
import { callAI } from '@/hooks/useAI';

/**
 * Build a content-rich summary of a card for fusion context.
 * Deliberately different from buildObjectPromptSummary — that function is optimised
 * for lightweight workspace snapshots. Fusion needs actual content, not metadata.
 */
function buildFusionContext(object: WorkspaceObject): string {
  const ctx = object.context || {};
  const lines: string[] = [`[${object.type.toUpperCase()}] "${object.title}"`];

  // Sections-based cards (analysis, brief, etc.) — extract real text
  const sections: any[] = ctx.sections || [];
  for (const s of sections) {
    if (!s) continue;
    if (s.type === 'summary' && s.text) lines.push(`Summary: ${s.text}`);
    else if ((s.type === 'narrative' || s.type === 'text') && s.text)
      lines.push(`Analysis: ${s.text.slice(0, 600)}`);
    else if (s.type === 'metric' && s.label)
      lines.push(`Metric — ${s.label}: ${s.value}${s.trendLabel ? ` (${s.trendLabel})` : ''}`);
    else if (s.type === 'callout' && s.text)
      lines.push(`[${(s.severity || 'note').toUpperCase()}] ${s.text}`);
    else if (s.type === 'table' && Array.isArray(s.columns) && Array.isArray(s.rows)) {
      lines.push(`Table (${s.rows.length} rows): ${s.columns.join(', ')}`);
      s.rows.slice(0, 10).forEach((row: string[]) =>
        lines.push('  ' + s.columns.map((c: string, i: number) => `${c}: ${row[i] ?? ''}`).join(' | '))
      );
    }
    else if (s.type === 'metrics-row' && Array.isArray(s.metrics))
      lines.push('Metrics: ' + s.metrics.map((m: any) => `${m.label}: ${m.value}`).join(', '));
  }

  // Data-query cards (dataset, inspector, alert, metric, comparison)
  if (Array.isArray(ctx.columns) && Array.isArray(ctx.rows)) {
    const cols: string[] = ctx.columns;
    const rows: string[][] = ctx.rows;
    lines.push(`Data (${rows.length} rows): ${cols.join(', ')}`);
    rows.slice(0, 20).forEach(row =>
      lines.push('  ' + cols.map((c, i) => `${c}: ${row[i] ?? ''}`).join(' | '))
    );
  }

  // Metric cards
  if (ctx.currentValue !== undefined) {
    lines.push(`Value: ${ctx.unit || ''}${ctx.currentValue}${ctx.change ? ` (${ctx.trend === 'up' ? '+' : ''}${ctx.change})` : ''}`);
    if (Array.isArray(ctx.breakdown))
      (ctx.breakdown as any[]).forEach(b => lines.push(`  ${b.name}: ${b.value}`));
  }

  // Alert cards
  if (Array.isArray(ctx.alerts)) {
    lines.push(`Alerts (${(ctx.alerts as any[]).length} total):`);
    (ctx.alerts as any[]).slice(0, 15).forEach((a: any) =>
      lines.push(`  [${a.severity?.toUpperCase() || 'ALERT'}] ${a.title || a.text || ''}`)
    );
  }

  // Comparison cards
  if (Array.isArray(ctx.entities)) {
    lines.push(`Comparison (${(ctx.entities as any[]).length} entities):`);
    (ctx.entities as any[]).forEach((e: any) => {
      const metrics = e.metrics ? Object.entries(e.metrics).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
      lines.push(`  ${e.name}: ${metrics}`);
    });
  }

  // Brief/synthesis content
  if (typeof ctx.content === 'string' && ctx.content)
    lines.push(`Content: ${ctx.content.slice(0, 800)}`);
  else if (typeof ctx.summary === 'string' && ctx.summary)
    lines.push(`Summary: ${ctx.summary.slice(0, 800)}`);
  if (Array.isArray(ctx.insights))
    (ctx.insights as string[]).forEach(ins => lines.push(`  • ${ins}`));

  // Simulation cards
  if (Array.isArray(ctx.simRows)) {
    lines.push('Simulation projections:');
    (ctx.simRows as any[]).slice(0, 8).forEach((r: any) =>
      lines.push(`  ${r.period}: A=${r.scenarioA}, B=${r.scenarioB}`)
    );
  }

  return lines.join('\n');
}

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
    const sourceSum = buildFusionContext(source);
    const targetSum = buildFusionContext(target);

    const result = await callAI(
      [
        {
          role: 'user',
          content: `You are an analytical synthesis engine. You must produce NEW analysis that NEITHER input contains on its own.

OBJECT A:
${sourceSum}

OBJECT B:
${targetSum}

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
    } catch (e) { console.warn('[fusion-executor] Failed to parse fusion AI response:', e); }

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
