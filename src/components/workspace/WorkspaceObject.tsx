import { useState, useEffect, useRef, type HTMLAttributes } from 'react';
import { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import { WorkspaceObject as WO } from '@/lib/workspace-types';
import { useWorkspaceActions } from '@/hooks/useWorkspaceActions';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCrossObjectBehavior } from '@/hooks/useCrossObjectBehavior';
import { useAmbientSherpa } from '@/hooks/useAmbientSherpa';
import { useManifestation } from '@/hooks/useManifestation';
import { AmbientHint } from '@/components/workspace/AmbientHint';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MetricDetail } from '@/components/objects/MetricDetail';
import { ComparisonPanel } from '@/components/objects/ComparisonPanel';
import { AlertRiskPanel } from '@/components/objects/AlertRiskPanel';
import { DataInspector } from '@/components/objects/DataInspector';
import { AIBrief } from '@/components/objects/AIBrief';
import { Timeline } from '@/components/objects/Timeline';
import { DocumentReader } from '@/components/objects/DocumentReader';
import { DatasetView } from '@/components/objects/DatasetView';
import { AnalysisCard } from '@/components/objects/AnalysisCard';
import { ActionQueue } from '@/components/objects/ActionQueue';
import { VendorDossier } from '@/components/objects/VendorDossier';
import { CashPlanner } from '@/components/objects/CashPlanner';
import { EscalationTracker } from '@/components/objects/EscalationTracker';
import { OutreachTracker } from '@/components/objects/OutreachTracker';
import { ProductionRiskMap } from '@/components/objects/ProductionRiskMap';
import { EmailDraft } from '@/components/objects/EmailDraft';
import { SimulationCard } from '@/components/objects/SimulationCard';
import { AutomationPanel } from '@/components/objects/AutomationPanel';
import { DatasetEditPreview } from '@/components/objects/DatasetEditPreview';
import { MemoryCleanupPreview } from '@/components/objects/MemoryCleanupPreview';
import { getObjectTypeToken, getFamilyTokens, derivePosture, POSTURE_LABELS } from '@/lib/design-tokens';

/**
 * ManifestationSkeleton — geometry-only placeholder shown during the
 * `scaffold` and `resolving` phases of manifestation. Communicates type
 * + structure before the real content hydrates. Uses the existing
 * `.workspace-skeleton` shimmer utility from index.css.
 */
function ManifestationSkeleton({ objectType }: { objectType: string }) {
  // Different object types suggest different skeleton shapes.
  const isTabular =
    objectType === 'dataset' ||
    objectType === 'inspector' ||
    objectType === 'action-queue' ||
    objectType === 'escalation-tracker' ||
    objectType === 'outreach-tracker';
  const isMetric = objectType === 'metric' || objectType === 'comparison';

  if (isMetric) {
    return (
      <div className="space-y-3 py-2">
        <div className="workspace-skeleton h-8 w-1/3 rounded-md" />
        <div className="workspace-skeleton h-3 w-2/3 rounded-md" />
        <div className="workspace-skeleton h-16 w-full rounded-md" />
      </div>
    );
  }
  if (isTabular) {
    return (
      <div className="space-y-1.5 py-2">
        <div className="workspace-skeleton h-4 w-full rounded-md" />
        <div className="workspace-skeleton h-3 w-full rounded-md" />
        <div className="workspace-skeleton h-3 w-full rounded-md" />
        <div className="workspace-skeleton h-3 w-full rounded-md" />
        <div className="workspace-skeleton h-3 w-5/6 rounded-md" />
      </div>
    );
  }
  // Default: analysis/brief — paragraph-shaped skeleton
  return (
    <div className="space-y-2 py-2">
      <div className="workspace-skeleton h-3 w-5/6 rounded-md" />
      <div className="workspace-skeleton h-3 w-full rounded-md" />
      <div className="workspace-skeleton h-3 w-11/12 rounded-md" />
      <div className="workspace-skeleton h-3 w-3/4 rounded-md" />
      <div className="workspace-skeleton h-3 w-full rounded-md" />
    </div>
  );
}

