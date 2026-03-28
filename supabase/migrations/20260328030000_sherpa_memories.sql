-- Sherpa Memory System — persistent learning for the AI intelligence layer

create table public.sherpa_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  type text not null check (type in (
    'correction',
    'preference',
    'entity',
    'pattern',
    'anti-pattern'
  )),
  trigger jsonb not null default '{}',
  content text not null,
  reasoning text,
  confidence float not null default 0.5,
  source text not null check (source in (
    'explicit',
    'inferred',
    'confirmed'
  )) default 'inferred',
  tier text not null check (tier in ('prompt', 'override')) default 'prompt',
  hit_count int not null default 0,
  miss_count int not null default 0,
  last_activated_at timestamptz,
  created_at timestamptz not null default now(),
  tags text[] not null default '{}',

  constraint unique_memory unique (user_id, type, content)
);

-- RLS: user-scoped access
alter table public.sherpa_memories enable row level security;

create policy "Users can read own memories"
  on public.sherpa_memories for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own memories"
  on public.sherpa_memories for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own memories"
  on public.sherpa_memories for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own memories"
  on public.sherpa_memories for delete
  to authenticated
  using (auth.uid() = user_id);

-- Fast retrieval index
create index idx_memories_user_active
  on public.sherpa_memories(user_id, confidence desc)
  where confidence > 0.3;

-- RPC: increment hit count + boost confidence
create or replace function public.increment_memory_hit(memory_id uuid)
returns void as $$
begin
  update public.sherpa_memories
  set hit_count = hit_count + 1,
      last_activated_at = now(),
      confidence = least(1.0, confidence + 0.05)
  where id = memory_id;
end;
$$ language plpgsql security definer;

-- RPC: increment miss count + reduce confidence
create or replace function public.increment_memory_miss(memory_id uuid)
returns void as $$
begin
  update public.sherpa_memories
  set miss_count = miss_count + 1,
      confidence = greatest(0.1, confidence - 0.1)
  where id = memory_id;
end;
$$ language plpgsql security definer;

-- RPC: batch confidence decay for stale memories
create or replace function public.decay_stale_memories(
  target_user_id uuid,
  stale_threshold_days int default 30,
  decay_factor float default 0.9
)
returns void as $$
begin
  update public.sherpa_memories
  set confidence = confidence * decay_factor
  where user_id = target_user_id
    and source != 'confirmed'
    and last_activated_at < now() - (stale_threshold_days || ' days')::interval
    and confidence > 0.2;

  -- Delete memories that have decayed below usefulness
  delete from public.sherpa_memories
  where user_id = target_user_id
    and confidence < 0.2
    and source != 'confirmed';

  -- Delete memories where misses exceed hits (self-correcting)
  delete from public.sherpa_memories
  where user_id = target_user_id
    and miss_count > hit_count
    and hit_count > 2;
end;
$$ language plpgsql security definer;
