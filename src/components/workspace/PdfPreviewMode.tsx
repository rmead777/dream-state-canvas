/**
 * PdfPreviewMode — interactive page break editor for PDF export.
 *
 * Shows the immersive content with draggable page boundary lines.
 * User positions dividers to control where pages break, then clicks
 * Export to capture each region via html2canvas + jsPDF.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { toast } from 'sonner';

// A4 landscape aspect ratio (297mm x 210mm)
const A4_LANDSCAPE_RATIO = 210 / 297; // height / width ≈ 0.707

interface PdfPreviewModeProps {
  contentRef: React.RefObject<HTMLDivElement>;
  title: string;
  onClose: () => void;
}

export function PdfPreviewMode({ contentRef, title, onClose }: PdfPreviewModeProps) {
  const [dividers, setDividers] = useState<number[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);

  // Calculate initial page breaks based on content dimensions
  useEffect(() => {
    if (!contentRef.current) return;

    const rect = contentRef.current.getBoundingClientRect();
    setContentWidth(rect.width);
    setContentHeight(contentRef.current.scrollHeight);

    const pageHeight = rect.width * A4_LANDSCAPE_RATIO;
    const totalHeight = contentRef.current.scrollHeight;

    // Generate automatic page breaks
    const autoDividers: number[] = [];
    let y = pageHeight;
    while (y < totalHeight - 50) { // Don't add a divider too close to the end
      autoDividers.push(y);
      y += pageHeight;
    }

    setDividers(autoDividers);
  }, [contentRef]);

  const pageHeight = contentWidth * A4_LANDSCAPE_RATIO;
  const pageCount = dividers.length + 1;

  // Drag handling
  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(index);
  }, []);

  useEffect(() => {
    if (dragging === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!contentRef.current) return;
      const rect = contentRef.current.getBoundingClientRect();
      const scrollTop = contentRef.current.parentElement?.scrollTop || 0;
      const y = e.clientY - rect.top + scrollTop;

      // Clamp between previous and next dividers (or content bounds)
      const minY = dragging > 0 ? dividers[dragging - 1] + 60 : 60;
      const maxY = dragging < dividers.length - 1 ? dividers[dragging + 1] - 60 : contentHeight - 60;
      const clampedY = Math.max(minY, Math.min(maxY, y));

      setDividers(prev => {
        const next = [...prev];
        next[dragging] = clampedY;
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

  // Add a new divider at click position
  const handleAddDivider = useCallback((e: React.MouseEvent) => {
    if (!contentRef.current || dragging !== null) return;
    const rect = contentRef.current.getBoundingClientRect();
    const scrollTop = contentRef.current.parentElement?.scrollTop || 0;
    const y = e.clientY - rect.top + scrollTop;

    // Don't add too close to existing dividers
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

      // A4 landscape in mm
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pdfWidth = 297;
      const pdfHeight = 210;
      const margin = 10;
      const usableWidth = pdfWidth - margin * 2;
      const usableHeight = pdfHeight - margin * 2;

      for (let i = 0; i < allBreaks.length - 1; i++) {
        const startY = allBreaks[i];
        const endY = allBreaks[i + 1];
        const regionHeight = endY - startY;

        if (regionHeight < 10) continue; // Skip tiny regions

        // Capture the region
        const canvas = await html2canvas(content, {
          y: startY,
          height: regionHeight,
          width: content.scrollWidth,
          windowHeight: regionHeight,
          useCORS: true,
          scale: 2, // High quality
          backgroundColor: '#ffffff',
          logging: false,
        });

        // Scale to fit A4 landscape
        const imgRatio = canvas.height / canvas.width;
        let imgWidth = usableWidth;
        let imgHeight = usableWidth * imgRatio;

        // If too tall, scale down
        if (imgHeight > usableHeight) {
          imgHeight = usableHeight;
          imgWidth = usableHeight / imgRatio;
        }

        if (i > 0) pdf.addPage();
        pdf.addImage(
          canvas.toDataURL('image/png'),
          'PNG',
          margin + (usableWidth - imgWidth) / 2, // Center horizontally
          margin,
          imgWidth,
          imgHeight,
        );
      }

      // Save
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
            Click between pages to add breaks · Drag lines to adjust · Right-click to remove
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

      {/* Page break overlay — positioned over the content */}
      <div
        className="absolute inset-0 z-40 pointer-events-none"
        style={{ height: contentHeight }}
      >
        {/* Clickable layer for adding dividers */}
        <div
          className="absolute inset-0 pointer-events-auto cursor-crosshair"
          onClick={handleAddDivider}
          style={{ height: contentHeight }}
        />

        {/* Page number labels */}
        {(() => {
          const allBreaks = [0, ...dividers, contentHeight];
          return allBreaks.slice(0, -1).map((startY, i) => {
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
          });
        })()}

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
              {/* Dashed line */}
              <div className="flex-1 border-t-2 border-dashed border-purple-400" />

              {/* Drag handle */}
              <div className="shrink-0 mx-2 flex items-center gap-1 rounded-full bg-purple-500 px-2 py-0.5 shadow-md cursor-ns-resize">
                <span className="text-[8px] text-white/90">⋮⋮</span>
                <span className="text-[9px] text-white font-medium">
                  ✂
                </span>
              </div>

              {/* Dashed line continued */}
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
