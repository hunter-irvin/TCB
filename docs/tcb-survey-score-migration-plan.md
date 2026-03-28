# TCB Survey Score Migration Plan

## Goal

Run a one-time database update that replaces the current TCB player attribute scores with the values derived from the Google Sheet pivot table, while keeping the existing TCB roster rows, player IDs, positions, chemistry, scenarios, and matchup history intact.

This plan also describes how we can rerun the same import later if the sheet gets updated again.

## Confirmed Decisions

- The app roster names are the source of truth. The sheet should not rename players in TCB.
- `Lucas P` from the sheet should map to `Luke P` in TCB.
- `Yonaton` should be skipped.
- `Todd W` should remain in TCB and should not be updated from the sheet.
- We should update the database and app to support decimal attribute scores instead of forcing integer-only values.
- Decimal scores should be stored and displayed to `1` decimal place.
- Manual editing in the roster should remain the current integer `1-5` options.
- If a stored score is decimal, the roster should still visibly show that decimal value.
- If a user changes a decimal score in the app by picking an integer option, the saved value should become that integer with one decimal place, such as `3.0`.
- The DB type for all nine attribute columns should become `numeric(3,1)`.
- If a future rerun finds a player in the sheet who is not in TCB, the importer should skip that player rather than fail the whole run.
- We do not need reusable import software for future reruns. Instead, this plan should describe the manual retrieval, formatting, validation, and apply steps.

## Confirmed Source And Target

### Source sheet

- Spreadsheet ID: `1IxdA0KlPwYWyFbWCuKY0VMSFIPaIv8QXWeIOnwrUMLA`
- Tab: `Pivot Table 2`
- Tab `gid`: `1831535334`
- The tab is publicly accessible and the CSV export route resolves successfully.

### Target data

- Run slug: `TCB`
- Run ID: `11111111-1111-4111-8111-111111111111`
- Table to update: `public.players`
- Columns to replace:
  - `shooting`
  - `driving`
  - `assisting`
  - `man_defense`
  - `help_defense`
  - `shot_blocking`
  - `playmaking`
  - `rebounding`
  - `transition`

## What We Learned From The Pivot Table

The pivot table is structurally close to the TCB Player Roster attributes, but not identical.

### Subcategory columns we can map into TCB

- `3 PT` -> `shooting`
- `Offense Creation` -> `driving`
- `Passing` -> `assisting`
- `On Ball Defense` -> `man_defense`
- `Help Defense` -> `help_defense`
- `Shot Contesting` -> `shot_blocking`
- `Actitvity Level` -> `playmaking`
- `Rebounding` -> `rebounding`
- `Transition Play` -> `transition`

### Total columns present in the sheet but not in TCB

- `Offense Total`
- `Misc Total`
- `Defense Total`
- `Grand Total`

Those totals should be treated as validation and audit data only. They should not be written into `public.players`.

### Name mismatch findings

The sheet has 20 scored player rows and the current TCB run also has 20 players, but only 18 names match exactly.

- Exact matches: 18
- Sheet-only names:
  - `Lucas P`
  - `Yonaton`
- Current TCB-only names:
  - `Luke P`
  - `Todd W`

This means we should not key the import by raw player name alone.

### Resolved name-handling rule

- `Lucas P` -> update `Luke P`
- `Yonaton` -> skip
- `Todd W` -> leave unchanged
- do not rename any player in `public.players` from sheet labels

### Data shape finding

The pivot table stores averaged survey scores as decimals, and we now want to preserve decimals rather than round them back to integers.

That means the app and database need to move from integer-only ratings to decimal ratings before we write the imported scores.

## Recommended Import Strategy

Use a one-time staging workflow:

1. export the pivot table to CSV
2. normalize it into a manually reviewed staging file
3. validate the row and column mappings
4. apply a one-time transactional DB update

Reason:

- the source is an external Google Sheet
- the sheet has extra total columns we must ignore
- the player names need explicit human-reviewed mapping
- the source values are decimals and should remain decimals
- this migration is rare enough that documented manual steps are preferable to building reusable import software

## Manual Mapping Rules

### Player mapping

Use this mapping when preparing the staging data:

