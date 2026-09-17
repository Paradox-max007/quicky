Absolutely. The requirements now span **Spin the Bottle room logic, gender-balanced matchmaking, gifting, stickers, games UI, realtime player counts, and a complete admin-dashboard redesign**. The important part is to implement these as connected systems rather than isolated UI changes.

# PRD — Quicky Games Platform

## Spin the Bottle • Gender-Balanced Rooms • Gifting • Stickers • Games UI • Admin Dashboard

**Platform:** Web + Capacitor Android/iOS
**Frontend:** Next.js + TypeScript + Tailwind + existing UI system
**Realtime:** Supabase Realtime
**Game rendering:** Existing Three.js/game implementation where applicable
**Backend:** Existing API/backend + Prisma/Supabase infrastructure
**Priority:** High
**Implementation style:** Production-ready, responsive, configurable, no hardcoded game content

---

# 1. CORE OBJECTIVE

Refactor the Games system so that:

1. Spin the Bottle only starts when a valid opposite-gender pairing exists.
2. Every Spin the Bottle room has **6 male-weighted seats + 6 female-weighted seats**.
3. Room assignment and room changing must respect those gender slots.
4. Empty/invalid rooms must never start spinning.
5. Gifting supports:

   * All
   * Guys
   * Girls
   * quantity 1 / 10 / 50 / 100 / 1000
   * bulk sending
   * atomic coin deduction
6. Insufficient coins opens the existing coin-purchase modal instead of breaking the flow.
7. Stickers become admin-managed PNG sticker sets.
8. Stickers can be unlocked through:

   * events
   * leagues
   * coins
   * subscriptions
9. Games page displays **all games as equal cards**.
10. Spin the Bottle must no longer be a giant banner.
11. Inactive games show a polished animated **Coming Soon** treatment.
12. Every game displays its current active-player count.
13. Game statistics use the generic **Game Points** terminology.
14. Admin gets a completely separate professional dashboard.
15. Admin can manage essentially every game/gift/sticker configuration without code changes.

---

# 2. IMPORTANT TERMINOLOGY

Do not use `Kiss Points` as the generic game statistic.

Use:

> **Game Points**

Spin the Bottle may internally have kiss-related events, but the common game-stat UI must say:

* Game Points
* Games Played
* Wins, where applicable
* Streak
* Current Players

This allows future games such as:

* Ludo
* Truth or Dare
* Party Quiz
* Cards
* Spin the Bottle
* other multiplayer games

to use the same architecture.

---

# 3. SPIN THE BOTTLE — ROOM GENDER ARCHITECTURE

This is a **critical requirement**.

A Spin the Bottle room contains a maximum of:

> **12 players**

The room has a predefined gender capacity:

| Gender | Capacity |
| ------ | -------: |
| Male   |        6 |
| Female |        6 |
| Total  |       12 |

These are not simply statistics.

They represent **available gender-compatible seats**.

---

# 4. SEAT ASSIGNMENT

Do not randomly place a user into any available seat.

Instead, each room must maintain:

```text
male_capacity = 6
female_capacity = 6

male_occupied
female_occupied

male_available
female_available
```

Example:

```text
Room A

Male:
6 / 6 occupied

Female:
3 / 6 occupied

Available:
3 female seats
```

A male user must NOT be assigned to this room.

A female user may be assigned.

---

# 5. RANDOM SEAT POSITIONS

The visual table continues to contain 12 logical seats.

However, each seat must have a server-defined gender slot.

Example:

```text
Seat 0 → male
Seat 1 → female
Seat 2 → male
Seat 3 → female
...
```

The actual visual positions can remain randomized/configurable, but the gender assignment must be deterministic for the room.

Recommended:

```text
6 male seats
6 female seats
```

distributed around the table rather than placing all males on one side.

Do not expose:

> "This is a male seat"

or

> "This is a female seat"

to users.

Open seats should simply appear as:

> Open Seat

---

# 6. ROOM CREATION

When creating a room:

```text
room.capacity = 12

room.male_capacity = 6
room.female_capacity = 6
```

Generate the 12 seats.

Each seat contains:

```text
seat_id
room_id
seat_index
allowed_gender
occupied_by
status
```

Example:

```text
seat_index: 0
allowed_gender: male

seat_index: 1
allowed_gender: female
```

---

# 7. PLAYER JOIN ALGORITHM

When a user presses:

> Play Now

the server must NOT simply select a random room.

It must execute:

### Step 1

Determine the user's gender from the authenticated profile.

### Step 2

Find active Spin the Bottle rooms.

### Step 3

Filter rooms where:

```text
room has available seat
AND
seat.allowed_gender == user.gender
```

### Step 4

Calculate room suitability.

Recommended ordering:

```text
1. valid gender seat
2. room has available capacity
3. room is active
4. room is not currently locked
5. room with existing players
6. room with highest occupancy
7. random tie-break
```

The final tie-break can remain randomized so users do not always enter the same table.

---

# 8. NEVER ASSIGN AN INVALID ROOM

Example:

User:

```text
Female
```

Room A:

```text
Male: 6/6
Female: 4/6
```

Valid.

Room B:

```text
Male: 4/6
Female: 6/6
```

Invalid.

The female user must not enter Room B.

---

# 9. ROOM CHANGE

The existing:

> Change Table

must use the exact same algorithm.

Do NOT:

```text
random room → random seat
```

Instead:

```text
find active rooms
↓
find available seat
↓
check seat gender
↓
check room capacity
↓
check room state
↓
assign valid room
```

If the first candidate fails validation:

```text
candidate 1 → invalid
candidate 2 → invalid
candidate 3 → valid
→ assign
```

The client must never make the final room assignment decision.

The server must be authoritative.

---

# 10. CONCURRENT ROOM JOIN PROTECTION

This is important.

Two users can attempt to claim the same final seat simultaneously.

Use a transaction/row lock or equivalent atomic operation.

Example:

```text
BEGIN

find valid available seat FOR UPDATE

if no seat:
    rollback

claim seat

update room occupancy

COMMIT
```

Never rely on:

