

# Redeploy All Edge Functions

Redeploy all 6 edge functions: `ai-chat`, `ai-image`, `ingest-document`, `generate-report`, `qbo-data`, `qbo-status`.

Note: The current build errors (`file-saver`, `xlsx`, `docx` missing type declarations in `export-utils.ts`) are client-side issues unrelated to edge functions and won't block deployment.

## Steps

1. Deploy all 6 edge functions in a single batch using the deploy tool.

