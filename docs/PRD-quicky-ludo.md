Yes. I checked the current `main` branch rather than rebuilding the older requirements. The current repository HEAD I inspected is commit `21edf839aa9c7e6d5fe4608410ef93e2aee8c852`, and the repo already contains an **older Ludo implementation** in `LudoGame.tsx` and `src/lib/quicky/ludo.ts`. That implementation is match-based/two-player and therefore **must not simply be reused as-is** for this request.

The important part is that the latest architecture already has the pieces we want to reuse: `useGameRoomStore`, the Spin Bottle room shell, `RoomChatPanel`, player cards, gifts, game chat, realtime, room lifecycle, and the Games hub. The current Spin Bottle room is already designed as a full-window desktop game + chat layout and a responsive mobile/Capacitor layout.

Also, the current Games cards already support equal-sized game cards, active-player counts, and Coming Soon states, so **do not recreate that work**.

Below is the implementation PRD I would give directly to the coding agent.

# Quicky Ludo — Full Implementation PRD

### Classic 4-Player Ludo inside the existing Quicky Game Room Architecture

---

## 1. OBJECTIVE

Add a new playable game:

> **Quicky Ludo**

The game must be available on:

* Web
* Capacitor Android
* Capacitor iOS

It must use the **same Game Room architecture already established by Spin the Bottle**.

The only major difference is:

> **Spin Bottle game area → Ludo game area**

Everything surrounding the game remains the existing Quicky architecture.

### Do NOT create

* a separate dating chat
* a separate game chat architecture
* a separate gifting system
* a separate room system
* a separate friend system
* a separate mention system
* a separate notification system
* a separate room player interaction system

All of those already exist and must be reused.

---

# 2. IMPORTANT CURRENT-REPO RULE

The existing repository already contains:

```text
src/components/quicky/LudoGame.tsx
src/lib/quicky/ludo.ts
```

and the existing game API contains older Ludo logic under the match-based game route. The existing server implementation is explicitly built around:

```text
match.userAId
match.userBId
color A
color B
```

and therefore is a **2-player match game**, not the required 4-player room game.

### Therefore:

**DO NOT PATCH THE OLD 2-PLAYER LUDO INTO 4 PLAYERS.**

Instead:

1. Extract/reuse useful pure Ludo rules where appropriate.
2. Create a new room-based Ludo state model.
3. Connect it to `useGameRoomStore`.
4. Connect it to the existing Spin Bottle room shell.
5. Preserve Spin Bottle behavior completely.

The old Ludo component should either be replaced or isolated so it cannot accidentally be rendered by the new Games flow.

---

# 3. HIGH-LEVEL ARCHITECTURE

Current conceptual architecture:

```text
Games
  ↓
Game Landing
  ↓
Join Room
  ↓
Shared Game Room
  ├── Game HUD
  ├── Game Area
  ├── Room Players
  ├── Room Chat
  ├── Game Chat
  ├── Gifts
  ├── Mentions
  ├── Profile interaction
  └── Friends
```

For Ludo:

```text
Games
  ↓
Quicky Ludo Landing
  ↓
Play Now
  ↓
Ludo Room
  ├── Shared Quicky Room HUD
  ├── Ludo Board
  ├── 4 Player Zones
  ├── Dice
  ├── Tokens
  ├── Turn Indicator
  ├── Game Result
  └── Existing Room Chat
```

The game room must not become a completely separate application.

---

# 4. SHARED ROOM ARCHITECTURE

Create a reusable abstraction if the current Spin Bottle room is too tightly coupled to Spin Bottle.

Recommended:

```text
src/components/quicky/game-room/
    GameRoomShell.tsx
    GameRoomGameArea.tsx
    GameRoomPlayerLayer.tsx
    GameRoomBottomBar.tsx
    GameRoomMobileChat.tsx
```

Then:

```text
SpinBottleRoom
    ↓
GameRoomShell
    ↓
SpinBottleGameArea
```

and:

```text
LudoRoom
    ↓
GameRoomShell
    ↓
LudoGameArea
```

### Critical rule

Do not duplicate 60,000 lines of Spin Bottle room behavior.

The current Spin Bottle implementation already has a shared runtime and presentation architecture. `SpinBottleRoom.tsx` is explicitly built around `useGameRoomStore`, with the runtime surviving navigation to chats/profiles.

Ludo should consume the same runtime principles.

---

# 5. LUDO GAME LIMIT

## Maximum players

Exactly:

> **4 players**

Not 6.

Not 8.

Not 12.

Maximum:

```text
4
```

Minimum:

```text
2
```

### Lobby states

#### 1 player

```text
Waiting for more players
```

No game starts.

#### 2 players

Game may start.

#### 3 players

Game may start.

#### 4 players

Full game.

---

# 6. ROOM ASSIGNMENT

REVISED (unified entry-screen update): Ludo NOW uses gender weighting —
**exactly 2 male + 2 female seats per table**, mirroring the Spin Bottle
seat architecture at Ludo's 4-seat scale:

```text
seat 0 (RED)    → male slot
seat 1 (GREEN)  → female slot
seat 2 (YELLOW) → male slot
seat 3 (BLUE)   → female slot
```

seatIndex parity IS the gender slot (even = male, odd = female), so the two
male seats (RED/YELLOW) and the two female seats (GREEN/BLUE) sit on opposite
DIAGONALS of the board — neither gender ever clusters on one side. Profiles
whose gender maps cleanly (male/female) can only claim their own slots;
nonbinary/other/unset profiles are treated as "either" and may take ANY open
seat. The gender-capacity recheck runs INSIDE the seat-claim transaction
(`ludo-assignment.ts`) so a 2-seat gender quota can never be overfilled by a
race. Fresh rooms are created with `maleCapacity: 2, femaleCapacity: 2`.

Do not apply the Spin Bottle 6/6 scale to Ludo:

```text
6 male / 6 female
```

### Ludo room capacity

```text
maxPlayers = 4
```

### Seat assignment

Assign:

```text
seat 0 → RED
seat 1 → GREEN
seat 2 → YELLOW
seat 3 → BLUE
```