| Sheet name | TCB player | Action |
| --- | --- | --- |
| `Lucas P` | `Luke P` | update |
| `Yonaton` | none | skip |

All other player names should match the existing TCB roster directly.

### Attribute mapping

Use this mapping when converting the pivot columns into DB columns:

| Sheet subcategory | DB column |
| --- | --- |
| `3 PT` | `shooting` |
| `Offense Creation` | `driving` |
| `Passing` | `assisting` |
| `On Ball Defense` | `man_defense` |
| `Help Defense` | `help_defense` |
| `Shot Contesting` | `shot_blocking` |
| `Actitvity Level` | `playmaking` |
| `Rebounding` | `rebounding` |
| `Transition Play` | `transition` |

## Implementation Plan

### Phase 1: Lock the mapping rules

1. Confirm the two player-name mismatches.
2. Confirm the decimal storage and editing behavior in the app.
3. Confirm the exact DB column type change for decimal scores.

Recommended default:

- keep existing player IDs
- update only the nine attribute columns
- leave positions, chemistry, scenarios, and matchup history untouched
- do not rename players from sheet labels
- skip unmatched sheet players that are intentionally excluded
- display and store values to `1` decimal place
- keep manual editing as integer-only options
- show decimal values in the roster even though edits stay integer-only
- when edited manually, overwrite decimals with the selected integer as `.0`

### Phase 2: Prepare the one-time staging data manually

1. Export the Google Sheet tab `Pivot Table 2` as CSV using `gid=1831535334`.
2. Copy the exported data into a working sheet or CSV used only for migration prep.
3. Keep only the nine attribute subcategory columns and the player-name row labels.
4. Remove `Offense Total`, `Misc Total`, `Defense Total`, and `Grand Total` from the apply dataset.
5. Rename `Lucas P` to `Luke P` in the staging file.
6. Remove the `Yonaton` row from the staging file.
7. Round every attribute value to `1` decimal place if the exported data has more precision than that.
8. Add each target player's current TCB `id` beside the cleaned player name so the final update is keyed by `id`, not by name.
9. Produce a reviewable before/after diff table showing:
   - player name
   - player id
   - current score per attribute
   - incoming score per attribute
   - delta per attribute
10. Confirm that `Todd W` remains present in TCB but absent from the update set.

The staging step should stop if any unexpected player or attribute label appears.

### Phase 3: Create a rollback snapshot

Before applying updates, capture the current TCB scores.

Minimum rollback artifact:

- export the current `public.players` rows for `run_id = TCB` to a timestamped JSON or CSV file

Better rollback option:

- write the current TCB player rows into a timestamped backup table or temp restore SQL file

At minimum, we should preserve:

- `id`
- `name`
- `row_number`
- all nine attribute columns

Because this change introduces decimal support, the rollback plan should also include the schema migration needed to revert from decimal columns back to integer columns if we decide to undo the feature.

### Phase 4: Apply the DB update transactionally

The one-time SQL update should update existing `public.players` rows in place by `id`.

It should not:

- delete and recreate players
- resequence `row_number`
- touch `eligible_positions`
- touch `player_chemistry`
- touch `scenario_assignments`
- touch `matchup_tinder_responses`

Why this matters:

- current TCB player IDs are already referenced by scenarios, chemistry edges, and matchup responses
- replacing rows instead of updating them would orphan or misattach existing data

Suggested apply pattern:

1. Apply the DB schema change so the nine attribute columns use `numeric(3,1)`.
2. Update the app types and roster rendering so decimal values can be loaded and displayed correctly.
3. Keep roster editing constrained to integer `1-5` choices.
4. Load current TCB players.
5. Validate that every mapped player ID exists in the TCB run.
6. Create a one-time SQL update from the reviewed staging file.
7. In one transaction, update only the mapped players and only the nine attribute columns.
8. Re-read TCB players and compare against the reviewed staging values.

### Phase 5: Post-apply verification

After the update, verify:

- row count in `public.players` for TCB is unchanged
- the same player IDs still exist
- only the nine attribute columns changed
- scenario assignments still point at the same player IDs
- chemistry rows still point at the same player IDs
- a spot check in the TCB roster UI shows the new decimal ratings
- Teams analytics and any sorting based on attributes still behave correctly with decimal values

## Rerun Plan For Future Sheet Updates

