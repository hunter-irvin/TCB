# Team Matchup Balance Build Spec

## Status

| # | Task | Status | Notes | Verification tests |
| --- | --- | --- | --- | --- |
| 1 | Finalize matchup scoring rules | Completed | Offense and defense assignments are solved independently. | Unit-test independent offense/defense assignment solving; unit-test fair deadband at `-0.3`, `0`, and `+0.3`; unit-test missing matchup data returns neutral `0`. |
| 2 | Define scenario ranking priorities | Completed | Full rosters first, then fair-pair count, then unfairness magnitude, then net-advantage spread. | Unit-test candidate ordering with hand-built fixtures covering each tie-break layer; verify a full-roster candidate beats a partial candidate even with worse matchup totals. |
| 3 | Add matchup-balance scoring library | Completed | `lib/team-matchup-balance.ts` now builds score lookup, solves assignments, evaluates scenarios, and suggests swaps. | Unit-test player-pair aggregation from matchup rows; unit-test `5!` assignment ranking with deterministic fixtures; unit-test team-pair and whole-scenario report shapes. |
| 4 | Load matchup response data into Teams page | Completed | Teams page now fetches the run-scoped matchup visualizer chord bundle client-side and derives matchup lookup state with `loading` / `ready` / `error` gating. | Manual test that only current-run players and matchup rows are used; verify no cross-run leakage by switching runs; verify loading and empty-data states. |
| 5 | Add `Balance Matchup` button and action mode | Completed | Internal action mode is `balanceMatchup`; the user-facing autofill button label is `Matchups` and it is disabled until matchup data is ready. | Manual test button renders beside existing actions; verify loading state, disabled state, and summary copy; verify existing buttons still work. |
| 6 | Rank random scenario candidates with matchup scoring | Completed | Current generator reuses the random fill path and ranks candidates by matchup report. | Unit-test candidate sorter with deterministic fixtures; manual test repeated runs produce full rosters when possible; compare selected candidate against a known weaker candidate fixture. |
| 7 | Add analytics tab switch | Completed | Each scenario now has `Stats Comparison` and `Matchup Comparison`. | Manual test tab switching per scenario; verify active tab does not affect other scenario cards; verify keyboard focus and aria roles if used. |
| 8 | Keep existing stats charts under `Stats Comparison` | Completed | Existing stats charts remain available and unchanged in the stats tab. | Visual regression/manual comparison against current charts; verify totals, labels, tooltips, and layout are unchanged under `Stats Comparison`. |
| 9 | Build `Overall` matchup bar chart | Completed | Implemented as `Team Advantages` with nested `OVR`, `OFF`, and `DEF` bars on a fixed `±5.0` scale. | Unit-test team net overall values from fixture reports; manual test zero-centered axis, positive/negative direction, and symmetric scaling; verify displayed values match computed totals. |
| 10 | Build `Offense` team chord diagram | Completed | Reworked into fixed-layout team diagrams with directional arrow-arcs, hover tooltips, selection state, and head-to-head drill-down trigger. | Manual test 2-team, 3-team, and 4-team layouts; verify arc direction and color match offense net values; compare colors against existing matchup visualizer examples. |
| 11 | Build `Defense` team chord diagram | Completed | Mirrors offense behavior with independent directional values and drill-down trigger. | Manual test 2-team, 3-team, and 4-team layouts; verify arc direction and color match defense net values; verify defense values can differ from offense for the same team pair. |
| 12 | Persist selected matchup report in scenario UI state | Completed | Selected scenarios retain chosen player-pair assignments, team totals, and swap-suggestion context. | Inspect state shape in DevTools/logging; verify selected scenario retains chosen assignments and totals after generation; verify unchosen alternatives are not stored. |
| 13 | Manual verification across 2, 3, and 4 teams | In Progress | Live verification is solid for `3` teams; `2` and `4` team dedicated passes should still be completed. | Run end-to-end manual checks for `2`, `3`, and `4` teams; verify sparse-data neutrality; verify no-data still renders neutral charts and returns a candidate without errors. |
| 14 | Phase 1: Redefine Goal 2 mismatch score | Completed | `totalUnfairnessMagnitude` now uses `sum(abs(rawScore))` across chosen pairs. | Unit-test fair pairs with `0.05` and `0.25` contribute different Goal 2 totals; verify reported Goal 2 score increases relative to old deadbanded version for the same scenario; verify helper text and labels still describe the metric correctly. |
| 15 | Phase 2: Update assignment tie-breaker scoring | Completed | Assignment tie-breakers now use raw mismatch totals while keeping fair-pair count first. | Unit-test two equally fair assignments where one has lower `sum(abs(rawScore))`; verify solver now picks that assignment; verify offense and defense assignments remain independently solved. |
| 16 | Phase 3: Revalidate scenario ranking and swap suggestions | Completed | Candidate ranking order is unchanged, but scenario selection and swap suggestions now reflect raw mismatch totals. | Unit-test candidate ranking with equal fair-count fixtures and different raw mismatch totals; verify swap suggestion can change after the new Goal 2 math; manual test `Balance Matchup` still returns stable full-roster candidates. |
| 17 | Phase 4: Visual and regression verification for new mismatch math | Completed | Goal 2 visuals now reflect raw mismatch totals; color thresholds remain unchanged. | Manual test `Optimization Results` Goal 2 bar/score reflects raw mismatch totals; verify `Team Advantages`, offense/defense cards, and head-to-head tooltips still render expected raw values; verify no unintended color-threshold regressions. |

