# Supabase Prototype Persistence Plan

## Goal

Move the current local-storage prototype to a shared Supabase-backed data store so that:

- all users see the same roster and team scenarios across sessions
- player edits and scenario edits persist immediately to the backend
- separate browser sessions stay up to date
- local editing still works if backend writes fail

This plan intentionally avoids authentication. All users are treated equally and the app uses the Supabase anon key only.

## Task Tracker

| Task | Status | Requires MCP |
| --- | --- | --- |
| Phase 1: Add Supabase client configuration | Completed | No |
| Phase 2: Create database schema | Completed | Yes |
| Phase 3: Seed baseline data | Completed | Yes |
| Phase 4: Replace roster reads | Completed | No |
| Phase 5: Replace roster writes | Completed | No |
| Phase 6: Replace scenario reads | Completed | No |
| Phase 7: Replace scenario writes | Completed | No |
| Phase 8: Add realtime subscriptions | Completed | No |
| Phase 9: Add failure queue and retry behavior | Completed | No |
| Phase 10: Remove local-storage-first assumptions | Completed | No |

## Scope

This plan covers persistent storage for:

- players
- player attributes
- editable player names
- eligible player positions
- team scenarios
- scenario ordering
- scenario team assignments

This plan does not persist:

- UI-only collapsed or expanded state for scenario cards
- drag hover state
- temporary picker state

Those should remain local browser state.

## Architecture

### Shared backend model

Use four public tables:

1. `public.teams`
2. `public.players`
3. `public.team_scenarios`
4. `public.scenario_assignments`

### Client behavior

The client should follow an optimistic-write model:

1. update React state immediately
2. update local storage immediately
3. send the Supabase write immediately
4. show an error banner if the backend write fails
5. keep local edits intact even when backend sync fails

### Realtime behavior

Use Supabase Realtime Postgres Changes for:

- `players`
- `team_scenarios`
- `scenario_assignments`

This is sufficient for the prototype and simpler than adding Broadcast-based triggers now.

## Data model

### `public.teams`

Canonical team definitions used across every scenario.

Suggested columns:

```sql
create table public.teams (
  id text primary key,
  name text not null,
  color text not null,
  display_order smallint not null unique
);
```

Notes:

- seed this once from the existing `TEAMS` constant
- `id` should match the frontend team id exactly to avoid translation logic

### `public.players`

Stores roster rows and all player attributes in one table.

Suggested columns:

```sql
create table public.players (
  id bigint primary key,
  row_number integer not null unique,
  name text not null default '',
  eligible_positions smallint[] not null default '{}',
  shooting smallint,
  driving smallint,
  assisting smallint,
  man_defense smallint,
  help_defense smallint,
  shot_blocking smallint,
  playmaking smallint,
  rebounding smallint,
  transition smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint players_shooting_check check (shooting between 1 and 5 or shooting is null),
  constraint players_driving_check check (driving between 1 and 5 or driving is null),
  constraint players_assisting_check check (assisting between 1 and 5 or assisting is null),
  constraint players_man_defense_check check (man_defense between 1 and 5 or man_defense is null),
  constraint players_help_defense_check check (help_defense between 1 and 5 or help_defense is null),
  constraint players_shot_blocking_check check (shot_blocking between 1 and 5 or shot_blocking is null),
  constraint players_playmaking_check check (playmaking between 1 and 5 or playmaking is null),
  constraint players_rebounding_check check (rebounding between 1 and 5 or rebounding is null),
  constraint players_transition_check check (transition between 1 and 5 or transition is null)
);
```

Notes:

- keep `id` aligned with the current frontend numeric player id
- keep `row_number` aligned with the visible roster order
- `eligible_positions` should only contain values `1-5`

### `public.team_scenarios`

Stores editable scenario containers and their visual order.

Suggested columns:

```sql
create table public.team_scenarios (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Suggested index:

```sql
create unique index team_scenarios_sort_order_idx
on public.team_scenarios (sort_order);
```

Notes:

- `sort_order` is the source of truth for scenario ordering
- titles are shared across all users

### `public.scenario_assignments`

Stores which player is assigned to which team slot inside each scenario.

Suggested columns:

```sql
create table public.scenario_assignments (
  scenario_id uuid not null references public.team_scenarios(id) on delete cascade,
  team_id text not null references public.teams(id),
  position smallint not null,
  player_id bigint references public.players(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (scenario_id, team_id, position),
  constraint scenario_assignments_position_check check (position between 1 and 5)
);
```

Suggested uniqueness rule:

```sql
create unique index scenario_assignments_unique_player_per_scenario_idx
on public.scenario_assignments (scenario_id, player_id)
where player_id is not null;
```

Notes:

- this prevents one player from appearing twice inside the same scenario
- a player may still appear in different scenarios, which matches current behavior

## Security model

This is prototype-only access control.

### RLS strategy

Enable row level security on all four tables, but allow the `anon` role to read and write all rows.

Reason:

- this keeps the API and Realtime models aligned with Supabase expectations
- it is safer than leaving tables fully unrestricted without RLS
- it is still intentionally open because the prototype has no authentication

Example policy shape:

```sql
alter table public.players enable row level security;

create policy "anon can select players"
on public.players
for select
to anon
using (true);

create policy "anon can insert players"
on public.players
for insert
to anon
with check (true);

create policy "anon can update players"
on public.players
for update
to anon
using (true)
with check (true);
```

Apply equivalent policies to:

- `public.teams`
- `public.team_scenarios`
- `public.scenario_assignments`

## Client sync model

### Load order

On app start:

1. load local storage snapshot first
2. render immediately from local storage if present
3. fetch Supabase data in the background
4. replace local state with backend state once loaded
5. persist the backend snapshot back into local storage

Reason:

- this keeps the app fast
- it preserves offline resilience
- it avoids a blank screen while the network loads

### Write model

Every edit should follow the same pipeline:

1. apply the change to React state
2. persist the same change to local storage
3. send the backend mutation
4. clear any existing sync error if the mutation succeeds
5. set a sync error if the mutation fails

### Failure model

If a backend write fails:

- keep the local edit
- keep the local-storage snapshot
- show a visible non-blocking error message
- retry later

Recommended UI message:

`Changes saved locally. Backend sync failed.`

### Retry triggers

Retry failed writes on:

1. next successful user edit
2. browser window focus
3. network reconnect
4. explicit retry button

Use a small queued mutation list in local state or local storage so failed writes are not dropped.

### Conflict model

Use last-write-wins for the prototype.

Reason:

- multiple anonymous users can edit the same shared data
- conflict-free collaboration is out of scope for this prototype
- last-write-wins is acceptable if realtime keeps the UI fresh

## Realtime plan

Subscribe to Postgres changes on:

- `public.players`
- `public.team_scenarios`
- `public.scenario_assignments`

Behavior:

1. when a remote change arrives, patch the in-memory store
2. update local storage with the new canonical state
3. clear stale optimistic markers if the remote row matches the pending local mutation

Supabase requirements:

1. add these tables to the `supabase_realtime` publication
2. ensure `anon` can read the rows that realtime emits

## Implementation phases

### Phase 1: Add Supabase client configuration

Tasks:

1. install `@supabase/supabase-js`
2. add env vars for project URL and anon key
3. create a shared browser client helper
4. keep local storage as the current read and write source until backend tables exist

Verification:

1. app builds successfully with the new dependency
2. missing env vars produce a controlled error, not a crash
3. Supabase client can initialize in the browser without hydration issues

### Phase 2: Create database schema

Tasks:

1. create the four tables
2. add constraints and indexes
3. enable RLS
4. create anon policies
5. add `updated_at` trigger logic if desired

Verification:

1. `list_tables` returns all four tables
2. constraints reject invalid position and attribute values
3. `get_advisors` does not report missing RLS on public tables
4. anon reads and writes succeed from a browser session

### Phase 3: Seed baseline data

Tasks:

1. seed `teams` from current constants
2. seed `players` from current roster defaults
3. optionally seed one default scenario and empty assignments

Verification:

1. `teams` row count matches the number of frontend teams
2. `players` row count is 20
3. seeded player names, positions, and ratings match the current defaults
4. loading the roster page from Supabase reproduces the same initial roster as local storage

### Phase 4: Replace roster reads

Tasks:

1. fetch `players` from Supabase on startup
2. normalize into the current `Player[]` frontend shape
3. fall back to local storage if the fetch fails

Verification:

1. a clean browser with no local storage loads the roster from Supabase
2. player names, positions, and attributes render exactly as expected
3. if Supabase is unreachable, local storage still renders the roster
4. an error banner appears when backend fetch fails

### Phase 5: Replace roster writes

Tasks:

1. write player name edits to `players`
2. write eligible position changes to `players`
3. write attribute dropdown changes to `players`
4. keep optimistic updates and local-storage persistence

Verification:

1. editing a player name updates the database row immediately
2. changing a position updates `eligible_positions`
3. changing an attribute updates the correct column
4. opening a second browser session shows the updated player data after refresh
5. if the write fails, the UI still reflects the edit locally and shows the sync error

### Phase 6: Replace scenario reads

Tasks:

1. fetch `team_scenarios`
2. fetch `scenario_assignments`
3. compose the current scenario UI state from those tables
4. keep collapsed state local-only

Verification:

1. a clean browser loads scenario titles and assignments from Supabase
2. scenario ordering matches `sort_order`
3. player pool contents are computed correctly from assignments
4. collapsed or expanded local view state does not affect the backend

### Phase 7: Replace scenario writes

Tasks:

1. persist scenario title edits
2. persist scenario creation
3. persist scenario reorder via `sort_order`
4. persist player assignment, swap, clear, and return-to-pool actions

Verification:

1. renaming a scenario updates the correct row
2. adding a scenario inserts a new row with the expected order
3. dragging scenarios changes `sort_order` correctly
4. assigning a player writes the correct `scenario_assignments` row
5. swapping players results in the correct final slot rows
6. dragging a player back to the pool clears the assignment row or sets `player_id` to `null`, depending on final implementation
7. a second browser session sees the final scenario arrangement after refresh

### Phase 8: Add realtime subscriptions

Tasks:

1. subscribe to `players`
2. subscribe to `team_scenarios`
3. subscribe to `scenario_assignments`
4. merge incoming changes into current state safely

Verification:

1. changing a player in browser A updates browser B without reload
2. changing a scenario title in browser A updates browser B without reload
3. assigning a player in browser A updates browser B without reload
4. scenario reorder in browser A updates browser B without reload
5. realtime subscriptions reconnect cleanly after a temporary disconnect

### Phase 9: Add failure queue and retry behavior

Tasks:

1. capture failed backend mutations in a retry queue
2. retry on focus and reconnect
3. keep a visible but non-blocking error banner
4. clear the banner once sync recovers

Verification:

1. disconnect the network and make edits
2. confirm edits persist in UI and local storage
3. confirm the sync error appears
4. restore the network
5. confirm queued edits replay successfully
6. confirm the error clears after replay succeeds

### Phase 10: Remove local-storage-first assumptions

Tasks:

1. make Supabase the canonical source of truth
2. keep local storage only as a cache and offline fallback
3. document a one-time migration path from older local-only users

Verification:

1. deleting local storage does not lose backend data
2. a user on a new device still sees the shared roster and scenarios
3. stale local storage is replaced by fresher backend data after load

## Test matrix

### Functional tests

1. edit player name
2. edit eligible positions
3. edit each attribute type
4. add scenario
5. rename scenario
6. reorder scenarios
7. assign player to empty slot
8. swap player between occupied slots
9. drag player from team to player pool
10. drag player from player pool to team

### Cross-session tests

1. open two browsers or one browser plus incognito
2. verify roster edits propagate
3. verify scenario edits propagate
4. verify scenario order propagates
5. verify assignment swaps propagate

### Failure tests

1. disable network before a write
2. simulate Supabase permission failure
3. simulate malformed payload rejection from a check constraint
4. verify local edits remain usable
5. verify error banner appears
6. verify retries eventually clear the error

### Data integrity tests

1. a player cannot appear twice in one scenario
2. invalid position values are rejected
3. invalid attribute values are rejected
4. deleting a scenario removes its assignments
5. clearing an assignment returns the player to the computed pool

## Recommended rollout order

1. create the schema and seed data
2. wire roster reads and writes
3. wire scenario reads and writes
4. add realtime
5. add retry queue and sync error UI
6. remove remaining local-only assumptions

## Open decisions

These should be decided before implementation starts:

1. Should empty team slots have explicit rows in `scenario_assignments`, or should only occupied rows exist.
   Recommendation: store only occupied rows. It keeps the table smaller and simpler.

2. Should the app seed one default scenario automatically if the database has none.
   Recommendation: yes, seed `Team Scenario 1` so the initial UX is not empty.

3. Should the app expose a manual "retry sync" control in addition to automatic retries.
   Recommendation: yes, add one small retry action in the error banner.

## References

- [lib/types.ts](c:\Users\irvinh\OneDrive - Jacobs Engineering Group Inc\Desktop\Repos\TCB\TCB\lib\types.ts)
- [lib/state.ts](c:\Users\irvinh\OneDrive - Jacobs Engineering Group Inc\Desktop\Repos\TCB\TCB\lib\state.ts)
- [components/roster-page.tsx](c:\Users\irvinh\OneDrive - Jacobs Engineering Group Inc\Desktop\Repos\TCB\TCB\components\roster-page.tsx)
- [components/teams-page.tsx](c:\Users\irvinh\OneDrive - Jacobs Engineering Group Inc\Desktop\Repos\TCB\TCB\components\teams-page.tsx)
