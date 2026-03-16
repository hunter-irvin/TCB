# Matchup Tinder Feature Plan

## Goal

Add a third product surface called `Matchup Tinder` that lets anonymous visitors give quick matchup feedback on randomly generated player pairs from the current roster.

This feature should:

- add a new route and tab entry for `Matchup Tinder`
- hide the primary menu while users are on the `Matchup Tinder` page itself
- present two players at a time in a mobile-first interaction flow
- assign one player to `Offense` and one to `Defense`
- let users respond with:
  - left player wins
  - right player wins
  - good matchup
  - skip
- use a draggable basketball interaction as the primary input
- save all responses in the backend for future team-balancing analysis
- support a `Test` / `Play` toggle with `Test` selected by default
- include lightweight feedback and transition animations between rounds

## Confirmed Product Decisions

- `Test` mode should write to the database with a `test` flag.
- `Play` mode should write to the same response dataset with a `play` flag.
- Offense should always render on the left.
- Defense should always render on the right.
- The two players themselves should still be randomized.
- `Skip` should not be stored in the database.
- The same visitor should not see the same directional matchup twice within the same page session when possible.
- All visitors should be treated equally.
  - no auth
  - no cookies
  - no persisted user/session identity

## Product Shape

### Routing and Navigation

Recommended route:

- `/matchup-tinder`

Recommended navigation behavior:

- show `Matchup Tinder` as a third tab alongside `Roster` and `Teams`
- keep the tab visible on `Roster` and `Teams`
- hide the primary tab bar entirely on `/matchup-tinder`

This matches the requirement that the page is reachable from the app, but once a visitor is inside the flow they are not encouraged to leave it.

### Page Framing

Recommended page title:

- `Matchup Tinder`

Recommended page copy:

- one short sentence explaining that visitors should choose who wins the possession or mark it as a good matchup

Because the nav is hidden on this page, the screen should feel more like a focused interaction surface than an admin tool.

## Core User Experience

### Mobile-First Layout

The page should be designed for phone screens first and scale up gracefully to desktop.

Recommended structure:

- top toggle:
  - `Test`
  - `Play`
- matchup card area
- draggable basketball in the center
- large, clearly labeled left and right player zones
- `Good Matchup` target above the ball
- `Skip` button pinned near the bottom

### Matchup Presentation

Each round should show:

- Player A card
  - player name
  - role badge: `Offense` or `Defense`
  - optional small metadata later if needed
- Player B card
  - player name
  - role badge: `Offense` or `Defense`
- draggable basketball centered between them

Recommended round generation rules:

- choose two distinct players from the current roster
- require both players to have a non-empty name
- assign one player offense and the other defense
- always render offense on the left
- always render defense on the right

### Input Model

Primary interaction:

- drag the basketball:
  - left for left player wins
  - right for right player wins
  - up for good matchup

Secondary interaction:

- tap targets as a fallback for accessibility and non-drag users

Skip interaction:

- `Skip` button advances immediately to the next round
- skip does not write a backend row

### Motion and Feedback

Recommended lightweight animations:

- subtle scale-up and glow when the basketball is picked up
- clear snap animation toward the selected target
- short confirmation pulse on the winning target
- quick card transition between rounds:
  - fade
  - slide
  - staggered entrance for the next pair

These animations should stay short enough that repeated use still feels fast.

## Video Integration Plan

### Recommendation Summary

- Use looping `mp4` files, not `gif`.
- Keep the videos in the repo under a static `public` folder for phase one.
- Treat them as decorative demo loops, not interactive media.
- Render one video inside the offense card and one inside the defense card.

### Format Recommendation

Best phase-one format:

- `mp4`
  - H.264 video codec
  - no audio track if possible

Why `mp4` is the best fit here:

- much smaller than `gif` for short motion clips
- better visual quality at the same file size
- straightforward browser support
- works cleanly with `autoPlay`, `muted`, `loop`, and `playsInline`

Recommended element attributes:

- `autoPlay`
- `muted`
- `loop`
- `playsInline`
- `preload="metadata"`