## Verification Matrix

### Task 1: Finalize matchup scoring rules

1. Build fixtures where offense and defense best assignments differ and verify both are preserved independently.
2. Verify `rawScore` values inside the `±0.3` deadband are marked fair.
3. Verify missing player-pair matchup data produces `rawScore = 0` and fair status.

### Task 2: Define scenario ranking priorities

1. Build a fixture set with one full and one partial candidate and confirm the full candidate always wins.
2. Build tied fair-count candidates and confirm lower total unfairness magnitude wins.
3. Build tied unfairness candidates and confirm lower net-advantage spread wins.

### Task 3: Add matchup-balance scoring library

1. Unit-test directional score aggregation from raw matchup rows.
2. Unit-test assignment enumeration and winner selection for one team pair.
3. Unit-test whole-scenario report generation for expected totals and output shape.

### Task 4: Load matchup response data into Teams page

1. Switch runs and confirm matchup data changes with the active run.
2. Verify only run-owned player IDs are included in the scorer.
3. Verify empty or missing matchup data does not crash the page.

### Task 5: Add `Balance Matchup` button and action mode

1. Confirm the button renders in the action row beside the existing balance actions.
2. Confirm click starts the new scenario action mode and shows loading state.
3. Confirm summary text references matchup balancing rather than stats balancing.

### Task 6: Rank random scenario candidates with matchup scoring

1. Verify generated candidates are still built through the current random-fill path.
2. Verify the selected candidate matches the best-ranked fixture under matchup rules.
3. Verify a scenario with more fair pairings beats a scenario with fewer fair pairings.

### Task 7: Add analytics tab switch

1. Confirm both analytics tabs render.
2. Confirm switching tabs only changes the current scenario card.
3. Confirm focus, click, and keyboard behavior remain usable.

### Task 8: Keep existing stats charts under `Stats Comparison`

1. Compare current and updated `Stats Comparison` screenshots for one scenario.
2. Verify the stacked totals and tooltip values still match previous behavior.
3. Verify mobile and desktop layouts still behave correctly.

### Task 9: Build `Overall` matchup bar chart

1. Verify each team bar equals its computed net overall advantage.
2. Verify the chart scales symmetrically around zero.
3. Verify positive and negative teams render on opposite sides of the zero baseline.

### Task 10: Build `Offense` team chord diagram

1. Verify a 2-team scenario renders two nodes and directional offense arcs.
2. Verify 3-team and 4-team scenarios render evenly spaced nodes.
3. Verify arc color and intensity match offense net advantage using existing matchup visualizer color rules.

### Task 11: Build `Defense` team chord diagram

1. Verify defense arcs can differ from offense arcs for the same team pair.
2. Verify node layout remains readable for 2, 3, and 4 teams.
3. Verify color and direction reflect defense net advantage values.

### Task 12: Persist selected matchup report in scenario UI state

1. Verify the selected scenario stores only chosen offense and defense pair assignments.
2. Verify team-pair offense, defense, and overall totals are present.
3. Verify rejected assignment alternatives are not retained.

### Task 13: Manual verification across 2, 3, and 4 teams

1. Verify end-to-end generation and rendering for 2 teams.
2. Verify end-to-end generation and rendering for 3 teams.
3. Verify end-to-end generation and rendering for 4 teams.
4. Verify sparse-data scenarios stay neutral where data is missing.
5. Verify no-data scenarios still generate a candidate and render neutral matchup visuals.

