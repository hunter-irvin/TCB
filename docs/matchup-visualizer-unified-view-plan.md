# Matchup Visualizer Unified View Plan

## Goal

Add a new `Unified` matchup visualizer view that combines:

- `good_matchup`
- imbalanced positive outcomes
- imbalanced negative outcomes

Each player-to-player connection should:

- use arc width to represent total vote volume
- use color to represent the directional mix of `win`, `good`, and `lose` votes
- continue to support separate `Offense` and `Defense` perspectives

This plan is intentionally additive. The safest first version is to add `Unified` alongside the existing `Good Matchup` and `Imbalanced` views rather than replacing either current view.

## Recommended Color Model

We should implement the `good` zone in the math, not only in the color scale.

Reason:

- it gives us explicit, testable behavior for when a connection should still count as visually `good`
- it avoids tiny differences around zero creating slightly green or slightly red links that feel noisy
- it keeps the UI logic simple because the API can return a normalized score and a derived tone band

## Proposed Formula

For each directed player connection, aggregate:

- `winVotes`
- `goodVotes`
- `loseVotes`

Where:

- in `offense` perspective, `offense_wins` is `win` and `defense_wins` is `lose`
- in `defense` perspective, `defense_wins` is `win` and `offense_wins` is `lose`

Then compute:

`totalVotes = winVotes + goodVotes + loseVotes`

`rawScore = (winVotes - loseVotes) / totalVotes`

This yields:

- `-1` for all lose votes
- `0` for all good votes, or perfectly balanced win/lose mixes
- `+1` for all win votes

### Good Deadband

Use a centered deadband:

- if `rawScore >= -0.2` and `rawScore <= 0.2`, treat the connection as visually `good`

Recommended normalized color score:

```ts
function normalizeUnifiedColorScore(rawScore: number) {
  const deadband = 0.2;

  if (rawScore <= -deadband) {
    return (rawScore + deadband) / (1 - deadband);
  }

  if (rawScore >= deadband) {
    return (rawScore - deadband) / (1 - deadband);
  }

  return 0;
}
```

This gives:

- `0` for the full `good` range from `-0.2` to `+0.2`
- `-1` to `0` outside the deadband on the lose side
- `0` to `+1` outside the deadband on the win side

Then color interpolation becomes:

- `normalizedScore = -1` => red
- `normalizedScore = 0` => yellow
- `normalizedScore = +1` => green

Suggested stops:

- red: `#dc2626`
- yellow: `#facc15`
- green: `#16a34a`

## Width Logic

In the unified view, link width should use:

`count = totalVotes`

That is different from the current views:

- `good_matchup` uses `goodCount`
- `imbalanced` uses `abs(winVotes - loseVotes)`

This matches the product goal that width reflects how much data exists for the connection, while color reflects what the votes mean.

## Current Implementation Shape

Current relevant files:

- [lib/matchup-visualizer.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/lib/matchup-visualizer.ts)
- [components/matchup-visualizer-page.tsx](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/components/matchup-visualizer-page.tsx)
- [app/api/[run]/matchup-visualizer/chord/route.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/app/api/[run]/matchup-visualizer/chord/route.ts)
- [app/globals.css](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/app/globals.css)

Current behavior:

- the API builds two datasets per perspective: `good_matchup` and `imbalanced`
- each edge currently carries only:
  - `count`
  - `voteTotal`
  - `tone`
- the chart styles links by CSS classes:
  - `neutral`
  - `positive`
  - `negative`
- the filter slider currently means:
  - minimum good votes in `good_matchup`
  - minimum net margin in `imbalanced`

Unified view needs richer edge metadata than the current binary tone model.

## Implementation Plan

### Phase 1: Extend the data model

Update `lib/matchup-visualizer.ts` to add a third view:

- `unified`

Add richer edge fields for unified rendering, likely:

- `winVotes`
- `goodVotes`
- `loseVotes`
- `rawScore`
- `normalizedScore`
- `colorHex`

Recommended type changes:

- extend `MATCHUP_VISUALIZER_VIEWS`
- expand `MatchupVisualizerView`
- expand `MatchupVisualizerEdge`

Keep existing fields for backward compatibility with current views where practical.

### Phase 2: Build unified aggregates

Reuse the existing `buildPairAggregates` function, because it already computes:

- `goodCount`
- `positiveCount`
- `negativeCount`

Add a `unified` branch in `buildMatchupVisualizerResponse`.

For unified edges:

- `count = goodCount + positiveCount + negativeCount`
- `voteTotal = count`
- `winVotes = positiveCount`
- `goodVotes = goodCount`
- `loseVotes = negativeCount`
- `rawScore = (positiveCount - negativeCount) / count`
- `normalizedScore = normalizeUnifiedColorScore(rawScore)`
- `colorHex = interpolate red/yellow/green from normalizedScore`