The color is determined by seat, not by user gender.

### REVISED — board presentation & physical animation

The Ludo UI was re-worked to feel like a REAL-WORLD board game:

* **The whole table is the board** — the 15×15 board fills the measured
  stage edge to edge (thin breathing margin), never a small centered tile.
* **Each player's home is the CORNER of the table**: a colored corner base
  with an inner plate, 4 circular token pads and an owner chip (player name,
  or an honest "Open Seat").
* **The path is laid through the table**: the classic 52-cell cross ring,
  4 colored home columns with direction chevrons, start cells marked with a
  travel-direction arrow, safe cells starred, and the center finish built
  from four colored triangles pointing at the middle.
* **Coins hop like real pieces** — while a token travels square by square
  (~180 ms per square, server-transition driven) its coin LIFTS off the
  board, scales up mid-air and lands with a squash every square.
* **The dice is a REAL 3D cube** (CSS `preserve-3d`, six pip faces,
  opposite faces sum to 7): it tumbles on two axes with a bouncing hop while
  rolling and settles on the SERVER's value with a physical overshoot ease
  plus an extra full turn per roll — every roll animates, even repeats.

---

# 7. PLAYER COLORS

Use four visually distinct Ludo colors.

Recommended:

```text
Player 1 → Quicky Pink/Red
Player 2 → Emerald Green
Player 3 → Golden Yellow
Player 4 → Blue/Cyan
```

Do not make the entire UI these colors.

The **Quicky theme remains the primary visual language**.

Colors are only used for:

* tokens
* player indicators
* player name accents
* home area
* turn indicators
* dice accent
* progress indicators

---

# 8. BOARD DESIGN

The game area should look like a premium Ludo board while still looking like Quicky.

Do NOT simply embed an external Ludo game.

Do NOT use an iframe.

Do NOT create an unrelated bright children's-game UI.

### Board visual direction

```text
Quicky dark environment
        ↓
Premium wooden/game table
        ↓
Large centered Ludo board
        ↓
Soft glow
        ↓
Four colored player homes
```

The existing Spin Bottle game uses a wooden table/game-stage concept. Reuse the same outer stage treatment.

---

# 9. BOARD GEOMETRY

Use a logical coordinate system.

Never hardcode:

```text
width: 600px
height: 600px
```

Instead:

```text
aspect-ratio: 1 / 1
width: min(...)
height: auto
```

The board should calculate everything from its measured dimensions.

Example:

```ts
const BOARD_SIZE = 15
```

Use a standard 15 × 15 logical Ludo grid.

Every square should be addressable as:

```ts
{
  row: number
  col: number
}
```

This allows:

* responsive rendering
* smooth token animation
* desktop scaling
* mobile scaling
* accurate collision/stack positioning

---

# 10. LUDO BOARD STRUCTURE

Implement the classic four-home Ludo board:

```text
┌───────────┬───────────┐
│   RED     │   GREEN   │
│  HOME     │   HOME    │
│           │           │
├───────────┼───────────┤
│           │           │
│   TRACK   │   TRACK   │
│           │           │
├───────────┼───────────┤
│   BLUE    │  YELLOW   │
│   HOME    │   HOME    │
└───────────┴───────────┘
```

Each player has:

```text
4 tokens
```

Total:

```text
16 tokens
```

---

# 11. TOKEN MODEL

Each token must have:

```ts
type LudoToken = {
  id: string
  playerId: string
  color: LudoColor
  index: 0 | 1 | 2 | 3

  state:
    | 'yard'
    | 'track'
    | 'home'
    | 'finished'

  position: number
}
```

Where:

```text
yard
= token inside player's home

track
= token on shared path

home
= player's final colored path

finished
= token reached final center
```

---

# 12. CLASSIC LUDO RULES

Implement the classic rule set.

## 12.1 Four tokens per player

Every player starts with:

```text
4 tokens in their home yard
```

---

# 13. STARTING A TOKEN

A token can leave the yard only when:

```text
dice === 6
```

When a player rolls 6:

* choose an eligible token
* token leaves yard
* token moves to player's starting square

Example:

```text
RED → RED START
GREEN → GREEN START
YELLOW → YELLOW START
BLUE → BLUE START
```

---

# 14. DICE

Dice values:

```text
1
2
3
4
5
6
```

The server generates the result.

Never generate the authoritative dice result on the client.

Client animation:

```text
rolling animation
↓
server response
↓
display actual number
```

---

# 15. DICE ANIMATION

When user presses Roll:

### Phase 1

Button changes to:

```text
Rolling...
```

### Phase 2

Dice visually rotates/shakes.

Duration:

```text
500–800ms
```

### Phase 3

Dice lands on:

```text
1–6
```

### Phase 4

Legal tokens become highlighted.

---

# 16. EXTRA TURN

Classic Ludo behavior:

> Rolling a 6 grants another roll.

Therefore:

```text
roll 6
→ move token
→ same player rolls again
```

If the player has no legal move after rolling 6:

```text
6
↓
no legal move
↓
extra roll
```

The server remains authoritative.

---

# 17. THREE SIXES

Use the common classic Ludo rule:

```text
three consecutive 6s
```

On the third consecutive six:

```text
third six is cancelled
turn passes to next player
```

Reset:

```text
sixStreak = 0
```

This must be server-side.

---

# 18. MOVEMENT RULE

If a token has a dice value of:

```text
4
```

and its current logical position is:

```text
10
```

then:

```text
10 → 11 → 12 → 13 → 14
```

The token must animate through each square.

Do not teleport.

---

# 19. TOKEN MOVEMENT ANIMATION

Movement should feel like a real Ludo game.

Example:

```text
dice rolled
      ↓
legal token selected
      ↓
token jumps:
      ●
      ↓
      ●
      ↓
      ●
      ↓
      ●
```

Animation:

```text
150–220ms per square
```

With:

```text
ease-out
```

Each step should have a subtle bounce.

---

# 20. LEGAL MOVE HIGHLIGHT

After dice roll:

### If one legal token exists

