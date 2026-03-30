import { useState, useCallback, useRef } from 'react';
import { uploadDocument, UploadProgress } from '@/lib/document-store';
import { toast } from 'sonner';

interface DocumentUploadProps {
  onDocumentIngested: (docId: string) => void;
}

const ACCEPTED_TYPES = [
  '.xlsx', '.xls', '.csv',
  '.pdf',
  '.docx', '.doc',
  '.txt', '.md',
  '.png', '.jpg', '.jpeg', '.webp',
].join(',');

export function DocumentUpload({ onDocumentIngested }: DocumentUploadProps) {
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 20MB limit`);
        continue;
      }

      const doc = await uploadDocument(file, (p) => setProgress(p));

      if (doc) {
        toast.success(`${file.name} ingested`);
        onDocumentIngested(doc.id);
      }
    }
    setProgress(null);
  }, [onDocumentIngested]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const isActive = progress && progress.stage !== 'done' && progress.stage !== 'error';

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !isActive && fileInputRef.current?.click()}
        className={`
          flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 cursor-pointer
          transition-all duration-200
          ${isDragOver
            ? 'border-workspace-accent bg-workspace-accent/5'
            : 'border-workspace-border/60 hover:border-workspace-accent/30 hover:bg-workspace-surface/30'
          }
          ${isActive ? 'pointer-events-none opacity-70' : ''}
        `}
      >
        {isActive ? (
          <>
            <div className="h-4 w-4 shrink-0">
              <svg className="animate-spin h-4 w-4 text-workspace-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-workspace-text truncate">{progress.filename}</p>
              <p className="text-[10px] text-workspace-text-secondary">{progress.message}</p>
            </div>
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-workspace-text-secondary/50 shrink-0">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" x2="12" y1="3" y2="15" />
            </svg>
            <span className="text-[11px] text-workspace-text-secondary/60">
              Drop files or click to upload
            </span>
          </>
        )}
      </div>
    </div>
  );
}