Recommended non-goals for phase one:

- no controls
- no click behavior
- no audio

### File Size Guidance

Current starting point:

- about `1.8 MB` each
- about `3.6 MB` total if both videos are loaded

This is workable for a prototype, but it is a little heavier than ideal for a page that is meant to feel instant on mobile.

Recommended target if compression is easy:

- ideally under `1.0 MB` each
- acceptable up to about `1.5 MB` each for phase one

Recommendation:

- keep the current files for the first pass if they already look good
- compress them once if we can do so without making them blurry
- avoid repeated re-exports that materially reduce quality

### Hosting Recommendation

Recommended phase-one location:

- `public/matchup-tinder/offense-demo.mp4`
- `public/matchup-tinder/defense-demo.mp4`

Why this is the best fit right now:

- simplest setup in Next.js
- no extra storage configuration
- easy to version with the rest of the feature
- small enough that git repo growth is still reasonable for two files

Recommended future upgrade only if needed later:

- move media to Supabase Storage or a CDN-backed asset host if files get larger, more numerous, or are revised often

### UI Integration Recommendation

Recommended placement inside each player lane:

- add a media frame near the top of the offense lane
- add a media frame near the top of the defense lane
- keep the role badge and player name below the video so the page still reads clearly

Recommended visual treatment:

- same rounded card language as the existing lane
- subtle border and shadow
- `object-fit: cover`
- fixed aspect ratio so the layout does not jump while loading

Recommended behavior:

- videos should not intercept pointer input
- drag interactions should still belong to the basketball only
- if a video fails to load, the card should still look intact without breaking the flow

### Accessibility and Performance Notes

Recommended implementation details:

- mark the videos decorative if they do not add unique content
- avoid captions because they are examples, not primary instructional content
- respect reduced-motion preferences if the loops feel distracting
  - optional phase-two enhancement: show a poster frame instead of autoplay when `prefers-reduced-motion` is enabled

### Media File Workflow

If the source files live in `Downloads`, the simplest PowerShell flow will be:

```powershell
New-Item -ItemType Directory -Force public\matchup-tinder
Copy-Item "C:\Users\irvinh\Downloads\offense.mp4" "public\matchup-tinder\offense-demo.mp4"
Copy-Item "C:\Users\irvinh\Downloads\defense.mp4" "public\matchup-tinder\defense-demo.mp4"
git add public\matchup-tinder\offense-demo.mp4 public\matchup-tinder\defense-demo.mp4
```

If you want, once you give me the exact file paths, I can tailor the commands to your filenames.

### Current Asset Status

Current repo asset state:

- `public/matchup-tinder/offense-demo.mp4`
  - staged in git
  - current size: `1,512,804` bytes
- `public/matchup-tinder/defense-demo.mp4`
  - staged in git
  - current size: `1,736,544` bytes

This means static hosting setup is already complete and the remaining work is integration plus verification.

### Remaining Video Integration Steps

#### Step 1: Asset Preparation

- confirm these staged files are the final offense and defense clips
- optionally remove audio tracks later if present, but do not block phase one on that
- keep the current file names:
  - `offense-demo.mp4`
  - `defense-demo.mp4`

#### Step 2: Matchup Tinder Layout Update

- add a media container to each lane in `components/matchup-tinder-page.tsx`
- place the loop above the player name and role content
- keep enough breathing room so the cards still read cleanly on narrow screens

#### Step 3: Playback Configuration

- render each clip in a native `<video>` element
- use these sources:
  - `/matchup-tinder/offense-demo.mp4`
  - `/matchup-tinder/defense-demo.mp4`
- enable `autoPlay`, `muted`, `loop`, and `playsInline`
- use `preload="metadata"`
- disable pointer interaction on the video layer

#### Step 4: Styling and Fallbacks

- add a fixed aspect ratio frame in `app/globals.css`
- use `object-fit: cover`
- give the media frame a visual treatment that matches the existing lane cards
- make sure the page still looks good if the video has not loaded yet

