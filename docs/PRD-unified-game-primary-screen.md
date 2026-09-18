# PRD — Unified Game Primary Screen + Premium Chat/Friends Interaction

**Revision v2** — supersedes the earlier 4-column desktop version. This revision defines the corrected **3-column desktop architecture**: one large primary Spin the Bottle/Profile column + two smaller social columns on the same row on desktop, while mobile replaces those social columns with two theme-colored SVG actions.

---

## 1. Overview

The Game Primary Screen is the ONE screen every Quicky game opens into. Spin the Bottle, Quicky Ludo and every future game render the same `GamePrimaryScreen`, driven entirely by a `GamePrimaryConfig` — no hardcoded game-specific UI logic.

The screen carries two social surfaces — **Game Chats** and **My Friends** — and the bottom Game Chats section of the old Spin the Bottle landing is removed. What changes in v2 is **where those social surfaces live**:

- **Desktop (large screens):** two dedicated, always-visible social columns sit beside the main profile column.
- **Mobile / Capacitor:** the social columns are replaced by two theme-colored SVG icon actions (💬 Chat, 👥 Friends) above the profile, opening full-screen flows.

## 2. Information architecture

The hierarchy is NOT four equal columns. The structure is:

```text
                  MAIN CONTENT
                       │
       ┌───────────────┴───────────────┐
       │                               │
   PROFILE AREA                    SOCIAL AREA
       │                               │
       │                       ┌───────┴───────┐
       │                       │               │
       │                  GAME CHATS      MY FRIENDS
       │
       ├── Profile Image
       ├── User / Level
       ├── Statistics
       ├── Play Now
       ├── Group / Meet someone new
       ├── Your Progress
       └── How It Works
```

## 3. Desktop layout (large screens) — 3 columns

```text
                         SPIN THE BOTTLE

┌───────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────┐   ┌─────────────────┐ ┌────────────┐ │
│  │             PROFILE                 │   │   GAME CHATS    │ │ MY FRIENDS │ │
│  │          Profile Image              │   │                 │ │            │ │
│  │          You                        │   │  Chat preview   │ │ Friend     │ │
│  │          Level 1                    │   │                 │ │ preview    │ │
│  │   ❤️ 6  🎮 40  🪙505  ✨0  🎁0  🎁14│   │                 │ │            │ │
│  │            Play Now                 │   │                 │ │            │ │
│  │      Group / Meet someone new       │   │                 │ │            │ │
│  │          Your Progress              │   │                 │ │            │ │
│  │           How it works              │   │                 │ │            │ │
│  └─────────────────────────────────────┘   └─────────────────┘ └────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Column proportions — all three cards occupy the MAXIMUM width of the screen (no max-width cap), and the main profile column stays the largest while the social columns are generous:**

```text
MAIN PROFILE (1.6fr)        CHAT (1fr)         FRIENDS (1fr)
██████████████████████      ██████████████     ██████████████
██████████████████████      ██████████████     ██████████████
██████████████████████      ██████████████     ██████████████
██████████████████████      ██████████████     ██████████████
```

Implemented as a CSS grid with a **1.6fr : 1fr : 1fr** ratio (`lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]`) on a full-width container. The breakpoint is `lg` (≥1024px). Below `lg` the social columns disappear and the mobile architecture takes over.

### 3.0 Profile card social icons

The 💬 Chat and 👥 Friends icons live **INSIDE the profile card**, flanking the profile image circle **at both ends of the row**, with standard spacing from the card border (the card's own padding). Chat sits on the left end (accent color, shared unread badge), Friends on the right end (purple). You / Level renders directly beneath, centered.

**Desktop web (lg+): the flanking icons are HIDDEN.** The persistent GAME CHATS and MY FRIENDS columns are already on screen at that breakpoint, so duplicating the entry points inside the card would be redundant — the columns are the desktop surface. The profile image stays centered when the icons are hidden.

Icon behaviour per surface:
- **Desktop web (lg+):** icons hidden — the persistent social columns take over (no duplicate entry points in the card).
- **Narrow web + Capacitor:** icons visible; tapping one opens the dedicated screen as a fresh page (§6). Capacitor keeps the icons at EVERY viewport (wide tablets included), because the columns are a web-only surface.

### 3.1 Game Chats column (desktop)

- Persistent card titled **GAME CHATS** with the shared unread badge (existing unread mechanism, §47 below).
- Content: the existing contact list (shared game-chat store + existing `GameChatContactRow` rows).
- Tapping a contact opens the personal chat **inside the same column**; Back restores the contact list. The column never closes — there is no close button.

### 3.2 My Friends column (desktop)

- Persistent card titled **MY FRIENDS**.
- Content: the existing friends list (GET /friends) — every row offers the two actions **👤 Profile** and **💬 Chat**.
- 👤 opens the friend profile **inside the same column**; Back restores the list. 💬 opens the personal chat inside the column; Back restores the list. The column never closes.

### 3.3 Column interaction state machine (web)

Both columns are instances of the same interaction engine (`GameInteractionPanel`, `variant="column"`), each pinning a permanent root view:

```text
GAME CHATS COLUMN:   contacts ←→ personal chat
MY FRIENDS COLUMN:   friends list ←→ friend profile / personal chat
```

Views remain `closed | chat | personalChat | friends | friendProfile`; in column mode the root view is pinned so Back never empties the column. On narrow viewports the same engine renders as the floating overlay panel (`variant="overlay"`), closed by default, opened by the 💬 / 👥 icons.

## 4. Inside the main profile column

The order is EXACTLY:

```text
[💬 Chat]  Profile Image  [👥 Friends]     ← icons inside the card, both ends of the row
                                              (hidden on desktop web lg+ — the
                                               GAME CHATS / MY FRIENDS columns
                                               are the desktop surface)
     ↓
