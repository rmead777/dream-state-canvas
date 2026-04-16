/**
 * PdfPreviewMode — interactive page break editor for PDF export.
 *
 * Shows the immersive content with draggable page boundary lines.
 * User positions dividers to control where pages break, then clicks
 * Export to capture each region via html2canvas + jsPDF.
 *
 * Features:
 * - Snap-to-gap: dividers magnetically snap to DOM element boundaries
 *   so cuts land in natural whitespace, not through headings or content.
 * - Page-region shading: alternating faint tints show which content
 *   belongs to which page.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { toast } from 'sonner';

// A4 landscape: usable area after 10mm margin on all sides
const PDF_MARGIN = 10; // mm
const USABLE_W = 297 - PDF_MARGIN * 2; // 277mm
const USABLE_H = 210 - PDF_MARGIN * 2; // 190mm
const USABLE_RATIO = USABLE_H / USABLE_W; // ≈ 0.686

const SNAP_THRESHOLD = 30; // px — max distance to snap to a gap

interface PdfPreviewModeProps {
  contentRef: React.RefObject<HTMLDivElement>;
  title: string;
  onClose: () => void;
}

/** Walk contentRef's children (2 levels deep) and collect their
 *  top/bottom pixel offsets relative to contentRef. These become
 *  snap targets — natural gaps between rendered blocks. */
function collectSnapPositions(contentEl: HTMLElement): number[] {
  const base = contentEl.getBoundingClientRect().top;
  const positions = new Set<number>();
  const walk = (el: Element, depth: number) => {
    if (depth > 2) return;
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i] as HTMLElement;
      const r = child.getBoundingClientRect();
      positions.add(Math.round(r.top - base));
      positions.add(Math.round(r.bottom - base));
      walk(child, depth + 1);
    }
  };
  walk(contentEl, 0);
  return [...positions].sort((a, b) => a - b);
}

/** Find the nearest snap position within threshold, or return y unchanged. */
function snapToGap(y: number, snapPositions: number[]): number {
  let best = y;
  let bestDist = SNAP_THRESHOLD;
  for (const pos of snapPositions) {
    const dist = Math.abs(y - pos);
    if (dist < bestDist) {
      bestDist = dist;
      best = pos;
    }
    if (pos > y + SNAP_THRESHOLD) break; // sorted, no point continuing
  }
  return best;
}