#### Step 5: Interaction Regression Check

- verify the videos do not interfere with dragging or tapping the basketball
- verify the added media height does not crowd the `Good Matchup` target or the skip button
- verify the offense video stays in the offense lane and the defense video stays in the defense lane

#### Step 6: Verification and Commit Readiness

- verify both videos autoplay on mobile and desktop
- verify both loops remain muted
- verify basketball drag still works normally
- verify videos do not block click or drag targets
- verify layout remains balanced across small and wide screens
- verify the page still feels responsive on slower connections
- run `npx tsc --noEmit`
- if all checks pass, commit the UI changes together with the already staged video assets

## Backend Data Model

### Recommended Storage Approach

Because this is public anonymous feedback, the safest long-term option is still to write through a server-owned API route instead of inserting directly from the browser into Supabase.

Recommended flow:

1. client requests a matchup
2. client submits a response to a Next route handler
3. route validates payload and writes to Supabase
4. route returns the next matchup payload

This creates a cleaner place for:

- validation
- simple matchup generation
- later analysis helpers

### Recommended Tables

#### `public.matchup_tinder_responses`

Purpose:

- store one user judgment per answered matchup

Recommended fields:

- `id bigint generated always as identity primary key`
- `offense_player_id bigint not null references public.players(id) on delete cascade`
- `defense_player_id bigint not null references public.players(id) on delete cascade`
- `result text not null check (result in ('offense_wins', 'defense_wins', 'good_matchup'))`
- `mode text not null check (mode in ('test', 'play'))`
- `created_at timestamptz not null default now()`
- `matchup_key text not null`

Recommended constraints:

- check `offense_player_id <> defense_player_id`
- check `matchup_key = concat(offense_player_id, ':', defense_player_id)`

Recommended indexes:

- index on `(offense_player_id, defense_player_id)`
- index on `(mode, result)`
- index on `created_at`
- optional composite index on `(offense_player_id, defense_player_id, mode, result)`

This simplified table is better aligned with the future analysis goal because the unit of analysis is the directional pair:

- offense player
- defense player
- response result
- mode

### Optional Future View

If we later want easier reporting, we can add a summary view such as `matchup_tinder_pair_summary` that aggregates:

- total responses
- offense win count
- defense win count
- good matchup count
- good matchup rate
- offense win rate

## Matchup Generation Strategy

### Phase-One Recommendation

Generate matchups live from the current roster rather than precomputing a full queue.

Recommended rules:

- only include named players
- exclude self-matchups
- prefer directional pairs the current page session has not seen yet
- allow repeats only after the unseen pool is exhausted

Recommended implementation detail:

- treat offense-vs-defense as directional
  - `Player A offense vs Player B defense` is a different matchup from `Player B offense vs Player A defense`

This keeps the collected data aligned with real matchup judgments.

### Repeat Avoidance Without User Tracking

Because we do not want cookies or persisted session identity, repeat prevention should be handled only inside the active browser page session.

Recommended approach:

- maintain an in-memory set of seen directional matchup keys in the page component
- reset the seen set on a fresh visit or page reload for phase one

This satisfies the product goal without introducing user identity or persistent anonymous tracking.

## Frontend Architecture

### Route and Page Files

Likely additions:

- `app/matchup-tinder/page.tsx`
- `components/matchup-tinder-page.tsx`

Likely shared updates:

- `components/app-shell.tsx`
- `app/page.tsx`
- `app/globals.css`

### App Shell Changes

Recommended changes:

- add a third tab entry for `Matchup Tinder`
- add an option to hide the nav for focused pages
- reuse the existing shell styling where helpful, but allow this page to feel more immersive and mobile-first

## API and Sync Design

### Recommended Endpoints

Use route handlers under `app/api/matchup-tinder`.

Recommended endpoints:

- `GET /api/matchup-tinder/next`
  - returns the next unanswered matchup candidate for the current page session
- `POST /api/matchup-tinder/respond`
  - validates and records the response
  - returns success plus the next matchup payload

### Request Payload Shape

