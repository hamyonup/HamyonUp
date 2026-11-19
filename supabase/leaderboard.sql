-- Public scores contain only a display name and game coin total.
-- Apply this script in Supabase SQL Editor to harden the anonymous leaderboard API.
create table if not exists public.leaderboard (
  id text primary key check (id ~ '^u_[A-Za-z0-9_-]{4,80}$'),
  name text not null check (
    char_length(name) between 2 and 40
    and name !~ '[[:cntrl:]]'
  ),
  coins integer not null default 0 check (coins between 0 and 2000000000),
  avatar text,
  updated_at timestamptz not null default now()
);

-- Also constrain existing installations where CREATE TABLE did not change schema.
alter table public.leaderboard
  drop constraint if exists leaderboard_id_format,
  drop constraint if exists leaderboard_name_safe,
  drop constraint if exists leaderboard_coins_range;
alter table public.leaderboard
  add constraint leaderboard_id_format check (id ~ '^u_[A-Za-z0-9_-]{4,80}$'),
  add constraint leaderboard_name_safe check (char_length(name) between 2 and 40 and name !~ '[[:cntrl:]]'),
  add constraint leaderboard_coins_range check (coins between 0 and 2000000000);

alter table public.leaderboard enable row level security;

drop policy if exists "Anyone can view leaderboard" on public.leaderboard;
drop policy if exists "Players can publish scores" on public.leaderboard;
drop policy if exists "Players can update scores" on public.leaderboard;

create policy "Anyone can view leaderboard"
  on public.leaderboard for select
  to anon, authenticated
  using (true);

create policy "Players can publish scores"
  on public.leaderboard for insert
  to anon, authenticated
  with check (
    id ~ '^u_[A-Za-z0-9_-]{4,80}$'
    and char_length(name) between 2 and 40
    and name !~ '[[:cntrl:]]'
    and coins between 0 and 2000000000
    and avatar is null
  );

create policy "Players can update scores"
  on public.leaderboard for update
  to anon, authenticated
  using (id ~ '^u_[A-Za-z0-9_-]{4,80}$')
  with check (
    id ~ '^u_[A-Za-z0-9_-]{4,80}$'
    and char_length(name) between 2 and 40
    and name !~ '[[:cntrl:]]'
    and coins between 0 and 2000000000
    and avatar is null
  );

grant select, insert, update on public.leaderboard to anon, authenticated;