function ObjectContent({ object }: { object: WO }) {
  // Special flag: automation panel view
  if (object.context?.isAutomationPanel) {
    return <AutomationPanel object={object} />;
  }

  // Dataset edit preview gets its own renderer (before sections check)
  if (object.context?.isDatasetEdit || object.type === 'dataset-edit-preview') {
    return <DatasetEditPreview object={object} />;
  }

  // Memory cleanup preview
  if (object.context?.isMemoryCleanup || object.type === 'memory-cleanup-preview') {
    return <MemoryCleanupPreview object={object} />;
  }

  // If any card type has AI-generated sections, use the universal renderer
  if (object.context?.sections?.length > 0) {
    return <AnalysisCard object={object} />;
  }

  switch (object.type) {
    case 'metric': return <MetricDetail object={object} />;
    case 'comparison': return <ComparisonPanel object={object} />;
    case 'alert': return <AlertRiskPanel object={object} />;
    case 'inspector': return <DataInspector object={object} />;
    case 'brief': return <AIBrief object={object} />;
    case 'timeline': return <Timeline object={object} />;
    case 'document':
    case 'document-viewer': return <DocumentReader object={object} />;
    case 'dataset': return <DatasetView object={object} />;
    case 'analysis': return <AnalysisCard object={object} />;
    case 'action-queue': return <ActionQueue object={object} />;
    case 'vendor-dossier': return <VendorDossier object={object} />;
    case 'cash-planner': return <CashPlanner object={object} />;
    case 'escalation-tracker': return <EscalationTracker object={object} />;
    case 'outreach-tracker': return <OutreachTracker object={object} />;
    case 'production-risk': return <ProductionRiskMap object={object} />;
    case 'email-draft': return <EmailDraft object={object} />;
    case 'simulation': return <SimulationCard object={object} />;
    default:
      // Unknown types: try AnalysisCard (handles sections + markdown), then show content
      if (object.context?.content) {
        return <AnalysisCard object={object} />;
      }
      return <AnalysisCard object={object} />;
  }
}