```text
client checks available
client waits
client inserts player
```

because this creates race conditions.

---

# 11. ROOM VALIDATION

Before every spin:

```text
valid_players >= 2
AND
exists male player
AND
exists female player
```

Equivalent:

```text
male_count > 0
AND female_count > 0
AND total_players > 1
```

Only then can the bottle spin.

---

# 12. IMPORTANT EXAMPLES

### Example A

```text
3 males
0 females
```

Result:

> **Waiting for more players**

Bottle:

* does not spin
* does not animate
* does not select target
* does not start timer

---

### Example B

```text
3 females
0 males
```

Result:

> **Waiting for more players**

---

### Example C

```text
2 males
1 female
```

Valid.

Bottle may spin.

---

### Example D

```text
1 male
1 female
```

Valid.

Bottle may spin.

---

### Example E

```text
6 males
6 females
```

Valid.

Bottle may spin.

---

# 13. WAITING UI

Do NOT show:

> Waiting for female player

or:

> Waiting for male player

Always display:

> **Waiting for more players**

Optional secondary text:

> The game will start when another player joins.

But avoid revealing gender matchmaking logic.

---

# 14. PLAYER LEAVING BUG

Current bug:

> User leaves room but their ID/profile card remains on table.

This must be fixed at the architecture level.

When leaving:

```text
player membership
→ server removed/deactivated
→ seat released
→ realtime event emitted
→ client removes player
→ seat becomes Open Seat
```

Never simply remove the local React state.

Server state is authoritative.

---

# 15. PLAYER MEMBERSHIP STATES

Use:

```text
ACTIVE
INACTIVE
LEFT
KICKED
DISCONNECTED
```

Only:

```text
ACTIVE
```

players render on the table.

The client must never render a player solely because they existed in an old room snapshot.

---

# 16. REALTIME LEAVE EVENT

When a player leaves:

```text
PLAYER_LEFT
```

payload:

```ts
{
  roomId,
  userId,
  seatIndex,
  timestamp
}
```

Every connected client must:

1. remove that player
2. release visual seat
3. update player count
4. update gender count
5. recalculate whether game can continue
6. update waiting state if required

---

# 17. CURRENT ROUND SAFETY

If the leaving user is:

* spinner
* target

during an active round, the server must handle it explicitly.

Do not let the client continue a round involving a player who no longer belongs to the room.

Recommended state transition:

```text
ACTIVE ROUND
↓
PLAYER LEFT
↓
SERVER CANCELS ROUND
↓
REALTIME ROUND_CANCELLED
↓
CLIENT resets round
↓
recalculate valid players
```

Do not leave stale target/spinner IDs in state.

---

# 18. GIFTING — GENDER FILTER

The Gift Drawer must have three filter options:

```text
All
Guys
Girls
```

Default:

> All

---

# 19. GIFT FILTER BEHAVIOR

### All

Display:

```text
all eligible players
```

excluding current user.

### Guys

Display:

```text
gender = male
```

excluding current user.

### Girls

Display:

```text
gender = female
```

excluding current user.

Do not allow the current user to appear as a gift recipient.

---

# 20. GIFT DRAWER UX

Recommended structure:

```text
────────────────────────────
Send a Gift

[ All ] [ Guys ] [ Girls ]

Recipients
○ Player
○ Player
○ Player

Gift
[ Rose ]
[ Heart ]
[ Chocolate ]
...

Quantity

[ 1 ] [ 10 ] [ 50 ] [ 100 ] [ 1000 ]

────────────────────────────

Selected Gift
Rose

Price:
50 coins × 10 gifts × 11 players

Total:
5,500 coins

[ Send Gift ]
────────────────────────────
```

---

# 21. QUANTITY SELECTOR

Five chips:

```text
1
10
50
100
1000
```

Default:

```text
1
```

Only one quantity can be selected.

---

# 22. BULK GIFT CALCULATION

Let:

```text
giftPrice
quantity
recipientCount
```

Then:

```text
totalCost =
giftPrice × quantity × recipientCount
```

Example:

```text
Rose = 50 coins

Quantity = 10

Recipients = 11

Total =
50 × 10 × 11
= 5,500 coins
```

Display this calculation before confirmation.

---

# 23. "ALL" RECIPIENT RULE

If:

```text
All
```

is selected:

```text
recipients =
all eligible players in room except sender
```

If 12 players exist:

```text
12 - 1 = 11 recipients
```

Do not require manual selection.

---

# 24. FILTER + BULK EXAMPLE

If room contains:

```text
6 males
5 females
current user = male
```

Selecting:

```text
Guys
```

results in:

```text
5 male recipients
```

Selecting:

```text
Girls
```

results in:

```text
5 female recipients
```

Selecting:

```text
All
```

results in:

```text
10 recipients
```

---

# 25. GIFT TRANSACTION MUST BE ATOMIC

The server should receive something similar to:

```ts
sendBulkGift({
  roomId,
  giftId,
  recipientFilter,
  quantity
})
```

The server calculates recipients itself.

Never trust the client to send:

```text
recipientCount
totalPrice
coinAmount
```

Those are calculated server-side.

---

# 26. GIFT TRANSACTION

Server:

```text
BEGIN

authenticate sender

verify room membership

find eligible recipients

verify gift is active

calculate quantity

calculate total cost

verify sender balance

deduct coins

create gift transactions

update recipient gift statistics

COMMIT
```

If anything fails:

```text
ROLLBACK
```

No partial bulk gifts.

---

# 27. INSUFFICIENT COINS

If:

```text
balance < totalCost
```

DO NOT:

* close gift drawer unexpectedly
* throw generic error
* partially send gifts
* silently fail

Instead open:

> **Not Enough Coins**

Message:

> You don't have enough coins to send these gifts.

Actions:

```text
Cancel
Buy Coins
```

Use the existing coin-purchase modal.

This must work identically on:

* Web
* Capacitor Android
* Capacitor iOS

---

# 28. GIFT SUCCESS

After successful sending:

* close confirmation state
* update coin balance immediately from server result
* update gift counters
* show gift animation
* show recipient gift animation where appropriate
* emit realtime gift events

