# Player Chemistry Revision Plan

## Goal

Revise the chemistry feature after user feedback.

This iteration should:

- keep chemistry bonus
- remove chemistry tax from the roster experience and Teams analytics
- remove the separate chemistry chart from the Teams page
- add chemistry bonus into the existing `Misc` chart as a fourth segment
- render the chemistry segment in a distinct chemistry color that matches the roster chemistry styling
- keep the chemistry segment at the top of the `Misc` stack

## Open Questions To Confirm

- Should `tax` be removed only from the product surface, or should we also remove stored `tax` rows from Supabase in the same release?
  - Recommendation: ship the UI and analytics rollback first, then do data cleanup in a follow-up unless product wants a hard reset immediately.
- Should chemistry bonus contribute to the displayed `Misc` total above the bar?
  - Recommendation: yes, so the total always matches the visible stack.
- Should the chemistry segment use the existing roster chemistry accent as a fixed color, or a team-tinted version of that accent?
  - Recommendation: use a fixed chemistry accent so it is clearly distinguishable from the other `Misc` subcategories.
- Should a zero-value chemistry segment render as a zero-height segment, or be omitted entirely?
  - Recommendation: omit it visually when the value is `0` while still including chemistry in the total calculation logic.

## Confirmed Product Direction

- Chemistry bonus remains directional.
  - If Player A has a bonus with Player B, Player B does not automatically get one back.
- Chemistry tax is no longer part of the intended user experience.
- Each player can still have up to 5 chemistry bonus links unless product changes that cap.
- Default chemistry remains empty.
- Team chemistry scoring becomes bonus-only:
  - `+1` for each bonus-linked teammate on the same team
- Teams analytics should show chemistry inside `Misc`, not in a dedicated fourth chart.

## Recommended UX Changes

### Roster

Keep chemistry editing in the roster, but simplify it to bonus-only.

Recommended changes:

- keep the `Chemistry` group header if we want continuity, but show only one subcolumn:
  - `Bonus`
- remove the `Tax` subcolumn
- each cell should continue to display the count of mapped bonus players
- clicking the bonus count should keep the current popover pattern, but only for the bonus list
- `Remaining Players` should exclude:
  - the player themselves
  - players already selected in `bonus`
- if the active list reaches 5 players:
  - hide the remaining list
  - show `Only 5 players allowed`

### Teams Page Analytics

Replace the current chemistry card with a synthetic segment inside the `Misc` chart.

Recommended behavior:

- keep only three analytics cards:
  - `Offense`
  - `Defense`
  - `Misc`
- for each team, compute a chemistry bonus total using the existing directional bonus rules
- append a `Chemistry` segment to the `Misc` stack for that team
- always append chemistry after the existing `Misc` attributes so it renders on top of the stack
- include chemistry bonus in the displayed `Misc` total
- label the segment and tooltip as `Chemistry`

## Chart Scale Impact

The current chart system uses a shared max total of `75`.

Today that works because each chart contains three attributes, each with a practical team max of `25`.

After chemistry is merged into `Misc`:

- `Misc` max becomes `95`
  - `75` from existing misc attributes
  - `20` from chemistry bonus

Recommended approach:

- move from one shared chart max to a per-chart max
- keep `Offense` at `75`
- keep `Defense` at `75`
- set `Misc` to `95`

This avoids shrinking the offense and defense bars just to make room for chemistry in `Misc`.

## State and Persistence Strategy

### Recommended Rollout Order

Use a staged approach unless product explicitly wants immediate schema cleanup.

Stage 1:

- remove `tax` from roster UI and Teams analytics
- stop using `tax` in scoring
- stop rendering the dedicated chemistry chart
- preserve existing persisted `tax` data temporarily if that reduces migration risk

Stage 2:

- remove `tax` from frontend types and helpers
- remove `tax` writes from the sync path
- delete or archive existing `tax` rows in `player_chemistry`
- tighten DB constraints if we want the schema to become bonus-only permanently

### Frontend State

Likely touchpoints:

- `lib/types.ts`
- `lib/state.ts`
- `components/roster-page.tsx`
- `components/teams-page.tsx`
- `components/tournament-builder.tsx`
- `lib/supabase/tcb.ts`
- `lib/constants.ts`

Recommended changes:

- simplify roster state and sorting to bonus-only
- remove team analytics dependence on `tax`
- replace chemistry-total chart data with chemistry-segment chart data
- introduce an explicit chemistry segment style path so it does not inherit the default misc segment treatment

### Persistence

Current persistence can stay functional during Stage 1, but we should be deliberate about how much cleanup we want in this pass.

Two options:

- Minimal-risk rollout:
  - hide and ignore `tax`
  - keep reading existing `tax` rows harmlessly until cleanup
- Full cleanup rollout:
  - delete `tax` rows
  - remove `tax` from app types and Supabase mapping logic
  - optionally migrate `player_chemistry.kind` to bonus-only constraints

## Implementation Phases

### Phase 1: Confirm Scope

- confirm whether `tax` removal is product-only or data-model-deep
- confirm the exact chemistry segment color rule
- confirm that `Misc` total should include chemistry

### Phase 2: Roster Bonus-Only Update

- remove the `Tax` column from the roster table
- remove tax sorting and tax-specific popover flows
- keep the `Bonus` editor and count behavior
- update any chemistry copy that still implies bonus and tax both exist

### Phase 3: Teams Misc Chart Integration

- replace the separate chemistry totals builder with a chemistry bonus segment builder
- inject a `Chemistry` segment into each `Misc` team stack
- ensure chemistry is always the last segment in the array so it renders on top
- remove the dedicated chemistry chart card and its centered positive/negative bar treatment

### Phase 4: Chart Styling and Scale

- add a dedicated chemistry segment color that matches the roster chemistry styling
- keep chemistry visually distinct from the standard misc subcategory colors
- move chart sizing from a single shared max to per-chart max handling
- verify tooltips, totals, and aria labels all reflect the new `Misc` + `Chemistry` structure

### Phase 5: Persistence Cleanup

If product wants full removal now:

- remove `tax` from app types and validation helpers
- stop loading and writing `tax`
- add a cleanup migration or delete path for existing `tax` rows
- simplify constraints and helper logic to bonus-only chemistry

If product wants the safer staged rollout:

- leave the schema in place for now
- document that `tax` is intentionally ignored by current UX and analytics
- schedule a follow-up cleanup task after rollout confidence improves

### Phase 6: Verification

- verify bonus add/remove still works from the roster
- verify bonus counts persist after reload
- verify `tax` no longer changes totals or visuals
- verify there are only three analytics cards on the Teams page
- verify the `Misc` total equals:
  - misc attribute total
  - plus chemistry bonus
- verify the chemistry segment uses the distinct chemistry color
- verify the chemistry segment always appears on top of the `Misc` stack
- verify `Misc` bars do not clip when chemistry bonus is high

## Acceptance Criteria

- Roster shows chemistry bonus only.
- Users can add and remove up to 5 bonus links per player.
- The roster no longer exposes chemistry tax.
- Teams page shows only `Offense`, `Defense`, and `Misc` charts.
- The separate chemistry chart no longer appears.
- `Misc` contains a `Chemistry` segment for each team when chemistry bonus is present.
- The chemistry segment uses the agreed chemistry-specific color and is visually distinct from the other misc segments.
- The chemistry segment always renders at the top of the `Misc` stack.
- The displayed `Misc` total includes chemistry bonus.
- Chemistry scoring is bonus-only and remains directional.
- Existing tax data no longer affects the user-visible roster or analytics.

## Main Risks

- If `tax` rows remain in the database temporarily, future code can accidentally start using them again unless the read and scoring paths are explicit.
- The current shared chart max of `75` will under-scale or clip `Misc` once chemistry is included unless we adjust the chart sizing model.
- Using a fixed chemistry accent improves distinction, but it may reduce the current per-team color feel unless we intentionally balance both.
- Removing the dedicated chemistry chart changes expected visuals and may require updates to any screenshot-based QA notes or tests.