### Task 14: Phase 1: Redefine Goal 2 mismatch score

1. Build a fixture where two fair player pairs have raw scores like `0.04` and `0.26` and verify they no longer contribute equally.
2. Verify `totalMismatchScore = sum(abs(rawScore))` across all chosen offense and defense pairs.
3. Verify the same scenario reports a larger Goal 2 score than the current deadbanded version when fair-but-nonzero pairs exist.

### Task 15: Phase 2: Update assignment tie-breaker scoring

1. Build two equally fair assignments and verify the solver chooses the one with lower `sum(abs(rawScore))`.
2. Verify offense and defense assignments can still differ after the tie-breaker change.
3. Verify exact ties still allow either assignment without errors.

### Task 16: Phase 3: Revalidate scenario ranking and swap suggestions

1. Verify candidate sorting still prioritizes full rosters, then fair count, then the new Goal 2 score, then team spread.
2. Verify a previously tied scenario fixture now prefers the lower raw mismatch candidate.
3. Verify swap suggestions update when the new Goal 2 math changes the best swap.

### Task 17: Phase 4: Visual and regression verification for new mismatch math

1. Verify the `Optimization Results` Goal 2 value and bar length now follow `sum(abs(rawScore))`.
2. Verify offense/defense arrow colors remain unchanged under the current thresholds.
3. Verify head-to-head tooltips still show row-level offense advantage and vote totals correctly.
4. Verify `Team Advantages` and `Suggested Swap` still update correctly after roster changes.

## Goal

Add a new balancing strategy to the Teams page called `Balance Matchup` that evaluates randomly generated full-roster scenarios using matchup visualizer data rather than only player attribute totals.

In the shipped UI, this strategy is exposed through the `Matchups` autofill button while the internal mode/state name remains `balanceMatchup`.

The first version should:

- add a new matchup-balancing autofill action beside the existing balance actions
- use the current run's matchup response data
- work for `2`, `3`, or `4` teams
- always evaluate teams as `5` players per team
- ignore positions during matchup scoring once a scenario candidate exists
- solve offense and defense player-pair assignments independently for each team-vs-team comparison
- maximize fair matchups within the existing `±0.3` deadband
- minimize total unfairness magnitude when fair counts tie
- show a new `Matchup Comparison` analytics view beside the existing stats charts

## User-Facing Behavior

### Scenario Generation

The Teams page will keep the current scenario generation approach:

- generate many random valid full-roster candidates
- score each candidate
- select the best candidate

The new `Balance Matchup` mode will score those candidates using matchup data.

This mode should respect any manual assignments already made in the scenario and only fill remaining eligible slots, matching the current builder behavior.

### Scenario Analytics

Each scenario will have an analytics mode switch:

- `Stats Comparison`
- `Matchup Comparison`

`Stats Comparison` keeps the current stacked attribute charts.

`Matchup Comparison` currently shows four cards side by side:

- `Optimization Results`
- `Team Advantages` as a bar chart
- `Offense` as a team-level chord diagram
- `Defense` as a team-level chord diagram

When a directional offense or defense arrow is selected, the opposite chart card is replaced by a `Head to Head` drill-down card.

## Current Data Reality

Relevant existing data:

- `public.matchup_tinder_responses`
  - `offense_player_id bigint`
  - `defense_player_id bigint`
  - `result text`
  - `mode text`
  - `created_at timestamptz`
- `public.players`
  - `id bigint`
  - `name text`
  - `run_id uuid`

Important existing behavior:

- matchup rows are directional
- `offense_player_id -> defense_player_id` is different from the reverse
- the visualizer already supports `overall`, `good_matchup`, and `imbalanced`
- the visualizer already defines a fair deadband of `±0.3`
- run scoping already exists for matchup data and roster data

No schema change is required for phase one.

## Source of Truth for Matchup Math

This feature should reuse the existing matchup visualizer semantics from [lib/matchup-visualizer.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/lib/matchup-visualizer.ts).

Current math to reuse:

- `rawScore = (winVotes - loseVotes) / totalVotes`
- `normalizedScore = normalizeUnifiedColorScore(rawScore)`
- fair deadband: `abs(rawScore) <= 0.3`
- missing matchup data should be treated as neutral `0`

Perspective rules:

- for offense evaluation, `offense_wins` is positive and `defense_wins` is negative
- for defense evaluation, `defense_wins` is positive and `offense_wins` is negative