If scores need to be refreshed again later, follow the same manual process rather than rerunning software.

### Manual refresh steps

1. Export `Pivot Table 2` from the Google Sheet as CSV.
2. Build a fresh staging sheet from that export.
3. Keep only the nine mapped subcategories.
4. Remove the total columns.
5. Rename `Lucas P` to `Luke P` in the staging sheet.
6. Drop `Yonaton` from the staging sheet.
7. Round values to `1` decimal place.
8. Pull the current TCB player list from `public.players` with `id`, `name`, and current attributes.
9. Join the staging rows to TCB players by exact roster name after the approved name normalization.
10. Produce a before/after diff for human review.
11. Generate a one-time SQL update keyed by `player id`.
12. Run the update in a transaction.
13. Requery `public.players` and verify the written values.
14. Spot-check the Roster and Teams pages in the app.

### Tests for each future refresh

- verify the exported sheet still contains the same nine expected subcategories
- verify no unexpected new player names appear
- verify `Yonaton` is excluded
- verify `Todd W` is not in the update set
- verify every updated row maps to an existing TCB `player.id`
- verify unchanged player count for the TCB run
- verify scenario assignments still reference the same player IDs
- verify chemistry rows still reference the same player IDs
- verify the app loads and displays decimal values without blank or broken attribute controls
- verify a roster cell with a decimal like `3.4` visibly renders as `3.4`
- verify changing a decimal score through the integer editor stores the selected value as `.0`

## Future SQL Template

Use this as a future-reference artifact after the staging sheet has been reviewed and converted into a DB-ready update list.

```sql
begin;

with staged_scores (
  player_id,
  shooting,
  driving,
  assisting,
  man_defense,
  help_defense,
  shot_blocking,
  playmaking,
  rebounding,
  transition
) as (
  values
    -- player_id, shooting, driving, assisting, man_defense, help_defense, shot_blocking, playmaking, rebounding, transition
    (1, 4.2, 4.7, 3.4, 3.1, 3.3, 1.2, 4.0, 3.5, 4.8),
    (7, 3.8, 4.1, 3.0, 4.0, 3.2, 1.7, 3.6, 4.1, 3.9)
)
update public.players as p
set
  shooting = s.shooting,
  driving = s.driving,
  assisting = s.assisting,
  man_defense = s.man_defense,
  help_defense = s.help_defense,
  shot_blocking = s.shot_blocking,
  playmaking = s.playmaking,
  rebounding = s.rebounding,
  transition = s.transition,
  updated_at = now()
from staged_scores as s
where p.id = s.player_id
  and p.run_id = '11111111-1111-4111-8111-111111111111'::uuid;

-- Verification query
select
  id,
  name,
  shooting,
  driving,
  assisting,
  man_defense,
  help_defense,
  shot_blocking,
  playmaking,
  rebounding,
  transition
from public.players
where run_id = '11111111-1111-4111-8111-111111111111'::uuid
  and id in (
    select player_id from staged_scores
  )
order by id;

commit;
```

### Notes for the SQL template

- Only include reviewed TCB player IDs in `staged_scores`.
- Do not include `Yonaton`.
- Do not include `Todd W` unless you explicitly intend to update him in a future refresh.
- Values should already be rounded to `1` decimal place before they go into the SQL.
- Run the verification query before considering the refresh complete.

## Suggested Default Decisions

If we want the simplest safe implementation, I recommend these defaults:

1. Preserve existing TCB player IDs and roster rows.
2. Update only the nine attribute columns.
3. Ignore `Offense Total`, `Misc Total`, `Defense Total`, and `Grand Total` for storage.
4. Treat totals as validation-only fields in the dry-run report.
5. Use explicit human-reviewed name normalization for non-exact names.
6. Support decimal ratings end-to-end in the DB and app.
7. Skip intentionally excluded sheet players such as `Yonaton`.

## Resolved Product Rules

1. Stored decimal values should render visibly in the roster UI.
2. Manual roster edits stay integer-only, and selecting an integer overwrites the stored value as `.0`.
3. The nine player attribute DB columns should use `numeric(3,1)`.
4. Future refreshes should follow the documented manual workflow and may use the SQL template in this doc as a starting artifact.
