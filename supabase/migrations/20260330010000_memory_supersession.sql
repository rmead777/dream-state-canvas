-- Memory Supersession — track which memories replaced which

-- Add supersession tracking columns
ALTER TABLE public.sherpa_memories
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.sherpa_memories(id),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Index for efficient active-only queries
CREATE INDEX IF NOT EXISTS idx_memories_active
  ON public.sherpa_memories(user_id, is_active)
  WHERE is_active = true;

-- When a new memory supersedes an old one, mark the old as inactive
CREATE OR REPLACE FUNCTION public.supersede_memory(
  old_memory_id uuid,
  new_memory_id uuid
)
RETURNS void AS $$
BEGIN
  UPDATE public.sherpa_memories
  SET superseded_by = new_memory_id,
      is_active = false
  WHERE id = old_memory_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
