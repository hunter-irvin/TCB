# Run Scoping Refactor Plan

## Goal

Introduce the concept of a `Run` so that roster data, team setup, team scenarios, player chemistry, and matchup visualization data are scoped to a selected run instead of being global.

For the first phase, the app will support exactly two runs:

- `TCB Run`
- `SD Run`

`TCB Run` should preserve the existing app data and behavior. `SD Run` should start blank.

## Confirmed Product Decisions

- `SD Run` starts blank. Existing data should remain outside it.
- Active run selection should persist in the same browser.
- The header should show a circular run switcher with run initials.
- The switcher should appear on:
  - Roster
  - Teams
  - Matchup Visualizer
- The switcher should not appear on Matchup Tinder.
- Switching runs should always send the user to that run's Roster page.
- Row numbering should restart per run.
- Matchup Tinder responses can remain indirectly scoped through the players involved.
- Player chemistry is run-specific.
- There is no run management UI for now.
- When a blank run first opens on Teams, it should start with one default team card.

## URL Structure

Move the app to run-scoped routes using the run slug as the first path segment.

Examples:

- `/TCB/roster`
- `/TCB/teams`
- `/TCB/matchup-visualizer`
- `/TCB/matchup-tinder`
- `/SD/roster`
- `/SD/teams`
- `/SD/matchup-visualizer`
- `/SD/matchup-tinder`

### Routing Notes

- The current top-level routes should redirect to the default run:
  - `/` -> `/TCB/roster`
  - `/roster` -> `/TCB/roster`
  - `/teams` -> `/TCB/teams`
  - `/matchup-visualizer` -> `/TCB/matchup-visualizer`
  - `/matchup-tinder` -> `/TCB/matchup-tinder`
- Matchup Tinder should now also be run-specific by URL, even though the top-level header switcher is hidden there.
- We should normalize on slug values in lowercase internally if needed, but preserve the desired visible URL format if we explicitly want `TCB` and `SD` in the path. If that turns out awkward in Next.js routing or validation, the safer fallback is lowercase slugs like `/tcb/roster` and `/sd/roster`.

## Data Model Changes

### New `runs` table

Create a dedicated `public.runs` table.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `slug text not null unique`
- `name text not null unique`
- `display_order integer not null unique`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Seed rows:

- `TCB Run` with slug `TCB`
- `SD Run` with slug `SD`

### Add `run_id` to run-owned tables

Add `run_id uuid not null references public.runs(id)` to:

- `public.players`
- `public.player_chemistry`
- `public.teams`
- `public.team_scenarios`

### `scenario_assignments`

`scenario_assignments` can remain indirectly scoped through `team_scenarios` and `teams`.

Reasoning:

- every assignment already belongs to a scenario
- every scenario will belong to a run
- we do not need duplicate run ownership on the assignment row unless query performance or integrity concerns show up later

### `matchup_tinder_responses`

Do not add `run_id` in the first pass.

Reasoning:

- the user explicitly approved inferring scope through the players involved
- the response rows already reference player ids
- if each player belongs to exactly one run, response data can stay run-safe by always querying players within the selected run

## Constraints and Indexing

Existing globally unique constraints need to become run-scoped where appropriate.

### `players`

Adjust uniqueness so row numbers can restart within each run.

Target behavior:

- player `row_number` is unique within a run, not globally

Likely changes:

- drop the current unique constraint or unique index on `row_number`
- add a composite unique index on `(run_id, row_number)`

### `teams`

Display order should be unique within a run, not globally.

Likely changes:

- add a composite unique index on `(run_id, display_order)`

### `team_scenarios`

Sort order should be unique within a run, not globally.

Likely changes:

- replace the current global unique index on `sort_order`
- add a composite unique index on `(run_id, sort_order)`

### `player_chemistry`

Player chemistry rows should stay valid only within a run.

We should preserve uniqueness while preventing duplicates such as the same source-target-kind pair within a run.

Likely approach:

- keep the existing logical uniqueness on `(source_player_id, target_player_id, kind)`
- add `run_id`
- backfill `run_id` from the source player
- consider a constraint or trigger to ensure source and target players belong to the same run

## Migration Strategy

### Seed and backfill

1. Create the `runs` table.
2. Insert `TCB Run` and `SD Run`.
3. Add nullable `run_id` columns first to the owned tables.
4. Backfill existing rows:
   - all current `players` -> `TCB Run`
   - all current `player_chemistry` -> `TCB Run`
   - all current `teams` -> `TCB Run`
   - all current `team_scenarios` -> `TCB Run`
