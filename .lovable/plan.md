

# Cloud Document Corpus — Phases 1–5

## Guiding Philosophy: "Let AI Be AI"

AI is not a crude parsing orchestrator. Modern LLMs can **read**, **understand**, and **reason** about documents natively — structure, context, semantics, cross-references, tables, formatting. Our architecture must always err toward giving the AI the fullest possible representation of every document rather than lossy extraction pipelines.

**Core rules:**
- When in doubt, send MORE context to the AI, not less
- Prefer raw/rich document content over stripped-down extractions
- Let the AI determine what's relevant — don't pre-filter aggressively
- Treat token costs as an investment in quality, not an expense to minimize

---

## Phase 1 — Storage Infrastructure

### Database: `documents` table
| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| user_id | uuid (nullable) | Owner |
| filename | text | Original filename |
| mime_type | text | MIME type |
| file_type | text | 'xlsx' / 'csv' / 'pdf' / 'docx' / 'txt' / 'md' / 'image' |
| storage_path | text | Path in storage bucket |
| extracted_text | text | Full extracted text (for search/context) |
| structured_data | jsonb | Parsed structured data (spreadsheet rows, etc.) |
| metadata | jsonb | Sheet names, page count, dimensions, AI summary, keywords |
| data_profile | jsonb | Cached DataProfile (AI-generated rules) |
| fingerprint | text | Content hash for dedup/cache |
| created_at | timestamptz | |

### Storage bucket: `documents`
- Raw file storage for all uploads

---

## Phase 2 — Ingestion Edge Function (`supabase/functions/ingest-document/index.ts`)

### Spreadsheets (XLSX, CSV) — Full Workbook Awareness

**Critical: Never assume only one worksheet matters.**

- Parse ALL worksheets in a workbook, not just the first
- For each sheet: extract name, headers, row count, sample rows
- Send the full sheet inventory to AI with a prompt like:
  > "This workbook contains N sheets: [Sheet1 (450 rows, columns: A-Z), Sheet2 (12 rows, columns: A-F), ...]. Here are the first 5 rows of each. Which sheets contain the primary operational data? Which are reference/lookup tables? Which can be ignored?"
- AI decides which sheets are relevant and how they relate to each other
- Store ALL sheet data in `structured_data` as `{ sheets: { [name]: { headers, rows, aiAssessment } } }`
- The `DataProfile` analysis runs on AI-selected primary sheet(s)

### PDFs — Native AI Reading

**Critical: Let AI read PDFs natively rather than relying solely on text extraction.**

- Use the Lovable AI gateway's multimodal capabilities (Gemini vision models) to process PDFs
- Convert PDF pages to images and send them directly to the AI model for understanding
- This preserves: layout, tables, charts, headers/footers, formatting, spatial relationships
- The AI can understand a table in a PDF far better by SEEING it than by parsing extracted text fragments
- Fall back to text extraction (pdfplumber/pypdf) as supplementary context, not primary
- For large PDFs (>20 pages): send page images in batches, ask AI to summarize each batch, then synthesize
- Store both raw extracted text (for search) AND AI's structural understanding (in metadata)

### Word Documents (DOCX)
- Extract full text preserving paragraph structure
- Send to AI for structural understanding (sections, key points, document type)

### Plain Text & Markdown
- Store as-is — these are already AI-readable
- AI can reason about structure from formatting cues

### Images
- Send directly to vision-capable AI models
- AI describes content, extracts any visible text/data, identifies chart types
- Store AI description in `extracted_text`, original in storage

---

## Phase 3 — Smart Context Selection

### Updated `ai-chat` edge function: `context-select` mode
- When user asks a question, retrieve document metadata (summaries, keywords, sheet names)
- AI picks which documents (and which sheets within workbooks) are relevant
- Full content of selected documents injected into the conversation context
- For spreadsheets: include ALL rows from relevant sheets (not just previews) when feasible
- For PDFs: include AI's structural analysis + key page images for the specific question

---

## Phase 4 — Upload UI & Dynamic Loading

- Drag-and-drop upload zone in workspace
- Progress indicator during ingestion (file upload → AI analysis → ready)
- Replace hardcoded `CANONICAL_DATASET` with DB-fetched data
- Upload triggers: store file → call ingest function → AI analyzes → DataProfile generated → workspace objects created
- Multi-file upload support — user can drop several files at once

---

## Phase 5 — Cross-Document Reasoning

- AI can reference and cross-correlate across all uploaded documents
- "Compare the vendor data from the XLSX with the payment terms in the PDF contract"
- DataProfile and fusion rules stored in DB (not localStorage)
- Workspace state references document IDs for persistence

---

## Files to create/edit
- **Create**: `supabase/functions/ingest-document/index.ts`
- **Edit**: `supabase/functions/ai-chat/index.ts` (add context-select mode)
- **Create**: Upload UI component
- **Migration**: `documents` table + storage bucket
- **Edit**: Workspace context to load from DB instead of seed data
