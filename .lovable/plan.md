

# Rich Text Rendering for Document Reader AI Responses

## What's changing

The "Ask about this document" AI response currently renders as plain `<p>` text with `whitespace-pre-wrap`. The AI returns markdown (bold, lists, dollar amounts, etc.) but it's displayed raw. We'll add a `MarkdownRenderer` component adapted from the uploaded reference and use it in the DocumentReader.

## Technical approach

### 1. Create `src/components/objects/MarkdownRenderer.tsx`
- Adapted from the uploaded `MarkdownRenderer.tsx` reference
- Self-contained markdown parser (no external dependency needed) that handles:
  - **Bold** and *italic* formatting
  - Bullet and numbered lists
  - Dollar amounts highlighted in emerald/green
  - Percentages highlighted in blue
  - Tables with alternating rows
  - Headings (h2, h3)
  - Code blocks
  - Callout badges (EFFORT: LOW, URGENCY: NOW, etc.)
  - Streaming cursor animation via `isStreaming` prop
- Styled to match the workspace design language (uses workspace CSS variables where possible)

### 2. Update `src/components/objects/DocumentReader.tsx`
- Import `MarkdownRenderer`
- Replace the plain `<p>` tag on line 142 with:
  ```tsx
  <MarkdownRenderer content={aiResponse} isStreaming={isStreaming} />
  ```
- This gives rich rendering during streaming and after completion

### Files
- **Create**: `src/components/objects/MarkdownRenderer.tsx`
- **Edit**: `src/components/objects/DocumentReader.tsx` (swap plain text for MarkdownRenderer)

