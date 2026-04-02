# Scenario-Embedded Teams Refactor Plan

## Status

| # | Task | Status | Notes | Verification tests |
| --- | --- | --- | --- | --- |
| 1 | Finalize scenario-owned team model and reset policy | Planned | Each scenario owns its own team count, names, colors, and assignments. Existing Teams page scenario/team data can be discarded on rollout. | Review type and schema design against confirmed decisions; verify the plan supports different team counts across two scenarios in the same run; verify removed teams send assigned players back to the pool in the intended state model. |
| 2 | Add scenario-owned team persistence in Supabase | Planned | Introduce `public.scenario_teams` keyed by `(scenario_id, team_id)` and update `scenario_assignments` to reference scenario-local teams instead of run-global teams. | Apply migration on a dev branch; verify `scenario_teams` rows can store two scenarios with different team counts; verify `scenario_assignments` rejects a `(scenario_id, team_id)` pair that does not exist in `scenario_teams`. |
| 3 | Update app types and local persisted state shape | Planned | Move team definitions into `Scenario`; remove top-level `teams` from the Teams page persisted state. | Typecheck updated `Scenario` and `PersistedScenarioState` shapes; verify local storage no longer depends on a root `teams` array; verify parsing old local state safely falls back to a fresh default scenario. |
| 4 | Replace global team sync with per-scenario team sync | Planned | Remove `teams` table reads/writes from the Teams page flow and sync scenario team definitions together with scenario metadata/assignments. | Verify scenario create/update/delete also persists `scenario_teams`; verify cross-browser realtime updates reflect scenario team edits without affecting unrelated scenarios; verify the page still loads correctly when `scenario_teams` is empty. |
| 5 | Remove the top-level `Setup Teams` section | Planned | Team configuration moves entirely into each scenario card. | Verify the top section is removed; verify the page can still create the first scenario with default teams; verify no orphaned validation banners or actions remain at page level. |
| 6 | Add per-scenario team configuration UI | Planned | Each scenario card gets its own controls for team count, names, colors, add/remove team, and validation. | Manual test adding/removing teams inside one scenario leaves other scenarios unchanged; verify duplicate-name validation is scoped to the current scenario; verify color changes only update the current scenario. |
| 7 | Rework assignment state to follow scenario-owned teams | Planned | All assignment helpers should use `scenario.teams` rather than a shared `teams` array. Removing a team should move those players back to that scenario’s pool. | Verify deleting a team returns its assigned players to the pool and preserves other teams’ assignments; verify drag/drop, picker assignment, reset, and undo still work in scenarios with different team counts; verify position legality still holds after a team-count change. |
| 8 | Update randomize and stat-balance flows for per-scenario teams | Planned | Scenario generators and stat scoring must operate on each scenario’s own team set. | Verify Random, Overall Stats, and Category Stats work for scenarios with different team counts; verify candidate ranking only uses the current scenario’s teams; verify generated summaries remain accurate after changing a scenario’s team count. |
| 9 | Update matchup-balance and matchup-comparison flows for per-scenario teams | Planned | Matchup reports, goal scoring, swap suggestions, and charts must read `scenario.teams` per card. | Verify two scenarios with different team counts render independent matchup analytics; verify swap suggestions only reference teams/players from the current scenario; verify offense/defense/head-to-head charts stay stable for 2-team, 3-team, and 4-team scenarios. |
| 10 | Add reset/discard handling for old backend and local Teams data | Planned | Since current data is not precious, prefer a clean cutover over migration. | Verify the app ignores or clears stale local state from the pre-refactor shape; verify old `teams` table data no longer affects Teams page rendering; verify new scenarios seed cleanly after rollout for each run. |
| 11 | Realtime and regression verification | Planned | Revalidate the full Teams workflow under the new scenario-owned team model. | Manual test simultaneous edits in two browser sessions; verify scenario reorder, duplicate, delete, undo, matchup loading, and analytics tab state still work; verify no cross-scenario contamination of team definitions or assignments. |

