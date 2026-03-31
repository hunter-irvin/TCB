# Matchup Visualizer Unified View Implementation

## Status

Implemented.

The matchup visualizer now supports three views:

- `Overall`
- `Fair`
- `Unfair`

`Overall` is the default tab and appears first in the view toggle.

## Current User-Facing Behavior

### Views

- `Overall` combines all play-mode matchup responses.
- `Fair` shows only responses marked `good_matchup`.
- `Unfair` shows only imbalanced responses, using the existing net-margin logic.

### Perspectives

- `Offense`
- `Defense`

The same directed player connection can render differently across the two perspectives because `win` and `lose` invert by perspective.

### Layout

The visualizer now has:

- the chart on the left
- a compact settings panel on the right

The settings panel contains:

- the vote counter
- the legend
- the minimum-vote slider

On small screens, the settings panel stacks below the chart.

## Implemented Naming

On this page, the terminology is now:

- `Overall`
- `Fair`
- `Unfair`

This rename was applied to:

- tab labels
- vote-count labels
- legend text
- empty-state text
- slider labels
- aria labels for the chart

Internal data values still use:

- `good_matchup`
- `imbalanced`
- `overall`

The rename is presentation-layer only.

## Implemented Data Model

Relevant files:

- [lib/matchup-visualizer.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/lib/matchup-visualizer.ts)
- [components/matchup-visualizer-page.tsx](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/components/matchup-visualizer-page.tsx)
- [app/api/[run]/matchup-visualizer/chord/route.ts](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/app/api/[run]/matchup-visualizer/chord/route.ts)
- [app/globals.css](/c:/Users/irvinh/OneDrive%20-%20Jacobs%20Engineering%20Group%20Inc/Desktop/Repos/TCB/TCB/app/globals.css)

The visualizer bundle now includes:

- datasets for `good_matchup`, `imbalanced`, and `overall`
- richer edge metadata for unified color rendering
- raw vote totals per view for the top-right counter

### Edge fields now used by `Overall`

- `count`
- `voteTotal`
- `tone`
- `winVotes`
- `goodVotes`
- `loseVotes`
- `rawScore`
- `normalizedScore`
- `colorHex`

### Raw vote totals

The bundle response now includes:

- `rawVoteTotals.overall`
- `rawVoteTotals.good_matchup`
- `rawVoteTotals.imbalanced`

This is used so the unselected vote counter shows the true underlying total for the current view rather than the sum of filtered chart edges.

## Implemented Math

For each directed player connection:

- `winVotes`
- `goodVotes`
- `loseVotes`

Where:

- in `Offense`, `offense_wins` counts as `win` and `defense_wins` counts as `lose`
- in `Defense`, `defense_wins` counts as `win` and `offense_wins` counts as `lose`

### Raw score

`rawScore = (winVotes - loseVotes) / totalVotes`

Where:

`totalVotes = winVotes + goodVotes + loseVotes`

### Good deadband

Implemented deadband:

- `MATCHUP_VISUALIZER_GOOD_DEADBAND = 0.3`

That means:

- scores from `-0.3` to `+0.3` are treated as the middle `Fair` zone
- only values outside that range move toward red or green

### Normalization

The current helper behaves like:

```ts
function normalizeUnifiedColorScore(rawScore: number) {
  const deadband = 0.3;

  if (rawScore <= -deadband) {
    return (rawScore + deadband) / (1 - deadband);
  }

  if (rawScore >= deadband) {
    return (rawScore - deadband) / (1 - deadband);
  }

  return 0;
}
```

This produces:

- `0` for the full fair zone
- negative values outside the fair zone on the lose side
- positive values outside the fair zone on the win side

## Implemented Color Behavior

### Overall

`Overall` uses a continuous red-yellow-green spectrum:

- red: lose-leaning
- yellow: fair / balanced
- green: win-leaning

Current base stops:

- red: `#dc2626`
- yellow: `#facc15`
- green: `#16a34a`

Links use direct inline stroke colors from `edge.colorHex`, not only the older fixed tone classes.

### Fair

`Fair` uses a yellow-only legend and neutral fair-link rendering.

### Unfair

`Unfair` keeps the legacy positive/negative treatment:

- green for wins
- red for loses

## Implemented Width Behavior

### Overall

In `Overall`:

- link width represents `totalVotes`

### Fair

In `Fair`:

- link width represents `goodCount`

### Unfair

In `Unfair`:

- link width represents `abs(winVotes - loseVotes)`

## Implemented Filter Behavior

The slider meaning now depends on the current view.

### Overall

- slider filters by minimum `totalVotes`
- label shown to the user: `Minimum total votes`

### Fair

- slider filters by minimum fair votes
- label shown to the user: `Minimum fair votes`

### Unfair

- slider filters by minimum unfair net margin
- label shown to the user: `Minimum unfair threshold`

## Implemented Counter Behavior

### When no player is selected

The vote counter now uses the raw total for the current view:

- `Overall` = all play responses in scope
- `Fair` = all `good_matchup` responses in scope
- `Unfair` = all imbalanced responses in scope

For the current TCB dataset at the time of implementation, those totals are:

- `Overall`: `1038`
- `Fair`: `415`
- `Unfair`: `623`

### When a player is selected

The counter continues to show the selected player’s outgoing visible vote total for the current filtered dataset.

That behavior was intentionally preserved.

## Implemented Legend Behavior

### Overall

The `Overall` legend uses:

- a spectrum from red to yellow to green
- a solid yellow middle band
- subtle tick marks at the fair-zone boundaries

Because the fair deadband is `±0.3`, the legend visually maps that as:

- yellow band from `35%` to `65%`
- tick marks at those two boundaries

Legend labels:

- `Loses`
- `Fair`
- `Wins`

### Fair

The `Fair` legend shows:

- yellow swatch
- label `Fair`

### Unfair

The `Unfair` legend shows:

- green swatch with `Wins`
- red swatch with `Loses`

## Implemented Layout Behavior

### Desktop

The chart area uses a two-column layout:

- chart on the left
- compact settings panel on the right

### Mobile

Below the mobile breakpoint, the layout stacks:

1. chart
2. settings panel

This preserves the chart as the primary visual focus.

## Verification Performed

### Code-level verification

- `npx tsc --noEmit` passed after implementation changes

### Live browser verification completed earlier in the implementation

Verified in DevTools:

- `Overall` tab renders
- `Offense` and `Defense` both work
- `Overall` uses a true multi-step gradient, not only the legacy three-tone classes
- exact yellow links appear in the fair band
- multiple distinct gradient colors render across the chart

### Data verification

Confirmed from the database:

- total play rows: `1038`
- fair / `good_matchup` rows: `415`
- unfair / imbalanced rows: `623`

## Notes

- Internal code still uses `good_matchup` and `imbalanced` for compatibility and because those values map directly to stored result semantics.
- The page labels intentionally use `Fair` and `Unfair` because they read better in the visualizer UI.
- The current doc reflects implemented behavior, not just proposal state.