Automatically highlight it.

### If multiple legal tokens exist

Highlight all eligible tokens.

Token effect:

```text
soft glow
scale 1.05
pulse
```

Clicking an illegal token:

```text
small shake
```

Do not display a generic error toast unless necessary.

---

# 21. CAPTURE RULE

If a token lands on an opponent token on a non-safe square:

```text
capture opponent
```

The opponent token returns to:

```text
yard
```

### Capture animation

1. Attacking token lands.
2. Small impact effect.
3. Opponent token shakes.
4. Opponent token lifts slightly.
5. Token travels back toward its home.
6. Token settles in yard.
7. Small capture notification appears.

Example:

```text
⚡ Captured!
```

Duration:

```text
700–1000ms
```

---

# 22. SAFE SQUARES

Implement standard safe positions.

Tokens on safe squares cannot be captured.

Visually indicate safe squares subtly:

```text
star / shield / glow
```

Do not make them visually overpowering.

---

# 23. TOKEN STACKING

If multiple same-player tokens occupy the same square:

```text
stack them
```

Do not render them directly over each other.

Use:

```text
small offset
```

Example:

```text
    ●
  ●
```

Maximum four tokens.

The exact offset should be calculated from board cell size.

---

# 24. HOME PATH

Once a token completes the outer track, it enters its colored home path.

It must:

```text
track
→ home path
→ final center
```

The player must reach the final destination using the exact required dice distance.

---

# 25. EXACT FINISH RULE

If a token needs:

```text
3 spaces
```

and dice is:

```text
4
```

the move is illegal.

The token remains where it is.

If no other legal token exists:

```text
turn passes
```

---

# 26. TOKEN FINISH ANIMATION

When token reaches final home:

```text
scale 1
→ scale 1.15
→ glow
→ small bounce
→ settle
```

Then:

```text
✓ Token home
```

The token should remain visibly represented in the finished area.

---

# 27. WIN CONDITION

A player wins when:

```text
4 / 4 tokens
```

reach the final home.

Immediately set:

```ts
winnerId
status = 'finished'
```

Server-side.

---

# 28. GAME FINISH ANIMATION

Winner:

```text
all four tokens glow
↓
board celebration
↓
winner avatar appears
↓
"WINS!"
↓
confetti
```

Keep the celebration tasteful and consistent with Quicky.

Do not turn the entire app into a bright arcade screen.

---

# 29. PLAYER HUD

Around the Ludo board, show four compact player indicators.

Example:

```text
          🟢 Alex
          2/4 home


🔴 Luna                 🟡 Mia
2/4 home                 1/4 home


          🔵 Ryan
          0/4 home
```

Each player indicator contains:

* profile image
* display name
* color indicator
* tokens finished
* online state
* current turn state

---

# 30. CURRENT TURN INDICATOR

Current player should have:

```text
glowing border
```

and:

```text
Your Turn
```

if it is the current user.

For other players:

```text
Alex's Turn
```

The board should subtly pulse around the active player's color.

---

# 31. DICE POSITION

The dice belongs visually to the current player.

Recommended:

```text
center-bottom of board
```

or:

```text
center-right of board
```

depending on available space.

On mobile:

```text
board
↓
current player
↓
dice
```

must remain easily reachable.

---

# 32. ROLL BUTTON

Large touch target:

```text
ROLL DICE
```

When it is not the user's turn:

```text
Alex is rolling...
```

Button disabled.

Never allow client-side cheating by manually changing dice state.

---

# 33. MOBILE LAYOUT

Capacitor/mobile should use the existing Spin Bottle mobile philosophy.

Layout:

```text
┌─────────────────────────┐
│ Quicky Ludo     coins   │
├─────────────────────────┤
│                         │
│     PLAYER INDICATORS   │
│                         │
│      ┌───────────┐      │
│      │           │      │
│      │   LUDO    │      │
│      │   BOARD   │      │
│      │           │      │
│      └───────────┘      │
│                         │
│       DICE / TURN       │
│                         │
├─────────────────────────┤
│      ROOM CHAT          │
├─────────────────────────┤
│ message input           │
└─────────────────────────┘
```

The existing mobile keyboard protection and game runtime behavior must remain intact.

---

# 34. WEB LAYOUT

Desktop should use the existing Spin Bottle full-screen game architecture.

Current Spin Bottle already defines:

```text
top bar
+
game area
+
right-side room chat
```

on desktop.

Ludo:

```text
┌──────────────────────────────────────────────────────────────┐
│ Quicky Ludo   LIVE             economy / room controls       │
├───────────────────────────────────────┬──────────────────────┤
│                                       │                      │
│                                       │                      │
│              LUDO BOARD               │      ROOM CHAT       │
│                                       │                      │
│                                       │                      │
│                                       │                      │
│                                       │                      │
├───────────────────────────────────────┤                      │
│ turn / dice / controls                │                      │
└───────────────────────────────────────┴──────────────────────┘
```

The game should use the available desktop space instead of being trapped in a mobile-sized card.

---

# 35. ROOM CHAT

Reuse:

```text
RoomChatPanel
```

Do not create:

```text
LudoChatPanel
```

Existing room chat functionality must continue:

* realtime messages
* reactions
* mentions
* reply
* profile interaction
* stickers
* images
* existing composer
* existing chat notifications

The Ludo game should not know how chat works.

---

# 36. GAME CHAT

Existing Game Chat must remain available.

If the user opens:

```text
Game Chats
```

from inside Ludo:

```text
Ludo remains active in background
```

exactly as Spin Bottle does.

Do not reset:

* board
* dice
* current turn
* token positions
* player list
* room state

---

# 37. GIFTS

Reuse the existing gifting architecture.

Ludo must support:

```text
profile → interaction → gift
```

and:

```text
room → gift
```

exactly like Spin Bottle.

Do not create another gift transaction table.

Do not create another coin system.

---

# 38. PLAYER PROFILE INTERACTION

Clicking/tapping a Ludo player should open the same existing interaction UI.

Existing options remain:

```text
Message
Mention
Gift
Add Friend
Profile
```