## Goal

Refactor the Teams page so team definitions are owned by each scenario instead of by the page/run as a whole.

After this refactor:

- each scenario can have a different number of teams
- each scenario can use different team names
- each scenario can use different team colors
- removing a team returns that team’s assigned players to the pool for that scenario
- scenario team definitions sync through Supabase
- the top-level `Setup Teams` section is removed entirely

## Difficulty Assessment

This is a medium-to-large refactor.

The page is conceptually close to supporting it because most analytics and interaction flows are already scenario-scoped, but the current implementation still relies on one shared `teams` array being threaded through almost everything:

- scenario creation currently derives assignments from a page-level `teams` array
- persistence currently stores teams separately from scenarios
- realtime sync currently treats teams as a run-level resource
- assignment reconciliation currently rewrites all scenarios when global teams change
- stats balance and matchup balance functions both accept `teams` as a top-level input

So this is not a small UI move. It is a data-shape and persistence refactor first, with UI changes following from that.

## Confirmed Product Decisions

- Team definitions should be embedded in each scenario.
- Existing Teams page scenario/team data is not precious and does not need migration.
- If a team is removed from a scenario, its assigned players should move back to that scenario’s pool.
- Scenario team changes must sync through Supabase.
- The top-level `Setup Teams` section should be removed entirely.
- New scenarios should start with `2` teams.
- Scenario team count should remain bounded to `1..4`.
- Users should remove a specific team from that team’s own inline header using a remove button similar to today’s setup UI.
- Team name and color editing should happen inline in the team header above that team’s player cells.
- Team color editing should use a visible swatch/button like today.
- Old local Teams page state should be ignored; backend cleanup can happen later as a final cleanup step.
- Realtime conflict handling can be last-write-wins.
- Team name/color writes should remain debounced so updates are only posted after the user stops typing or dragging the color control.
- Scenario duplication should copy embedded teams exactly.
- Scenarios with fewer than `2` teams should show an empty state for matchup analytics.
- When a team is removed, remaining teams should compact and reflow immediately.

## Current Pain Points

Today the Teams page assumes one shared team definition set for the whole page:

- `Scenario` stores only assignments in [lib/types.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/lib/types.ts#L53)
- top-level persisted state stores `teams` separately from `scenarios` in [lib/types.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/lib/types.ts#L60)
- new scenarios are created from a shared `teams` array in [components/teams-page.tsx](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/components/teams-page.tsx#L250)
- scenario assignments are reconciled whenever shared teams change in [components/teams-page.tsx](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/components/teams-page.tsx#L454)
- Supabase persistence treats teams as run-level records in [lib/supabase/tcb.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/lib/supabase/tcb.ts#L44)

Those assumptions need to be removed, not worked around.

## Target Data Model

### App types

Update app types so a scenario owns its team definitions:

```ts
type Scenario = {
  id: string;
  title: string;
  teams: Team[];
  assignments: Assignments;
  collapsed: boolean;
};

type PersistedScenarioState = {
  nextScenarioNumber: number;
  scenarios: Scenario[];
};
```

`Assignments` can remain keyed by `teamId`, but the authoritative team list becomes `scenario.teams`.

### Supabase schema

Add a new `public.scenario_teams` table.

Suggested columns:

- `scenario_id uuid not null references public.team_scenarios(id) on delete cascade`
- `team_id text not null`
- `name text not null`
- `color text not null`
- `display_order smallint not null`
- `updated_at timestamptz not null default now()`

Suggested constraints:

- primary key: `(scenario_id, team_id)`
- unique: `(scenario_id, display_order)`
- check: trimmed `name` is not blank

Update `public.scenario_assignments` so `scenario_id + team_id` references `public.scenario_teams(scenario_id, team_id)`.

### Tables after refactor

- `team_scenarios`: scenario metadata only
- `scenario_teams`: team definitions embedded per scenario
- `scenario_assignments`: assignments scoped to scenario-local teams
- `teams`: no longer used by the Teams page and can be left unused temporarily or dropped in a later cleanup

## Rollout Strategy

Prefer a clean cutover.

Because the existing Teams page data is not precious:

- do not backfill old team definitions into scenarios
- do not attempt to migrate old local Teams state
- seed new scenarios with default team definitions at first load
- ignore or clear stale pre-refactor local storage entries
- stop reading the run-level `teams` table from the Teams page

This keeps the refactor simpler and reduces hidden compatibility branches.

## Proposed Task Breakdown

### Task 1: Finalize scenario-owned team model and reset policy

Define the exact shape and lifecycle rules before coding:

- `Scenario` owns `teams`
- each scenario has independent team validation
- scenario deletion deletes its team definitions and assignments
- team removal returns players to the pool for that scenario
- old local/backend team data is discarded

Tests:

1. Review the target `Scenario` shape and verify it can represent two scenarios with different team counts.
2. Walk through removal of a team with assigned players and verify the resulting state returns players to the pool.
3. Confirm no feature still requires shared run-level team definitions.

### Task 2: Add scenario-owned team persistence in Supabase

Create `scenario_teams` and add the composite foreign key from `scenario_assignments`.

Recommended migration sequence:

1. create `scenario_teams`
2. seed nothing
3. add composite foreign key from `scenario_assignments`
4. update application code
5. optionally drop or deprecate `teams` table in a later cleanup migration

Tests:

1. Insert two scenarios with different team counts and verify both persist successfully.
2. Insert assignments for one scenario and verify another scenario can reuse the same `team_id` text without conflict.
3. Verify deleting a scenario cascades to `scenario_teams` and assignments.

### Task 3: Update app types and local persisted state shape

Refactor:

- `Scenario`
- `PersistedScenarioState`
- scenario serializers/parsers
- equality helpers
- pristine checks

Tests:

1. Typecheck the updated types and helpers.
2. Verify old local state shape falls back to a clean new state instead of throwing.
3. Verify a new scenario persists with embedded `teams` and restores correctly on reload.

### Task 4: Replace global team sync with per-scenario team sync

Remove the global teams sync pipeline and replace it with:

- scenario metadata sync
- scenario team sync
- scenario assignment sync

Likely implications:

- remove `latestTeamsRef`, team sync debouncing, and `teams` realtime subscription
- add `scenario_teams` read/write/realtime paths
- load scenarios as a combined state from `team_scenarios + scenario_teams + scenario_assignments`

Tests:

1. Edit team names/colors in one browser and verify another browser updates the same scenario.
2. Verify editing teams in scenario A does not alter scenario B.
3. Verify page load with no scenario rows creates a default scenario with default teams.

### Task 5: Remove the top-level `Setup Teams` section

Delete the page-level team configuration area and move all team setup into scenario cards.

Tests:

1. Verify the top `Setup Teams` section no longer renders.
2. Verify there is still an obvious way to add/remove/configure teams inside a scenario.
3. Verify no global team validation message remains on the page.

### Task 6: Add per-scenario team configuration UI

Each scenario card should own:

- add team
- remove team
- edit team name
- edit team color
- maybe reorder teams later if needed

Recommended UX:

- place team controls inline in each team header above that team’s player cells
- scope validation and disabled states to the current scenario
- use the same visual style as current team config controls where practical
- keep name and color persistence debounced so typing and color dragging do not spam the API

Tests:

1. Change the team count in one scenario and verify other scenarios do not change.
2. Enter duplicate team names inside one scenario and verify validation appears only there.
3. Verify min/max team limits of `1..4` apply per scenario.
4. Verify name and color edits only persist after input settles.

### Task 7: Rework assignment state to follow scenario-owned teams

Refactor all assignment helpers to use `scenario.teams`.

Key areas:

- `createEmptyAssignments`
- assignment reconciliation
- drag/drop target resolution
- slot rendering
- reset/undo
- team removal behavior

When removing a team:

1. capture assigned player ids from that team
2. remove that team from `scenario.teams`
3. remove its assignment branch
4. leave those players unassigned so they naturally reappear in the pool
5. compact display order immediately for the remaining teams

Tests:

1. Remove a team with assigned players and verify those players reappear in the scenario pool.
2. Verify drag/drop still works after adding and removing teams.
3. Verify undo restores the prior team set and assignments together.
4. Verify remaining teams renumber/reflow immediately after removal.

### Task 8: Update randomize and stat-balance flows for per-scenario teams

All generation and scoring helpers must accept `scenario.teams`.

This includes:

- random fill
- overall stat balance
- category stat balance
- scenario summaries
- candidate ranking helpers

Tests:

1. Verify `Random` works for 2-team, 3-team, and 4-team scenarios living on the same page.
2. Verify `Overall Stats` and `Category Stats` only score against the current scenario’s team set.
3. Verify generated summary copy still reflects the active scenario result.

### Task 9: Update matchup-balance and matchup-comparison flows for per-scenario teams

Refactor all matchup logic to consume `scenario.teams`.

This includes:

- matchup report generation
- goal scores
- swap suggestions
- overall team-advantage bars
- offense and defense chord diagrams
- head-to-head views

Tests:

1. Verify two scenarios with different team counts both render valid matchup comparison cards.
2. Verify swap suggestions use only teams defined inside the current scenario.
3. Verify head-to-head selection still works correctly after changing team count.
4. Verify a `1`-team scenario shows the intended empty state instead of broken matchup charts.

### Task 10: Add reset/discard handling for old backend and local Teams data

Implement a clean reset path for the new model.

Suggested approach:

- bump or change the Teams page local storage schema
- ignore old persisted state
- stop loading `teams` rows for Teams page setup
- optionally clear old `team_scenarios` / `scenario_assignments` data in non-production or one-time maintenance if desired
- defer backend cleanup of old shared-team artifacts to a final cleanup step rather than blocking the main refactor

Tests:

1. Load the page with old local storage present and verify it does not crash.
2. Verify a clean scenario is created instead of trying to reconcile old shared teams.
3. Verify old `teams` table rows do not affect rendered scenarios.

### Task 11: Realtime and regression verification

Run the full Teams page through its normal workflows after the refactor.

Tests:

1. Open two browser sessions and verify scenario team edits sync live.
2. Verify scenario reorder, delete, collapse, undo, and analytics tabs still work.
3. Verify no cross-scenario bleed for names, colors, team count, assignments, stats, or matchup analytics.

## Recommended Implementation Order

1. Ship the schema migration for `scenario_teams`.
2. Refactor shared types and serializers.
3. Update load/save/realtime plumbing.
4. Move team config UI into scenarios.
5. Refactor assignment helpers.
6. Refactor stat-balance and matchup-balance consumers.
7. Remove the top-level setup section.
8. Run regression verification.

This order reduces the amount of time the UI and persistence layers disagree about state shape.

## Primary Risks

- assignment bugs when team count changes inside one scenario
- stale local state from the old shared-team model
- realtime conflicts if scenario metadata, scenario teams, and assignments are not refreshed atomically enough
- hidden assumptions that `teams.length` is page-global
- UI overflow or layout issues when scenarios on the same page have very different team counts

## Suggested Non-Goals For This Refactor

To keep scope controlled, do not bundle in:

- scenario duplication UX changes
- cross-scenario copy/paste of team definitions
- scenario-specific player pools
- dropping the old `teams` table immediately if leaving it unused is simpler
- new run-management behavior

## Exit Criteria

This refactor is done when:

- the page has no top-level shared team setup UI
- every scenario can define its own teams independently
- scenario team edits sync through Supabase
- removing a team returns its players to the pool
- stats balance and matchup balance both work with scenario-local team sets
- two scenarios on the same page can differ in team count, names, and colors without interference
