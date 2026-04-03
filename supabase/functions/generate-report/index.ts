/**
 * generate-report — server-side PDF report builder using pdf-lib.
 *
 * Accepts a list of workspace card snapshots and generates a polished
 * multi-page PDF report. Uploads to Supabase Storage and returns a signed URL.
 *
 * Request body:
 *   title       — report title
 *   cards       — array of { id, type, title, sections, rows, columns }
 *   includeData — whether to include raw data tables (default: false)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts, PDFPage } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Color palette ─────────────────────────────────────────────────────────
const COLORS = {
  accent:     rgb(0.388, 0.4, 0.949),   // #6366f1 indigo
  bg:         rgb(0.972, 0.972, 0.988), // near-white
  text:       rgb(0.09, 0.11, 0.20),    // dark navy
  textLight:  rgb(0.42, 0.45, 0.58),    // medium gray
  border:     rgb(0.86, 0.87, 0.92),
  success:    rgb(0.06, 0.72, 0.51),    // #10b981
  warning:    rgb(0.96, 0.62, 0.18),    // #f59e0b
  danger:     rgb(0.94, 0.27, 0.27),    // #ef4444
  white:      rgb(1, 1, 1),
};

const PAGE_W = 595;  // A4 width in pts
const PAGE_H = 842;  // A4 height in pts
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ─── PDF helpers ────────────────────────────────────────────────────────────

function addPage(doc: PDFDocument): PDFPage {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  // Light background tint
  page.drawRectangle({
    x: 0, y: 0, width: PAGE_W, height: PAGE_H,
    color: COLORS.bg,
  });
  return page;
}

function drawAccentBar(page: PDFPage, y: number, h = 3) {
  page.drawRectangle({ x: MARGIN, y, width: CONTENT_W, height: h, color: COLORS.accent });
}

function drawRule(page: PDFPage, y: number) {
  page.drawRectangle({ x: MARGIN, y, width: CONTENT_W, height: 0.5, color: COLORS.border });
}

function wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    const w = font.widthOfTextAtSize(test, fontSize);
    if (w > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawTextWrapped(
  page: PDFPage,
  text: string,
  font: any,
  fontSize: number,
  x: number,
  y: number,
  maxWidth: number,
  color = COLORS.text,
  lineHeight = 1.4,
): number {
  const lines = wrapText(text, font, fontSize, maxWidth);
  let cy = y;
  for (const line of lines) {
    if (cy < MARGIN + 20) break;
    page.drawText(line, { x, y: cy, size: fontSize, font, color });
    cy -= fontSize * lineHeight;
  }
  return cy;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { title = "Workspace Report", cards = [], includeData = false } = await req.json();

    // Initialise Supabase admin client (to write to storage)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // ─── Build PDF ────────────────────────────────────────────────────────
    const pdfDoc = await PDFDocument.create();
    const fontRegular  = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold     = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontOblique  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    // ── Cover page ────────────────────────────────────────────────────────
    const cover = addPage(pdfDoc);

    // Full-bleed accent band at top
    cover.drawRectangle({ x: 0, y: PAGE_H - 180, width: PAGE_W, height: 180, color: COLORS.accent });

    // "DREAM STATE CANVAS" product wordmark
    cover.drawText("DREAM STATE CANVAS", {
      x: MARGIN, y: PAGE_H - 60, size: 10,
      font: fontBold, color: COLORS.white,
    });

    // Report title
    const titleLines = wrapText(title, fontBold, 28, CONTENT_W - 16);
    let ty = PAGE_H - 96;
    for (const line of titleLines.slice(0, 3)) {
      cover.drawText(line, { x: MARGIN, y: ty, size: 28, font: fontBold, color: COLORS.white });
      ty -= 36;
    }

    // Date
    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    cover.drawText(dateStr, { x: MARGIN, y: PAGE_H - 194, size: 11, font: fontRegular, color: COLORS.textLight });

    // Summary stats
    cover.drawText(`${cards.length} card${cards.length !== 1 ? "s" : ""}  ·  ${cards.filter((c: any) => c.sections?.length > 0).length} with AI analysis`, {
      x: MARGIN, y: PAGE_H - 214, size: 11, font: fontRegular, color: COLORS.textLight,
    });

    drawAccentBar(cover, PAGE_H - 230, 2);

    // Card index
    let idxY = PAGE_H - 270;
    cover.drawText("CONTENTS", { x: MARGIN, y: idxY, size: 9, font: fontBold, color: COLORS.textLight });
    idxY -= 18;
    for (const card of cards.slice(0, 20)) {
      const typeLabel = String(card.type || "card").toUpperCase().replace(/-/g, " ");
      cover.drawText(`${typeLabel}   ${card.title}`, { x: MARGIN, y: idxY, size: 11, font: fontRegular, color: COLORS.text });
      idxY -= 17;
      if (idxY < MARGIN + 20) break;
    }

    // Footer
    cover.drawText("Confidential · Generated by Dream State Canvas", {
      x: MARGIN, y: 32, size: 8, font: fontOblique, color: COLORS.textLight,
    });

    // ── Card pages ────────────────────────────────────────────────────────
    let pageNum = 1;

    for (const card of cards) {
      let page = addPage(pdfDoc);
      pageNum++;
      let y = PAGE_H - MARGIN;

      // Card header band
      page.drawRectangle({ x: MARGIN - 4, y: y - 42, width: CONTENT_W + 8, height: 46, color: COLORS.accent, opacity: 0.08 });
      page.drawRectangle({ x: MARGIN - 4, y: y - 42, width: 3, height: 46, color: COLORS.accent });

      // Type badge + title
      const typeLabel = String(card.type || "card").toUpperCase().replace(/-/g, " ");
      page.drawText(typeLabel, { x: MARGIN + 8, y: y - 14, size: 7, font: fontBold, color: COLORS.accent });
      page.drawText(card.title || "Untitled", { x: MARGIN + 8, y: y - 28, size: 16, font: fontBold, color: COLORS.text });
      y -= 58;

      // Render sections
      if (Array.isArray(card.sections)) {
        for (const section of card.sections) {
          if (!section?.type) continue;

          // Page overflow check
          if (y < MARGIN + 60) {
            // Add page footer then new page
            page.drawText(`Page ${pageNum}`, { x: PAGE_W - MARGIN - 40, y: 24, size: 8, font: fontRegular, color: COLORS.textLight });
            page = addPage(pdfDoc);
            pageNum++;
            y = PAGE_H - MARGIN;
          }

          switch (section.type) {
            case "summary": {
              y -= 4;
              drawRule(page, y);
              y -= 16;
              y = drawTextWrapped(page, String(section.text || ""), fontBold, 12, MARGIN, y, CONTENT_W, COLORS.text, 1.5);
              y -= 8;
              break;
            }
            case "narrative": {
              // Strip markdown syntax for clean PDF text
              const clean = String(section.text || "").replace(/[*_#`[\]]/g, "").replace(/\n+/g, " ").trim();
              y -= 4;
              y = drawTextWrapped(page, clean, fontRegular, 10, MARGIN, y, CONTENT_W, COLORS.textLight, 1.5);
              y -= 8;
              break;
            }
            case "metric": {
              y -= 4;
              const val = String(section.value ?? "");
              const label = String(section.label ?? "");
              page.drawText(label, { x: MARGIN, y, size: 8, font: fontBold, color: COLORS.textLight });
              y -= 14;
              page.drawText(val, { x: MARGIN, y, size: 22, font: fontBold, color: COLORS.accent });
              if (section.trendLabel) {
                page.drawText(String(section.trendLabel), { x: MARGIN + fontBold.widthOfTextAtSize(val, 22) + 6, y: y + 4, size: 10, font: fontRegular, color: COLORS.textLight });
              }
              y -= 20;
              break;
            }
            case "callout": {
              y -= 4;
              const bgColor = section.severity === "danger" ? rgb(0.99, 0.93, 0.93)
                : section.severity === "warning" ? rgb(1, 0.97, 0.90)
                : section.severity === "success" ? rgb(0.92, 0.98, 0.94)
                : rgb(0.93, 0.94, 0.99);
              const textColor = section.severity === "danger" ? COLORS.danger
                : section.severity === "warning" ? COLORS.warning
                : section.severity === "success" ? COLORS.success
                : COLORS.accent;
              const boxH = 28;
              page.drawRectangle({ x: MARGIN, y: y - boxH + 16, width: CONTENT_W, height: boxH, color: bgColor });
              page.drawText(String(section.text || ""), { x: MARGIN + 8, y: y + 2, size: 10, font: fontRegular, color: textColor });
              y -= boxH + 4;
              break;
            }
            case "metrics-row": {
              y -= 4;
              const metrics = Array.isArray(section.metrics) ? section.metrics.slice(0, 5) : [];
              const mw = Math.floor(CONTENT_W / Math.max(metrics.length, 1));
              for (let i = 0; i < metrics.length; i++) {
                const mx = MARGIN + i * mw;
                page.drawText(String(metrics[i].label || ""), { x: mx, y, size: 7, font: fontBold, color: COLORS.textLight });
                page.drawText(String(metrics[i].value ?? ""), { x: mx, y: y - 14, size: 14, font: fontBold, color: COLORS.text });
              }
              y -= 38;
              break;
            }
            case "table": {
              if (!includeData) break;
              y -= 4;
              const cols: string[] = Array.isArray(section.columns) ? section.columns.slice(0, 6) : [];
              const rows: any[][] = Array.isArray(section.rows) ? section.rows.slice(0, 10) : [];
              const colW = Math.floor(CONTENT_W / Math.max(cols.length, 1));
              // Header
              page.drawRectangle({ x: MARGIN, y: y - 14, width: CONTENT_W, height: 18, color: COLORS.accent });
              for (let ci = 0; ci < cols.length; ci++) {
                page.drawText(String(cols[ci]).slice(0, 18), { x: MARGIN + ci * colW + 4, y: y - 10, size: 7, font: fontBold, color: COLORS.white });
              }
              y -= 20;
              // Rows
              for (let ri = 0; ri < rows.length; ri++) {
                if (y < MARGIN + 20) break;
                const rowBg = ri % 2 === 0 ? COLORS.white : rgb(0.96, 0.96, 0.98);
                page.drawRectangle({ x: MARGIN, y: y - 12, width: CONTENT_W, height: 16, color: rowBg });
                for (let ci = 0; ci < cols.length; ci++) {
                  const val = String(rows[ri][ci] ?? "").slice(0, 20);
                  page.drawText(val, { x: MARGIN + ci * colW + 4, y: y - 8, size: 7, font: fontRegular, color: COLORS.text });
                }
                y -= 16;
              }
              y -= 8;
              break;
            }
          }
        }
      }

      // Data table (includeData mode)
      if (includeData && Array.isArray(card.columns) && card.columns.length > 0 && Array.isArray(card.rows) && card.rows.length > 0) {
        if (y < MARGIN + 100) {
          page.drawText(`Page ${pageNum}`, { x: PAGE_W - MARGIN - 40, y: 24, size: 8, font: fontRegular, color: COLORS.textLight });
          page = addPage(pdfDoc);
          pageNum++;
          y = PAGE_H - MARGIN;
        }
        y -= 8;
        page.drawText("DATA SAMPLE", { x: MARGIN, y, size: 7, font: fontBold, color: COLORS.textLight });
        y -= 16;
        const cols = card.columns.slice(0, 6);
        const rows = card.rows.slice(0, 12);
        const colW = Math.floor(CONTENT_W / Math.max(cols.length, 1));
        page.drawRectangle({ x: MARGIN, y: y - 14, width: CONTENT_W, height: 18, color: rgb(0.93, 0.94, 0.99) });
        for (let ci = 0; ci < cols.length; ci++) {
          page.drawText(String(cols[ci]).slice(0, 18), { x: MARGIN + ci * colW + 4, y: y - 10, size: 7, font: fontBold, color: COLORS.accent });
        }
        y -= 20;
        for (const row of rows) {
          if (y < MARGIN + 20) break;
          for (let ci = 0; ci < cols.length; ci++) {
            page.drawText(String(row[ci] ?? "").slice(0, 20), { x: MARGIN + ci * colW + 4, y, size: 7, font: fontRegular, color: COLORS.text });
          }
          y -= 14;
        }
      }

      // Page footer
      page.drawText(`${card.type?.toUpperCase().replace(/-/g, " ")} · ${card.title}`, {
        x: MARGIN, y: 24, size: 8, font: fontOblique, color: COLORS.textLight,
      });
      page.drawText(`Page ${pageNum}`, { x: PAGE_W - MARGIN - 40, y: 24, size: 8, font: fontRegular, color: COLORS.textLight });
    }

    // ── Serialize and upload ──────────────────────────────────────────────
    const pdfBytes = await pdfDoc.save();
    const filename = `reports/${Date.now()}-${title.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40)}.pdf`;

    // Ensure the bucket exists (idempotent)
    await supabaseAdmin.storage.createBucket("workspace-exports", { public: false }).catch(() => {});

    const { error: uploadError } = await supabaseAdmin.storage
      .from("workspace-exports")
      .upload(filename, pdfBytes, { contentType: "application/pdf", upsert: true });

    if (uploadError) {
      return new Response(JSON.stringify({ error: `Storage upload failed: ${uploadError.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from("workspace-exports")
      .createSignedUrl(filename, 3600); // 1 hour expiry

    if (signedError || !signedData?.signedUrl) {
      return new Response(JSON.stringify({ error: `Signed URL failed: ${signedError?.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ url: signedData.signedUrl, filename }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[generate-report] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
