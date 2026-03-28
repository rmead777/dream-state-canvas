/**
 * OfflineCatalog — visual fallback when AI gateway is unavailable.
 * Shows a grid of available object types for explicit user selection.
 * Replaces keyword matching as the degraded-mode experience.
 */
import { ObjectType } from '@/lib/workspace-types';

interface CatalogItem {
  type: ObjectType;
  icon: string;
  label: string;
  desc: string;
}

const CATALOG_ITEMS: CatalogItem[] = [
  { type: 'action-queue', icon: '☐', label: 'Action Queue', desc: 'Prioritized to-do list' },
  { type: 'vendor-dossier', icon: '◈', label: 'Vendor Dossier', desc: 'Call prep for a vendor' },
  { type: 'cash-planner', icon: '$', label: 'Cash Planner', desc: 'Optimize payment allocation' },
  { type: 'escalation-tracker', icon: '⚠', label: 'Escalation Tracker', desc: 'What\'s getting worse?' },
  { type: 'production-risk', icon: '⚡', label: 'Production Risk', desc: 'What breaks if they cut us off?' },
  { type: 'outreach-tracker', icon: '✉', label: 'Outreach Tracker', desc: 'Promises & follow-ups' },
  { type: 'metric', icon: '◆', label: 'Key Metric', desc: 'Single number overview' },
  { type: 'alert', icon: '⚠', label: 'Urgent Alerts', desc: 'What needs attention now' },
  { type: 'inspector', icon: '▤', label: 'Data Table', desc: 'Browse the full dataset' },
  { type: 'brief', icon: '✦', label: 'Analysis Brief', desc: 'AI-written summary' },
  { type: 'comparison', icon: '⇄', label: 'Comparison', desc: 'Side-by-side view' },
  { type: 'dataset', icon: '▥', label: 'Full Dataset', desc: 'Complete data view' },
];

interface OfflineCatalogProps {
  onSelect: (type: ObjectType) => void;
  onDismiss: () => void;
}

export function OfflineCatalog({ onSelect, onDismiss }: OfflineCatalogProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-workspace-text">AI is temporarily unavailable</p>
          <p className="text-xs text-workspace-text-secondary/60">Select an object type to create manually</p>
        </div>
        <button
          onClick={onDismiss}
          className="rounded-full px-3 py-1 text-xs text-workspace-text-secondary hover:text-workspace-text transition-colors"
        >
          Dismiss
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CATALOG_ITEMS.map((item) => (
          <button
            key={item.type}
            onClick={() => onSelect(item.type)}
            className="flex flex-col items-start gap-1.5 rounded-xl border border-workspace-border/50 bg-white/80 px-3 py-3 text-left transition-all duration-200 hover:border-workspace-accent/30 hover:shadow-[0_8px_20px_rgba(99,102,241,0.08)] hover:-translate-y-0.5"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{item.icon}</span>
              <span className="text-xs font-medium text-workspace-text">{item.label}</span>
            </div>
            <p className="text-[10px] text-workspace-text-secondary/60 leading-relaxed">{item.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