For bulk gifts, avoid triggering 1,000 separate client animations.

Aggregate where necessary.

Example:

> 🎁 You sent 10 Roses to 11 players

---

# 29. STICKER SYSTEM

Stickers are **PNG media assets**.

Admin must be able to upload sticker images.

Recommended supported format:

```text
PNG
```

with transparent backgrounds supported.

---

# 30. STICKER SET STRUCTURE

A sticker set contains:

```text
Sticker Set
    ↓
7–8 PNG stickers
```

Admin creates:

```text
Love Pack
Fun Pack
Game Night Pack
```

etc.

Each set has:

```text
id
name
description
cover_image
league_requirement
season_requirement
event_requirement
coin_price
subscription_requirement
is_active
sort_order
created_at
updated_at
```

---

# 31. INDIVIDUAL STICKER

Each sticker:

```text
id
set_id
name
image_url/storage_path
sort_order
is_active
created_at
updated_at
```

---

# 32. STICKER ACQUISITION METHODS

A sticker set may be available through:

### Coins

```text
price = 500 coins
```

### League

```text
required_league = Gold
```

### Season

```text
required_season = Season 4
```

### Event

```text
required_event = Summer Event
```

### Subscription

```text
required_subscription = Premium
```

Admin can configure the acquisition mechanism.

---

# 33. STICKER ADMIN UPLOAD

Admin flow:

```text
Admin Dashboard
→ Stickers
→ Sticker Sets
→ Create Set
→ Upload cover
→ Add stickers
→ Upload 7–8 PNG files
→ Reorder
→ Configure acquisition
→ Publish
```

Provide drag-and-drop ordering.

---

# 34. STICKER CHAT UI

In Game Chat composer:

```text
[ + ] [ message................ ] [ sticker ] [ send ]
```

Clicking sticker opens a Telegram-style drawer.

Structure:

```text
────────────────────────
Sticker Drawer

[Love] [Fun] [Game]

❤️ 😘 💕 😎 🎉 😂
🔥 💋 🥰 🎮 👑

────────────────────────
```

Sticker sets should be horizontally selectable.

---

# 35. STICKER PERFORMANCE

Sticker drawer must feel instant.

Requirements:

* CDN/object storage
* thumbnails
* lazy loading
* browser caching
* prefetch active sticker set
* avoid downloading original large PNGs until needed
* optimized dimensions
* use WebP/AVIF thumbnails if infrastructure supports it, while preserving uploaded PNG as source asset

The admin-uploaded PNG remains the canonical asset.

---

# 36. GAMES PAGE — COMPLETE UI CHANGE

Remove the special giant Spin the Bottle banner.

Every game must use the same card architecture.

Example:

```text
┌──────────────────────────┐
│                          │
│       GAME IMAGE         │
│                          │
│   🟢  128 playing        │
│                          │
│   Spin the Bottle        │
│   Party social game      │
│                          │
│       [ Play ]           │
└──────────────────────────┘
```

---

# 37. GAMES GRID

Desktop:

```text
4 cards per row
```

depending on available width.

Tablet:

```text
3 cards
```

Mobile:

```text
2 cards per row
```

The grid should be responsive rather than fixed-width.

Recommended CSS:

```text
grid-template-columns:
repeat(auto-fit/minmax(...))
```

but tune breakpoints so mobile explicitly remains 2 columns.

---

# 38. GAME CARD INFORMATION

Each card can contain:

### Image

Admin-uploaded.

### Name

Example:

> Spin the Bottle

### Description

Short description.

### Active players

```text
🟢 👥 128
```

Use:

* people SVG/icon
* number
* green pulsing dot

Example:

> 🟢 128

---

# 39. ACTIVE PLAYER COUNT

This must be realtime or near-realtime.

Count:

```text
currently active game sessions
```

not total historical players.

Do not count users who:

* left the game
* timed out
* disconnected beyond the configured threshold

Recommended:

```text
heartbeat
last_active_at
```

and server-side cleanup.

---

# 40. ACTIVE PLAYER ANIMATION

Green indicator:

```text
●
```

with subtle pulse.

Do not make it distracting.

Animation:

```text
opacity
scale
```

approximately every 1.5–2 seconds.

Respect:

```text
prefers-reduced-motion
```

---

# 41. COMING SOON GAMES

Inactive games remain visible.

They should NOT simply be hidden.

Example:

```text
┌────────────────────────┐
│     faded image        │
│                        │
│    ✨ COMING SOON ✨    │
│                        │
│      Ludo              │
│                        │
└────────────────────────┘
```

Requirements:

* card image faded
* subtle dark overlay
* animated Coming Soon text
* card remains visually attractive
* Play button disabled
* clicking can show a small informational message

Example:

> Ludo is coming soon.

---

# 42. ACTIVE VS INACTIVE

Active:

```text
100% visual prominence
```

Inactive:

```text
reduced opacity
dark overlay
Coming Soon animation
disabled interaction
```

Do not use completely disabled/gray UI that makes the card look broken.

---

# 43. FUTURE GAME TYPES

Database must support:

```text
SPIN_BOTTLE
TRUTH_OR_DARE
LUDO
PARTY_QUIZ
CARD_GAME
WORD_GAME
CUSTOM
```

Do not hardcode the game list into React.

---

# 44. GAME MODE SUPPORT

Every game should support configuration:

```text
group
two_player
both
```

Example:

### Spin the Bottle

```text
group
```

### Ludo

```text
group
two_player
```

The UI can eventually show:

```text
Play with Room
Play with Friend
```

But gameplay implementation is outside this phase.

For now, store the capability in the database.

---

# 45. MAIN GAME LANDING SCREEN

The current mobile layout can remain conceptually similar, but improve the data presentation.

Top section:

```text
Profile
Level
Game Points
Games Played
Kisses
Gifts
Coins
```

Use compact game-themed icons.

Do NOT display only game statistics.

The screen should eventually accommodate:

### Game Stats

* Game Points
* Games Played
* Game Streak
* Wins
* Current League

### Social/Dating Stats