5. Make `run_id` non-null after backfill.
6. Replace global unique constraints/indexes with run-scoped ones.
7. Seed blank default data for `SD Run` only where needed.

### Blank `SD Run` defaults

`SD Run` should start blank for roster and chemistry, but Teams should still feel usable on first open.

Recommended default:

- no players
- no chemistry
- one default team card created lazily on first Teams load if the run has no teams yet
- one pristine team scenario created lazily on first Teams load if the run has no scenarios yet

This keeps the database minimal while preserving the current first-use experience.

## Application Architecture Changes

## 1. Shared run model

Add a shared run type, likely in `lib/types.ts`.

Suggested shape:

```ts
export type Run = {
  id: string;
  slug: string;
  name: string;
  displayOrder: number;
};
```

Also add helpers for:

- allowed run slugs
- lookup by slug
- initials for the switcher badge
- default run slug

## 2. Run-aware routing

Introduce route groups like:

- `app/[run]/roster/page.tsx`
- `app/[run]/teams/page.tsx`
- `app/[run]/matchup-visualizer/page.tsx`
- `app/[run]/matchup-tinder/page.tsx`

Add route validation so invalid run slugs 404 or redirect safely.

The old non-run pages can become redirects or be removed once compatibility redirects are in place.

## 3. Active run context

Add a client-side run provider that:

- reads the active run from the route slug
- persists the last selected run in browser storage
- keeps header switcher state in sync
- exposes run metadata to child pages

Recommended behavior:

- route slug is the source of truth when present
- local persistence is used for landing/redirect behavior and convenience
- changing runs navigates to `/${nextRun.slug}/roster`

## 4. Header switcher

Update `AppShell` so the right side of the header can render:

- top-level nav
- optional header actions
- run switcher circle with initials

Behavior:

- visible on Roster, Teams, Matchup Visualizer
- hidden on Matchup Tinder
- clicking opens a small menu with:
  - `TCB Run`
  - `SD Run`
- selecting a run routes to that run's Roster page

## 5. Tournament builder provider

`components/tournament-builder.tsx` currently loads and syncs a global roster. This provider needs to become run-aware.

Changes needed:

- accept the active run id or slug as input
- fetch players filtered by `run_id`
- fetch chemistry filtered by `run_id`
- write inserts and updates with the active `run_id`
- delete only within the active run snapshot
- scope realtime subscriptions to the active run if possible
- recompute row numbers within the selected run only

Important note:

- `createPlayerDraft`
- `getNextPlayerRowNumber`
- sync comparison logic

all need to continue working with a run-filtered player list, which should be straightforward once the provider fetches only the current run.

## 6. Teams page

`components/teams-page.tsx` currently loads players from the builder and team data globally from Supabase. It needs to load and sync teams and scenarios within the active run.

Changes needed:

- fetch `teams` filtered by `run_id`
- fetch `team_scenarios` filtered by `run_id`
- when creating or updating teams, include `run_id`
- when creating scenarios, include `run_id`
- keep assignment queries joined through run-owned scenarios
- if the selected run has no teams, initialize one default team locally and persist it
- if the selected run has no scenarios, initialize one pristine scenario locally and persist it

## 7. Matchup Tinder

Move Matchup Tinder to run-scoped URLs and run-scoped API behavior.

Changes needed:

- route path becomes `/${run}/matchup-tinder`
- page fetches from run-aware API endpoints
- `app/api/matchup-tinder/next/route.ts` must read the requested run
- `app/api/matchup-tinder/respond/route.ts` must validate both players belong to the same requested run
- player candidate selection must query only players in the active run
- "not enough players" messaging should remain unchanged, but now apply per run

Because the user asked for shareable run-specific links, the URL itself must fully determine which run Tinder is using.

## 8. Matchup Visualizer

`app/api/matchup-visualizer/chord/route.ts` must become run-aware.

Changes needed:

- fetch only players in the selected run
- fetch only matchup responses involving players from the selected run
- continue filtering for `mode = "play"`

Safer query pattern:

1. load the run's player ids
2. load responses where both `offense_player_id` and `defense_player_id` belong to that set
3. build the graph from that filtered dataset

This keeps the current indirect scoping model valid.

## API Changes

We should choose one consistent pattern for run-aware APIs.

Recommended pattern:

- `GET /api/[run]/matchup-tinder/next`
- `POST /api/[run]/matchup-tinder/respond`
- `GET /api/[run]/matchup-visualizer/chord`

Benefits:

- the run scope is obvious and shareable
- client pages can build relative requests from the current route
- backend handlers do not need to trust only client request bodies for run scope

Fallback option:

- keep current API paths and pass `run` as a query/body parameter

The route-segment version is cleaner and better matches the product requirement.

## Realtime Considerations

Realtime subscriptions currently listen to broad tables such as `players` and `team_scenarios`.

For run scoping:

- if Supabase channel filters support the necessary `run_id` filtering cleanly, subscribe per run
- otherwise keep broad subscriptions but have refresh handlers fetch only the active run's data

This is acceptable for only two runs, but filtering by `run_id` is preferable if supported.

## Redirect and Persistence Behavior

### Browser persistence

Persist the user's most recently selected run in browser storage.

Use cases:

- if a user visits `/`, redirect to the stored run's roster if present
- otherwise default to `/TCB/roster`

### Switching behavior

When the user changes runs from the header:

- save the new run slug in browser storage
- navigate to `/${run.slug}/roster`

### Matchup Tinder links

Because Matchup Tinder is run-specific and linkable:

- direct visits to `/${run}/matchup-tinder` should respect the URL, not the stored run
- the page should not render the run switcher

## Implementation Phases

## Phase 1: Schema and seed migration

- create `runs`
- seed `TCB Run` and `SD Run`
- add `run_id` columns
- backfill current data to `TCB Run`
- update unique indexes to be run-scoped
- verify triggers and RLS policies include the new tables/columns as needed

## Phase 2: Route scaffolding and run context

- add `[run]` page routes
- add run slug parsing and validation
- add shared run provider
- add redirects from legacy routes

## Phase 3: Header and run switcher

- update `AppShell`
- add initials badge
- add switcher menu
- show it on the three desktop pages only

## Phase 4: Roster and chemistry scoping

- make `TournamentBuilderProvider` run-aware
- update roster page to read current run context
- ensure row numbers restart per run

## Phase 5: Teams and scenarios scoping

- scope team and scenario queries by run
- lazy-create default team/scenario for blank runs
- confirm team edits stay isolated across runs

## Phase 6: Matchup Tinder scoping

- move page and API routes under run scope
- filter matchups by run roster
- ensure responses remain valid through player-based inference

## Phase 7: Matchup Visualizer scoping

- move API under run scope
- filter players and responses by run
- verify blank runs show sensible empty states

## Verification Checklist

- `/` lands on the stored run's roster or `TCB` if none exists
- switching from `TCB Run` to `SD Run` always navigates to `/SD/roster`
- switching back returns to `/TCB/roster`
- roster edits in `SD Run` do not affect `TCB Run`
- row numbers in `SD Run` start at `1`
- player chemistry selections do not leak across runs
- Teams in `SD Run` start with one default team and one pristine scenario
- team edits and assignments in `SD Run` do not affect `TCB Run`
- Matchup Tinder at `/SD/matchup-tinder` only serves `SD Run` players
- Matchup Visualizer at `/SD/matchup-visualizer` only shows `SD Run` data
- direct links to either run keep the correct run context after refresh
- legacy routes redirect cleanly to `TCB` equivalents

## Key Risks

### 1. Global assumptions in current code

Several parts of the app assume one global roster or one global set of scenarios. We should expect hidden assumptions in:

- route building
- realtime refresh logic
- empty state initialization
- unique ordering helpers

### 2. Migration/index drift

The app already has live schema history. We should inspect existing indexes and triggers before replacing global uniqueness rules so we do not leave conflicting indexes behind.

### 3. Matchup response inference

Inferring run scope through players is acceptable now, but it means visualizer and Tinder queries must be disciplined about filtering by the run's player id set. If this gets messy, adding `run_id` to `matchup_tinder_responses` would be the next cleanup step.

## Recommended Starting Order

1. Implement the schema migration and seed `runs`.
2. Add run-scoped routes and redirect old paths.
3. Add the shared run context and header switcher.
4. Make roster and chemistry run-aware.
5. Make teams and scenarios run-aware.
6. Move Matchup Tinder and Matchup Visualizer to run-scoped routes and APIs.

## Deliverable

This plan is the blueprint for the refactor. Once approved, implementation should begin with the schema migration, because nearly every downstream change depends on `run_id` ownership and the new route model.