You / Level
     ↓
Statistics          (COMMON stats — identical for every game + coin balance)
     ↓
Play Now
     ↓
Group / Meet someone new
     ↓
Your Progress
     ↓
How It Works
```

**Play Now, Progress, and How It Works are NOT separate desktop columns.** They remain part of the same vertical content flow underneath the profile/statistics. Game information and the honest coming-soon state for non-playable games follow at the bottom of the same column.

### 4.1 REVISED — ONE entry screen for every game, COMMON statistics

The same `GamePrimaryScreen` serves EVERY game. Across games only THREE things ever change:

1. the top bar game **name** and **icon**,
2. the **room** a [Play Now] tap leads to (Spin the Bottle → Spin the Bottle room via matchmaking; Ludo → Ludo room via the server's table-availability + gender-weighted check),
3. the How-It-Works copy / rotating taglines that describe the game itself.

**The Statistics grid is COMMON**: every game shows the identical set — Total Games · Total Wins · Total Coins · Interactions — computed from the shared landing payloads (`commonGameStats`). The old per-game stat sets (kisses, tokens home, captures…) are retired; the separate "All Quicky" combined block stays empty and is hidden by the screen. The matchmaking modal is likewise SHARED (`MatchmakingModal`) — one join flow for every game, only the status copy differs.

## 5. Game identity

The page header carries the game identity for every game: back arrow, game icon, game name (§5), and an honest **● LIVE / COMING SOON** indicator. No large hero band is required by this architecture; the profile column leads with the PROFILE card.

## 6. Mobile / Capacitor — AND small-screen web

Below `lg` the web app follows the **same flow as the Capacitor app**. On mobile, the Chat/Friends preview columns are NOT shown — the social actions are the two theme-colored SVG icons INSIDE the profile card (§3.0), and tapping them opens DEDICATED SCREENS as a fresh page — never an in-page overlay:

```text
  ┌───────────────────────────────┐
│ 💬 │   Profile Image   │ 👥 │   ← icons inside the profile card
  └───────────────────────────────┘
          You
        Level 1

      Statistics

       Play Now

  Group / Meet someone new

    Your Progress

    How It Works
```

- Chat icon: accent (coral) color, carries the existing unread badge.
- Friends icon: purple color.
- Icons are implemented as SVG icons (existing `lucide-react` dependency: `MessageCircle`, `Users`) — no new icon library.
- **The in-page overlay interaction panel is removed** — one navigation model everywhere: persistent columns on desktop web, dedicated screens below lg and on Capacitor.

**💬 Chat flow (web below lg + Capacitor):**

```text
Chat icon
   ↓