Recommended `POST /respond` payload:

- `offensePlayerId`
- `defensePlayerId`
- `result`
  - `offense_wins`
  - `defense_wins`
  - `good_matchup`
- `mode`
  - `test`
  - `play`

Recommended `GET /next` input:

- current `mode`
- optional exclude list of seen `matchup_key` values from the current page session

Because the total roster is small, an exclude list is feasible for phase one.

## Accessibility and Input Fallbacks

The drag interaction should not be the only way to respond.

Required fallback behavior:

- keyboard-operable target buttons
- clear visible labels for the response zones
- skip button always reachable
- reduced-motion friendly transition behavior

## Analytics Usefulness

To make the data useful later for fairness tuning, each stored response should preserve:

- offense player ID
- defense player ID
- the visitor-selected result
- mode
- timestamp
- directional matchup key

This allows later analysis such as:

- which offensive players are consistently judged advantaged
- which defensive players are consistently judged disadvantaged
- which pairings are most often marked `good matchup`
- which directional offense-vs-defense pairs are rarely considered fair

This does change the originally suggested data model:

- we no longer need a sessions table
- we no longer need `left_player_id` and `right_player_id` in storage because presentation is fixed
- we should store a directional matchup key or equivalent indexed pair fields so pair analysis is straightforward later

## Implementation Phases

### Phase 1: Route and Shell Setup

- add `/matchup-tinder` page route
- add `Matchup Tinder` as the third tab
- update `AppShell` to support hidden nav on this page
- verify roster and teams still behave normally

### Phase 2: Matchup Tinder UI Shell

- build the page layout
- add the `Test` / `Play` toggle with `Test` default
- add player cards, role badges, drag area, and skip button
- ensure layout feels native on mobile first

### Phase 3: Interaction Model

- implement drag gesture handling for the basketball
- add tap and keyboard fallbacks
- add completion feedback and transition animations
- load the next matchup after each response
- keep an in-memory set of seen matchup keys so repeats are avoided within the active page session

### Phase 4: Backend Persistence

- add Supabase schema for matchup responses
- add API route handlers for fetching and submitting matchups
- validate payloads on the server
- persist both response result and mode
- do not persist skip actions

### Phase 5: Matchup Generation Logic

- generate valid random matchups from the current roster
- avoid same-player pairings
- minimize repeats within the active page session
- preserve offense/defense directionality
- always render offense left and defense right

### Phase 6: Verification

- verify anonymous visitors can complete multiple rounds
- verify `Test` is the default
- verify `Play` and `Test` are stored distinctly
- verify drag, tap, keyboard, and skip all work
- verify skip advances without creating a response row
- verify menu is hidden on the page
- verify responses land in Supabase with correct player IDs and roles
- verify offense is always left and defense is always right
- verify the same page session does not repeat directional pairs until the available pool is exhausted
- verify next-round transitions feel fast on mobile

## Acceptance Criteria

- App shows a third entry for `Matchup Tinder`.
- Visiting `/matchup-tinder` hides the main nav.
- Page works well on mobile and remains usable on desktop.
- Each round shows two distinct players, one offense and one defense.
- Users can select:
  - left wins
  - right wins
  - good matchup
  - skip
- Basketball drag interaction works for the three non-skip outcomes.
- A non-drag fallback exists for accessibility.
- `Test` / `Play` toggle appears at the top and defaults to `Test`.
- Anonymous responses persist to the backend with `mode = 'test'` or `mode = 'play'`.
- Offense always appears on the left and defense always appears on the right.
- Skip advances the flow without storing a backend row.
- Stored rows include enough context to analyze matchup fairness later.
- Lightweight confirmation and next-round animations run without making the flow feel slow.

## Main Risks

- Because we are not persisting any visitor/session identity, repeat avoidance only applies within the active page session and resets on reload.
- A drag-first interaction can become frustrating if tap and keyboard fallbacks are weak.
- If matchups repeat too often, visitors may stop engaging quickly.
- If the page reuses the existing admin shell too literally, it may not feel focused enough for public participation.
