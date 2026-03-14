# Player Chemistry Implementation Plan

## Goal

Add a new `Chemistry` category to the roster and teams flows so users can define player-to-player chemistry relationships and see how those relationships affect team scenarios.

This feature should:

- add two chemistry subcategories on the roster:
  - `Bonus`
  - `Tax`
- show the count of mapped players in each chemistry column
- allow editing chemistry links from the roster
- persist chemistry data to Supabase
- add a chemistry chart to the Teams page that can go positive or negative

## Confirmed Product Decisions

- Chemistry mappings are directional.
  - If Player A has a bonus with Player B, Player B does not automatically get one back.
- A player cannot map the same target player into both `bonus` and `tax`.
- Chemistry should persist to Supabase.
- Team chemistry scoring is:
  - `+1` for each bonus-linked teammate on the same team
  - `-1` for each tax-linked teammate on the same team
- The Teams chemistry chart range is `-20` to `+20`.
- Each player can have up to 5 bonus links and up to 5 tax links.
- Default chemistry is empty for both lists.

## Recommended Data Model

### Persistence Model

Use a new relational table instead of storing JSON arrays directly on `players`.

Recommended table:

- `player_chemistry`
  - `id bigint generated always as identity primary key`
  - `source_player_id bigint not null references public.players(id) on delete cascade`
  - `target_player_id bigint not null references public.players(id) on delete cascade`
  - `kind text not null check (kind in ('bonus', 'tax'))`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`

Recommended constraints:

- unique `(source_player_id, target_player_id)`
  - prevents duplicate mappings
  - also prevents the same target from being both bonus and tax for one source player
- check `source_player_id <> target_player_id`
  - prevents self-links

Recommended enforcement:

- application-level validation for the max of 5 per kind
- optional database trigger later if we want hard DB enforcement

### App Model

Expose chemistry on each player as two arrays so the UI remains simple:

```ts
type PlayerChemistry = {
  bonus: number[];
  tax: number[];
};

