/**
 * EmailDraft — renders an AI-composed email with copy/send actions.
 *
 * Context fields:
 *   to       — recipient address(es)
 *   subject  — email subject line
 *   body     — email body (plain text, may contain newlines)
 *   contextCardId? — card that triggered the draft (for reference)
 */
import { useState } from 'react';
import { WorkspaceObject } from '@/lib/workspace-types';
import { useToast } from '@/hooks/use-toast';

interface Props {
  object: WorkspaceObject;
}

export function EmailDraft({ object }: Props) {
  const { to = '', subject = '', body = '' } = object.context ?? {};
  const { toast } = useToast();
  const [copied, setCopied] = useState<'none' | 'body' | 'all'>('none');

  const handleCopyBody = async () => {
    await navigator.clipboard.writeText(body);
    setCopied('body');
    toast({ title: 'Body copied', description: 'Email body copied to clipboard.' });
    setTimeout(() => setCopied('none'), 2000);
  };

  const handleCopyAll = async () => {
    const full = `To: ${to}\nSubject: ${subject}\n\n${body}`;
    await navigator.clipboard.writeText(full);
    setCopied('all');
    toast({ title: 'Email copied', description: 'Full email copied to clipboard.' });
    setTimeout(() => setCopied('none'), 2000);
  };

  // mailto: deep link — opens default email client with pre-populated fields
  const mailtoHref = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const bodyLines = body.split('\n');

  return (
    <div className="space-y-3">
      {/* Header fields */}
      <div className="rounded-xl border border-workspace-border/60 bg-white/60 divide-y divide-workspace-border/40 overflow-hidden">
        {/* To */}
        <div className="flex items-baseline gap-3 px-4 py-2.5">
          <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-workspace-text-secondary/60">To</span>
          <span className="text-sm text-workspace-text font-medium break-all">{to || <span className="text-workspace-text-secondary/50 italic">—</span>}</span>
        </div>
        {/* Subject */}
        <div className="flex items-baseline gap-3 px-4 py-2.5">
          <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-workspace-text-secondary/60">Subject</span>
          <span className="text-sm text-workspace-text font-semibold">{subject || <span className="text-workspace-text-secondary/50 italic">—</span>}</span>
        </div>
      </div>

      {/* Body */}
      <div className="rounded-xl border border-workspace-border/60 bg-white/60 px-4 py-3 min-h-[6rem]">
        <div className="text-sm text-workspace-text leading-relaxed whitespace-pre-wrap font-[system-ui,sans-serif]">
          {bodyLines.map((line, i) => (
            <span key={i}>
              {line}
              {i < bodyLines.length - 1 && <br />}
            </span>
          ))}
          {!body && <span className="text-workspace-text-secondary/40 italic">No content</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-0.5">
        {/* Send — opens mailto: */}
        <a
          href={mailtoHref}
          target="_blank"
          rel="noopener noreferrer"
          className="workspace-focus-ring inline-flex items-center gap-1.5 rounded-lg bg-workspace-accent px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-workspace-accent/90 hover:shadow-md active:scale-95"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          Open in Email
        </a>

        {/* Copy body */}
        <button
          onClick={handleCopyBody}
          className={`workspace-focus-ring inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all active:scale-95 ${
            copied === 'body'
              ? 'border-green-300 bg-green-50 text-green-700'
              : 'border-workspace-border bg-white/80 text-workspace-text-secondary hover:border-workspace-accent/30 hover:bg-white hover:text-workspace-accent'
          }`}
        >
          {copied === 'body' ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy Body
            </>
          )}
        </button>

        {/* Copy all */}
        <button
          onClick={handleCopyAll}
          className={`workspace-focus-ring inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all active:scale-95 ${
            copied === 'all'
              ? 'border-green-300 bg-green-50 text-green-700'
              : 'border-workspace-border bg-white/80 text-workspace-text-secondary hover:border-workspace-accent/30 hover:bg-white hover:text-workspace-accent'
          }`}
        >
          {copied === 'all' ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied
            </>
          ) : 'Copy All'}
        </button>
      </div>

      {/* Context trace */}
      {object.context?.contextCardId && (
        <div className="text-[10px] text-workspace-text-secondary/50">
          Based on card: {object.context.contextCardId}
        </div>
      )}
    </div>
  );
}
