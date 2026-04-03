-- Backfill: set trigger = {"always": true} for all existing confirmed memories
-- and all memories saved by rememberFact (source = 'inferred') that have no trigger keywords set.
-- Going forward, rememberFact always saves with always:true, but existing rows need patching.

UPDATE sherpa_memories
SET trigger = '{"always": true}'::jsonb
WHERE
  -- Confirmed memories should always inject
  source = 'confirmed'
  OR
  -- Preferences/patterns/entities/anti-patterns with always=false should be always-on
  (
    type IN ('preference', 'pattern', 'entity', 'anti-pattern')
    AND (trigger->>'always')::boolean IS NOT TRUE
  );
