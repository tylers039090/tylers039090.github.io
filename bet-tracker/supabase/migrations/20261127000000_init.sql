-- Bet Tracker — milestone 1 schema.
-- Money in dollars as numeric(10,2), odds as American integers,
-- times as timestamptz, local dates in America/Los_Angeles.
-- games is created before legs because legs.game_id references it.

create extension if not exists pgcrypto;

-- ── games ────────────────────────────────────────────────────────────────
create table public.games (
  id          text primary key,              -- ESPN event id
  league      text not null,                 -- ESPN path, e.g. basketball/mens-college-basketball
  away        text,
  home        text,
  away_abbr   text,
  home_abbr   text,
  away_score  int,
  home_score  int,
  state       text check (state in ('pre','in','post')),
  detail      text,                          -- "2nd 6:09", "Final/OT"
  start_at    timestamptz,
  espn_url    text,
  updated_at  timestamptz default now()
);
create index games_start_at_idx on public.games (start_at);
create index games_state_idx on public.games (state);

-- ── bets ─────────────────────────────────────────────────────────────────
create table public.bets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  ticket      text,                          -- Bovada ticket number, unique per user when present
  date        date not null,                 -- local game day; settle day for futures
  type        text not null check (type in ('single','parlay')),
  sport       text not null check (sport in ('NFL','NBA','NHL','MLB','NCAAF','NCAAB','Soccer','Golf','Other')),
  odds        int not null,
  stake       numeric(10,2) not null check (stake >= 0),
  to_win      numeric(10,2) not null check (to_win >= 0),
  status      text not null default 'open' check (status in ('open','won','lost','push','cashout')),
  payout      numeric(10,2),                 -- cashout only
  settled_by  text check (settled_by in ('auto','manual')),
  is_future   boolean not null default false,
  source      text check (source in ('screenshot','manual')),
  created_at  timestamptz default now(),
  unique (user_id, ticket)                   -- NULL tickets never collide
);
create index bets_user_date_idx on public.bets (user_id, date);
create index bets_user_status_idx on public.bets (user_id, status);

-- ── legs ─────────────────────────────────────────────────────────────────
create table public.legs (
  id          uuid primary key default gen_random_uuid(),
  bet_id      uuid not null references public.bets on delete cascade,
  position    int not null default 0,        -- order within a parlay
  pick        text not null,                 -- "Gonzaga -3.5", "Over 47.5"
  market      text,                          -- Spread | Moneyline | Total | Prop | Futures | ...
  team        text,                          -- parsed picked side (team, or Over/Under), for grading
  line        numeric,                       -- parsed number, for grading
  away        text,
  home        text,
  start_at    timestamptz,
  game_id     text references public.games on delete set null,  -- ESPN event id
  odds        int,
  result      text check (result in ('won','lost','push'))
);
create index legs_bet_id_idx on public.legs (bet_id);
create index legs_game_id_idx on public.legs (game_id);

-- ── futures_info ─────────────────────────────────────────────────────────
create table public.futures_info (
  bet_id        uuid primary key references public.bets on delete cascade,
  team          text,
  market        text,
  odds_now      int,
  odds_src      text,
  record        text,
  record_note   text,
  rank          text,
  rank_note     text,
  next_game_id  text references public.games on delete set null,
  next_label    text,                        -- "@ 49ers (9-1)"
  next_start    timestamptz,                 -- until next_game_id is linked to an ESPN game
  next_where    text,                        -- "Levi's Stadium · SEA +3"
  settle_date   date,
  settle_event  text,
  outlook       text,
  updated_at    timestamptz
);

-- ── Row-level security ───────────────────────────────────────────────────
alter table public.games        enable row level security;
alter table public.bets         enable row level security;
alter table public.legs         enable row level security;
alter table public.futures_info enable row level security;

-- games: readable by any signed-in user; written only by the poller's
-- service role (which bypasses RLS), so there are no write policies.
create policy "games readable by signed-in users"
  on public.games for select to authenticated using (true);

create policy "own bets"
  on public.bets for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "legs of own bets"
  on public.legs for all to authenticated
  using (exists (select 1 from public.bets b where b.id = legs.bet_id and b.user_id = (select auth.uid())))
  with check (exists (select 1 from public.bets b where b.id = legs.bet_id and b.user_id = (select auth.uid())));

create policy "futures info of own bets"
  on public.futures_info for all to authenticated
  using (exists (select 1 from public.bets b where b.id = futures_info.bet_id and b.user_id = (select auth.uid())))
  with check (exists (select 1 from public.bets b where b.id = futures_info.bet_id and b.user_id = (select auth.uid())));

-- ── Realtime (used from milestone 3) ─────────────────────────────────────
alter publication supabase_realtime add table public.games, public.bets, public.legs;
