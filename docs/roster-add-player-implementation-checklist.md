# Roster Add/Delete Player Implementation Checklist

## Goal

Add support for an unbounded roster so users can:

- append new players beyond the original 20 seeded rows
- delete players from the roster
- persist adds and deletes to Supabase
- automatically clear deleted players from team assignments
- keep incomplete players visible on the Teams page

This feature continues to avoid authentication. Any user can add, edit, and delete players.

## Confirmed Product Decisions

- Roster size is no longer capped at 20.
- New players are appended to the bottom of the roster.
- The roster page gets an `Add player` button at the bottom of the table.
- A new player only requires a `name`.
- New players start with empty positions.
- New players start with blank attribute ratings.
- Each roster row gets a delete control revealed on hover.
- Deleting a player removes them from:
  - roster state
  - Supabase
  - any team assignments or scenarios that reference them
- Incomplete players should still be visible on the Teams page.
- Players remain assignable only when they satisfy slot rules.

## Implementation Checklist

### Phase 1: Remove fixed roster assumptions

- [ ] Replace hard dependencies on `ROSTER_SIZE = 20` in the roster editing flow.
- [ ] Keep the initial 20 seeded players as the default baseline, but stop treating 20 as a runtime maximum.
- [ ] Update player sanitization so it preserves variable-length rosters.
- [ ] Preserve `rowNumber` as the canonical append/order field.
- [ ] Confirm sorting logic still operates on dynamic player arrays.

### Phase 2: Extend the data and state model

- [ ] Add a builder action for creating a player.
- [ ] Add a builder action for deleting a player.
- [ ] Define how new players receive a stable `id`.
- [ ] Define how new players receive `rowNumber = max(rowNumber) + 1`.
- [ ] Ensure new players are initialized with:
  - `name`
  - empty `positions`
  - empty attributes
- [ ] Ensure deleting a player prunes all assignment references in memory.
- [ ] Ensure local storage persistence handles variable-length rosters correctly.

### Phase 3: Update Supabase schema and sync behavior

- [ ] Add a migration that supports safe creation of new player IDs from the database.
- [ ] Preserve existing player IDs so current scenario references remain valid.
- [ ] Keep `row_number` unique and append-based.
- [ ] Update the player write path so it handles:
  - inserts
  - updates
  - deletes
- [ ] Detect deleted player IDs during sync instead of relying on upsert-only behavior.
- [ ] Delete removed players from Supabase.
- [ ] Verify realtime roster refresh still works after create and delete operations.

### Phase 4: Add roster UI for player creation

- [ ] Add an `Add player` action below the roster table.
- [ ] Match the visual pattern used for the team-scenario add action.
- [ ] Append a new row at the bottom when the button is clicked.
- [ ] Focus the new player name input after creation.
- [ ] Ensure the new row appears correctly in both unsorted and sorted views.

### Phase 5: Add hover delete UI

- [ ] Add a right-side actions column to the roster table.
- [ ] Add a delete button for each row.
- [ ] Reveal the delete button on row hover.
- [ ] Keep the button discoverable and usable on touch or non-hover devices.
- [ ] Confirm the delete action targets the correct player even when the table is sorted.

### Phase 6: Delete behavior and assignment cleanup

- [ ] Remove deleted players from roster state immediately.
- [ ] Clear deleted players from all team assignments immediately.
- [ ] Clear deleted players from all saved scenarios immediately.
- [ ] Sync the deletion to Supabase.
- [ ] Verify deleted players do not reappear after realtime refresh or page reload.

### Phase 7: Teams page visibility and assignability

- [ ] Keep incomplete players visible on the Teams page.
- [ ] Separate player visibility from slot eligibility.
- [ ] Ensure players with no eligible position are visible but not assignable to slots.
- [ ] Ensure players with no name are handled consistently if temporary blank states exist.
- [ ] Confirm the available-player list and slot dropdown behavior still make sense with incomplete players.

### Phase 8: UX and regression coverage

- [ ] Confirm roster editing still works for seeded players.
- [ ] Confirm sorting still works after add and delete operations.
- [ ] Confirm row numbering/order remains stable after deletes.
- [ ] Confirm assignments remain valid after roster mutations.
- [ ] Confirm local-state fallback still works if backend sync fails.
- [ ] Confirm backend retry behavior still works for adds and deletes.
- [ ] Confirm no layout breakage on desktop or mobile.

## Suggested Task Order

- [ ] Implement the database migration first.
- [ ] Refactor state management for dynamic roster length.
- [ ] Add create-player behavior.
- [ ] Add delete-player behavior.
- [ ] Update Supabase sync to support deletion.
- [ ] Add roster UI controls.
- [ ] Adjust Teams page visibility rules.
- [ ] Run regression testing across roster, teams, sync, and reload flows.

## Acceptance Criteria

- [ ] Users can add players beyond 20 with no cap.
- [ ] Clicking `Add player` appends a new row at the bottom of the roster.
- [ ] New players persist to Supabase and remain after reload.
- [ ] New players start with blank positions and blank ratings.
- [ ] Hovering a roster row reveals a delete button on the far right.
- [ ] Deleting a player removes them from the roster immediately.
- [ ] Deleting a player removes them from Supabase.
- [ ] Deleting a player removes them from all team assignments and scenarios.
- [ ] Incomplete players are still visible on the Teams page.
- [ ] Incomplete players cannot be assigned to invalid slots.
- [ ] Existing seeded players and existing scenarios continue to work after the migration.

## Main Risks

- Deletion is a behavioral change from the current upsert-only player sync flow.
- Existing scenario assignments reference `player_id`, so ID migration must be backward-compatible.
- Teams page logic currently couples visibility and eligibility in some places, which may require a careful refactor.
- Hover-only controls can create usability gaps on touch devices if no fallback is provided.