type Player = {
  id: number;
  rowNumber: number;
  name: string;
  positions: Position[];
  attributes: PlayerAttributes;
  chemistry: PlayerChemistry;
};
```

This gives us the UX the product wants while keeping persistence normalized in Supabase.

## Roster UX

### Table Layout

Add a new major category:

- `Chemistry`

With two subcolumns:

- `Bonus`
- `Tax`

Each cell should display the number of mapped players for that player and kind.

Examples:

- `0`
- `2`
- `5`

### Editing Behavior

When the user clicks a chemistry count cell:

- open a popover/dropdown for that player and chemistry kind
- show two containers:
  - `Active Selection`
  - `Remaining Players`

Active Selection behavior:

- show selected player names
- show an `x` next to each selected player
- clicking `x` removes that mapping immediately

Remaining Players behavior:

- show all other eligible players not already selected in either bonus or tax for that player
- clicking a player adds that player to the active list for the current chemistry kind
- the count in the roster cell updates immediately

Limit behavior:

- if the active list reaches 5 players:
  - hide the remaining players list
  - show the message `Only 5 players allowed`

Default behavior:

- all players start with `bonus = []`
- all players start with `tax = []`
- roster cells display `0` when empty

### Filtering Rules

For a player editing `bonus`:

- exclude the player themselves
- exclude players already in `bonus`
- exclude players already in `tax`

For a player editing `tax`:

- exclude the player themselves
- exclude players already in `tax`
- exclude players already in `bonus`

## Teams Page Analytics

### Scoring Rule

For each team in a scenario:

- gather the 5 assigned player IDs on that team
- for each assigned player:
  - add `+1` for every `bonus` target also on that same team
  - add `-1` for every `tax` target also on that same team

This score is directional by design.

Example:

- A bonus B
- B has no link to A
- if A and B are on the same team, total contribution is `+1`, not `+2`

### Chart Design

Add a new chemistry chart card to the Teams page analytics section.

Requirements:

- one total per team
- range from `-20` to `+20`
- visually support both positive and negative totals
- zero should be the center baseline

Recommended rendering approach:

- use a centered vertical bar with:
  - upward fill for positive values
  - downward fill for negative values
- show the numeric total above or centered near the bar
- keep hover or focus tooltip behavior consistent with the existing chart system

## State and Sync Changes

### Local State

Update:

- `lib/types.ts`
- `lib/state.ts`
- `components/tournament-builder.tsx`
- `lib/supabase/tcb.ts`

Required changes:

- add chemistry to `Player`
- sanitize chemistry arrays on load
- preserve chemistry during temp ID remaps
- include chemistry in player equality checks
- load chemistry rows from Supabase and stitch them onto each player
- write chemistry changes back to Supabase

### Sync Strategy

Recommended sync approach:

- continue syncing `players` through the existing flow
- sync chemistry relationships as a second related dataset
- when temporary player IDs are replaced with real Supabase IDs, remap chemistry arrays in memory before writeback

Important behavior:

- deleting a player should remove:
  - the player
  - all chemistry rows where they are the source
  - all chemistry rows where they are the target

Using `on delete cascade` handles the backend cleanup safely.

## Sample Test Data

It is fine to seed temporary chemistry mappings for testing.

Recommended temporary sample coverage:

- at least one player with 0 bonus and 0 tax
- at least one player with multiple bonus links
- at least one player with multiple tax links
- at least one team scenario where chemistry becomes positive
- at least one team scenario where chemistry becomes negative

These mappings can be overwritten later.

## Implementation Phases

### Phase 1: Schema and types

- Add a migration for `player_chemistry`
- Extend `Player` types with `chemistry`
- Add sanitization helpers for chemistry arrays
- Update player equality and remap helpers

### Phase 2: Supabase read/write path

- Load chemistry rows alongside players
- Combine player rows and chemistry rows into hydrated `Player` objects
- Write chemistry edits back to Supabase
- Ensure delete cascade behavior works

### Phase 3: Roster chemistry UI

- Add the `Chemistry` group and `Bonus` and `Tax` columns
- Render counts in cells
- Build the chemistry popover
- Add active/remove and remaining/add flows
- Enforce the 5-player limit

### Phase 4: Teams chemistry chart

- Compute chemistry totals from current scenario assignments
- Add a chart model for chemistry totals
- Render the new chart with a centered zero baseline

### Phase 5: Verification

- Verify add/remove behavior in roster
- Verify no overlap between bonus and tax
- Verify counts update immediately
- Verify reload and realtime refresh preserve chemistry
- Verify team chemistry totals match expected scenarios

## Acceptance Criteria

- Roster shows a `Chemistry` group with `Bonus` and `Tax` columns.
- New and existing players default to `0` chemistry counts unless mappings exist.
- Clicking a chemistry value opens an editor with `Active Selection` and `Remaining Players`.
- Removing a player from active selection updates the count immediately.
- Adding a player from remaining updates the count immediately.
- A player cannot add themselves to chemistry.
- A player cannot place the same target in both bonus and tax.
- A player cannot exceed 5 bonus targets or 5 tax targets.
- When a chemistry list reaches 5, the remaining list is hidden and `Only 5 players allowed` is shown.
- Chemistry persists after reload through Supabase.
- Deleting a player removes their related chemistry edges.
- Teams page shows a chemistry chart for each scenario.
- Chemistry totals are directional and use a `-20` to `+20` scale.

## Main Risks

- The current player sync flow is single-table oriented, so chemistry persistence will require a careful multi-table sync path.
- Temporary player IDs for newly added roster rows must be remapped before chemistry writes become valid.
- The roster chemistry editor introduces a more complex popover than the current row controls, so click-outside and focus behavior need careful handling.
- The Teams analytics section currently assumes only positive stacked charts, so chemistry likely needs a separate chart rendering path rather than a small patch to the existing one.
