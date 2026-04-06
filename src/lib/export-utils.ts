/**
 * Export utilities — download workspace content as Excel or Word files.
 */
import { saveAs } from 'file-saver';
import type { WorkspaceObject } from './workspace-types';

// ─── Excel Export ─────────────────────────────────────────────────────────────

/**
 * Export tabular data (columns + rows) as an .xlsx file.
 * Works for dataset objects and any object with structured_data.
 */
export async function exportToExcel(
  title: string,
  columns: string[],
  rows: string[][],
): Promise<void> {
  const XLSX = await import('xlsx');

  // Build worksheet from header + data rows
  const wsData = [columns, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Auto-size columns based on content width
  ws['!cols'] = columns.map((col, i) => {
    const maxLen = Math.max(
      col.length,
      ...rows.slice(0, 100).map(r => (r[i] || '').length)
    );
    return { wch: Math.min(maxLen + 2, 50) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `${sanitizeFilename(title)}.xlsx`);
}

// ─── Word Export ──────────────────────────────────────────────────────────────

/**
 * Export card content as a .docx file.
 * Handles sections-based cards, markdown content, and tabular data.
 */
export async function exportToWord(object: WorkspaceObject): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = await import('docx');

  const children: any[] = [];

  // Title
  children.push(
    new Paragraph({
      text: object.title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    })
  );

  // Subtitle with type + date
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `${object.type.toUpperCase()} — Generated ${new Date().toLocaleDateString()}`,
          color: '888888',
          size: 18,
          italics: true,
        }),
      ],
      spacing: { after: 400 },
    })
  );

  const ctx = object.context || {};

  // Sections-based content (analysis cards, briefs)
  if (ctx.sections?.length > 0) {
    for (const section of ctx.sections) {
      if (section.title) {
        children.push(
          new Paragraph({
            text: section.title,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 100 },
          })
        );
      }
      if (section.content) {
        for (const line of section.content.split('\n')) {
          children.push(
            new Paragraph({
              text: line,
              spacing: { after: 80 },
            })
          );
        }
      }
      // Section items (bullet points)
      if (section.items?.length > 0) {
        for (const item of section.items) {
          const text = typeof item === 'string' ? item : item.label || item.text || JSON.stringify(item);
          children.push(
            new Paragraph({
              text: `  •  ${text}`,
              spacing: { after: 60 },
            })
          );
        }
      }
    }
  }

  // Markdown/text content
  if (ctx.content && typeof ctx.content === 'string') {
    for (const line of ctx.content.split('\n')) {
      if (line.startsWith('# ')) {
        children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_2, spacing: { before: 300 } }));
      } else if (line.startsWith('## ')) {
        children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_3, spacing: { before: 200 } }));
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        children.push(new Paragraph({ text: `  •  ${line.slice(2)}`, spacing: { after: 60 } }));
      } else if (line.trim()) {
        children.push(new Paragraph({ text: line, spacing: { after: 80 } }));
      }
    }
  }

  // Tabular data — include as a Word table
  if (ctx.columns?.length > 0 && ctx.rows?.length > 0) {
    children.push(
      new Paragraph({
        text: 'Data',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 100 },
      })
    );

    const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
    const borders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

    // Limit to 200 rows in Word export to keep file size reasonable
    const exportRows = ctx.rows.slice(0, 200);

    const headerRow = new TableRow({
      children: ctx.columns.map((col: string) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: col, bold: true, size: 18 })] })],
          borders,
        })
      ),
    });

    const dataRows = exportRows.map((row: string[]) =>
      new TableRow({
        children: ctx.columns.map((_: string, i: number) =>
          new TableCell({
            children: [new Paragraph({ text: row[i] || '', spacing: { after: 20 } })],
            borders,
          })
        ),
      })
    );

    children.push(
      new Table({
        rows: [headerRow, ...dataRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
      })
    );
  }

  // Summary/response text
  if (ctx.response && typeof ctx.response === 'string') {
    children.push(
      new Paragraph({
        text: 'Summary',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 100 },
      })
    );
    for (const line of ctx.response.split('\n')) {
      if (line.trim()) {
        children.push(new Paragraph({ text: line, spacing: { after: 80 } }));
      }
    }
  }

  // If no content was added beyond the title, note it
  if (children.length <= 2) {
    children.push(
      new Paragraph({
        text: 'No exportable content found for this card.',
        spacing: { after: 200 },
        children: [new TextRun({ text: 'No exportable content found for this card.', italics: true, color: '999999' })],
      })
    );
  }

  const doc = new Document({
    sections: [{ children }],
  });

  const buf = await Packer.toBlob(doc);
  saveAs(buf, `${sanitizeFilename(object.title)}.docx`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim() || 'export';
}
