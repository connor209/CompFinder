-- Comp Finder — what people asked for at the show
--
-- "Do you have any gengars" is a WANT, and until now nothing recorded it. The
-- ones where the answer was NO are the valuable half: that is what to buy and
-- what to pack next time, and it evaporates the moment the conversation ends.
-- No amount of sales data reconstructs it — a sale says what we had, never
-- what we were asked for and couldn't find.
--
-- It is its own table rather than a column somewhere because a want is not
-- about a card we own. Most rows will name something that was never in the
-- box, so there is nothing to hang it off: no stack card, no checkout, and
-- frequently no catalogue match either ("any gengars" is not a card).
--
-- `query` is kept VERBATIM alongside the normalised form. The normalised one
-- groups and dedupes; the raw one is what somebody actually said, and reading
-- a season of those is worth more than any count. `had_match` is the whole
-- point of the table — see the comment on it.
--
-- Run once in the Supabase SQL editor. Until it is, the desk degrades: the
-- want button says the table is missing and everything else on the screen
-- carries on working.

create table if not exists public.show_wants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,              -- what they asked for, as typed
  query_norm text not null,         -- normalise() from showfilter.js — groups and dedupes
  event text,                       -- which show, when one is set on the desk
  had_match boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);

comment on column public.show_wants.had_match is
  'True when the show stock search found something at the moment of asking. The FALSE rows are the reason this table exists: a want we could not meet is a buying instruction, and it is the only demand signal a show produces.';

create index if not exists show_wants_user_created_idx
  on public.show_wants (user_id, created_at desc);
create index if not exists show_wants_user_miss_idx
  on public.show_wants (user_id, created_at desc)
  where had_match = false;

alter table public.show_wants enable row level security;
create policy "own wants - select" on public.show_wants for select using (auth.uid() = user_id);
create policy "own wants - insert" on public.show_wants for insert with check (auth.uid() = user_id);
create policy "own wants - update" on public.show_wants for update using (auth.uid() = user_id);
create policy "own wants - delete" on public.show_wants for delete using (auth.uid() = user_id);
