/**
 * Notebook — Sherpa's metacognition surface.
 *
 * Single top-level tab in SherpaRail that surfaces what Sherpa is doing
 * autonomously: scratchpads it has architected, predictions it has logged,
 * memories it has inferred, and the structural shape of its own knowledge.
 *
 * Replaces the standalone Memory tab — Memory becomes one section here,
 * alongside Scratchpads, Predictions, and Pending Inferences.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { listDocuments, extractDataset, type DocumentRecord } from '@/lib/document-store';
import {
  getMemories,
  getPendingMemories,
  confirmMemory,
  deleteMemory,
} from '@/lib/memory-store';
import type { SherpaMemory } from '@/lib/memory-types';

interface NotebookProps {
  onSendToSherpa?: (message: string) => void;
}

// ─── Section Header ─────────────────────────────────────────────────────────

interface SectionProps {
  label: string;
  count?: number | string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ label, count, hint, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="space-y-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="group flex w-full items-baseline justify-between gap-3 py-1 text-left transition-opacity hover:opacity-100 opacity-90"
      >
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-workspace-accent/75">
          {label}
        </span>
        <span className="flex items-baseline gap-2 text-[11px] text-workspace-text-secondary tabular-nums">
          {count !== undefined && <span>{count}</span>}
          <span className="inline-block w-2 text-[8px] text-workspace-text-secondary/40 transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
        </span>
      </button>
      {hint && open && (
        <p className="text-[10px] text-workspace-text-secondary/45 leading-relaxed">{hint}</p>
      )}
      {open && <div className="space-y-2 animate-[materialize_0.32s_cubic-bezier(0.16,1,0.3,1)]">{children}</div>}
    </section>
  );
}

// ─── Hero Stats ─────────────────────────────────────────────────────────────

interface HeroProps {
  scratchpadCount: number;
  ephemeralCount: number;
  memoryCount: number;
  predictionCount: number | null;
  pendingCount: number;
}

function Hero({ scratchpadCount, ephemeralCount, memoryCount, predictionCount, pendingCount }: HeroProps) {
  const stats = [
    { label: 'Scratchpads', value: scratchpadCount, sub: ephemeralCount > 0 ? `${ephemeralCount} ephemeral` : 'all persistent' },
    { label: 'Memories', value: memoryCount, sub: pendingCount > 0 ? `${pendingCount} pending` : 'all confirmed' },
    { label: 'Predictions', value: predictionCount ?? '—', sub: predictionCount === null ? 'no ledger' : 'tracked' },
  ];
  return (
    <div className="rounded-xl border border-workspace-border/35 bg-workspace-surface/30 p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-workspace-accent/75 mb-2">
        Sherpa's Notebook
      </div>
      <div className="grid grid-cols-3 gap-2">
        {stats.map(s => (
          <div key={s.label} className="rounded-lg bg-white/40 px-2.5 py-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-workspace-text-secondary/60">{s.label}</div>
            <div className="mt-0.5 text-base font-semibold text-workspace-text tabular-nums leading-none">{s.value}</div>
            <div className="mt-1 text-[9px] text-workspace-text-secondary/45 truncate">{s.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Scratchpads ────────────────────────────────────────────────────────────

interface ScratchpadsProps {
  scratchpads: DocumentRecord[];
  onAsk: (q: string) => void;
}

function ScratchpadRow({ doc, onAsk }: { doc: DocumentRecord; onAsk: (q: string) => void }) {
  const meta = (doc.metadata || {}) as { isScratchpad?: boolean; summary?: string; primarySheet?: string };
  const ds = extractDataset(doc);
  const rowCount = ds?.rows.length ?? 0;
  const colCount = ds?.columns.length ?? 0;
  const name = meta.primarySheet || doc.filename.replace(/\.scratchpad$/, '');
  const isEphemeral = name.toLowerCase().startsWith('tmp_');
  const ageMs = Date.now() - new Date(doc.created_at).getTime();
  const ageLabel = formatAge(ageMs);

  return (
    <div className="group rounded-lg border border-workspace-border/30 bg-white/30 px-3 py-2.5 transition-all hover:border-workspace-accent/40 hover:bg-white/55 hover:shadow-[0_2px_10px_rgba(99,102,241,0.05)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${isEphemeral ? 'bg-amber-400/60' : 'bg-emerald-400/70'}`} />
            <span className="truncate text-[12px] font-medium text-workspace-text">{name}</span>
            {isEphemeral && (
              <span className="rounded-full bg-amber-100/70 px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-amber-800/80">ephemeral</span>
            )}
          </div>
          {meta.summary && (
            <p className="mt-0.5 text-[10px] text-workspace-text-secondary/65 leading-snug line-clamp-2">{meta.summary}</p>
          )}
          <div className="mt-1.5 flex items-center gap-3 text-[9px] text-workspace-text-secondary/50 tabular-nums">
            <span>{rowCount.toLocaleString()} rows</span>
            <span>·</span>
            <span>{colCount} cols</span>
            <span>·</span>
            <span>{ageLabel}</span>
          </div>
        </div>
        <button
          onClick={() => onAsk(`Open the "${name}" scratchpad and walk me through what's in it.`)}
          className="opacity-0 group-hover:opacity-100 transition-opacity rounded-md border border-workspace-accent/25 px-2 py-1 text-[9px] uppercase tracking-wider text-workspace-accent/80 hover:bg-workspace-accent/8"
        >
          Open
        </button>
      </div>
    </div>
  );
}

function ScratchpadList({ scratchpads, onAsk }: ScratchpadsProps) {
  const sorted = useMemo(() => {
    return [...scratchpads].sort((a, b) => {
      const aMeta = (a.metadata || {}) as { primarySheet?: string };
      const bMeta = (b.metadata || {}) as { primarySheet?: string };
      const aName = (aMeta.primarySheet || a.filename).toLowerCase();
      const bName = (bMeta.primarySheet || b.filename).toLowerCase();
      const aTmp = aName.startsWith('tmp_');
      const bTmp = bName.startsWith('tmp_');
      // Persistent first, then ephemeral; within each, newest first
      if (aTmp !== bTmp) return aTmp ? 1 : -1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [scratchpads]);

  if (sorted.length === 0) {
    return (
      <p className="text-[11px] text-workspace-text-secondary/50 italic px-1">
        Sherpa hasn't created any scratchpads yet. Run a morning brief to bootstrap.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {sorted.map(d => (
        <ScratchpadRow key={d.id} doc={d} onAsk={onAsk} />
      ))}
    </div>
  );
}

// ─── Prediction Ledger ──────────────────────────────────────────────────────

interface PredictionLedgerProps {
  ledger: DocumentRecord | null;
  onAsk: (q: string) => void;
}

function PredictionLedger({ ledger, onAsk }: PredictionLedgerProps) {
  if (!ledger) {
    return (
      <p className="text-[11px] text-workspace-text-secondary/50 italic px-1">
        No prediction ledger yet. Sherpa creates one during the morning brief once predictions are made.
      </p>
    );
  }
  const ds = extractDataset(ledger);
  if (!ds || ds.rows.length === 0) {
    return (
      <p className="text-[11px] text-workspace-text-secondary/50 italic px-1">
        Ledger exists but is empty. Predictions will populate as Sherpa makes them.
      </p>
    );
  }

  // Try to detect grading columns
  const lowerCols = ds.columns.map(c => c.toLowerCase());
  const predIdx = lowerCols.findIndex(c => c.includes('prediction') || c.includes('forecast') || c.includes('claim'));
  const resIdx = lowerCols.findIndex(c => c.includes('resolution') || c.includes('actual') || c.includes('outcome'));
  const dateIdx = lowerCols.findIndex(c => c.includes('date') || c.includes('resolves'));
  const verdictIdx = lowerCols.findIndex(c => c.includes('hit') || c.includes('miss') || c.includes('grade') || c.includes('verdict'));

  // Calibration calc — count hits/misses if verdict column present
  let hits = 0;
  let misses = 0;
  let pending = 0;
  if (verdictIdx >= 0) {
    for (const r of ds.rows) {
      const v = (r[verdictIdx] || '').toLowerCase();
      if (v.includes('hit') || v === 'true' || v === 'yes' || v === 'correct') hits++;
      else if (v.includes('miss') || v === 'false' || v === 'no' || v === 'wrong') misses++;
      else pending++;
    }
  }
  const graded = hits + misses;
  const calibration = graded > 0 ? Math.round((hits / graded) * 100) : null;

  const recent = ds.rows.slice(-5).reverse();

  return (
    <div className="space-y-2">
      {calibration !== null && (
        <div className="flex items-baseline gap-3 rounded-lg border border-workspace-border/30 bg-white/30 px-3 py-2">
          <div>
            <div className="text-[9px] uppercase tracking-[0.16em] text-workspace-text-secondary/60">Calibration</div>
            <div className="text-base font-semibold text-workspace-text tabular-nums leading-none">{calibration}%</div>
          </div>
          <div className="text-[10px] text-workspace-text-secondary/55 tabular-nums">
            {hits} hits · {misses} misses{pending > 0 && ` · ${pending} pending`}
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        {recent.map((row, i) => {
          const pred = predIdx >= 0 ? row[predIdx] : row[0];
          const res = resIdx >= 0 ? row[resIdx] : null;
          const verdict = verdictIdx >= 0 ? row[verdictIdx] : null;
          const date = dateIdx >= 0 ? row[dateIdx] : null;
          const v = (verdict || '').toLowerCase();
          const isHit = v.includes('hit') || v === 'correct';
          const isMiss = v.includes('miss') || v === 'wrong';
          return (
            <div key={i} className="rounded-lg border border-workspace-border/25 bg-white/30 px-3 py-2">
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    isHit ? 'bg-emerald-500/70' : isMiss ? 'bg-rose-500/70' : 'bg-workspace-text-secondary/35'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-workspace-text leading-snug">{pred}</p>
                  {res && (
                    <p className="mt-0.5 text-[10px] text-workspace-text-secondary/65">→ {res}</p>
                  )}
                  {date && (
                    <p className="mt-0.5 text-[9px] text-workspace-text-secondary/45 tabular-nums">{date}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {ds.rows.length > 5 && (
        <button
          onClick={() => onAsk(`Open the prediction ledger.`)}
          className="w-full rounded-md border border-workspace-border/30 px-2 py-1.5 text-[10px] text-workspace-text-secondary/70 hover:border-workspace-accent/40 hover:text-workspace-accent transition-colors"
        >
          View all {ds.rows.length} predictions
        </button>
      )}
    </div>
  );
}

// ─── Pending Inferences ─────────────────────────────────────────────────────

interface PendingProps {
  pending: SherpaMemory[];
  onConfirm: (id: string) => void;
  onDelete: (id: string) => void;
}

function PendingInferences({ pending, onConfirm, onDelete }: PendingProps) {
  if (pending.length === 0) {
    return (
      <p className="text-[11px] text-workspace-text-secondary/50 italic px-1">
        Nothing waiting for review. Sherpa surfaces inferred patterns here when it's not sure.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {pending.map(m => {
        const conf = Math.round(m.confidence * 100);
        return (
          <div key={m.id} className="rounded-lg border border-amber-200/55 bg-amber-50/35 px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[8px] uppercase tracking-wider font-medium text-amber-700/75">{m.type}</span>
                  <span className="text-[9px] text-workspace-text-secondary/55 tabular-nums">{conf}% confidence</span>
                </div>
                <p className="text-[11px] text-workspace-text leading-snug">{m.reasoning || m.content}</p>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button
                  onClick={() => onConfirm(m.id)}
                  className="rounded-md bg-emerald-600/85 px-2 py-1 text-[9px] font-medium uppercase tracking-wider text-white hover:bg-emerald-600 transition-colors"
                  title="Confirm — promote to override tier"
                >
                  Keep
                </button>
                <button
                  onClick={() => onDelete(m.id)}
                  className="rounded-md border border-workspace-border/40 px-2 py-1 text-[9px] uppercase tracking-wider text-workspace-text-secondary/65 hover:bg-rose-50/50 hover:border-rose-300/50 hover:text-rose-700/70 transition-colors"
                >
                  Drop
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Memory (grouped) ───────────────────────────────────────────────────────

interface MemoryGroupedProps {
  memories: SherpaMemory[];
  pendingIds: Set<string>;
  onDelete: (id: string) => void;
}

const TYPE_CONFIG: Record<string, { label: string; tone: string }> = {
  correction: { label: 'Corrections', tone: 'text-rose-600/85' },
  preference: { label: 'Preferences', tone: 'text-workspace-accent' },
  entity: { label: 'Domain', tone: 'text-emerald-600/85' },
  pattern: { label: 'Patterns', tone: 'text-blue-600/85' },
  'anti-pattern': { label: 'Avoid', tone: 'text-amber-600/85' },
};

function MemoryGrouped({ memories, pendingIds, onDelete }: MemoryGroupedProps) {
  const grouped = useMemo(() => {
    const g: Record<string, SherpaMemory[]> = {};
    for (const m of memories) {
      if (pendingIds.has(m.id)) continue; // pending shown above
      (g[m.type] = g[m.type] || []).push(m);
    }
    return g;
  }, [memories, pendingIds]);

  const totalShown = Object.values(grouped).reduce((s, arr) => s + arr.length, 0);
  if (totalShown === 0) {
    return (
      <p className="text-[11px] text-workspace-text-secondary/50 italic px-1">
        No confirmed memories yet. Sherpa builds these from explicit guidance and observed patterns.
      </p>
    );
  }

  const order: (keyof typeof TYPE_CONFIG)[] = ['correction', 'preference', 'pattern', 'entity', 'anti-pattern'];
  return (
    <div className="space-y-3">
      {order.map(t => {
        const list = grouped[t];
        if (!list || list.length === 0) return null;
        const cfg = TYPE_CONFIG[t];
        return (
          <div key={t}>
            <div className={`text-[9px] uppercase tracking-[0.18em] font-medium ${cfg.tone} mb-1`}>
              {cfg.label} <span className="text-workspace-text-secondary/45 tabular-nums">· {list.length}</span>
            </div>
            <div className="space-y-1">
              {list.map(m => {
                const conf = Math.round(m.confidence * 100);
                const usage = m.hitCount > 0 ? `${m.hitCount}×` : null;
                return (
                  <div key={m.id} className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white/40 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-workspace-text leading-snug">{m.content}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-[9px] text-workspace-text-secondary/50 tabular-nums">
                        <span>{conf}%</span>
                        {usage && <><span>·</span><span>used {usage}</span></>}
                        {m.tier === 'override' && <><span>·</span><span className="text-emerald-700/70">override</span></>}
                      </div>
                    </div>
                    <button
                      onClick={() => onDelete(m.id)}
                      className="opacity-0 group-hover:opacity-100 text-[10px] text-workspace-text-secondary/40 hover:text-rose-600 transition-all"
                      title="Delete memory"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function Notebook({ onSendToSherpa }: NotebookProps) {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [memories, setMemories] = useState<SherpaMemory[]>([]);
  const [pending, setPending] = useState<SherpaMemory[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const [docs, mems, pend] = await Promise.all([
      listDocuments(),
      user ? getMemories(user.id) : Promise.resolve([]),
      user ? getPendingMemories(user.id) : Promise.resolve([]),
    ]);
    setDocs(docs);
    setMemories(mems);
    setPending(pend);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const scratchpads = useMemo(
    () => docs.filter(d => Boolean((d.metadata as { isScratchpad?: boolean })?.isScratchpad)),
    [docs]
  );
  const ephemeralCount = useMemo(
    () => scratchpads.filter(d => {
      const meta = (d.metadata || {}) as { primarySheet?: string };
      const name = (meta.primarySheet || d.filename).toLowerCase();
      return name.startsWith('tmp_');
    }).length,
    [scratchpads]
  );
  const predictionLedger = useMemo(
    () => scratchpads.find(d => {
      const meta = (d.metadata || {}) as { primarySheet?: string };
      const name = (meta.primarySheet || d.filename).toLowerCase();
      return name.includes('prediction') || name.includes('forecast');
    }) || null,
    [scratchpads]
  );
  const predictionCount = useMemo(() => {
    if (!predictionLedger) return null;
    const ds = extractDataset(predictionLedger);
    return ds?.rows.length ?? 0;
  }, [predictionLedger]);

  const pendingIds = useMemo(() => new Set(pending.map(p => p.id)), [pending]);

  const handleAsk = useCallback((q: string) => {
    onSendToSherpa?.(q);
  }, [onSendToSherpa]);

  const handleConfirm = useCallback(async (id: string) => {
    await confirmMemory(id);
    reload();
  }, [reload]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteMemory(id);
    reload();
  }, [reload]);

  if (loading) {
    return (
      <div className="py-6 text-center text-[11px] text-workspace-text-secondary/50">
        Reading Sherpa's notebook…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Hero
        scratchpadCount={scratchpads.length}
        ephemeralCount={ephemeralCount}
        memoryCount={memories.length}
        predictionCount={predictionCount}
        pendingCount={pending.length}
      />

      <Section
        label="Scratchpads"
        count={`${scratchpads.length}${ephemeralCount > 0 ? ` (${ephemeralCount} tmp)` : ''}`}
        hint="Sherpa's self-architected data layer. Persistent ones stick around; ephemeral (tmp_) get cleaned up at end of brief."
        defaultOpen
      >
        <ScratchpadList scratchpads={scratchpads} onAsk={handleAsk} />
      </Section>

      <Section
        label="Predictions"
        count={predictionCount ?? '—'}
        hint="Forecasts Sherpa has made and graded against actuals."
        defaultOpen={Boolean(predictionLedger)}
      >
        <PredictionLedger ledger={predictionLedger} onAsk={handleAsk} />
      </Section>

      {pending.length > 0 && (
        <Section
          label="Awaiting Confirmation"
          count={pending.length}
          hint="Patterns Sherpa inferred from your behavior. Confirm to apply going forward, or drop if wrong."
          defaultOpen
        >
          <PendingInferences pending={pending} onConfirm={handleConfirm} onDelete={handleDelete} />
        </Section>
      )}

      <Section
        label="Memory"
        count={memories.length - pending.length}
        hint="What Sherpa knows about you. Confidence reinforces with each successful application; decays with disuse."
        defaultOpen={false}
      >
        <MemoryGrouped memories={memories} pendingIds={pendingIds} onDelete={handleDelete} />
      </Section>
    </div>
  );
}
