-- Bet Tracker — milestone 3: live scores.

-- ESPN short names ("Texas A&M", "Mississippi St") help match picks to teams.
alter table public.games
  add column if not exists away_short text,
  add column if not exists home_short text;

-- One row the poller updates each run; the app reads it to show score age
-- and to say when ESPN is unreachable.
create table public.poller_state (
  id            int primary key default 1 check (id = 1),
  last_run      timestamptz,            -- last time the poller fetched ESPN
  last_success  timestamptz,            -- last run where every fetch worked
  last_error    text,
  last_error_at timestamptz,
  hot           boolean not null default false,  -- a tracked game is live or about to start
  tracked       int not null default 0           -- games the poller is following
);
insert into public.poller_state (id) values (1) on conflict do nothing;

alter table public.poller_state enable row level security;
create policy "poller state readable by signed-in users"
  on public.poller_state for select to authenticated using (true);

-- Realtime: futures cards pick up their linked next game; score age stays fresh.
alter publication supabase_realtime add table public.futures_info, public.poller_state;
