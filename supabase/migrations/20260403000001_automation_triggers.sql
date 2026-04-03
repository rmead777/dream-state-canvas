-- Automation Triggers table
-- Stores user-defined workflow triggers that Sherpa evaluates on a schedule.
-- Each trigger monitors a dataset condition and fires an action when met.

CREATE TABLE IF NOT EXISTS public.automation_triggers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label       text NOT NULL,
  -- condition: { column, operator, value, aggregation? }
  -- e.g. { "column": "balance", "operator": "gt", "value": 50000, "aggregation": "sum" }
  condition   jsonb NOT NULL,
  -- action: { type: 'notify' | 'create_card', params: { ... } }
  -- notify   → shows a Sherpa observation
  -- create_card → materializes a card on the canvas
  action      jsonb NOT NULL DEFAULT '{"type":"notify","params":{}}'::jsonb,
  enabled     boolean NOT NULL DEFAULT true,
  fire_count  integer NOT NULL DEFAULT 0,
  last_fired_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS: users can only see/modify their own triggers
ALTER TABLE public.automation_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own triggers" ON public.automation_triggers
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own triggers" ON public.automation_triggers
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own triggers" ON public.automation_triggers
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users delete own triggers" ON public.automation_triggers
  FOR DELETE USING (auth.uid() = user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_automation_trigger_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER automation_triggers_updated_at
  BEFORE UPDATE ON public.automation_triggers
  FOR EACH ROW EXECUTE FUNCTION public.set_automation_trigger_updated_at();