export function WorkspaceObjectWrapper({ object, dragHandleProps }: { object: WO; dragHandleProps?: HTMLAttributes<HTMLSpanElement> | SyntheticListenerMap }) {
  const { collapseObject, dissolveObject, pinObject, unpinObject, focusObject, processIntent } = useWorkspaceActions();
  const { state, dispatch } = useWorkspace();
  const { shouldDim, shouldHighlight, getContextualActions, cascadeDissolve } = useCrossObjectBehavior();
  const ambientHints = useAmbientSherpa();
  const [size, setSize] = useState<{ width: number | null; height: number | null }>({ width: null, height: null });
  const [dismissedHints, setDismissedHints] = useState<Set<string>>(new Set());
  const [showFocusFlash, setShowFocusFlash] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const isFocused = state.activeContext.focusedObjectId === object.id;
  const manifestation = useManifestation(object);

  // Lineage pulse — when a scaffold spawns with this card as a source,
  // we briefly add `lineage-pulsing`. The animation is 1.2s; we keep the
  // class on for 1300ms (a touch longer) so it always finishes cleanly.
  const [isLineagePulsing, setIsLineagePulsing] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sourceIds?: string[] }>).detail;
      if (detail?.sourceIds?.includes(object.id)) {
        setIsLineagePulsing(true);
        window.setTimeout(() => setIsLineagePulsing(false), 1300);
      }
    };
    window.addEventListener('sherpa-lineage-highlight', handler);
    return () => window.removeEventListener('sherpa-lineage-highlight', handler);
  }, [object.id]);

  // Scroll into view when focused
  useEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isFocused]);

  // Sherpa-driven focus flash / glow
  useEffect(() => {
    if (!isFocused) return;

    setShowFocusFlash(true);
    const timeout = window.setTimeout(() => setShowFocusFlash(false), 900);
    return () => window.clearTimeout(timeout);
  }, [isFocused, object.lastInteractedAt]);

  const isDimmed = shouldDim(object.id);
  const isHighlighted = shouldHighlight(object.id);
  const isMaterializing = object.status === 'materializing';
  // When the manifestation controller is driving visuals, skip the legacy
  // CSS `materialize` keyframe (the hook's inline style handles opacity/
  // scale/blur and composes with phase-driven transitions).
  const useLegacyMaterializeAnim = isMaterializing && !manifestation.active;
  const contextualActions = getContextualActions(object.id);
  const objectHints = ambientHints.filter((h) => h.objectId === object.id && !dismissedHints.has(h.hint));

  const handleDissolve = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cascadeTargets = cascadeDissolve(object.id);
    for (const childId of cascadeTargets) {
      dissolveObject(childId);
    }
    dissolveObject(object.id);
  };

  return (
    <div
      ref={cardRef}
      data-workspace-object-id={object.id}
      className={`
        workspace-focus-ring group relative isolate overflow-hidden rounded-2xl border workspace-card-surface
        transition-all duration-300 workspace-spring
        ${size.height ? 'flex flex-col' : ''}
        ${isLineagePulsing ? 'lineage-pulsing' : ''}
        ${manifestation.phase === 'scaffold' ? 'scaffold-crystallizing' : ''}
        ${useLegacyMaterializeAnim
          ? 'animate-[materialize_0.4s_cubic-bezier(0.16,1,0.3,1)_forwards] opacity-0'
          : manifestation.active ? '' : 'opacity-100'
        }
        ${isFocused
          ? 'border-workspace-accent/20 shadow-[0_18px_50px_rgba(99,102,241,0.16)] scale-[1.01]'
          : isHighlighted
            ? 'border-workspace-accent/15 shadow-[0_12px_36px_rgba(99,102,241,0.12)] ring-1 ring-workspace-accent/10'
            : isDimmed
              ? 'border-workspace-border opacity-65 shadow-sm'
              : 'border-workspace-border shadow-[0_10px_28px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:border-workspace-accent/12 hover:shadow-[0_18px_40px_rgba(15,23,42,0.08)]'
        }
      `}
      tabIndex={0}
      role="group"
      aria-label={`${getObjectTypeToken(object.type).label || object.type} ${object.title}`}
      style={{
        ...(size.width ? { width: size.width } : {}),
        ...(size.height ? { height: size.height } : {}),
        // Manifestation style overrides opacity / transform / boxShadow
        // during the scaffold → settled choreography. Merged last so it wins
        // over any class-based values (e.g. the focused scale).
        ...manifestation.style,
      }}
      onClick={() => focusObject(object.id)}
      onFocus={(e) => {
        if (e.target === e.currentTarget) {
          focusObject(object.id);
        }
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          focusObject(object.id);
        }
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 opacity-80"
        style={{ background: `linear-gradient(to bottom, ${getFamilyTokens(object.type).gradient}, transparent)` }} />

      {/* Relationship highlight pulse */}
      {isHighlighted && (
        <div className="absolute inset-0 rounded-xl bg-workspace-accent/[0.02] animate-pulse pointer-events-none" />
      )}

      {/* Sherpa focus flash */}
      {showFocusFlash && (
        <div className="pointer-events-none absolute inset-0 rounded-xl border border-workspace-accent/30 bg-workspace-accent-subtle/40 animate-enter" />
      )}

      {/* Header — family-colored type pill, posture badge, actions on hover */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          {/* Drag handle */}
          <span
            {...dragHandleProps}
            onClick={(e) => e.stopPropagation()}
            className="workspace-focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-transparent cursor-grab text-workspace-text-secondary/35 transition-all duration-200 workspace-spring active:cursor-grabbing group-hover:border-workspace-border/70 group-hover:bg-white/85 group-hover:text-workspace-text-secondary/70 group-focus-within:border-workspace-border/70 group-focus-within:bg-white/85 group-focus-within:text-workspace-text-secondary/70"
            title="Drag to reorder. Press space, then arrow keys to move."
            aria-label={`Reorder ${object.title}`}
          >
            ⠿
          </span>
          {/* Type pill — family-colored. Hidden when label is empty (e.g. generic analysis) */}
          {(() => {
            const typeToken = getObjectTypeToken(object.type);
            const familyToken = getFamilyTokens(object.type);
            return typeToken.label ? (
              <span className={`shrink-0 rounded-full border ${familyToken.pillBorder} ${familyToken.pillBg} ${familyToken.pillText} px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em]`}>
                {typeToken.label}
              </span>
            ) : null;
          })()}
          {/* Title */}
          <h3 className="text-sm font-semibold tracking-[-0.01em] text-workspace-text truncate">{object.title}</h3>
          {/* Metadata badges — posture + relationships, subdued */}
          <div className="flex items-center gap-1.5 shrink-0">
            {(() => {
              const posture = derivePosture(object);
              return posture ? (
                <span className="rounded-full border border-workspace-border/40 bg-white/60 px-1.5 py-0.5 text-[9px] text-workspace-text-secondary/55 tabular-nums">
                  {POSTURE_LABELS[posture]}
                </span>
              ) : null;
            })()}
            {object.relationships.length > 0 && (
              <span className="rounded-full border border-workspace-border/40 bg-white/60 px-1.5 py-0.5 text-[9px] text-workspace-text-secondary/55 tabular-nums" title="Has relationships">
                ◈ {object.relationships.length}
              </span>
            )}
          </div>
        </div>

        {/* Contextual actions — visible on hover */}
        <div className="flex items-center gap-1 opacity-0 translate-y-1 transition-all duration-200 workspace-spring group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0">
          <button
            onClick={(e) => { e.stopPropagation(); dispatch({ type: 'ENTER_IMMERSIVE', payload: { id: object.id } }); }}
            className="workspace-focus-ring rounded-md px-2 py-1 text-[10px] text-workspace-text-secondary transition-colors hover:bg-workspace-accent/10 hover:text-workspace-accent"
            title="Expand to full view"
          >
            ⤢ Expand
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); object.pinned ? unpinObject(object.id) : pinObject(object.id); }}
            className={`workspace-focus-ring rounded-md px-2 py-1 text-[10px] transition-colors ${
              object.pinned
                ? 'bg-workspace-accent/10 text-workspace-accent shadow-[0_10px_20px_rgba(99,102,241,0.12)]'
                : 'text-workspace-text-secondary hover:bg-white/90'
            }`}
            title={object.pinned ? 'Unpin' : 'Pin'}
          >
            {object.pinned ? '◆ Pinned' : '◇ Pin'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); collapseObject(object.id); }}
            className="workspace-focus-ring rounded-md px-2 py-1 text-[10px] text-workspace-text-secondary transition-colors hover:bg-white/90"
            title="Collapse"
          >
            ↓ Collapse
          </button>
          <button
            onClick={handleDissolve}
            className="workspace-focus-ring rounded-md px-2 py-1 text-[10px] text-workspace-text-secondary transition-colors hover:bg-white/90 hover:text-red-500"
            title="Dissolve"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content — scrollable when height is constrained */}
      <div className={`relative z-10 px-5 pb-4 ${size.height ? 'overflow-y-auto flex-1 min-h-0' : ''}`}
        style={size.height ? { maxHeight: `calc(100% - 100px)` } : {}}
      >
        {manifestation.showSkeleton ? (
          <ManifestationSkeleton objectType={object.type} />
        ) : (
          <ErrorBoundary label={object.title}>
            <ObjectContent object={object} />
          </ErrorBoundary>
        )}

        {/* Ambient Sherpa hints — contextual, inline */}
        {!manifestation.showSkeleton && objectHints.map((h) => (
          <AmbientHint
            key={h.hint}
            hint={h.hint}
            acceptLabel={h.acceptLabel}
            onDismiss={() => setDismissedHints((prev) => new Set(prev).add(h.hint))}
            onAccept={
              h.action === 'pin' ? () => { pinObject(object.id); setDismissedHints((prev) => new Set(prev).add(h.hint)); }
              : h.action === 'collapse' ? () => { collapseObject(object.id); }
              : undefined
            }
            delay={2000}
          />
        ))}
      </div>

      {/* Cross-object contextual actions — appear on hover */}
      {contextualActions.length > 0 && (
        <div className="border-t border-workspace-border/20 bg-white/40 px-5 py-2 opacity-0 translate-y-1 transition-all duration-200 workspace-spring group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0">
          <div className="flex items-center gap-2">
            {contextualActions.map((action) => (
              <button
                key={action.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (action.query) processIntent(action.query);
                }}
                className="workspace-focus-ring flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-workspace-text-secondary
                    transition-colors hover:bg-white/85 hover:text-workspace-accent"
              >
                <span>{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Origin trace — subtle, bottom */}
      {object.origin.query && (
        <div className="border-t border-workspace-border/30 bg-white/55 px-5 py-2 text-[10px] text-workspace-text-secondary/60">
          ← "{object.origin.query}"
        </div>
      )}

      {/* Bottom edge — vertical resize only */}
      <div
        className="absolute bottom-0 inset-x-4 h-3 cursor-ns-resize opacity-0 transition-opacity duration-200 z-10 group-hover:opacity-100 group-focus-within:opacity-100"
        title="Drag to resize height"
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          const startY = e.clientY;
          const rect = e.currentTarget.parentElement?.getBoundingClientRect();
          const startH = rect?.height ?? 200;
          const onMove = (ev: MouseEvent) => {
            setSize((prev) => ({
              width: prev.width,
              height: Math.max(100, startH + ev.clientY - startY),
            }));
          };
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
      >
        <div className="mx-auto mt-1 h-1 w-10 rounded-full bg-workspace-text-secondary/20 transition-all duration-200 group-hover:w-12 group-hover:bg-workspace-accent/25" />
      </div>

      {/* Corner — diagonal resize (width + height) */}
      <div
        className="absolute bottom-0 right-0 flex h-6 w-6 cursor-nwse-resize items-end justify-end pr-1.5 pb-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-60 group-focus-within:opacity-60 z-20"
        title="Drag to resize"
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const rect = e.currentTarget.parentElement?.getBoundingClientRect();
          const startW = rect?.width ?? 400;
          const startH = rect?.height ?? 200;
          const onMove = (ev: MouseEvent) => {
            setSize({
              width: Math.max(280, startW + ev.clientX - startX),
              height: Math.max(100, startH + ev.clientY - startY),
            });
          };
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
      >
        <svg width="9" height="9" viewBox="0 0 8 8" className="text-workspace-text-secondary">
          <path d="M7 1L1 7M7 4L4 7M7 7L7 7" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </div>

      {/* Double-click bottom edge to reset height */}
      <div
        className="absolute bottom-0 inset-x-0 h-1 z-[5]"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setSize((prev) => ({ width: prev.width, height: null }));
        }}
      />
    </div>
  );
}