export function PdfPreviewMode({ contentRef, title, onClose }: PdfPreviewModeProps) {
  const [dividers, setDividers] = useState<number[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [contentOffsetTop, setContentOffsetTop] = useState(0);

  // Cached snap positions — refreshed on drag start to avoid
  // expensive DOM traversal on every mousemove.
  const snapPositionsRef = useRef<number[]>([]);

  // Calculate initial page breaks based on content dimensions
  useEffect(() => {
    if (!contentRef.current) return;

    const rect = contentRef.current.getBoundingClientRect();
    setContentWidth(rect.width);
    setContentHeight(contentRef.current.scrollHeight);
    setContentOffsetTop(contentRef.current.offsetTop);

    // Use the actual PDF usable aspect ratio (after margins) so
    // auto-dividers match what will actually fit on each page.
    const pageHeight = rect.width * USABLE_RATIO;
    const totalHeight = contentRef.current.scrollHeight;

    // Collect snap positions and place auto-dividers at the nearest
    // gap to each pageHeight increment.
    const snaps = collectSnapPositions(contentRef.current);

    const autoDividers: number[] = [];
    let target = pageHeight;
    while (target < totalHeight - 50) {
      autoDividers.push(snapToGap(target, snaps));
      target += pageHeight;
    }

    setDividers(autoDividers);
  }, [contentRef]);

  const pageCount = dividers.length + 1;

  // Drag handling
  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    // Cache snap positions at drag start
    if (contentRef.current) {
      snapPositionsRef.current = collectSnapPositions(contentRef.current);
    }
    setDragging(index);
  }, [contentRef]);

  useEffect(() => {
    if (dragging === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!contentRef.current) return;
      const rect = contentRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;

      // Clamp between previous and next dividers (or content bounds)
      const minY = dragging > 0 ? dividers[dragging - 1] + 60 : 60;
      const maxY = dragging < dividers.length - 1 ? dividers[dragging + 1] - 60 : contentHeight - 60;
      const clampedY = Math.max(minY, Math.min(maxY, y));

      // Snap to nearest DOM element boundary
      const snappedY = snapToGap(clampedY, snapPositionsRef.current);
      // Re-clamp after snap (snap could push past neighbors)
      const finalY = Math.max(minY, Math.min(maxY, snappedY));

      setDividers(prev => {
        const next = [...prev];
        next[dragging] = finalY;
        return next;
      });
    };

    const handleMouseUp = () => setDragging(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, dividers, contentHeight, contentRef]);

  // Add a new divider at click position (snapped)
  const handleAddDivider = useCallback((e: React.MouseEvent) => {
    if (!contentRef.current || dragging !== null) return;
    const rect = contentRef.current.getBoundingClientRect();
    const rawY = e.clientY - rect.top;

    const snaps = collectSnapPositions(contentRef.current);
    const y = snapToGap(rawY, snaps);

    const tooClose = dividers.some(d => Math.abs(d - y) < 60);
    if (tooClose) return;

    const newDividers = [...dividers, y].sort((a, b) => a - b);
    setDividers(newDividers);
  }, [dividers, dragging, contentRef]);

  // Remove a divider
  const handleRemoveDivider = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDividers(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Export to PDF
  const handleExport = useCallback(async () => {
    if (!contentRef.current) return;
    setExporting(true);

    try {
      const content = contentRef.current;
      const allBreaks = [0, ...dividers, contentHeight];

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      for (let i = 0; i < allBreaks.length - 1; i++) {
        const startY = allBreaks[i];
        const endY = allBreaks[i + 1];
        const regionHeight = endY - startY;

        if (regionHeight < 10) continue;

        const canvas = await html2canvas(content, {
          y: startY,
          height: regionHeight,
          width: content.scrollWidth,
          windowHeight: regionHeight,
          useCORS: true,
          scale: 2,
          backgroundColor: '#ffffff',
          logging: false,
          onclone: (doc) => {
            const style = doc.createElement('style');
            style.textContent = `
              *, *::before, *::after {
                animation-duration: 0s !important;
                animation-delay: 0s !important;
                transition: none !important;
              }
            `;
            doc.head.appendChild(style);
            doc.querySelectorAll('[class*="counter-enter"]').forEach((el) => {
              (el as HTMLElement).style.opacity = '1';
            });
          },
        });

        const imgRatio = canvas.height / canvas.width;
        let imgWidth = USABLE_W;
        let imgHeight = USABLE_W * imgRatio;

        if (imgHeight > USABLE_H) {
          imgHeight = USABLE_H;
          imgWidth = USABLE_H / imgRatio;
        }

        if (i > 0) pdf.addPage();
        pdf.addImage(
          canvas.toDataURL('image/png'),
          'PNG',
          PDF_MARGIN + (USABLE_W - imgWidth) / 2,
          PDF_MARGIN,
          imgWidth,
          imgHeight,
        );
      }

      const filename = `${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`;
      pdf.save(filename);
      toast.success(`PDF saved: ${filename}`);
    } catch (err) {
      console.error('PDF export failed:', err);
      toast.error(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setExporting(false);
    }
  }, [contentRef, dividers, contentHeight, title]);

  // Precompute page regions for shading
  const allBreaks = [0, ...dividers, contentHeight];
  const PAGE_TINTS = [
    'rgba(147, 51, 234, 0.035)',  // purple
    'rgba(59, 130, 246, 0.035)',  // blue
  ];

  return (
    <div ref={overlayRef}>
      {/* Toolbar */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-2 bg-white/95 backdrop-blur-sm border-b border-purple-200/50 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium text-purple-600 uppercase tracking-wider">PDF Preview</span>
          <span className="text-[10px] text-workspace-text-secondary tabular-nums">
            {pageCount} page{pageCount !== 1 ? 's' : ''}
          </span>
          <span className="text-[9px] text-workspace-text-secondary/50">
            Click to add breaks · Drag to adjust · Right-click to remove
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[11px] text-workspace-text-secondary border border-workspace-border/30 hover:border-workspace-border/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="rounded-lg px-4 py-1.5 text-[11px] font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : `Export ${pageCount}-Page PDF`}
          </button>
        </div>
      </div>

      {/* Page break overlay — aligned with contentRef */}
      <div
        className="absolute left-0 right-0 z-40 pointer-events-none"
        style={{ top: contentOffsetTop, height: contentHeight }}
      >
        {/* Clickable layer for adding dividers */}
        <div
          className="absolute inset-0 pointer-events-auto cursor-crosshair"
          onClick={handleAddDivider}
          style={{ height: contentHeight }}
        />

        {/* Page region shading — alternating tints so user can see
            which content belongs to which page */}
        {allBreaks.slice(0, -1).map((startY, i) => {
          const endY = allBreaks[i + 1];
          return (
            <div
              key={`shade-${i}`}
              className="absolute left-0 right-0 pointer-events-none"
              style={{
                top: startY,
                height: endY - startY,
                backgroundColor: PAGE_TINTS[i % PAGE_TINTS.length],
              }}
            />
          );
        })}

        {/* Page number labels */}
        {allBreaks.slice(0, -1).map((startY, i) => {
          const endY = allBreaks[i + 1];
          const midY = startY + (endY - startY) / 2;
          return (
            <div
              key={`page-${i}`}
              className="absolute right-4 pointer-events-none"
              style={{ top: midY - 12 }}
            >
              <span className="rounded-full bg-purple-100 px-2.5 py-1 text-[10px] font-medium text-purple-600 shadow-sm">
                Page {i + 1}
              </span>
            </div>
          );
        })}

        {/* Draggable divider lines */}
        {dividers.map((y, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 z-50 pointer-events-auto group"
            style={{ top: y - 12, height: 24 }}
          >
            {/* Hit area + visual line */}
            <div
              className={`absolute left-0 right-0 top-1/2 flex items-center cursor-ns-resize ${
                dragging === i ? 'opacity-100' : 'opacity-70 hover:opacity-100'
              }`}
              onMouseDown={(e) => handleMouseDown(i, e)}
              onContextMenu={(e) => { e.preventDefault(); handleRemoveDivider(i, e); }}
            >
              <div className="flex-1 border-t-2 border-dashed border-purple-400" />
              <div className="shrink-0 mx-2 flex items-center gap-1 rounded-full bg-purple-500 px-2 py-0.5 shadow-md cursor-ns-resize">
                <span className="text-[8px] text-white/90">⋮⋮</span>
                <span className="text-[9px] text-white font-medium">
                  ✂
                </span>
              </div>
              <div className="flex-1 border-t-2 border-dashed border-purple-400" />
            </div>

            {/* Remove button — visible on hover */}
            <button
              className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-red-400 text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm pointer-events-auto"
              onClick={(e) => handleRemoveDivider(i, e)}
              title="Remove page break"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