* Overall Chemistry
* Dating Activity
* Likes
* Matches
* Quicky Points
* Dating Streak

This keeps the screen useful outside Spin the Bottle.

---

# 46. CHEMISTRY CALCULATION

Chemistry must be a combined metric.

It should consider both:

### Dating activity

Examples:

* interactions
* matches
* likes
* meaningful conversations
* profile engagement
* dating activity/streak

### Game activity

Examples:

* games played
* game participation
* game interactions
* successful game interactions
* game streak
* received/sent game interactions

Do not calculate Chemistry purely from Spin the Bottle.

---

# 47. CHEMISTRY ENGINE

Create a dedicated service:

```text
ChemistryService
```

Example conceptual model:

```text
dating_score
+
game_score
+
engagement_score
=
chemistry_score
```

Normalize the result to:

```text
0–100
```

The exact weighting should be configurable rather than hardcoded.

Example configuration:

```json
{
  "datingWeight": 0.5,
  "gameWeight": 0.4,
  "engagementWeight": 0.1
}
```

Admin should eventually be able to adjust these weights.

Do not calculate Chemistry directly inside UI components.

---

# 48. CHEMISTRY BETWEEN TWO USERS

For a future partner-specific chemistry score:

```text
User A ↔ User B
```

combine:

```text
dating interactions between A/B
+
game interactions between A/B
+
chat interactions
+
Quicky interactions
```

Keep this separate from the global user Chemistry score.

Recommended fields:

```text
global_chemistry
relationship_chemistry
```

---

# 49. GAME CHAT ARCHITECTURE

The previous Game Chat requirements remain.

There must be one shared chat architecture for:

```text
Dating Contacts
Game Contacts
```

with tabs:

```text
Game
Dating
```

---

# 50. CHAT CONTACT PAGE

On mobile:

```text
Chat
│
├── Game Contacts
│
└── Dating Contacts
```

Selecting contact:

```text
Contacts
→ Personal Chat
```

On Web:

```text
┌──────────────────┬─────────────────────────────┐
│ Contacts         │ Personal Chat               │
│                  │                             │
│ User A           │ Header                      │
│ User B           │                             │
│ User C           │ Messages                    │
│                  │                             │
│                  │ Composer                    │
└──────────────────┴─────────────────────────────┘
```

WhatsApp Web-style architecture.

---

# 51. GAME ROOM CHAT BUTTON

Near the room chat composer add:

```text
Message icon
```

Click:

```text
Game/Dating Contacts
```

Then select contact.

On Web:

```text
room chat panel
→ contacts
→ personal chat
```

On mobile:

```text
room
→ contacts screen
→ personal chat screen
```

Game session continues in background.

---

# 52. WEB CHAT ALIGNMENT FIX

The personal chat must NEVER appear as a floating/left-side overlay on top of the game table.

The existing bug:

```text
personal chat
floating over game table
```

must be removed.

Instead:

```text
┌──────────────────────────────┬───────────────────┐
│                              │ Room Chat /       │
│       GAME TABLE             │ Contacts /        │
│                              │ Personal Chat     │
│                              │                   │
└──────────────────────────────┴───────────────────┘
```

The right room-chat panel becomes a stateful container:

```text
ROOM_CHAT
CONTACT_LIST
PERSONAL_CHAT
```

---

# 53. WEB CHAT BACK FLOW

If opened directly from a profile:

```text
Game Room
→ Personal Chat
```

Back:

```text
Personal Chat
→ Contact List
```

Back:

```text
Contact List
→ Room Chat
```

Do NOT force the user through an unrelated page.

---

# 54. MOBILE CHAT BACK FLOW

Same conceptual stack:

```text
Game Room
↓
Contacts
↓
Personal Chat
```

Back:

```text
Personal Chat
↓
Contacts
↓
Game Room
```

Browser/Capacitor navigation must preserve this stack.

---

# 55. ADMIN DASHBOARD — COMPLETE REDESIGN

Do not simply add more menu items to the existing user-facing dashboard.

Create a dedicated:

> **Quicky Admin Console**

with completely different visual hierarchy.

---

# 56. ADMIN DESIGN

Admin dashboard should feel like:

* SaaS administration platform
* analytics dashboard
* moderation console
* content management system

Not like the normal Quicky user application.

Use:

```text
dark professional admin shell
left sidebar
top command/header bar
responsive content area
cards
tables
charts
filters
drawers
confirmation dialogs
```

---

# 57. ADMIN SIDEBAR

Recommended:

```text
Dashboard

Users
 ├─ All Users
 ├─ Active Users
 ├─ Suspended Users
 └─ Reports

Games
 ├─ All Games
 ├─ Game Configuration
 ├─ Active Sessions
 └─ Game Statistics

Spin the Bottle
 ├─ Rooms
 ├─ Live Tables
 ├─ Room Settings
 └─ Matchmaking

Gifts
 ├─ Categories
 ├─ Gifts
 └─ Transactions

Stickers
 ├─ Sticker Sets
 ├─ Stickers
 └─ Unlock Rules

Chats
 ├─ Game Chats
 ├─ Dating Chats
 └─ Reports

Subscriptions

Coins / Economy

Events

Leagues

Seasons

Notifications

Complaints

Moderation

Analytics

Settings

Admin Users
```

---

# 58. ADMIN GAME MANAGEMENT

Admin can create/edit:

```text
game name
slug
description
icon
card image
banner image
active/inactive
coming soon
sort order
supported modes
minimum players
maximum players
game points label
rules
How It Works content
loading texts
```

---

# 59. GAME CARD IMAGE MANAGEMENT

Admin must be able to:

```text
Upload image
Replace image
Preview image
Delete image
Crop/resize if supported
```

The image is stored in storage, not as a hardcoded URL in React.

---

# 60. HOW IT WORKS MANAGEMENT

Admin can create multiple rule slides.

Example:

```text
Rule 1
Title
Description
Icon

Rule 2
Title
Description
Icon
```

Admin can set:

```text
sort_order
duration
active
```

The frontend automatically rotates through them.