and whatever is already supported by the current implementation.

---

# 39. MENTIONS

Existing room mention functionality must work in Ludo.

Example:

```text
@Alex nice move!
```

Alex receives the same existing mention behavior.

No Ludo-specific mention implementation.

---

# 40. FRIENDS

Friends must continue working.

From Ludo:

```text
player → Add Friend
```

must use the existing friends API.

No new friendship schema.

---

# 41. ROOM LEAVING

Use the existing temporary room lifecycle.

When a user leaves Ludo:

1. stop local animations
2. unsubscribe from Ludo realtime
3. stop heartbeat/presence
4. remove player from room
5. preserve completed game history if required
6. clean up room if empty
7. navigate to Ludo landing

Do not leave a ghost player on the board.

---

# 42. PLAYER DISCONNECT

This is especially important for a turn-based game.

If a player loses connection:

```text
player status = disconnected
```

Do not immediately destroy their tokens.

Give a short grace period.

Recommended:

```text
30 seconds
```

During this time:

```text
Alex disconnected
Reconnecting...
```

If they reconnect:

```text
restore session
```

If they do not:

```text
mark player as left
```

---

# 43. PLAYER LEAVES DURING THEIR TURN

If the active player leaves:

```text
current turn
↓
detect player inactive/left
↓
advance to next active player
```

No game lock.

---

# 44. PLAYER LEAVES AFTER ROLLING

If:

```text
player rolled
```

and then leaves:

```text
discard pending dice
```

then advance to next player.

Never allow another player to execute the departed player's pending move.

---

# 45. GAME STATE

Recommended server state:

```ts
type LudoGameState = {
  version: number

  status:
    | 'waiting'
    | 'starting'
    | 'playing'
    | 'finished'

  players: LudoPlayer[]

  currentPlayerId: string | null

  turnNumber: number

  dice: {
    value: number | null
    rolledBy: string | null
    rolledAt: number | null
  }

  sixStreak: number

  tokens: LudoToken[]

  winnerId: string | null

  lastActionId: string | null

  lastActionAt: number
}
```

---

# 46. PLAYER STATE

```ts
type LudoPlayer = {
  userId: string
  seat: 0 | 1 | 2 | 3

  color:
    | 'red'
    | 'green'
    | 'yellow'
    | 'blue'

  displayName: string
  avatar: string | null

  status:
    | 'waiting'
    | 'ready'
    | 'playing'
    | 'disconnected'
    | 'left'
    | 'winner'

  tokensFinished: number
}
```

---

# 47. SERVER AUTHORITY

This is mandatory.

The client may request:

```text
roll
move
```

but the server decides whether it is legal.

Never trust:

```ts
clientDice
clientPosition
clientWinner
clientTurn
```

---

# 48. ROLL API

Recommended:

```http
POST /api/quicky/games/ludo/room/[roomId]/roll
```

Request:

```json
{
  "actionId": "uuid"
}
```

Server validates:

```text
authenticated user
+
room membership
+
game type
+
game status
+
current turn
+
no pending dice
```

Then generates:

```text
1–6
```

and stores it.

Response:

```json
{
  "ok": true,
  "dice": 6,
  "legalMoves": [
    "token-1",
    "token-3"
  ],
  "stateVersion": 42
}
```

---

# 49. MOVE API

```http
POST /api/quicky/games/ludo/room/[roomId]/move
```

Request:

```json
{
  "tokenId": "token-1",
  "actionId": "uuid"
}
```

Server verifies:

```text
user owns token
+
correct turn
+
dice exists
+
token is legally movable
+
exact distance valid
```

Then:

```text
move token
+
capture if necessary
+
calculate extra turn
+
calculate winner
+
increment state version
```

---

# 50. IDEMPOTENCY

Every roll/move must include:

```text
actionId
```

If the same request arrives twice:

```text
do not execute twice
```

This prevents:

* double movement
* double capture
* duplicate dice
* duplicate winner
* duplicate rewards

---

# 51. STATE VERSIONING

Every authoritative state mutation increments:

```ts
stateVersion
```

Example:

```text
40
41
42
43
```

Client ignores an older state.

This protects against:

* delayed requests
* reconnects
* duplicate realtime messages
* mobile resume
* browser tab race conditions

---

# 52. REALTIME

Use the existing realtime architecture.

Do not introduce an unrelated WebSocket framework.

Realtime events should include:

```text
ludo.player_joined
ludo.player_left
ludo.player_ready
ludo.turn_changed
ludo.dice_rolled
ludo.token_moving
ludo.token_moved
ludo.token_captured
ludo.token_finished
ludo.game_finished
```

The actual authoritative state should still come from the server.

---

# 53. ANIMATION VS SERVER STATE

Important architecture:

```text
SERVER
  ↓
authoritative state transition
  ↓
client receives event
  ↓
client animates transition
```

Never:

```text
client animation
  ↓
assume state
```

Example:

Server says:

```text
token 1 moved from position 10 → 15
```

Client animates:

```text
10 → 11 → 12 → 13 → 14 → 15
```

---

# 54. REALTIME ANIMATION EVENT

For smooth multiplayer movement, the server response can include:

```json
{
  "event": "token_moved",
  "tokenId": "red-1",
  "from": 10,
  "to": 15,
  "steps": 5
}
```

Every client then performs the same animation.

---

# 55. DICE MULTIPLAYER ANIMATION

When another player rolls:

```text
dice shakes
↓
dice displays result
↓
their legal tokens highlight
```

Do not animate only on the rolling user's device.

Every player in the room must see the same action.

---

# 56. GAME START

When minimum players is reached:

```text
2+ players
```

show:

```text
Players ready
```

Then:

```text
3
2
1
```

Then:

```text
LUDO!
```

Animation duration:

```text
~1.5 seconds
```

---

# 57. FIRST PLAYER

Determine the starting player server-side.

Recommended:

```text
random among active players
```

Store:

```text
currentPlayerId
```

Do not let each client calculate a different first player.

---

# 58. TURN ORDER

Turn order follows room seat order:

```text
RED
→ GREEN
→ YELLOW
→ BLUE
→ RED
```

If a seat is empty:

```text
skip empty seat
```

If a player leaves:

```text
skip departed player
```

---

# 59. ROOM WITH 2 PLAYERS

Example:

```text
RED
GREEN
empty
empty
```

Turn:

```text
RED
→ GREEN
→ RED
→ GREEN
```

---

# 60. ROOM WITH 3 PLAYERS

Example:

```text
RED
GREEN
YELLOW
empty
```

Turn:

```text
RED
→ GREEN
→ YELLOW
→ RED
```

---

# 61. ROOM WITH 4 PLAYERS

Normal:

```text
RED
→ GREEN
→ YELLOW
→ BLUE
→ RED
```

---

# 62. GAME PAUSE / BACKGROUND

If the user:

* opens Game Chat
* opens Profile
* opens Friends
* opens Dating Chat
* backgrounds Capacitor

the Ludo game must continue.

The game runtime remains attached.

This is consistent with the current architecture where `useGameRoomStore` keeps room state alive while users navigate away from the table.

---

# 63. MOBILE RESUME

When Capacitor resumes:

```text
reconnect realtime
↓
fetch latest authoritative room state
↓
compare stateVersion
↓
reconcile board
```

Never reconstruct the game from local animation state.

---

# 64. OFF-SCREEN TURN

If it becomes the user's turn while they are in:

```text
Game Chat
Dating Chat
Profile
Friends
```

show the existing non-intrusive game notification architecture.

Example:

```text
🎲 Your turn in Quicky Ludo
Roll the dice
```

Do not invent a new decision drawer like Spin Bottle's Kiss/No Thanks flow.

Ludo only requires a turn notification.

---

# 65. MOBILE HAPTICS

On Capacitor:

### Your turn

Light haptic.

### Dice result

Light haptic.

### Capture

Medium haptic.

### Token reaches home

Light success haptic.

### Win

Success pattern.

Use existing Capacitor/haptic abstraction if available.

Do not directly duplicate native plugin setup.

---

# 66. SOUND

If the app already has game sound infrastructure, use it.

Suggested sounds:

```text
dice-roll
token-step
token-capture
token-home
extra-turn
win
```

Sound must:

* respect device mute
* respect app sound setting
* never autoplay aggressively
* not interfere with chat

---

# 67. ACCESSIBILITY

Each token needs:

```text
aria-label
```

Example:

```text
Red token 2, position 14
```

Dice:

```text
Roll dice
```

Turn:

```text
Your turn
```

Reduced motion:

```text
prefers-reduced-motion
```

should reduce:

* token bounce
* glow
* confetti
* dice animation

but must preserve functional state transitions.

---

# 68. RESPONSIVE BOARD

Desktop:

```text
board can grow substantially
```

Mobile:

```text
board uses maximum safe width
```

Never let the board:

* overflow horizontally
* hide the dice
* hide player indicators
* overlap chat
* become too small to touch

---

# 69. TOUCH INTERACTION

Token selection:

```text
tap
```

No drag-to-move.

This avoids accidental moves and simplifies multiplayer authority.

---

# 70. DESKTOP INTERACTION

Mouse:

```text
click token
```

Keyboard:

not required for gameplay.

Hover:

```text
token glow
```

only when token is legally selectable.

---

# 71. GAME LANDING

Use the existing Games architecture.

When user opens:

```text
Quicky Ludo
```

show:

```text
Quicky Ludo

Classic Ludo
Play with up to 4 players

[ Play Now ]
```

Stats can use the existing generic game statistics structure.

Do not create a new landing architecture.

---

# 72. GAME CARD

The Games page already has equal-sized game cards and active-player indicators.

Add/activate:

```text
Quicky Ludo
```

with:

```text
icon
name
description
active players
play state
```

No giant banner.

---

# 73. ACTIVE PLAYER COUNT

Use the existing:

```text
● Users 24 playing
```

architecture.

Ludo's number should represent:

```text
users currently inside active Ludo rooms
```

not:

```text
number of rooms
```

---

# 74. GAME STATS

Use generic game statistics.

Do not display:

```text
Kiss Points
```

for Ludo.

Use:

```text
Ludo Games
Ludo Wins
Tokens Finished
Captures
Best Result
```

if the existing stats infrastructure supports these.

---

# 75. LUDO GAME POINTS

If the generic Quicky game-point system is already present:

```text
game points
```

should be awarded through the existing game-stat system.

Do not create a separate coin-like Ludo currency.

Recommended event records:

```text
game_started
game_finished
game_won
token_finished
capture
```

---

# 76. DATABASE

Prefer reusing the existing game room/session architecture.

If the current schema can safely represent:

```text
gameType = 'ludo'
```

use it.

Do not create an unnecessary second room table.

However, Ludo-specific state should be separated from Spin Bottle-specific state.

Recommended:

```text
game_sessions
```

or the existing room state:

```json
{
  "gameType": "ludo",
  "gameState": {
    ...
  }
}
```

---

# 77. LUDO STATE STORAGE

Do not store animation frames.

Store only authoritative state:

```text
players
turn
dice
tokens
winner
stateVersion
sixStreak
```

Animations are client-side.

---

# 78. GAME HISTORY

When game ends, record:

```text
gameSessionId
gameType = ludo
winnerUserId
players
startedAt
endedAt
duration
```

If existing game-post infrastructure supports completed games, connect Ludo to it instead of creating a new post model.

---

# 79. CHAT/GIFT/MENTION DATA

Ludo room messages must remain associated with:

```text
roomId
gameType = ludo
```

where supported by existing room-chat architecture.

Do not duplicate chat storage.

---

# 80. EXISTING SPIN BOTTLE MUST NOT BREAK

After implementing Ludo, test:

```text
Spin Bottle
```

with:

* room creation
* room assignment
* gender balancing
* bottle spin
* Kiss/No Thanks
* response timer
* gifts
* chat
* mentions
* profile interactions
* Game Chat
* room change
* leaving
* reconnect

The Ludo implementation must not modify Spin Bottle game rules.