Color behavior for team chord diagrams should mimic the existing matchup visualizer:

- red for disadvantage
- yellow around the fair zone
- green for advantage

Where possible, reuse the existing color interpolation and tone helpers instead of creating a second color system.

## Matchup Scoring Model

### Team Pair Evaluation

For each unordered pair of teams, such as `Team A` and `Team B`, evaluate two separate perspectives:

1. `Team A offense vs Team B defense`
2. `Team A defense vs Team B offense`

These two assignments are solved independently.

That means the chosen player-pair assignment on offense does not need to match the chosen player-pair assignment on defense.

Example:

- offense assignment: `A1`, `B2`, `C3`, `D4`, `E5`
- defense assignment: `A2`, `B1`, `C5`, `D3`, `E4`

This is intentional and required behavior.

### Player-Pair Assignment Search

Each team has `5` players, so each perspective produces a `5 x 5` matrix of directional player matchup scores.

For each perspective:

- enumerate all `5! = 120` one-to-one assignments
- score every assignment
- keep the first best-ranked assignment encountered; exact ties are acceptable and do not require storing alternates

This brute-force search is acceptable because the assignment size is fixed and small.

### Assignment Ranking

For one perspective, rank assignments by:

1. highest number of fair pairings where `abs(rawScore) <= 0.3`
2. lowest total unfairness magnitude

Total mismatch magnitude is now calculated as the sum of `abs(rawScore)` across the `5` chosen player pairs.

If two assignments still tie, either assignment is acceptable.

### Team-vs-Team Totals

For each unordered team pair, compute:

- chosen offense player-pair assignments
- offense cumulative score
- chosen defense player-pair assignments
- defense cumulative score
- overall cumulative score

Current formulas:

- `offenseCumulativeScore = sum(rawScore of the 5 chosen offense pairs)`
- `defenseCumulativeScore = sum(rawScore of the 5 chosen defense pairs)`
- `overallCumulativeScore = offenseCumulativeScore + defenseCumulativeScore`

### Whole-Scenario Ranking

Rank scenario candidates in this order:

1. full rosters only
2. highest total fair-pair count across all team-pair offense and defense assignments
3. lowest total unfairness magnitude across all chosen pairings
4. lowest spread in team net overall advantage

If two candidates still tie after those four checks, the current implementation falls back to stable assignment-signature ordering.

Team net overall advantage should be derived by summing each team's cumulative overall matchup scores against every other team.

The `Team Advantages` card should visualize this net overall advantage.

## Visualization Plan

### Analytics Mode Switch

Add a scenario-local tab switch above the analytics section:

- `Stats Comparison`
- `Matchup Comparison`

The active selection should be local UI state only and does not need backend persistence.

### `Stats Comparison`

This view should remain exactly as it works today:

- stacked attribute charts
- current colors
- current tooltips
- current layout behavior

### `Matchup Comparison`

This view currently renders four cards in one row on desktop and stacks them responsively on smaller screens:

1. `Optimization Results`
2. `Team Advantages`
3. `Offense`
4. `Defense`

### `Optimization Results`

This card currently shows:

- `Goal 1: Maximize Fair Matchups`
- `Goal 2: Minimize Total Mismatch Score`
- `Goal 3: Minimize Team Advantages`
- `Suggested Swap`

Current behavior:

- Goal 1 uses a gold/black completion bar showing `fair chosen matchups / total chosen matchups`
- Goal 2 uses a gold/black completion bar and now reports `sum(abs(rawScore))`
- Goal 3 uses a gold/black completion bar and reports overall team spread
- Suggested swap updates live when the roster changes and the scenario is complete

### `Team Advantages` Bar Chart

The `Team Advantages` card currently shows one team row per team with nested bars:

- `OVR`
- `OFF`
- `DEF`

Current behavior:

- bar value = team net overall, offense, or defense advantage
- zero-centered axis per metric
- fixed visual scale of `±5.0`
- positive values extend to the right of zero
- negative values extend to the left of zero
- helper text under the title reads `Summarized results for player-pair matchups`

### `Offense` and `Defense` Team Diagrams

These two cards currently reuse the matchup visualizer concept at the team level using bespoke fixed layouts instead of a circular node layout.

Implemented structure:

- `2` teams: left/right
- `3` teams: triangle
- `4` teams: box
- each team is a labeled circle
- each directional relationship is rendered as a tapered arrow-arc
- both directions between a team pair follow parallel inward curves
- arc color reflects the actual directional advantage/disadvantage