No hardcoded rule text.

---

# 61. GAME LOADING SCREEN

Loading text should also be admin-configurable.

Example:

```text
Finding players...
Preparing the table...
Looking for your match...
Getting the bottle ready...
Almost there...
```

Admin controls:

```text
text
order
active/inactive
```

The frontend randomly/sequentially rotates them according to configuration.

---

# 62. ADMIN GIFT MANAGEMENT

Admin can manage:

### Categories

```text
name
icon
sort order
active
```

### Gifts

```text
name
category
PNG/icon
coin price
sort order
active
```

### Gift rules

```text
maximum quantity
bulk sending enabled
```

---

# 63. ADMIN STICKER MANAGEMENT

Admin can:

```text
Create sticker set
Upload cover
Upload PNG stickers
Reorder stickers
Edit sticker names
Enable/disable stickers
Set acquisition method
Set coin price
Set event requirement
Set league requirement
Set season requirement
Set subscription requirement
Publish/unpublish
```

---

# 64. ADMIN LIVE GAME MONITOR

Create:

> **Live Tables**

Admin sees:

```text
Room ID
Game
Players
Male
Female
Round
Status
Created
Last activity
```

Example:

```text
#SPIN-1024
Spin the Bottle
8 / 12
4M / 4F
Round 7
Decision
Active
```

Admin should be able to inspect a room without manipulating game state unless explicitly given moderation controls.

---

# 65. ROOM DEBUGGING

Admin should have a room detail view:

```text
Room
├── Players
├── Seats
├── Gender distribution
├── Current round
├── Events
├── Chat activity
├── Membership events
└── Server timestamps
```

This will make future debugging significantly easier.

---

# 66. ADMIN USER MANAGEMENT

Create proper admin roles.

Recommended:

```text
SUPER_ADMIN
GAME_ADMIN
CONTENT_ADMIN
MODERATOR
SUPPORT
```

Permissions should be server-side.

Never rely on:

```text
if(user.email === ...)
```

in frontend code.

---

# 67. ADMIN AUDIT LOG

Every sensitive admin action should create:

```text
admin_id
action
entity_type
entity_id
old_value
new_value
timestamp
ip/session metadata where appropriate
```

Examples:

```text
GAME_UPDATED
GIFT_PRICE_CHANGED
STICKER_SET_PUBLISHED
USER_SUSPENDED
ROOM_ACTION
```

---

# 68. DATABASE STRUCTURE

Use existing schema where possible rather than duplicating existing tables.

Additional/required concepts:

### `game_definitions`

```text
id
slug
name
description
card_image
icon
status
sort_order
supports_group
supports_two_player
min_players
max_players
game_points_label
created_at
updated_at
```

---

### `game_rules`

```text
id
game_id
title
description
icon
sort_order
display_duration
is_active
created_at
updated_at
```

---

### `game_loading_messages`

```text
id
game_id
message
sort_order
is_active
created_at
updated_at
```

---

### `game_sessions`

Existing equivalent should be reused if present.

Must support:

```text
game_id
room_id
status
last_activity_at
created_at
```

---

### `game_room_seats`

```text
id
room_id
seat_index
allowed_gender
user_id
status
created_at
updated_at
```

---

### `game_room_members`

```text
id
room_id
user_id
seat_index
status
joined_at
last_active_at
left_at
```

---

### `gifts`

Existing gift model should be extended if already present.

---

### `gift_transactions`

Must support bulk sending:

```text
id
sender_user_id
receiver_user_id
gift_id
quantity
unit_price
total_price
room_id
created_at
```

---

### `sticker_sets`

```text
id
name
description
cover_image
unlock_type
coin_price
required_event_id
required_league_id
required_season_id
required_subscription_id
is_active
sort_order
created_at
updated_at
```

---

### `stickers`

```text
id
sticker_set_id
name
storage_path
thumbnail_path
mime_type
sort_order
is_active
created_at
updated_at
```

---

# 69. GAME PLAYER COUNT

Maintain a reliable active-session model.

For example:

```text
game_sessions.last_activity_at
```

Users are considered active only if:

```text
last_activity_at >= now - activityWindow
```

Do not calculate active players from stale room records.

---

# 70. REALTIME EVENTS

Recommended events:

```text
ROOM_PLAYER_JOINED
ROOM_PLAYER_LEFT
ROOM_UPDATED
ROOM_ROUND_STARTED
ROOM_ROUND_CANCELLED
ROOM_ROUND_RESOLVED

GIFT_SENT
GIFT_BALANCE_UPDATED

GAME_ACTIVE_COUNT_UPDATED

CHAT_MESSAGE_CREATED
CHAT_MESSAGE_READ
CHAT_MESSAGE_REACTION
STICKER_SENT
```

---

# 71. SERVER AUTHORITY

Critical game rules must never be decided solely by the client.

Server owns:

* room assignment
* seat assignment
* gender compatibility
* room capacity
* round validity
* target selection
* response deadline
* game result
* coin balance
* gift recipient calculation
* gift price
* sticker ownership
* game points
* chemistry calculation

Client owns:

* rendering
* animation
* optimistic UI where safe
* local navigation
* interaction feedback

---

# 72. SPIN STATE MACHINE

Use an explicit state machine.

```text
WAITING
↓
READY
↓
SPINNING
↓
TARGET_SELECTED
↓
WAITING_FOR_RESPONSES
↓
RESOLVED
↓
RESULT_DISPLAY
↓
READY
```

If a player leaves:

```text
ANY ACTIVE STATE
↓
ROUND_CANCELLED
```

If insufficient valid players:

```text
WAITING
```

---

# 73. NO SPIN CONDITION

Before every spin:

```ts
const canSpin =
  totalPlayers > 1 &&
  malePlayers.length > 0 &&
  femalePlayers.length > 0;
```

But the authoritative check must be server-side.

Client can use the same logic only for rendering.

---

# 74. LAST-MOMENT RESPONSE

Keep the previous race-condition fix.

The server must use:

```text
response_deadline
server timestamp
transaction/lock
```

If response reaches server before deadline:

> Accept.