### Phase 3: Define unified filtering

The unified view needs a threshold rule that still makes sense with width-based magnitude.

Recommended first version:

- slider filters by `totalVotes`
- keep the existing slider range `1..5`

Reason:

- it aligns with the new meaning of width
- it avoids hiding high-volume neutral-yellow links that are important in unified mode
- it keeps the filter intuitive: “show me connections with at least N total votes”

This should be implemented in `filterMatchupVisualizerResponse`.

### Phase 4: Update the page controls and copy

In `components/matchup-visualizer-page.tsx`:

- add `Unified` as a third tab
- keep `Offense` and `Defense` tabs unchanged
- update `countLabel`
- update slider `aria-label`
- update empty-state title and description for unified mode

Recommended copy:

- count label: `Unified Votes:`
- empty title: `No strong unified links yet`
- empty description: explain that the view includes all play responses with at least the selected total vote threshold

### Phase 5: Render unified link colors

The current chart uses CSS tone classes:

- `.matchup-visualizer-link-neutral`
- `.matchup-visualizer-link-positive`
- `.matchup-visualizer-link-negative`

For unified mode, move link color to an inline stroke style derived from `edge.colorHex`.

Recommended approach:

- keep the existing classes for opacity, hover, active, and inactive states
- set `stroke={link.colorHex}` for unified links
- preserve CSS-class color handling for the two legacy modes

This minimizes regression risk.

### Phase 6: Decide how node highlighting should behave

Current interaction model:

- hovering or pinning a source player highlights only outgoing links from that player
- target nodes are shown as related

Unified mode can keep that behavior unchanged.

No interaction redesign is required for the first implementation.

### Phase 7: Verify live behavior

Use DevTools on:

- `http://localhost:3000/TCB/matchup-visualizer`

Test both:

- `Offense`
- `Defense`

And all three views:

- `Good Matchup`
- `Imbalanced`
- `Unified`

## Suggested Implementation Details

### Helper functions to add in `lib/matchup-visualizer.ts`

Recommended helpers:

- `normalizeUnifiedColorScore(rawScore: number): number`
- `interpolateUnifiedMatchupColor(score: number): string`
- `getUnifiedEdgeTone(score: number): "positive" | "neutral" | "negative"`

Even though unified rendering will likely use `colorHex` directly, keeping a coarse tone is still helpful for:

- analytics
- testing
- fallback styling

### Color interpolation approach

Recommended implementation:

1. Clamp to `[-1, 1]`
2. If score is negative, interpolate from yellow to red
3. If score is positive, interpolate from yellow to green
4. If score is zero, use yellow exactly

This is easy to reason about and stable in tests.

## Testing Plan

### Unit tests

Add coverage for:

- all `win` => green extreme
- all `lose` => red extreme
- all `good` => yellow
- mixed values inside the deadband => yellow
- mixed values just outside the deadband => slight tint away from yellow
- unified `count` equals `win + good + lose`
- offense and defense perspectives invert `win` and `lose` correctly

### Integration tests

Verify API payload shape for:

- `good_matchup`
- `imbalanced`
- `unified`

Confirm:

- no regression in existing responses
- unified edges include the extra fields
- filter behavior matches the selected threshold semantics

### Manual browser checks

In DevTools:

- confirm `Unified` tab appears
- confirm link width changes with total vote count
- confirm yellow links exist for connections within the `-0.2..0.2` band
- confirm greener links appear as `win` share increases
- confirm redder links appear as `lose` share increases
- confirm the same connection can look different in `Offense` vs `Defense`
- confirm hover and pinned highlighting still work

## Risks

### Risk: filter semantics become inconsistent across tabs

Today the slider means different things in the two existing views already.

Adding unified makes that more noticeable, so the UI copy should be explicit per view.

### Risk: yellow links may dominate visually

Because the deadband includes `-0.2..0.2`, many balanced connections may stay yellow.

That is probably desirable for the first pass, but if the chart feels too neutral we can tighten the band later.

### Risk: current CSS tone classes are too rigid

The current component expects three fixed tones.

Unified should avoid forcing the color model back into those buckets and instead use direct stroke colors.

## Recommended Rollout

1. Add the `Unified` dataset and edge math in the library.
2. Add the third tab and unified filter/copy in the page.
3. Render unified links with computed stroke colors.
4. Run manual checks in DevTools for both perspectives.
5. Keep existing `Good Matchup` and `Imbalanced` views unchanged unless regressions require small cleanup.

## Clarifying Questions

1. Should `Unified` be added as a third tab, or do you eventually want it to replace `Imbalanced` once we like it?
2. In unified mode, should the slider label explicitly say `Minimum total votes`, even if the legacy tabs keep their current labels?