Current source values:

- `Offense` uses each team's cumulative offense score against each other team
- `Defense` uses each team's cumulative defense score against each other team

Current interaction behavior:

- hovering a team previews outgoing relationships
- clicking a team pins that team focus
- hovering an arrow shows a black tooltip with score
- clicking an arrow selects a head-to-head matchup
- while head-to-head mode is active:
  - the opposite chart is replaced by `Head to Head`
  - the selected source chart is darkened except for the selected arrow and the two involved team nodes
  - `Optimization Results` and `Team Advantages` are darkened
  - clicking outside the head-to-head card clears the drill-down unless another arrow is clicked

Current arrow color thresholds:

- `|score| < 0.3` => yellow
- `0.3 <= |score| < 1.5` => light green / orange
- `|score| >= 1.5` => dark green / red

### `Head to Head`

This drill-down card is now implemented.

Current behavior:

- title: `Head to Head`
- left column label: `[Team X] OFFENSE`
- right column label: `[Team Y] DEFENSE`
- each chosen player pair is shown on one row
- connector line color reflects the player-pair matchup score
- connector line width reflects vote count
- hovering a row-level line shows a black tooltip with:
  - offense advantage score
  - vote total

## Implemented Data Shape

The shared scoring library now lives at:

- `lib/team-matchup-balance.ts`

Current exported types:

```ts
type TeamMatchupPairScore = {
  rawScore: number;
  normalizedScore: number;
  colorHex: string;
  isFair: boolean;
  voteTotal: number;
};

type TeamMatchupChosenPair = {
  sourcePlayerId: number;
  targetPlayerId: number;
  rawScore: number;
  normalizedScore: number;
  colorHex: string;
  isFair: boolean;
  voteTotal: number;
};

type TeamMatchupPerspectiveReport = {
  sourceTeamId: string;
  targetTeamId: string;
  pairCount: number;
  pairs: TeamMatchupChosenPair[];
  fairPairCount: number;
  unfairnessMagnitude: number;
  cumulativeScore: number;
  averageScore: number;
  normalizedScore: number;
  colorHex: string;
};

type TeamMatchupPairReport = {
  leftTeamId: string;
  rightTeamId: string;
  offense: TeamMatchupPerspectiveReport;
  defense: TeamMatchupPerspectiveReport;
  overallCumulativeScore: number;
};

type TeamMatchupNetAdvantage = {
  teamId: string;
  overall: number;
  offense: number;
  defense: number;
};

type TeamMatchupDirectionalEdge = {
  sourceTeamId: string;
  targetTeamId: string;
  cumulativeScore: number;
  averageScore: number;
  normalizedScore: number;
  colorHex: string;
};

type ScenarioMatchupReport = {
  teamPairs: TeamMatchupPairReport[];
  teamNetAdvantages: TeamMatchupNetAdvantage[];
  totalFairPairCount: number;
  totalUnfairnessMagnitude: number;
  overallNetSpread: number;
  offenseEdges: TeamMatchupDirectionalEdge[];
  defenseEdges: TeamMatchupDirectionalEdge[];
};

type ScenarioMatchupSwapSuggestion = {
  sourceTeamId: string;
  targetTeamId: string;
  sourcePlayerId: number;
  targetPlayerId: number;
  nextReport: ScenarioMatchupReport;
};
```

The selected scenario now retains:

- chosen player-pair assignments
- team-pair offense totals
- team-pair defense totals
- team-pair overall totals
- team net advantages
- precomputed offense and defense directional edges for the team diagrams
- per-pair vote totals and color values for head-to-head drill-down rendering

## Teams Page Integration

Primary file:

- [components/teams-page.tsx](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/components/teams-page.tsx)

### Scenario Action Modes

Current action modes:

- `randomize`
- `balanceOverall`
- `balanceCategories`
- `balanceMatchup`

Implemented updates:

- action state types
- summary types
- button loading states
- feedback copy

### Candidate Generation

The current implementation does not create a separate constructive team-building engine.

Instead it:

- reuse `randomizeRemainingAssignments(...)`
- reuse the current repeated-candidate generation flow
- replace the scoring function used to choose finalists

This keeps implementation risk lower and makes comparison with the current strategies straightforward.

### Matchup Data Loading

The Teams page currently:

- fetches [app/api/[run]/matchup-visualizer/chord/route.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/app/api/[run]/matchup-visualizer/chord/route.ts) through `buildRunApiPath(run.slug, "matchup-visualizer/chord")`
- requests the payload with `cache: "no-store"`
- stores bundle state as `loading`, `ready`, or `error`
- disables the `Matchups` autofill button until the bundle is `ready`
- surfaces route-loading failures through the button tooltip and the local error state

## Implementation Breakdown

### Shared Matchup Scoring Helpers

- `lib/team-matchup-balance.ts` builds directional lookup maps from the matchup visualizer bundle
- the solver enumerates one-to-one pairings and ranks them by fair-count first, then raw mismatch total
- full-scenario reports retain team-pair totals, team net advantages, and precomputed diagram edges

### Scenario Builder Integration

- Teams page action types include `balanceMatchup`
- the autofill action reuses `randomizeRemainingAssignments(...)` and the current repeated-candidate generation flow
- full-roster candidates are preferred, with partial candidates used only as fallback
- selected candidates retain the matchup report used for analytics and swap suggestions

### Analytics UI

- scenario-local tabs now switch between `Matchup Comparison` and `Stats Comparison`
- matchup analytics render `Optimization Results`, `Team Advantages`, `Offense`, and `Defense`
- selecting a directional arrow swaps the opposite diagram card for the `Head to Head` drill-down card
- click-out behavior clears head-to-head mode unless the click lands inside the drill-down card or on another diagram arrow

### Same-Day Matchup Tinder Follow-Up

- [lib/matchup-tinder.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/lib/matchup-tinder.ts) now tracks undirected pair vote totals
- both `next` routes weight candidate matchups toward lower-vote pairs
- both `respond` routes reload pair vote totals after recording a vote so the next returned matchup uses the same weighting rules

## Edge Cases

### Sparse Matchup Data

If a player pair has no matchup data:

- treat score as `0`
- treat it as fair
- do not penalize it for missing information in phase one

### Partial Rosters

If a candidate is not a full roster:

- it should always lose to any otherwise valid full-roster candidate

If no full-roster candidate exists within the current attempt budget:

- return the best partial candidate using the same ranking order, preserving current generator behavior

### No Matchup Data for Entire Scenario

If all team-pair player matchup scores collapse to zero:

- `Balance Matchup` should still return a candidate
- all candidates may tie on matchup fairness
- fallback tie-breaking can remain stable or effectively first-best from the deduped list
- the `Matchup Comparison` view should show neutral output rather than an error

## Testing and Verification Checklist

- `Balance Matchup` appears and respects loading state
- manual assignments remain locked while only empty eligible slots are filled
- chosen offense and defense pair assignments can differ for the same team pair
- total fair-pair count increases for selected matchup-balanced scenarios relative to weaker candidates
- overall unfairness magnitude decreases for stronger matchup-balanced scenarios
- `Team Advantages` values equal the sum of each team's team-pair totals
- offense chord colors align with offense net advantage values
- defense chord colors align with defense net advantage values
- colors visually match the existing matchup visualizer palette and deadband behavior
- head-to-head labels match the players shown under each team header
- row-level head-to-head tooltips show offense advantage and vote totals
- the analytics section remains usable on narrow screens

## Files Touched on April 1, 2026

- [components/teams-page.tsx](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/components/teams-page.tsx)
- [lib/team-matchup-balance.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/lib/team-matchup-balance.ts)
- [lib/matchup-visualizer.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/lib/matchup-visualizer.ts)
- [lib/matchup-tinder.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/lib/matchup-tinder.ts)
- [app/api/[run]/matchup-visualizer/chord/route.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/app/api/[run]/matchup-visualizer/chord/route.ts)
- [app/api/[run]/matchup-tinder/next/route.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/app/api/[run]/matchup-tinder/next/route.ts)
- [app/api/[run]/matchup-tinder/respond/route.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/app/api/[run]/matchup-tinder/respond/route.ts)
- [app/api/matchup-tinder/next/route.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/app/api/matchup-tinder/next/route.ts)
- [app/api/matchup-tinder/respond/route.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/app/api/matchup-tinder/respond/route.ts)
- [app/globals.css](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/app/globals.css)
- [docs/team-matchup-balance-build-spec.md](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/docs/team-matchup-balance-build-spec.md)

## Open Questions for Later

- Should `Balance Matchup` eventually get a second-pass local swap optimizer after random candidate generation?
- Should matchup candidate scoring move server-side if client-side evaluation becomes too heavy?
- Should a future drill-down add a raw all-vs-all team matrix beside the current chosen-assignment view?