Even if the client's displayed timer has reached `0`.

Do not return:

> Already resolved

merely because the client timer reached zero.

---

# 75. IMMEDIATE RESULT

As soon as both players respond:

```text
response A
+
response B
=
resolve immediately
```

Do not wait for the timer.

If timer expires:

```text
resolve immediately
```

Then emit:

```text
ROUND_RESOLVED
```

---

# 76. KISS POINT UPDATE

When a qualifying result gives a kiss point:

```text
server transaction
→ recipient Game/Kiss Point +1
→ result event
→ HUD update
→ heart animation
```

Do not allow duplicate realtime events to increment twice.

---

# 77. MOBILE HEART ANIMATION

When receiving a point:

```text
+1
```

animate toward the top heart icon.

Suggested:

```text
scale: 1 → 1.35 → 1
opacity: 1 → 0
translateY: 0 → -40px
```

Duration:

```text
500–800ms
```

The heart HUD can briefly pulse.

---

# 78. MOBILE GAME LANDING

Keep the current mobile layout direction, but make it cleaner.

Structure:

```text
Header
Profile summary
Game/Dating statistics
Play Now
How It Works
Game Chats
My Friends
```

Stats should use compact themed icons.

Do not turn the page into a giant statistics dashboard.

---

# 79. GAME COIN BUTTON

Next to coin balance:

```text
1,000  [+]
```

Clicking `+` opens:

> Buy Coins

on both:

* Web
* Capacitor

Use the existing purchase modal.

---

# 80. SETTINGS ON GAME LANDING

Add a settings icon.

It should allow quick edits:

```text
Display Name
Profile Image
```

without forcing the user out of the game area.

After save:

```text
server update
→ game profile refresh
→ room/profile UI refresh
```

---

# 81. FRIENDS

On main Game screen:

```text
My Friends
```

Display users added through:

> Add as Friend

Each friend:

```text
avatar
name
online status
```

Actions:

```text
Chat
View Profile
```

---

# 82. PROFILE TOOLBOX

Clicking a player card opens:

```text
Tag
Message
Profile
Add Friend / Remove Friend
Gift
```

depending on relationship/state.

---

# 83. PROFILE MENU

Inside profile:

```text
...
```

Actions:

```text
Remove Friend
Block
Report / Complaint
```

depending on current relationship.

---

# 84. CHAT USER MENU

In one-to-one chat:

### Friend

```text
Remove Friend
Block
Clear Chat
Complaint
```

### Not Friend

```text
Add Friend
Block
Clear Chat
Complaint
```

---

# 85. CLEAR CHAT

Clear Chat means:

> Remove the conversation history from the user's visible conversation.

Define privacy behavior carefully in implementation.

Recommended:

```text
soft-delete conversation messages for requesting user
```

rather than destroying the other participant's history.

If the product explicitly requires deletion for both users, implement that as a separate server action.

Do not let the client directly delete arbitrary message rows.

---

# 86. COMPLAINT SYSTEM

Complaint form:

```text
Report User

Reason
[ Select ]

Description
[ Text area ]

[ Submit Complaint ]
```

Store:

```text
complaint_id
sender_user_id
reported_user_id
sender_name_snapshot
reported_name_snapshot
reason
description
status
created_at
```

Both user IDs must resolve to profile links in Admin.

---

# 87. ADMIN COMPLAINTS

Admin can later:

```text
view
filter
search
assign
change status
add internal note
take action
```

Statuses:

```text
OPEN
REVIEWING
RESOLVED
DISMISSED
```

---

# 88. ROOM MENTIONS

Clicking a player:

> Mention

must prepare a room-chat mention.

Composer becomes:

```text
@Luna
```

with the username/display name rendered:

* bold
* highlighted
* non-destructive to surrounding text

Cursor should automatically move after the mention.

Example:

```text
@Luna Hey, how are you?
```

---

# 89. @ MENTION AUTOCOMPLETE

When user types:

```text
@
```

open:

```text
┌──────────────────────┐
│ @                    │
├──────────────────────┤
│ avatar Luna          │
│ avatar Alex          │
│ avatar Sarah         │
└──────────────────────┘
```

Filter as the user types:

```text
@lu
```

→ Luna.

Only eligible room participants should appear.

---

# 90. MENTION DATA

Do not rely solely on text parsing.

Store structured mention information.

Example:

```text
message
mentions:
[
  {
    userId,
    displayName,
    startIndex,
    endIndex
  }
]
```

or a dedicated:

```text
chat_message_mentions
```

table.

This guarantees reliable notifications even if names change later.

---

# 91. MENTION NOTIFICATION — USER IN GAME

If mentioned user is currently inside the game room:

### Mobile

Show:

* visual mention indicator
* light haptic vibration

Do not interrupt the game with a large blocking modal.

Example:

```text
💬 Luna mentioned you
```

small toast/badge.

Haptic:

```text
light impact
```

---

# 92. MENTION NOTIFICATION — USER NOT ON GAME SCREEN

If the user is still active in the app but not inside the game:

Show:

> Someone mentioned you in the chat.

Include:

* sender
* room/game
* message preview

For mobile, trigger the appropriate in-app haptic when the notification is presented/received where platform capabilities allow.

---

# 93. MENTION WHEN APP IS BACKGROUND

If the user is not actively using the app, use the existing notification architecture for an in-app/push notification as appropriate.

Do not attempt to fake background haptics through the web client.

The server should create the notification event.

---

# 94. CHAT MESSAGE RENDERING

Mentioned names must render visually:

```text
@Luna
```

with:

* accent background
* bold text
* rounded highlight

Clicking a mention can open that user's profile.

---

# 95. STICKERS IN CHAT

Message types should include:

```text
text
image
voice
sticker
quicky_image
```

No typing indicator.

Continue supporting:

* realtime
* read receipts
* mobile swipe reply
* mobile long press reaction
* web hover actions

---

# 96. QUCKY IMAGE

Retain the previous Quicky Image requirement.

Sending a Quicky Image should:

```text
create message
→ award Quicky Points
→ update streak
→ create unique event
→ prevent duplicate point awards
```

