# Matchup Visualizer Plan

## Goal

Add a fourth product surface called `Matchup Visualizer` that sits alongside `Roster`, `Teams`, and `Matchup Tinder`.

The first version should:

- add a new route at `/matchup-visualizer`
- add a new nav tab labeled `Matchup Visualizer`
- render a chord diagram driven by `good_matchup` data already stored in Supabase
- include an `Offense` / `Defense` toggle at the top, styled like the existing `Test` / `Play` toggle
- arrange players as nodes around the outside of the diagram
- draw connections only where a player pair has at least one `good_matchup` response
- use line or ribbon stroke treatment to visually represent the count of `good_matchup` responses

## Current Data Reality

The existing dataset already supports this feature.

Current relevant table:

- `public.matchup_tinder_responses`
  - `offense_player_id bigint`
  - `defense_player_id bigint`
  - `result text`
  - `mode text`
  - `created_at timestamptz`
  - generated `matchup_key text`

Current relevant roster table:

- `public.players`
  - `id bigint`
  - `row_number integer`
  - `name text`

Important current behavior:

- matchup rows are directional
- `offense_player_id -> defense_player_id` is not the same as the reverse
- `good_matchup` is already one of the stored result values
- there are already response rows in the database, so the visualizer can be built without a schema change for phase one

## Charting Library Recommendation

Recommended library:

- `d3`

Why `d3` is the best fit here:

- D3 officially includes a chord layout via `d3-chord`
- the chord layout is matrix-based, which matches this feature naturally
- D3 only emits chords for non-zero relationships, which aligns with the requirement that zero-count pairs should not render lines
- it gives us precise control over stroke width, hover behavior, labeling, and future custom overlays
- it avoids pulling in a higher-level charting framework when this app currently uses mostly custom UI

Relevant official docs:

- D3 API index: https://d3js.org/api
- D3 chord layout: https://d3js.org/d3-chord
- D3 chord generator details: https://d3js.org/d3-chord/chord

Implementation note:

- we should render the visualization in React using SVG and use D3 for layout/math instead of letting D3 own the DOM

## Product Shape

### Route and Navigation

Recommended route:

- `/matchup-visualizer`

Recommended navigation update:

- add `Matchup Visualizer` as a fourth tab in `components/app-shell.tsx`

### Page Layout

Recommended initial page structure:

1. page title: `Matchup Visualizer`
2. short one-line description under the title
3. `Offense` / `Defense` toggle centered near the top
4. visualization panel containing the chord diagram
5. optional legend row showing how stroke width maps to counts

### Toggle Behavior

Recommended semantics:

- `Offense` mode:
  - outer nodes represent offensive players
  - connections represent `good_matchup` counts from `offense_player_id` to `defense_player_id`
- `Defense` mode:
  - outer nodes represent defensive players
  - the same directional data is shown from the defensive perspective

Because chord diagrams are inherently pair-based, the toggle should change the framing and labeling, not the underlying row set.

## Data Shaping Plan

### Phase-One Query Shape

We should add a route handler that returns aggregated matchup counts for `good_matchup` only.

Recommended endpoint:

- `GET /api/matchup-visualizer/chord?perspective=offense`
- `GET /api/matchup-visualizer/chord?perspective=defense`

Recommended aggregation:

- group by `offense_player_id`, `defense_player_id`
- filter `result = 'good_matchup'`
- count rows per directional pair

Recommended query output shape:

```ts
type MatchupVisualizerEdge = {
  offensePlayerId: number;
  defensePlayerId: number;
  count: number;
};

type MatchupVisualizerNode = {
  id: number;
  rowNumber: number;
  name: string;
};
```

### Matrix Transformation

D3 chord layout expects a square matrix.

Recommended transformation steps:

1. fetch all named players
2. sort by `row_number`
3. assign each player a stable matrix index
4. create an `n x n` matrix initialized to `0`
5. for each aggregated `good_matchup` row:
   - set matrix[sourceIndex][targetIndex] = count
6. pass that matrix into `d3.chord()`

Important note:

- self-links should remain `0`
- unnamed players should be excluded, matching existing matchup-tinder behavior

## Visualization Rules

### Nodes

Each player should appear as an arc around the perimeter.

Recommended label content:

- player name
- optional small count later if needed

### Links

