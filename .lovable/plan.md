

# Fix Build Errors & Redeploy Edge Functions

## Two bugs to fix

### 1. Duplicate `RouteMeta` export (provider-router.ts)

`RouteMeta` is exported at line 65 (`export interface RouteMeta`) and again at line 386 (`export type { ..., RouteMeta }`). Remove `RouteMeta` from line 386.

**Line 386** change:
```typescript
export type { Provider, ProviderConfig };
```

### 2. `sections` type error (action-handlers.ts)

Line 596 infers a narrow type for `context` that doesn't include `sections`. Add `as any` cast.

**Line 596** change:
```typescript
let context: any = { ...target.context, view: storedView };
```

### 3. Redeploy edge functions

After fixes, redeploy `ai-chat`, `ai-image`, and `ingest-document`.