---

# 81. RECOMMENDED FILE STRUCTURE

Create:

```text
src/components/quicky/
    LudoRoom.tsx

src/components/quicky/ludo/
    LudoGameArea.tsx
    LudoBoard.tsx
    LudoCell.tsx
    LudoToken.tsx
    LudoDice.tsx
    LudoPlayerHud.tsx
    LudoTurnIndicator.tsx
    LudoGameResult.tsx
    LudoCountdown.tsx
    ludo-room.css
```

Logic:

```text
src/lib/quicky/ludo/
    rules.ts
    board.ts
    movement.ts
    validation.ts
    types.ts
    constants.ts
```

API:

```text
src/app/api/quicky/games/ludo/
    join/
        route.ts

    room/
        route.ts

    stream/
        route.ts

    roll/
        route.ts

    move/
        route.ts

    leave/
        route.ts
```

Client API:

```text
src/lib/quicky/api-client.ts
```

Add:

```ts
api.ludo
```

without removing:

```ts
api.spinBottle
```

---

# 82. DO NOT USE THE OLD `LudoGame.tsx` AS THE ROOM

The current old component is not the correct architecture for this feature.

The new component should be:

```text
LudoRoom
```

which owns the Ludo game area but delegates room infrastructure to the existing game-room runtime.

The old:

```text
LudoGame.tsx
```

can be:

* replaced
* renamed
* converted into a pure board component

but must not remain as an independent 2-player game route.

---

# 83. PURE GAME ENGINE

The most important part of the implementation should be a deterministic pure engine.

Example:

```ts
rollDice(state, playerId, rng)
```

```ts
getLegalMoves(state, playerId, dice)
```

```ts
moveToken(state, playerId, tokenId)
```

```ts
captureToken(state, movingToken)
```

```ts
advanceTurn(state)
```

```ts
checkWinner(state, playerId)
```

These functions should not depend on React.

---

# 84. PURE ENGINE EXAMPLE

```ts
const legalMoves = getLegalMoves(
  state,
  playerId,
  dice
)
```

Returns:

```ts
[
  {
    tokenId: 'red-1',
    from: 14,
    to: 18,
    canCapture: false
  },
  {
    tokenId: 'red-3',
    from: 32,
    to: 36,
    canCapture: true
  }
]
```

The UI uses this to highlight tokens.

The server uses the exact same logic to validate the move.

---

# 85. IMPORTANT — SHARED RULE ENGINE

Do not have:

```text
client Ludo rules
+
server Ludo rules
```

that can drift apart.

Prefer:

```text
src/lib/quicky/ludo/rules.ts
```

shared by:

```text
server
+
client
+
tests
```

Server remains authoritative, but both use the same deterministic rule definitions.

---

# 86. TEST SUITE

Create unit tests for every rule.

### Dice

```text
1
2
3
4
5
6
```

### Starting

```text
dice 6 → token can leave yard
dice 5 → cannot
```

### Movement

```text
position + dice
```

### Exact finish

```text
required 3 + dice 3 = legal
required 3 + dice 4 = illegal
```

### Capture

```text
enemy on unsafe square → captured
enemy on safe square → not captured
```

### Extra turn

```text
6 → same player
```

### Three sixes

```text
6
6
6
→ third cancelled
→ next player
```

### Win

```text
4 tokens finished → winner
```

---

# 87. MULTIPLAYER TESTS

Test:

```text
Player A browser
Player B browser
Player C browser
Player D browser
```

simultaneously.

Verify:

* same dice
* same token movement
* same turn
* same capture
* same winner

---

# 88. RACE CONDITION TESTS

Test:

### Double roll

User double-clicks Roll.

Expected:

```text
one roll only
```

### Double move

User double-clicks token.

Expected:

```text
one movement
```

### Two browser tabs

Same user opens two tabs.

Expected:

```text
only authoritative turn can execute
```

### Stale move

Old client sends move after turn changed.

Expected:

```text
reject
```

---

# 89. RECONNECT TEST

During:

```text
dice roll
token animation
opponent turn
capture
```

disconnect network.

Reconnect.

Expected:

```text
fetch current state
```

and render the correct board.

---

# 90. MOBILE TEST

Test on:

```text
Android Capacitor
iOS Capacitor
```

Verify:

* board fits
* no horizontal overflow
* touch works
* keyboard doesn't resize board incorrectly
* app background/resume works
* haptic works
* chat still works
* game remains active while navigating

---

# 91. WEB TEST

Test:

```text
1280 × 720
1440 × 900
1920 × 1080
2560 × 1440
```

Board should scale naturally.

Chat remains visible.

Game should never look like a centered mobile phone.

---

# 92. MOBILE TEST

Test:

```text
320px
360px
375px
390px
414px
430px
```

Portrait.

Also test landscape.

---

# 93. LOADING STATE

Entering Ludo:

```text
Joining table...
```

Then:

```text
Preparing board...
```

Then:

```text
Players ready
```

Then:

```text
3
2
1
```

Then game.

Never show a black screen.

---

# 94. ERROR STATES

If room join fails:

```text
Couldn't join the table
[Try Again]
[Back to Games]
```

If move fails:

```text
Move unavailable
```

but reconcile state from server.

If realtime disconnects:

```text
Reconnecting...
```

Do not destroy the board.

---

# 95. EMPTY ROOM

If the user joins alone:

```text
🎲
Waiting for more players
```

The board can already be visible.

Do not display a broken/incomplete board.

---

# 96. PLAYER JOIN ANIMATION

When player joins:

```text
empty seat
↓
avatar scales in
↓
color indicator appears
↓
"Alex joined"
```

Room chat continues using existing join chips.

Do not add game logs to room chat if the current architecture already suppresses them.

---

# 97. PLAYER READY

Once minimum two players exist:

```text
2 players ready
```

Start countdown.

If another player joins during countdown:

```text
add them before the game begins
```

Once game has started:

> new users cannot join that active Ludo match.

They must join another room.

---

# 98. ROOM LOCK AFTER GAME START

Once:

```text
status = playing
```