Recommended phase-one rendering:

- use chord ribbons or stroked curved paths between arcs
- width should scale with `good_matchup` count
- zero-count pairs should not render

Recommended visual defaults:

- use a muted base stroke/fill palette that matches the existing app theme
- use player-based coloring later if desired, but not required for phase one
- add hover state later if time allows, but not required for the first pass

### Empty-State Behavior

If no `good_matchup` rows exist:

- show an explanatory empty state instead of an empty chart
- suggest collecting more matchup-tinder data

## Implementation Tasks

### Task 1: Product Shell

- add `Matchup Visualizer` tab to `components/app-shell.tsx`
- add route file at `app/matchup-visualizer/page.tsx`
- create page component, likely `components/matchup-visualizer-page.tsx`

### Task 2: Shared Types and Data Helpers

- add a new library file such as `lib/matchup-visualizer.ts`
- define API response types
- define matrix-building helpers
- define player index mapping helpers

### Task 3: Backend Aggregation Route

- add `app/api/matchup-visualizer/chord/route.ts`
- validate `perspective` query param
- fetch named players from `public.players`
- fetch aggregated `good_matchup` counts from `public.matchup_tinder_responses`
- return nodes plus directional edges or a prebuilt matrix

### Task 4: Chart Component

- install `d3`
- create a client component for the chord diagram
- render SVG arcs for players
- render connections for non-zero counts
- scale line or ribbon width by count
- add basic responsive sizing behavior

### Task 5: Toggle and Page Wiring

- add `Offense` / `Defense` toggle with the existing toggle visual language
- reload or recompute the chart when the toggle changes
- keep the loading and error states consistent with the rest of the app

### Task 6: Empty, Loading, and Error States

- add loading placeholder while data is fetched
- add empty state for zero `good_matchup` rows
- add error state for Supabase/config failures

### Task 7: Polish

- ensure labels do not collide badly on desktop
- ensure the chart still fits on narrower screens
- add a legend or caption describing that thicker connections mean more `good_matchup` votes

## Test Plan

### Data Tests

- verify only `result = 'good_matchup'` rows are included
- verify `offense_player_id = A, defense_player_id = B` is counted separately from the reverse
- verify self-pairs are excluded or remain zero
- verify unnamed players are excluded from the final node list and matrix
- verify zero-count relationships do not render connections

### API Tests

- `GET /api/matchup-visualizer/chord` returns `200` with valid payload when Supabase is configured
- invalid `perspective` returns `400`
- missing Supabase config returns `500`
- valid payload includes stable player ordering
- counts match a known fixture dataset

### UI Tests

- new `Matchup Visualizer` tab appears next to the existing tabs
- visiting `/matchup-visualizer` renders the page shell successfully
- `Offense` is selected by default
- toggling to `Defense` updates the chart without a page reload
- players render around the outside of the chart
- only player pairs with non-zero counts render links
- thicker links correspond to higher counts
- loading, empty, and error states display correctly

### Responsive Checks

- desktop: labels remain readable and chart stays centered
- tablet: chart scales down without clipping the perimeter labels
- phone: page remains usable even if labels need truncation or smaller text

### Regression Checks

- existing `Roster`, `Teams`, and `Matchup Tinder` tabs still work
- existing matchup-tinder flows still submit data correctly
- adding D3 does not break build or TypeScript checks

### Verification Commands

- `npx tsc --noEmit`
- app smoke test in browser for `/roster`, `/teams`, `/matchup-tinder`, `/matchup-visualizer`

## Open Questions

These need confirmation before implementation:

- Should the visualizer include both `test` and `play` rows, or only `play` rows?
- In `Defense` mode, do you want the exact same directional data with defensive framing, or do you want the matrix transposed so the selected defender becomes the “source” node?
- Should links be rendered as traditional filled chord ribbons or as thinner curved strokes between player arcs?
- On phone screens, is it acceptable to abbreviate long player names around the perimeter?
- Do you want any minimum threshold, such as hiding links with only `1` good-matchup vote?

## Recommended Default Decisions

If you want me to move straight into implementation after review, my recommended defaults are:

- include `play` rows only
- default toggle selection: `Offense`
- use directional data as stored
- use thinner curved strokes first, not full ribbons
- show all non-zero counts
- truncate or abbreviate long names on small screens
