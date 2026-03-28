import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface PdfCanvasViewerProps {
  fileBlob: Blob | null;
  fileName: string;
}

export function PdfCanvasViewer({ fileBlob, fileName }: PdfCanvasViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateWidth = () => setContainerWidth(node.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: any = null;
    let loadedDocument: any = null;

    if (!fileBlob) {
      setPdfDocument(null);
      setPageCount(0);
      return;
    }

    setError(null);

    const loadDocument = async () => {
      try {
        const data = new Uint8Array(await fileBlob.arrayBuffer());
        loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
        loadedDocument = await loadingTask.promise;

        if (cancelled) {
          await loadedDocument.destroy();
          return;
        }

        setPdfDocument(loadedDocument);
        setPageCount(loadedDocument.numPages);
        setCurrentPage(1);
      } catch (loadError) {
        if (!cancelled) {
          setPdfDocument(null);
          setError('Could not render this PDF in the workspace.');
        }
      }
    };

    loadDocument();

    return () => {
      cancelled = true;
      loadingTask?.destroy?.();
      loadedDocument?.destroy?.();
    };
  }, [fileBlob]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: any = null;

    const renderPage = async () => {
      if (!pdfDocument || !canvasRef.current || !containerWidth) return;

      try {
        setIsRendering(true);
        const page = await pdfDocument.getPage(currentPage);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(containerWidth - 48, 240);
        const fitScale = availableWidth / baseViewport.width;
        const viewport = page.getViewport({ scale: fitScale * zoom });
        const pixelRatio = window.devicePixelRatio || 1;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        if (!context) {
          throw new Error('Canvas context unavailable');
        }

        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });

        await renderTask.promise;
      } catch (renderError: any) {
        if (!cancelled && renderError?.name !== 'RenderingCancelledException') {
          setError('This PDF page could not be displayed.');
        }
      } finally {
        if (!cancelled) {
          setIsRendering(false);
        }
      }
    };

    renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [containerWidth, currentPage, pdfDocument, zoom]);

  const stepPage = useCallback((delta: number) => {
    setCurrentPage((prev) => Math.min(Math.max(prev + delta, 1), pageCount || 1));
  }, [pageCount]);

  const adjustZoom = useCallback((delta: number) => {
    setZoom((prev) => Math.min(Math.max(Number((prev + delta).toFixed(2)), 0.6), 2.4));
  }, []);

  const handleDownload = useCallback(() => {
    if (!fileBlob) return;

    const objectUrl = URL.createObjectURL(fileBlob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(objectUrl);
  }, [fileBlob, fileName]);

  return (
    <div className="flex h-full flex-col bg-workspace-surface">
      <div className="flex items-center justify-between border-b border-workspace-border/40 bg-workspace-bg/90 px-5 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs text-workspace-text-secondary">
          <button
            type="button"
            onClick={() => stepPage(-1)}
            disabled={currentPage <= 1 || !pdfDocument}
            className="rounded-md border border-workspace-border px-2.5 py-1 text-workspace-text transition-colors hover:bg-workspace-surface disabled:opacity-40"
          >
            Prev
          </button>
          <div className="min-w-20 text-center text-workspace-text">
            {pageCount > 0 ? `Page ${currentPage} / ${pageCount}` : 'Loading…'}
          </div>
          <button
            type="button"
            onClick={() => stepPage(1)}
            disabled={!pdfDocument || currentPage >= pageCount}
            className="rounded-md border border-workspace-border px-2.5 py-1 text-workspace-text transition-colors hover:bg-workspace-surface disabled:opacity-40"
          >
            Next
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-workspace-text-secondary">
          <button
            type="button"
            onClick={() => adjustZoom(-0.15)}
            className="rounded-md border border-workspace-border px-2.5 py-1 text-workspace-text transition-colors hover:bg-workspace-surface"
          >
            −
          </button>
          <div className="min-w-14 text-center text-workspace-text">{Math.round(zoom * 100)}%</div>
          <button
            type="button"
            onClick={() => adjustZoom(0.15)}
            className="rounded-md border border-workspace-border px-2.5 py-1 text-workspace-text transition-colors hover:bg-workspace-surface"
          >
            +
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!fileBlob}
            className="rounded-md border border-workspace-border px-2.5 py-1 text-workspace-text transition-colors hover:bg-workspace-surface disabled:opacity-40"
          >
            Download
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto flex min-h-full max-w-full items-start justify-center">
          {error ? (
            <div className="max-w-sm rounded-2xl border border-workspace-border bg-workspace-bg px-6 py-5 text-center shadow-sm">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.24em] text-workspace-accent">
                PDF Viewer
              </div>
              <p className="text-sm leading-relaxed text-workspace-text-secondary">{error}</p>
            </div>
          ) : (
            <div className="relative">
              <canvas ref={canvasRef} className="rounded-lg border border-workspace-border bg-workspace-bg shadow-sm" />
              {isRendering && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-workspace-bg/70 backdrop-blur-[2px]">
                  <div className="rounded-full border border-workspace-accent/20 bg-workspace-bg px-4 py-2 text-[10px] font-medium uppercase tracking-[0.24em] text-workspace-accent">
                    Rendering page
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}