room membership is locked.

No new player can enter.

This avoids changing a four-player game's turn structure.

---

# 99. GAME CHAT DURING LUDO

While Ludo is running:

```text
Room Chat
Game Chats
Dating Chats
```

continue normally.

Opening one-to-one chat must not destroy the Ludo runtime.

---

# 100. GIFTING DURING LUDO

Gifts remain available.

Gift animation should appear:

```text
over game area
```

for approximately:

```text
1–2 seconds
```

without pausing the Ludo engine.

Do not pause the current turn because someone sent a gift.

---

# 101. PERFORMANCE

Do not rerender the entire room on every token movement.

Separate state domains:

```text
room membership
chat
economy
ludo board
player HUD
```

A token movement should primarily rerender:

```text
affected token
+
relevant player HUD
+
turn state
```

not:

```text
chat
gifts
entire room
```

---

# 102. ANIMATION PERFORMANCE

Use:

```text
transform
opacity
scale
```

where possible.

Avoid animating:

```text
top
left
width
height
```

every frame.

The board should remain at 60fps on normal supported devices.

---

# 103. ANIMATION TIMELINE

### Dice

```text
0ms      click
0–600ms dice roll
600ms    result
```

### Token movement

```text
~180ms / square
```

### Capture

```text
impact       150ms
shake        250ms
return       400ms
settle       150ms
```

### Finish

```text
bounce       300ms
glow         500ms
```

### Winner

```text
board glow   400ms
celebration  1000–1500ms
```

---

# 104. REDUCED MOTION

When:

```css
prefers-reduced-motion
```

is enabled:

* no token bounce
* no excessive glow
* dice animation reduced
* no confetti animation
* instant/short transitions

Gameplay must remain identical.

---

# 105. SECURITY

Server must verify:

```text
authenticated user
room membership
game type
game status
turn owner
token ownership
dice validity
move legality
state version
action id
```

Never trust client-provided:

```text
dice
token position
winner
turn
capture result
```

---

# 106. ANTI-CHEAT

Never expose server RNG seed.

Never accept:

```json
{
  "dice": 6
}
```

from client.

Client sends:

```json
{
  "actionId": "..."
}
```

Server generates dice.

---

# 107. ADMIN

Do not build a new Ludo-specific admin dashboard.

The existing Games admin infrastructure already supports game definitions. The repo contains `AdminGamesScreen` and the corresponding games API.

Add Ludo to that system.

Admin can control:

```text
name
description
icon
artwork
active/inactive
sort order
```

Existing generic game controls remain responsible for these.

---

# 108. GAME TYPE

Use:

```ts
'ludo'
```

as the canonical slug.

Not:

```text
quickyludo
quicky-ludo-game
ludo4
```

Canonical:

```text
quicky-ludo
```

for the user-facing slug if existing game slugs use that convention, while the internal `gameType` can remain:

```text
ludo
```

---

# 109. EXISTING GAME CARD

Do not change the generic `GameCard` architecture just for Ludo.

The current GameCard already implements:

* artwork
* active player count
* Coming Soon
* playable state
* equal card layout.

Only provide the Ludo `GameDef`.

---

# 110. ROUTING

When user clicks:

```text
Quicky Ludo
```

flow:

```text
Games
 ↓
Ludo Landing
 ↓
Play Now
 ↓
Join Ludo Room
 ↓
LudoRoom
```

Do not send the user to:

```text
/matches/[matchId]/game
```

That is the old two-player architecture.

---

# 111. STATE MACHINE

Use:

```text
WAITING
   ↓
STARTING
   ↓
PLAYING
   ↓
TURN
   ↓
DICE_ROLLED
   ↓
MOVE
   ↓
CAPTURE?
   ↓
FINISH TOKEN?
   ↓
EXTRA TURN?
   ↓
NEXT TURN
   ↓
...
   ↓
WIN
   ↓
FINISHED
```

---

# 112. AUTHORITATIVE STATE TRANSITION

Example:

```text
PLAYER A TURN
     ↓
A rolls 6
     ↓
SERVER validates
     ↓
dice = 6
     ↓
client animations
     ↓
A chooses token
     ↓
SERVER validates token
     ↓
token moves
     ↓
capture?
     ↓
finished?
     ↓
extra turn?
     ↓
NEXT STATE
```

---

# 113. CRITICAL IMPLEMENTATION RULE

Never let animation determine game state.

Wrong:

```text
animate token
then update database
```

Correct:

```text
server validates
↓
database/state updated
↓
event emitted
↓
animation plays
```

---

# 114. GAME STATE RECONCILIATION

Every realtime event should be safe to miss.

If client receives:

```text
stateVersion = 51
```

then later:

```text
stateVersion = 53
```

it should request:

```text
latest state
```

if version 52 was missed.

---

# 115. CHAT PANEL MUST REMAIN EXACTLY THE EXISTING ARCHITECTURE

This is a major requirement.

Do not redesign:

```text
RoomChatPanel
GameChatScreen
GameChatContactsScreen
```

for Ludo.

The game is simply another consumer of them.

The existing Spin Bottle room already imports and uses these components.

---

# 116. FILES TO AUDIT BEFORE CODING

The coding agent must inspect the current versions of:

```text
src/components/quicky/SpinBottleRoom.tsx
src/components/quicky/RoomChatPanel.tsx
src/components/quicky/RoomPlayerCard.tsx
src/components/quicky/RoomTopHud.tsx

src/store/game-room.ts
src/store/game-chat.ts
src/store/quicky.ts

src/lib/quicky/api-client.ts
src/lib/quicky/realtime.ts
src/lib/quicky/room-assignment.ts
src/lib/quicky/room-cleanup.ts
src/lib/quicky/room-activity.ts

src/components/quicky/game-hub/GameLanding.tsx
src/components/quicky/game-hub/GameCard.tsx
src/components/quicky/game-hub/useGames.ts
src/components/quicky/GamesScreen.tsx

src/components/quicky/game-chat/
```

The repository tree confirms these are the current architectural pieces.

---

# 117. FILES TO REUSE, NOT DUPLICATE