Use server-side idempotency.

---

# 97. QUCKY STREAK

Reuse the existing streak implementation if available.

Do not create a second competing streak engine.

All streak calculations should use server time.

---

# 98. PERFORMANCE REQUIREMENTS

The room must remain smooth while:

* chat is active
* gifts are sent
* realtime messages arrive
* active player counts update
* sticker drawer opens
* game animations run

Separate state domains:

```text
GameState
ChatState
GiftState
UserStatsState
UIState
```

Do not put everything into one giant React state object.

---

# 99. REALTIME SUBSCRIPTION CLEANUP

Every subscription must have:

```text
subscribe
unsubscribe
```

lifecycle.

On:

```text
room change
leave
chat change
logout
component unmount
```

clean up the appropriate subscriptions.

Prevent duplicate listeners.

---

# 100. ADMIN CONTENT MUST NOT REQUIRE DEPLOYMENT

Admin changes to:

* game name
* image
* description
* rules
* loading text
* rule order
* gift price
* gift status
* sticker sets
* sticker images
* acquisition requirements

must become visible to users through database/cache refresh without modifying frontend code.

---

# 101. RESPONSIVE REQUIREMENTS

### Mobile

Use the existing mobile-first design language.

Do not make mobile look like a shrunken desktop.

### Tablet

Expand spacing and card sizes naturally.

### Desktop

Use the entire available viewport.

Never center the entire application inside a tiny mobile-width container.

---

# 102. WEB GAMES PAGE

Desktop structure:

```text
┌─────────────────────────────────────────────────────────┐
│ Top Navigation                                           │
├───────────────┬─────────────────────────────────────────┤
│ Game / Dating │ Games                                    │
│ Stats         │                                         │
│               │  Featured / Recommended                 │
│               │                                         │
│               │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│               │  │game │ │game │ │game │ │game │      │
│               │  └─────┘ └─────┘ └─────┘ └─────┘      │
│               │                                         │
│               │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│               │  │game │ │game │ │game │ │game │      │
│               │  └─────┘ └─────┘ └─────┘ └─────┘      │
└───────────────┴─────────────────────────────────────────┘
```

The existing mobile navigation architecture must not simply be stretched across the desktop.

---

# 103. GAMES CARD ANIMATION

On hover:

```text
image scale: 1 → ~1.03
card elevation increases
metadata slightly translates
```

Keep animations subtle.

No excessive bouncing.

---

# 104. PAGE ANIMATION STANDARD

All major pages should use consistent motion:

```text
page enter
fade + translateY
```

Cards:

```text
fade + small upward movement
```

Dialogs:

```text
fade backdrop
scale 0.96 → 1
```

Respect:

```text
prefers-reduced-motion
```

---

# 105. ADMIN SECURITY

Every admin API must verify:

```text
authenticated user
+
admin role
+
permission
```

on the server.

Never trust:

```text
isAdmin: true
```

from client state.

---

# 106. API STRUCTURE

Recommended endpoints/actions:

```text
GET    /games
GET    /games/:id
GET    /games/:id/rules
GET    /games/:id/loading-messages
GET    /games/:id/active-players

POST   /games/:id/rooms/join
POST   /games/:id/rooms/change
POST   /games/:id/rooms/leave

POST   /games/:id/round/respond

GET    /gifts
POST   /gifts/send

GET    /stickers/sets
GET    /stickers/sets/:id

GET    /chat/contacts
GET    /chat/:conversationId
POST   /chat/messages

POST   /friends
DELETE /friends/:id

POST   /complaints
```

Admin:

```text
GET/POST/PATCH /admin/games
GET/POST/PATCH /admin/games/:id/rules
GET/POST/PATCH /admin/games/:id/loading-messages

GET/POST/PATCH /admin/gifts
GET/POST/PATCH /admin/gift-categories

GET/POST/PATCH /admin/sticker-sets
GET/POST/PATCH /admin/stickers

GET /admin/live-rooms
GET /admin/live-rooms/:id

GET /admin/complaints
PATCH /admin/complaints/:id

GET /admin/analytics
```

Adapt these to the existing API conventions instead of creating duplicate APIs.

---

# 107. MIGRATION STRATEGY

Do not rewrite the whole application blindly.

Implementation order:

### Phase 1 — Audit

Inspect:

```text
games
rooms
players
profiles
chat
gifts
stickers
admin
Supabase realtime
Prisma
API routes
```

Identify existing tables before creating anything.

---

### Phase 2 — Room Architecture

Implement:

```text
6 male / 6 female seats
gender-aware assignment
room-change algorithm
server-side room locking
```

---

### Phase 3 — Leave Bug

Implement:

```text
membership lifecycle
seat release
PLAYER_LEFT realtime event
stale-player cleanup
round cancellation
```

---

### Phase 4 — Spin Validation

Implement:

```text
minimum 2
male > 0
female > 0
```

and:

> Waiting for more players

state.

---

### Phase 5 — Gifting

Implement:

```text
All / Guys / Girls
quantity selector
bulk calculation
atomic deduction
insufficient coin modal
realtime gift events
```

---

### Phase 6 — Stickers

Implement:

```text
sticker sets
PNG upload
7–8 sticker support
unlock rules
chat drawer
caching
```

---

### Phase 7 — Games UI

Replace giant Spin the Bottle banner with:

```text
responsive game grid
equal game cards
active player counts
Coming Soon overlay
```

---

### Phase 8 — Game Landing

Improve:

```text
stats
coin + button
settings
friends
game chats
How It Works
```

---

### Phase 9 — Chemistry

Create centralized:

```text
ChemistryService
```

combining dating + game activity.

---

### Phase 10 — Admin

Build the new:

> Quicky Admin Console

as an independent application shell.

---

# 108. TESTING — ROOM ASSIGNMENT

Test:

### 1

12 males/females capacity enforcement.

### 2

Female user cannot enter a room with no female seat.

### 3

Male user cannot enter a room with no male seat.

### 4

Concurrent joins cannot claim the same seat.

### 5

Change Table follows exact same rules.

