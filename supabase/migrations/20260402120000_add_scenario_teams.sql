begin;

create table if not exists public.scenario_teams (
  scenario_id uuid not null references public.team_scenarios(id) on delete cascade,
  team_id text not null,
  name text not null check (btrim(name) <> ''::text),
  color text not null,
  display_order smallint not null check (display_order >= 1 and display_order <= 4),
  updated_at timestamptz not null default now(),
  primary key (scenario_id, team_id),
  unique (scenario_id, display_order)
);

create index if not exists scenario_teams_scenario_id_display_order_idx
  on public.scenario_teams (scenario_id, display_order);

alter table public.scenario_teams enable row level security;

drop policy if exists "anon can manage scenario teams" on public.scenario_teams;
create policy "anon can manage scenario teams"
  on public.scenario_teams
  for all
  to anon
  using (true)
  with check (true);

drop trigger if exists set_updated_at_scenario_teams on public.scenario_teams;
create trigger set_updated_at_scenario_teams
before update on public.scenario_teams
for each row execute function set_updated_at();

alter table public.scenario_assignments
  drop constraint if exists scenario_assignments_team_id_fkey;

alter table public.scenario_assignments
  drop constraint if exists scenario_assignments_scenario_team_fkey;

alter table public.scenario_assignments
  add constraint scenario_assignments_scenario_team_fkey
  foreign key (scenario_id, team_id)
  references public.scenario_teams (scenario_id, team_id)
  on delete cascade
  not valid;

commit;