Reuse:

```text
RoomChatPanel
RoomPlayerCard
RoomTopHud
RoomExitControl
CoinStoreSheet
GiftSheet
PlayerInteractionSheet
GameChatScreen
GameChatContactsScreen
GameDecisionDrawer
useGameRoomStore
useGameChatStore
useGameWakeLock
```

where applicable.

---

# 118. FILES TO REPLACE/REFACTOR

The old:

```text
LudoGame.tsx
src/lib/quicky/ludo.ts
```

should be audited.

If they contain useful deterministic logic:

```text
extract
```

If they conflict with room-based 4-player architecture:

```text
replace
```

Do not keep two competing Ludo engines.

---

# 119. MIGRATION STRATEGY

### Phase 1

Create:

```text
ludo/types.ts
ludo/constants.ts
ludo/board.ts
ludo/rules.ts
```

### Phase 2

Implement deterministic engine.

### Phase 3

Unit test engine.

### Phase 4

Create server room state.

### Phase 5

Create roll/move endpoints.

### Phase 6

Realtime events.

### Phase 7

Create:

```text
LudoBoard
LudoToken
LudoDice
LudoPlayerHud
```

### Phase 8

Create:

```text
LudoRoom
```

### Phase 9

Integrate shared Game Room shell.

### Phase 10

Integrate Games page.

### Phase 11

Integrate Web.

### Phase 12

Integrate Capacitor.

### Phase 13

QA.

---

# 120. DO NOT REIMPLEMENT PREVIOUS FEATURES

This PRD explicitly excludes rebuilding:

* gender-balanced Spin Bottle rooms
* Spin Bottle response system
* Kiss/No Thanks
* gifts architecture
* sticker architecture
* Game Chat
* Dating Chat
* mentions
* friends
* profile interaction
* room cleanup
* room activity
* wake lock
* coin store
* generic game cards
* Coming Soon overlay
* active player counter

Those systems already exist and should be consumed by Ludo.

The repository already has dedicated room assignment/cleanup/realtime/game-chat infrastructure, so Ludo should plug into those rather than fork them.

---

# 121. ACCEPTANCE CRITERIA

The implementation is complete only when:

### Game

* [ ] Ludo appears in Games.
* [ ] Ludo can be opened on Web.
* [ ] Ludo can be opened in Capacitor.
* [ ] Maximum 4 players.
* [ ] Minimum 2 players.
* [ ] Four different player colors.
* [ ] Four tokens per player.
* [ ] Server-generated dice.
* [ ] Server-authoritative movement.
* [ ] Correct starting rule.
* [ ] Correct movement.
* [ ] Correct captures.
* [ ] Safe squares.
* [ ] Exact home rule.
* [ ] Extra turn on 6.
* [ ] Three-six rule.
* [ ] Correct turn order.
* [ ] Correct win condition.

### Animation

* [ ] Dice animation.
* [ ] Token step-by-step movement.
* [ ] Legal-token highlight.
* [ ] Capture animation.
* [ ] Return-to-yard animation.
* [ ] Token-home animation.
* [ ] Turn transition.
* [ ] Game-start countdown.
* [ ] Winner celebration.
* [ ] Reduced-motion support.

### Multiplayer

* [ ] Four simultaneous clients see identical state.
* [ ] Duplicate roll rejected.
* [ ] Duplicate move rejected.
* [ ] Stale moves rejected.
* [ ] Disconnect/reconnect works.
* [ ] Leaving player doesn't freeze game.
* [ ] Active turn advances after player leaves.

### Room

* [ ] Existing room architecture reused.
* [ ] Existing room chat works.
* [ ] Existing Game Chat works.
* [ ] Existing gifts work.
* [ ] Existing mentions work.
* [ ] Existing profile interactions work.
* [ ] Existing friends work.
* [ ] Existing coin system works.
* [ ] Game continues while chat/profile is open.

### Web

* [ ] Uses full desktop game area.
* [ ] Ludo board scales.
* [ ] Chat panel remains visible.
* [ ] No mobile-phone-sized game container.

### Mobile

* [ ] Board fits all supported phone sizes.
* [ ] Touch targets are large enough.
* [ ] No horizontal overflow.
* [ ] Haptic feedback works where supported.
* [ ] Background/resume reconciles state.
* [ ] Chat remains functional.

---

# 122. FINAL ARCHITECTURE

The final result should look conceptually like:

```text
                         QUICKS GAME PLATFORM
                                │
                    ┌───────────┴───────────┐
                    │                       │
               Spin Bottle              Quicky Ludo
                    │                       │
                    ▼                       ▼
             Shared Game Room       Shared Game Room
                    │                       │
          ┌─────────┼─────────┐     ┌───────┼────────┐
          │         │         │     │       │        │
        Game      Players    Chat   Game   Players   Chat
        Area                         Area
          │                           │
     Bottle logic                 Ludo logic
```

The architectural principle is:

> **The room is the platform. The game is a plug-in.**

Spin Bottle and Ludo should therefore share:

```text
Room
Players
Realtime
Chat
Game Chat
Gifts
Coins
Mentions
Friends
Profiles
Notifications
Room lifecycle
Wake lock
Navigation
```

Only this changes:

```text
Spin Bottle Game Engine
        ↓
Ludo Game Engine
```

That is the key difference between a clean Quicky games platform and building another standalone game inside the app.

### Repository basis

I checked the current repository tree and latest inspected HEAD, including the existing Ludo implementation, current Spin Bottle room, game cards, game-room store architecture, API structure, and chat/game infrastructure. The current tree confirms that Ludo already exists as an older implementation, while the newer room architecture lives around `SpinBottleRoom`, `useGameRoomStore`, Game Chat, room APIs, and the Games hub.

[Open the Quicky repository](https://github.com/Paradox-max007/quicky?utm_source=chatgpt.com)

**Implementation priority:** do the **pure 4-player Ludo engine first**, test every rule independently, then connect it to the existing room runtime. That prevents the old 2-player match implementation from contaminating the new 4-player multiplayer architecture.
