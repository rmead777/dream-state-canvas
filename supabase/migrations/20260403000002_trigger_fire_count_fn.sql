-- Atomic fire_count increment for automation_triggers
-- Avoids read-modify-write race when multiple tabs fire the same trigger concurrently.

CREATE OR REPLACE FUNCTION public.increment_trigger_fire_count(trigger_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.automation_triggers
  SET
    fire_count    = fire_count + 1,
    last_fired_at = now()
  WHERE id = trigger_id;
$$;
