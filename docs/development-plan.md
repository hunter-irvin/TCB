# Tournament Team Builder Development Plan

## Scope

Build a desktop-first interactive web app, deployable to Vercel and runnable locally with `npm run dev`, for drafting tournament team configurations.

Core requirements:

- Two pages: `Roster` and `Teams`
- `Roster` shows 20 fixed rows with columns `#`, `Name`, and `Position`
- `#` is read-only row count
- `Name` is editable
- `Position` is a multiselect with values `1` to `5`
- `Teams` shows four hardcoded teams:
  - Dave's Dawgs
  - Alon's Rangers
  - Juwan's Jackets
  - Eric's Enforcers
- Each team has five position slots
- A player can only occupy one team slot at a time
- Teams page supports drag-and-drop between available slots
- Dropping a player into a new valid slot removes them from their previous slot
- If dropped onto an occupied slot, the dropped player replaces the existing player and the previous occupant is cleared
- Only players eligible for a slot's position should appear in dropdowns
- Seed the app on first load from `data/seed-roster.csv`
- Persist changes locally for now

## Recommended Stack

- Next.js with App Router
- TypeScript
- React client components for roster editing and drag-and-drop interaction
- Lightweight CSS approach:
  - CSS modules or global CSS with custom properties
  - No backend for v1
- Browser `localStorage` for persistence

Rationale:

- Vercel-native deployment
- Easy local development with `npm run dev`
- Enough structure for route-based pages and future migration to a backend

## Data Model

### Player

- `id: number`
- `rowNumber: number`
- `name: string`
- `positions: number[]`

### Team Assignment

- `teamId: string`
- `position: number`
- `playerId: number | null`

### App State

- `players: Player[]`
- `assignments: Record<string, Record<number, number | null>>`
- `seedVersion: string`

Behavior rules:

- A player may be rostered in multiple eligible positions but can only be assigned to one team slot total
- Dropdown options exclude already-assigned players
- Dragging a player to a valid new slot moves them
- Replacing an occupied slot clears the displaced player instead of auto-swapping

## Execution Plan

### 1. Scaffold the app

Tasks:

- Initialize a Next.js TypeScript app in this repo
- Add npm scripts for local development and production build
- Set up route structure for `/roster` and `/teams`
- Add shared layout and top navigation tabs

Testing:

- Run `npm install`
- Run `npm run dev`
- Open the app locally and confirm both pages render without errors
- Run `npm run build` to verify Vercel-ready production output

### 2. Add seed data loading

Tasks:

- Add a CSV parsing utility for `data/seed-roster.csv`
- Convert the CSV rows into initial `Player` records
- Define first-load behavior:
  - If no saved local data exists, initialize from CSV
  - If saved data exists, use saved data
- Store a seed version key so the seed format can evolve safely later

Testing:

- Clear browser local storage and confirm the roster loads all 20 seeded players
- Verify names and positions match the CSV exactly
- Refresh the page and confirm the seed is not re-applied over edited data

### 3. Build the Roster page

Tasks:

- Render a 20-row table-like layout
- Lock the `#` column to row numbers 1 through 20
- Make `Name` editable per row
- Implement a multiselect control for positions `1` through `5`
- Support empty names and multiple positions during editing

Testing:

- Edit several names and confirm they persist after refresh
- Add and remove multiple positions for a player
- Verify row numbers remain fixed and uneditable
- Confirm exactly 20 rows render at all times

### 4. Build shared assignment logic

Tasks:

- Create selectors/helpers for:
  - available players by position
  - whether a player is already assigned
  - lookup of a player's current team slot
- Define assignment actions:
  - assign from dropdown
  - clear slot
  - move player between slots
  - replace slot occupant

Testing:

- Unit test or manually verify each state transition
- Confirm no player can end up in two team slots at once
- Confirm replacing a slot clears the previous occupant cleanly

### 5. Build the Teams page

Tasks:

- Render four team columns/cards with the hardcoded team names
- Render five position rows under each team
- Add dropdown assignment per slot
- Limit dropdown options to players eligible for that position and not already assigned elsewhere
- Show assigned players as chips/cards inside slots

Testing:

- Confirm each team shows positions 1 through 5
- Confirm dropdowns only show valid available players
- Assign players across teams and verify duplicate assignment is blocked
- Clear an assignment and confirm the player becomes available again

### 6. Add drag-and-drop interactions

Tasks:

- Make assigned player chips draggable
- Make team position cells droppable targets
- Snap dragged chips visually into the nearest valid cell
- On drop:
  - move the dragged player into the target slot
  - clear the origin slot
  - if target occupied, remove the previous occupant
- Prevent drops into invalid position cells

Testing:

- Drag a player to an empty valid slot and confirm they move
- Drag a player to an occupied valid slot and confirm replacement behavior
- Drag a player to an invalid slot and confirm no state change
- Repeat with multiple consecutive moves to catch stale-state bugs

### 7. Persist app state locally

Tasks:

- Save roster and team assignments to `localStorage`
- Hydrate client state safely on load
- Add reset behavior for development if needed

Testing:

- Refresh after edits and confirm both pages retain state
- Close and reopen the browser and confirm saved state remains
- Reset local data and confirm the app falls back to CSV seed state

### 8. Style the desktop-first UI

Tasks:

- Match the visual direction from the provided mockups
- Use a green field-style background and clear card/table contrast
- Make the roster resemble a lightweight spreadsheet
- Make the teams board readable and easy to scan on desktop widths

Testing:

- Check layout at common desktop widths
- Verify text remains legible and controls are usable
- Confirm drag-and-drop targets are visually obvious

### 9. Rework for mobile as needed

Tasks:

- Adapt navigation, table/card spacing, and team layout for smaller screens
- Decide whether teams stack vertically or scroll horizontally
- Preserve usability of dropdowns and touch interactions

Testing:

- Test responsive behavior in browser devtools
- Verify the roster remains editable on narrow screens
- Verify team assignment remains understandable on touch-sized layouts

### 10. Final verification and deployment

Tasks:

- Clean up code structure and naming
- Add a short README with local run and deploy steps
- Push to repo and connect to Vercel

Testing:

- Run `npm run lint` if configured
- Run `npm run build`
- Smoke test deployed Vercel app
- Confirm seeded first-run experience works in a fresh browser session

## Development Task List

1. Scaffold the Next.js TypeScript app and confirm `npm run dev` works locally.
2. Add the roster CSV loader and initialize app state from the seed data.
3. Build the desktop navigation and shared state store.
4. Implement the Roster page editing experience.
5. Implement the Teams page dropdown assignment flow.
6. Add assignment guards so players can only exist in one team slot.
7. Add drag-and-drop movement and replacement behavior.
8. Add local persistence and reset support.
9. Style the desktop UI to match the references.
10. Test desktop flows end to end.
11. Rework layout and interactions for mobile.
12. Run final local verification and prepare for Vercel deployment.

## Acceptance Criteria

- App runs locally with `npm run dev`
- App builds successfully for Vercel
- Two pages exist: `Roster` and `Teams`
- Roster initializes from CSV on first load
- Roster supports editing names and positions
- Teams page supports dropdown assignment by valid position
- No player can occupy more than one team slot at once
- Drag-and-drop move and replacement behavior works
- State persists locally across refreshes
