/**
 * VendorDossier — deep-dive card for a single vendor relationship.
 * Shows situation, threat, 2x2 strategic grid, payment history, quotes.
 */
import { WorkspaceObject } from '@/lib/workspace-types';
import { VendorDossierData } from '@/lib/cfo-object-types';
import { VendorLink, formatCurrency } from '@/components/objects/VendorLink';
import MarkdownRenderer from '@/components/objects/MarkdownRenderer';

interface VendorDossierProps {
  object: WorkspaceObject;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TIER_STYLES: Record<string, { badge: string; label: string }> = {
  critical: {
    badge: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800',
    label: 'Critical',
  },
  strategic: {
    badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800',
    label: 'Strategic',
  },
  operational: {
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    label: 'Operational',
  },
  standard: {
    badge: 'bg-workspace-surface text-workspace-text-secondary border-workspace-border',
    label: 'Standard',
  },
};

function getTierStyle(tier: string) {
  const key = tier.toLowerCase();
  return TIER_STYLES[key] ?? {
    badge: 'bg-workspace-surface text-workspace-text-secondary border-workspace-border',
    label: tier,
  };
}

function threatUrgencyColor(timeline: string | undefined): string {
  if (!timeline) return 'text-workspace-text-secondary';
  const t = timeline.toLowerCase();
  if (t.includes('immediate') || t.includes('now') || t.includes('today') || t.includes('48h') || t.includes('24h')) {
    return 'text-red-600 dark:text-red-400';
  }
  if (t.includes('week') || t.includes('soon')) {
    return 'text-amber-600 dark:text-amber-400';
  }
  return 'text-workspace-text-secondary';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-workspace-text-secondary/60">
      {children}
    </h4>
  );
}

function GridCell({ label, content }: { label: string; content: string }) {
  return (
    <div className="rounded-xl border border-workspace-border/40 bg-workspace-surface/20 p-3 space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-workspace-text-secondary/60">
        {label}
      </p>
      <p className="text-xs leading-relaxed text-workspace-text">{content}</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function VendorDossier({ object }: VendorDossierProps) {
  const data = object.context as VendorDossierData | undefined;

  if (!data || !data.vendorName) {
    return (
      <p className="text-sm text-workspace-text-secondary/60">
        No vendor data available. Ask Sherpa for a vendor dossier.
      </p>
    );
  }

  const tierStyle = getTierStyle(data.tier ?? 'standard');
  const threatColor = threatUrgencyColor(data.threatTimeline);

  return (
    <div className="space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {/* Vendor name + tier badge */}
        <div className="flex flex-wrap items-start gap-3">
          <h2 className="text-xl font-bold text-workspace-text leading-tight">
            <VendorLink name={data.vendorName} />
          </h2>
          {data.tier && (
            <span className={`mt-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tierStyle.badge}`}>
              {tierStyle.label}
            </span>
          )}
        </div>

        {/* Balance — large, prominent */}
        <p className="text-3xl font-bold tabular-nums text-workspace-text">
          {data.balanceFormatted ?? formatCurrency(data.balance)}
        </p>

        {/* Contact info */}
        {data.contact && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-workspace-text-secondary">
            {data.contact.name && <span className="font-medium text-workspace-text">{data.contact.name}</span>}
            {data.contact.role && <span>{data.contact.role}</span>}
            {data.contact.email && (
              <a
                href={`mailto:${data.contact.email}`}
                className="text-workspace-accent hover:underline"
              >
                {data.contact.email}
              </a>
            )}
            {data.contact.phone && <span>{data.contact.phone}</span>}
          </div>
        )}

        {/* Activity meta */}
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] tabular-nums text-workspace-text-secondary">
          {data.daysSilent != null && (
            <span>
              Silent:{' '}
              <span className={`font-semibold ${data.daysSilent > 7 ? 'text-amber-600 dark:text-amber-400' : 'text-workspace-text'}`}>
                {data.daysSilent}d
              </span>
            </span>
          )}
          {data.emailCount != null && (
            <span>
              Emails: <span className="font-semibold text-workspace-text">{data.emailCount}</span>
            </span>
          )}
          {data.riskCategory && (
            <span>
              Risk: <span className="font-semibold text-workspace-text">{data.riskCategory}</span>
            </span>
          )}
        </div>
      </div>

      {/* ── Situation ──────────────────────────────────────────────────────── */}
      {data.situation && (
        <div className="rounded-xl border-l-4 border-workspace-accent bg-workspace-surface/30 px-4 py-3">
          <SectionLabel>Situation</SectionLabel>
          <p className="text-sm leading-relaxed text-workspace-text">{data.situation}</p>
        </div>
      )}

      {/* ── Threat ─────────────────────────────────────────────────────────── */}
      {(data.threatType || data.threatTimeline) && (
        <div className="rounded-xl border border-workspace-border/40 bg-workspace-surface/15 px-4 py-3 space-y-1">
          <SectionLabel>Threat</SectionLabel>
          <div className="flex flex-wrap items-center gap-3">
            {data.threatType && (
              <span className="text-sm font-semibold text-workspace-text">{data.threatType}</span>
            )}
            {data.threatTimeline && (
              <span className={`text-sm font-medium tabular-nums ${threatColor}`}>
                {data.threatTimeline}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Relationship History ────────────────────────────────────────────── */}
      {data.relationshipHistory && data.relationshipHistory.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>Relationship History</SectionLabel>
          <ul className="space-y-1">
            {data.relationshipHistory.map((event, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-workspace-text-secondary">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-workspace-border" />
                <span>{event}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 2x2 Strategic Grid ─────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <SectionLabel>Strategic Position</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {data.whatTheyWant && (
            <GridCell label="What They Want" content={data.whatTheyWant} />
          )}
          {data.whatWeCanOffer && (
            <GridCell label="What We Can Offer" content={data.whatWeCanOffer} />
          )}
          {data.leverage && (
            <GridCell label="Our Leverage" content={data.leverage} />
          )}
          {data.riskIfIgnored && (
            <GridCell label="Risk If Ignored" content={data.riskIfIgnored} />
          )}
        </div>
      </div>

      {/* ── Payment History ─────────────────────────────────────────────────── */}
      {data.paymentHistory && (
        <div className="space-y-1.5">
          <SectionLabel>Payment History</SectionLabel>
          <MarkdownRenderer content={data.paymentHistory} />
        </div>
      )}

      {/* ── Key Quotes ──────────────────────────────────────────────────────── */}
      {data.keyQuotes && data.keyQuotes.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>Key Quotes</SectionLabel>
          {data.keyQuotes.map((quote, i) => (
            <blockquote
              key={i}
              className="rounded-lg border-l-[3px] border-workspace-accent/60 bg-workspace-surface/20 px-4 py-2.5"
            >
              <p className="text-xs italic leading-relaxed text-workspace-text">
                &ldquo;{quote}&rdquo;
              </p>
            </blockquote>
          ))}
        </div>
      )}

      {/* ── Sources ─────────────────────────────────────────────────────────── */}
      {data.sources && data.sources.length > 0 && (
        <div className="border-t border-workspace-border/30 pt-3 space-y-1">
          <SectionLabel>Sources</SectionLabel>
          <ul className="space-y-0.5">
            {data.sources.map((src, i) => (
              <li key={i} className="text-[10px] text-workspace-text-secondary/60">
                {src}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