Contact List          (existing Game Chat Contacts screen)
   ↓
Select Contact
   ↓
Chat Screen           (Back → Contact List → Game Primary)
```

**👥 Friends flow (web below lg + Capacitor):**

```text
Friends icon
   ↓
Full Screen Friends List        (dedicated GameFriendsScreen)
   ↓
 ┌───────────────────────┐
 │ John                  │
 │ [View Profile] [Chat] │
 └───────────────────────┘
        ↓                ↓
  Friend Profile    Personal Chat
  (Back → Friends)  (Back → Friends)
```

- Back from Friend Profile returns to **Friends**, never the Games list (§40).
- Back from Friends returns to the Game Primary Screen that opened it (`gameFriendsReturnView`).
- Screens respect `env(safe-area-inset-top/bottom)` (§45).
- On Capacitor tablets (wide viewports) the mobile architecture applies too — the dedicated screens and icon flow are used regardless of viewport width.

**💬 Chat flow (web, desktop):** the GAME CHATS column is permanently on screen — a personal chat opens inside the column and Back restores the contact list. On desktop the profile card's 💬 icon simply pulse-highlights the column. The Game Primary Screen stays mounted and the selected game state is preserved (§33).

## 7. Reuse constraints (unchanged from v1)

- Chat, friends, realtime messages, unread counts and keyboard/safe-area handling reuse the EXISTING systems. No parallel systems (`NewGameChatService`, `game_friends` tables) are created.
- The shared game-chat store stream is the single source of truth for unread badges.
- The EXISTING `GameChatScreen`, `GameChatContactRow`, GET /friends and `/profile/[id]` are composed into the columns/screens — composition/refactor, never rewrite.
- Transitions use the existing Framer Motion dependency (fade + soft slide, reversed on Back).
- Responsive: no fixed pixel widths for the page (the desktop grid uses `minmax(0, …)` tracks); the old bottom Game Chats section stays removed.

## 8. Acceptance criteria

1. Desktop (≥1024px, web): the primary screen renders **three columns** — a substantially wider main profile column plus GAME CHATS and MY FRIENDS social columns on the same row.
2. The main column contains, in order: Profile Image → You/Level → Statistics (COMMON stats, §6 revised) → Play Now → Group/Meet someone new → Your Progress → How It Works.
3. The social columns are persistent: opening a personal chat from the GAME CHATS column keeps it inside that column; Back restores the contact list. Opening a friend profile from MY FRIENDS keeps it inside that column; Back restores the friends list.
4. Mobile (web <1024px and Capacitor): NO social columns; the 💬/👥 icons sit INSIDE the profile card flanking the profile image circle — hidden on desktop web (lg+) where the columns take over; the profile content flows vertically in the §4 order.
5. Capacitor AND small-screen web flows: 💬 → Contact List screen (fresh page) → Chat Screen; 👥 → Friends screen (fresh page) → [View Profile]/[Chat]; Back always returns to the logical previous screen and never the Games list. The in-page overlay panel is gone.
6. Opening chats/friends never resets the selected game's primary screen state (§33).
7. Play Now → Game Room flow is unchanged (§54); the game name, icon and LIVE/COMING SOON state render in the header for every game.
8. The old bottom Game Chats section remains removed.

## 9. Regression paths

- **Spin the Bottle (web desktop):** Games → Spin the Bottle → 3-column primary screen → Play Now → matchmaking modal → room; back to primary → columns intact.
- **Spin the Bottle (mobile web):** primary screen → 💬 → overlay contacts → personal chat → Back → contacts → close; 👥 → friends → profile → Back → list.
- **Quicky Ludo (web desktop + mobile):** same screen driven by the Ludo config (Games/Wins/Tokens Home/Captures) — columns and flows identical.
- **Capacitor:** 💬 → contacts → chat → back → contacts → back → primary; 👥 → friends → profile → back → friends → back → primary; hardware back mirrors on-screen back on the Friends screen.