### 6

No valid room → appropriate waiting/new-room behavior.

---

# 109. TESTING — SPIN

Test:

```text
0 players
1 male
3 males
3 females
1 male + 1 female
6 male + 6 female
```

Only configurations containing both genders and >1 player may spin.

---

# 110. TESTING — LEAVE

Test:

```text
player leaves
player refreshes
player closes app
player loses connection
player changes room
```

Verify:

```text
seat released
card disappears
room count updates
gender count updates
round safely handled
```

---

# 111. TESTING — GIFTS

Test:

```text
All + 1
All + 10
All + 1000

Guys + 10
Girls + 50

insufficient balance

exact balance

concurrent gift requests

duplicate send
```

Verify no negative balance and no partial bulk transaction.

---

# 112. TESTING — STICKERS

Test:

```text
PNG upload
invalid file
large file
7 stickers
8 stickers
ordering
unlock by coins
unlock by league
unlock by event
unlock by subscription
inactive set
```

---

# 113. TESTING — CHAT

Test:

```text
Game Contacts
Dating Contacts
Room Chat
Personal Chat
Back navigation
Mention button
@ autocomplete
multiple mentions
mention notification
haptic
sticker
image
voice
reply
reaction
read receipt
```

---

# 114. TESTING — WEB

Verify:

* no mobile-width game page on desktop
* no personal-chat overlay on game table
* chat panel correctly occupies its column
* 3/4 game cards per row depending on width
* Coming Soon animation works
* active-player count updates
* admin dashboard is completely separate

---

# 115. TESTING — CAPACITOR

Verify:

* game UI remains mobile-first
* room remains alive while navigating chat
* chat opens correctly
* back navigation works
* mention haptic works
* decision drawer works only on mobile
* coin modal works
* stickers load quickly
* profile settings work without leaving game context

---

# 116. ACCEPTANCE CRITERIA

The implementation is considered complete only when:

### Spin the Bottle

* [ ] Maximum 12 players
* [ ] 6 male-weighted seats
* [ ] 6 female-weighted seats
* [ ] Gender-compatible room assignment
* [ ] Gender-compatible Change Table
* [ ] No invalid seat assignment
* [ ] No spin without >1 player
* [ ] No spin without both genders
* [ ] Correct waiting text
* [ ] Player leaving immediately frees seat
* [ ] Stale cards never remain
* [ ] Active round safely handles player leaving

### Gifts

* [ ] All/Guys/Girls
* [ ] 1/10/50/100/1000
* [ ] Correct total calculation
* [ ] Bulk sending
* [ ] Current user excluded
* [ ] Atomic coin deduction
* [ ] Insufficient coin modal
* [ ] Realtime gift updates

### Stickers

* [ ] Admin PNG upload
* [ ] Sticker sets
* [ ] 7–8 stickers/set
* [ ] Ordering
* [ ] Coin unlock
* [ ] Event unlock
* [ ] League unlock
* [ ] Season unlock
* [ ] Subscription unlock
* [ ] Fast chat drawer

### Games

* [ ] All games equal cards
* [ ] No giant Spin the Bottle banner
* [ ] Active player count
* [ ] Green realtime indicator
* [ ] Coming Soon overlay
* [ ] Faded inactive cards
* [ ] Responsive grid
* [ ] Generic Game Points terminology

### Chat

* [ ] Web WhatsApp-style layout
* [ ] Contacts left
* [ ] Chat right
* [ ] Correct vertical alignment
* [ ] Game/Dating tabs
* [ ] Game-room chat button
* [ ] Direct profile → chat
* [ ] Correct back stack
* [ ] Mention system
* [ ] @ autocomplete
* [ ] Mention visual alert
* [ ] Mobile haptic
* [ ] Notification when outside game

### Admin

* [ ] Separate admin shell
* [ ] Game management
* [ ] Game images
* [ ] Rules
* [ ] Loading messages
* [ ] Gifts
* [ ] Sticker sets
* [ ] Live rooms
* [ ] Users
* [ ] Complaints
* [ ] Analytics
* [ ] Roles/permissions
* [ ] Audit logs

---

# 117. MOST IMPORTANT ARCHITECTURAL RULE

Do **not** solve these requirements by adding more conditions into the existing `SpinBottleRoom.tsx`.

The implementation should be separated into services/modules:

```text
GameRoomService
        ↓
RoomAssignmentService
        ↓
GenderSeatService
        ↓
SpinRoundService
        ↓
GiftService
        ↓
StickerService
        ↓
GameStatsService
        ↓
ChemistryService
```

UI components should consume these services.

For example:

```text
SpinBottleRoom
 ├── RoomTable
 ├── RoomTopHud
 ├── RoomChatPanel
 ├── GiftDrawer
 ├── PlayerActionMenu
 └── DecisionOverlay
```

while backend logic handles:

```text
room assignment
seat validation
gender balancing
round validation
gift calculation
coin deduction
game statistics
chemistry
```

This is especially important because you are planning to add multiple multiplayer games later. **Spin the Bottle should become the first implementation of a generic Quicky Games platform rather than a one-off feature.**

---

## Final target architecture

```text
                         QUICKY GAMES
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
       Games UI          Game Sessions        Game Stats
          │                   │                   │
   ┌──────┼──────┐            │            ┌──────┼──────┐
   │      │      │            │            │      │      │
 Ludo   Spin   Truth      Room Manager   Points Streak Chemistry
              Bottle          │
                              │
                    Gender-balanced rooms
                              │
                       ┌──────┴──────┐
                       │             │
                    6 Male        6 Female
                       │             │
                       └──────┬──────┘
                              │
                       Spin the Bottle
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
       Room Chat          Game Chat            Gifts
          │                   │                   │
       Mentions       Game/Dating Contacts   All/Guys/Girls
                              │                   │
                         Stickers             Bulk Gifts
                                                  │
                                            Coin Economy
```

This structure will let you add **Ludo, Truth or Dare, quizzes, card games and future multiplayer games** without rebuilding the room, chat, gifting, stats, economy, friend, notification, and admin systems every time.
