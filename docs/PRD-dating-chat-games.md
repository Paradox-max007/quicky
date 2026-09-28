# Dating Chat Games — Product Requirements Document

## 1. Objective

Update the existing Dating Chat experience so that games are separated from the general chat actions and launched through a dedicated Games icon.

The Dating Chat Games system will initially contain:

- **Ludo** — Fully playable, private 2-player game.
- **Never Have I Ever** — Visible but marked **Coming Soon**.
- **Truth or Dare** — Removed from the new Games menu for now.

The existing 3-dot menu in the top-right corner of Dating Chat must remain, but the game options currently located there must be removed.

A new **Games** icon should provide access to the available games.

The key Ludo experience is:

```
Chat → Games → Ludo → Private invitation → Opponent accepts → Private 2-player Ludo → Game result → Beautiful game activity card appears in both users' chat.
```

## 2. Important Existing Functionality

Do not rebuild the Dating Chat screen from scratch.

The existing Dating Chat already has:

- Chat messages
- Top navigation
- 3-dot menu
- Existing game-launch button/functionality
- User-to-user conversation
- Existing notification infrastructure, if available
- Existing Ludo game logic/room infrastructure elsewhere in the application

The implementation should extend the existing system.

**Important**

The existing **Dating Premium** system must remain completely unchanged.

These games are part of the Dating Chat experience, but they should not alter Dating Premium.

## 3. Updated Dating Chat Header

The Dating Chat header currently has the existing controls including the 3-dot menu.

Add a dedicated:

**🎮 Games icon**

The icon should be placed in the chat header according to the existing Dating Chat design system.

The exact placement should follow the current header spacing and responsive layout.

Example:

```
┌─────────────────────────────────────────┐
│ ←  User Name          🎮   ⋮            │
└─────────────────────────────────────────┘
```

The actual icon should use the application's existing icon/theme system rather than introducing an unrelated visual style.

## 4. 3-Dot Menu Changes

The existing 3-dot menu/drawer currently contains game options such as:

- Truth or Dare
- Never Have I Ever
- Ludo

These game entries must be **removed** from the 3-dot menu.

### New 3-Dot Menu

It should contain only the existing non-game chat actions.

Do not duplicate the Games menu inside the 3-dot menu.

**Result**

```
3-dot menu
│
├── Existing chat action
├── Existing chat action
├── Existing chat action
└── ...
```

No:

- Ludo
- Never Have I Ever
- Truth or Dare

## 5. Games Menu

Clicking the new Games icon opens the Games interface.

This can be implemented as:

- bottom sheet on mobile
- side drawer where appropriate
- modal/panel on desktop

The presentation should follow the existing application design language.

### Games list

#### Ludo

- **Status:** Available
- **Description:** Challenge your chat partner to a private 2-player Ludo match.
- **Button:** `Play Ludo`

#### Never Have I Ever

- **Status:** Coming Soon
- **Description:** A fun question game for you and your chat partner.

The game must **not** be playable.

Display:

```
Never Have I Ever
COMING SOON
```

The card/button should be visually disabled but still attractive.

Clicking it may show a small informational state such as:

```
Never Have I Ever is coming soon.
```

No room should be created.

#### Truth or Dare

Truth or Dare should **not** appear in the Games menu.

It should also no longer appear in the 3-dot menu.

## 6. Games UI

The Games interface should feel like a dedicated mini game hub rather than a plain dropdown.

Example:

```
┌──────────────────────────────────────┐
│              🎮 Games                │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ 🎲                             │  │
│  │ LUDO                           │  │
│  │ Private 2 Player               │  │
│  │                                │  │
│  │       [ PLAY LUDO ]            │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ 💭                             │  │
│  │ NEVER HAVE I EVER              │  │
│  │                                │  │
│  │       COMING SOON              │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

Use the selected application theme.

**Do not hardcode colors.**

## 7. Ludo Game Rules

Ludo launched from Dating Chat must use:

- **Mode:** 2 Player
- **Opponent:** The opponent is automatically the current chat user.

Example:

```
You are chatting with Sarah.

Games → Ludo

Opponent:
Sarah

[ INVITE TO PLAY ]
```

The user should not have to search for or select another player.

## 8. Private Ludo Room

When User A chooses:

```
Play Ludo
```

the backend creates a private Ludo room.

Example:

```
room_id:             generated UUID
game_type:           LUDO
mode:                TWO_PLAYER
visibility:          PRIVATE

player_1:            User A
player_2:            User B

source:              DATING_CHAT
conversation_id:     existing chat ID
```

Only these two users can access the room.

**No public access**

The room must not appear in:

- public game rooms
- random game matchmaking
- game discovery
- community rooms
- public Ludo room lists

## 9. Room Access Security

The server must verify that the authenticated user is one of:

- `player_1`
- `player_2`

before allowing access to the room.

A user attempting to access the room using a manipulated room ID must receive:

```
Access denied
```

The room should also be associated with the original Dating Chat conversation.

## 10. Invitation Flow

When User A creates the Ludo room:

```
User A
   ↓
Creates private Ludo room
   ↓
User B receives mandatory in-app notification
   ↓
User A sees waiting screen
```

The invitation should be sent immediately after successful room creation.

## 11. In-App Game Invitation

User B receives an in-app notification.

Example:

```
┌─────────────────────────────────────┐
│ 🎲 Game Invitation                  │
│                                     │
│ John sent you a Ludo invitation.    │
│                                     │
│      [ PLAY NOW ]  [ NOT NOW ]      │
└─────────────────────────────────────┘
```

The wording should dynamically use the sender's display name.

Example:

```
John sent you a Ludo invitation.
```

## 12. Mandatory Notification

This is an important requirement.

The game invitation notification **must not** behave like a normal dismissible notification.

It **cannot**:

- disappear automatically
- be swiped away
- be dismissed by tapping outside
- disappear when navigating elsewhere
- disappear after a timeout

The user must explicitly select one of:

- `PLAY NOW`
- `NOT NOW`

Only after one of these actions can the invitation be closed.

## 13. Notification Persistence

If the user:

- switches screens
- receives another chat message
- closes another modal
- navigates around the app

the invitation must remain active.

The application should maintain:

```
pending_game_invitation
```

until the user responds.

## 14. Invitation State Machine

The invitation should have explicit server-side states.

```
PENDING
   │
   ├── PLAY_NOW  → ACCEPTED
   │
   └── NOT_NOW  → DECLINED
```

Additional states:

- `EXPIRED`
- `CANCELLED`

These should be handled server-side.

## 15. Sender Waiting Screen

Immediately after User A sends the invitation, User A enters a waiting state.

Example:

```
┌──────────────────────────────────────┐
│              🎲 LUDO                 │
│                                      │
│        Waiting for Sarah...          │
│                                      │
│             ◌ ◌ ◌                   │
│                                      │
│      Invitation sent successfully    │
│                                      │
│       Waiting for response...        │
└──────────────────────────────────────┘
```

The animation should be subtle and theme-aware.

## 16. Waiting Screen Behavior

User A must remain in the game invitation/waiting state while User B decides.

The UI should react immediately to:

- `PLAY NOW`
- `NOT NOW`

through realtime events.

No manual refresh should be required.

## 17. If Opponent Selects PLAY NOW

Flow:

```
User B
   ↓
PLAY NOW
   ↓
Server validates invitation
   ↓
User B joins private room
   ↓
Invitation becomes ACCEPTED
   ↓
User A receives realtime update
   ↓
Both users enter Ludo
```

Both players should transition into the same private Ludo room.

## 18. Ludo Start Screen

Once both players are present:

```
┌─────────────────────────────────────┐
│              LUDO                   │
│                                     │
│      You              Sarah         │
│       👤               👤           │
│                                     │
│           Ready to Play             │
│                                     │
│             [ START ]               │
└─────────────────────────────────────┘
```

If the existing Ludo game already has its own ready/start flow, reuse it.

**Do not duplicate game initialization logic.**

## 19. Existing Ludo Game Logic

The actual Ludo gameplay should use the existing Ludo game implementation where possible.

The Dating Chat integration should primarily provide:

- private room creation
- invitation
- acceptance
- decline
- player association
- navigation
- chat/game history
- room lifecycle

The existing Ludo engine should remain responsible for:

- dice
- turns
- tokens
- movement
- winning
- game state
- realtime synchronization

## 20. Two-Player Requirement

Dating Chat Ludo is strictly:

- Player 1 = inviter
- Player 2 = chat recipient

There is no:

- third player
- spectator
- random player
- public joining
- matchmaking

## 21. NOT NOW Flow

If User B presses:

```
NOT NOW
```

the server should:

1. Mark invitation as `DECLINED`.
2. Delete/close the private Ludo room.
3. Notify User A in realtime.
4. Notify User A in the game waiting screen.
5. Return User B to the Dating Chat.
6. Return User A to the Dating Chat after showing the decline state.

## 22. Sender Decline Message

User A should see an in-game message such as:

```
Sarah isn't in the mood for a game right now. Invite them later.
```

The UI should make it clear that:

- the invitation was declined
- the room is closed
- they can return to the conversation
- they can invite again later

Example:

```
┌─────────────────────────────────────┐
│              🎲 LUDO                │
│                                     │
│       Sarah isn't in the mood       │
│          for a game right now.      │
│                                     │
│          Invite later.              │
│                                     │
│          [ BACK TO CHAT ]           │
└─────────────────────────────────────┘
```

## 23. Recipient Decline Behavior

After pressing `NOT NOW`, User B immediately returns to the Dating Chat.

No game room should remain accessible to either user.

## 24. Room Cleanup

When an invitation is declined:

- Invitation → `DECLINED`
- Room → `CLOSED`
- Room access → revoked
- Waiting state → ended

The room should then be deleted or archived according to the existing game-room architecture.

Prefer soft-close/archive first if the existing game system requires historical records.

## 25. Prevent Duplicate Invitations

The system should prevent User A from creating multiple simultaneous Ludo invitations to the same chat user.

If an invitation is already:

```
PENDING
```

show:

```
Waiting for their response…
```

instead of creating another room.

## 26. Existing Game Room Protection

The backend should prevent:

- duplicate active Ludo rooms between the same two users
- joining an expired room
- joining a declined room
- joining another user's private room
- changing players
- adding spectators

## 27. Game Invitation Timeout

A configurable timeout should exist.

For example:

```
Invitation timeout: 5 minutes
```

If User B does not respond:

```
PENDING
   ↓
EXPIRED
```

The room closes and User A is returned to chat.

The exact timeout should be configurable from admin if desired.

## 28. Realtime Architecture

Use the existing realtime infrastructure.

Important events:

- `GAME_INVITATION_CREATED`
- `GAME_INVITATION_ACCEPTED`
- `GAME_INVITATION_DECLINED`
- `GAME_INVITATION_EXPIRED`

- `LUDO_ROOM_CREATED`
- `LUDO_PLAYER_JOINED`
- `LUDO_GAME_STARTED`
- `LUDO_GAME_FINISHED`
- `LUDO_ROOM_CLOSED`

The client should never need to poll continuously.

## 29. Game Completion

When the Ludo game finishes:

The server determines:

- winner
- loser
- `game_started_at`
- `game_finished_at`
- duration

The game result should be persisted.

## 30. Game Duration

Calculate duration from server timestamps.

```
duration_seconds = finished_at - started_at
```

Do not calculate the final duration only from the client.

This prevents incorrect results if:

- the app is backgrounded
- the browser is closed
- network disconnects
- device clocks differ

## 31. Chat Game Activity Card

After the game finishes, create a special game activity message in the Dating Chat.

This should appear for both users.

It should look significantly more beautiful than a normal text message.

Example:

```
┌──────────────────────────────────────┐
│ 🎲                                   │
│              LUDO                    │
│                                      │
│        You played Ludo               │
│                                      │
│             1h 24m                   │
│                                      │
│          🎮 Game Played              │
└──────────────────────────────────────┘
```

## 32. Required Card Content

The card must contain:

- **Title:** `You played Ludo`
- **Duration:** `for 1h 24m`

The duration should use human-readable formatting.

Examples:

```
for 8m
for 42m
for 1h 12m
for 2h 05m
```

For very long sessions:

```
for 2h 45m
```

Avoid:

```
92 minutes
```

unless appropriate for very short durations.

## 33. Card Should Appear for Both Users

The game activity is a conversation-level event.

Therefore:

```
User A chat → game card
User B chat → same game card
```

The card must not appear as if it was a normal message sent by only one person.

Recommended message type:

```
GAME_ACTIVITY
```

## 34. Game Activity Data Model

Example:

```
ChatMessage
-------------------------
id
conversation_id
message_type
game_type
game_session_id
game_name
started_at
finished_at
duration_seconds
created_at
metadata
```

For this feature:

- `message_type` = `GAME_ACTIVITY`
- `game_type` = `LUDO`
- `game_session_id` = …
- `game_name` = `"Ludo"`
- `duration_seconds` = …

## 35. Game Card Visual Design

The card should feel like a shared memory between the two people.

Possible design:

```
┌──────────────────────────────────────┐
│              🎲 LUDO                 │
│                                      │
│       ✨ GAME COMPLETED ✨           │
│                                      │
│       You played Ludo                │
│                                      │
│              1h 24m                  │
│                                      │
│       ───────────────────            │
│       Shared game memory             │
└──────────────────────────────────────┘
```

Use:

- selected theme
- subtle gradients
- game artwork/icon
- soft animation when first inserted
- responsive sizing
- rounded corners
- subtle shadow/glow
- optional player avatars

**Do not hardcode a single color palette.**

## 36. Game Card Animation

When the card first appears:

- Fade in.
- Slight upward movement.
- Soft scale from approximately 96% → 100%.
- Game icon can have a small entrance animation.

Keep the animation short.

Do not introduce heavy effects that negatively affect low-end mobile devices.

## 37. Reopening Old Game Cards

If the user scrolls back through the conversation, the game card should remain as a historical chat activity.

It should **not** animate repeatedly every time the chat is opened.

The entrance animation should only occur when the activity is newly created/first displayed.

## 38. Game History

The game session should be associated with:

- `conversation_id`
- `player_1_id`
- `player_2_id`

This makes it possible to display historical game activity.

Future games can use the same architecture:

- `LUDO`
- `NEVER_HAVE_I_EVER`
- `TRUTH_OR_DARE`
- …

## 39. Generic Game Invitation Architecture

Do not hardcode the invitation system exclusively for Ludo.

Create a generic structure:

```
GameInvitation
---------------
id
game_type
conversation_id
sender_id
recipient_id
room_id
status
created_at
responded_at
expires_at
```

This allows Never Have I Ever to use the same infrastructure later.

## 40. Game Session Architecture

Create/use:

```
GameSession
-------------
id
game_type
mode
conversation_id
room_id
player_1_id
player_2_id
status
started_at
finished_at
duration_seconds
winner_id
created_at
```

Possible status:

- `CREATED`
- `WAITING`
- `ACTIVE`
- `COMPLETED`
- `CANCELLED`
- `EXPIRED`

## 41. Suggested Database Relationships

```
Conversation
    │
    ├── GameInvitation
    │       │
    │       └── PrivateGameRoom
    │
    ├── GameSession
    │       │
    │       └── LudoGame
    │
    └── ChatMessage
            │
            └── GAME_ACTIVITY
```

## 42. Security

All important actions must be server-authoritative.

The client must not be able to determine:

- opponent identity
- invitation acceptance
- room membership
- game result
- game duration
- winner
- session completion

The server must validate all of these.

## 43. Navigation Flow

### Sender

```
Dating Chat
    ↓
🎮 Games
    ↓
Ludo
    ↓
Invite
    ↓
Private Room Created
    ↓
Waiting for Opponent
    ↓
Opponent accepts
    ↓
Ludo Game
    ↓
Game Finished
    ↓
Game Activity Card
    ↓
Dating Chat
```

### Recipient

```
Dating Chat
    ↓
Game Invitation
    ↓
PLAY NOW
    ↓
Private Ludo Room
    ↓
Ludo Game
    ↓
Game Finished
    ↓
Game Activity Card
    ↓
Dating Chat
```

## 44. Decline Flow

### Sender

```
Dating Chat
    ↓
Games
    ↓
Ludo
    ↓
Invite
    ↓
Waiting...
```

### Recipient

```
    ↓
Invitation
    ↓
NOT NOW
    ↓
Dating Chat
```

### Sender (after decline)

```
    ↓
Realtime decline event
    ↓
"Sarah isn't in the mood for a game right now.
Invite later."
    ↓
Dating Chat
```

## 45. Back Button Rules

### Before invitation

Normal back behavior.

### Sender waiting for response

Do not accidentally destroy the invitation.

If the user tries to leave, the system should handle it according to the invitation state.

Recommended:

```
Your Ludo invitation is still waiting for a response.
```

The pending invitation should remain server-side.

### During active game

Use the existing Ludo game's leave/exit rules.

Do not allow navigation to accidentally corrupt the game state.

## 46. Reconnection

If either player loses network connectivity:

```
Connecting...
```

The game should reconnect automatically.

The server remains the source of truth.

When connection returns:

```
Fetch current GameSession
↓
Restore current Ludo state
↓
Resume game
```

## 47. App Backgrounding

Especially for Capacitor:

When the user:

- locks the phone
- switches apps
- receives a call
- backgrounds the app

the game session must remain valid.

On resume:

```
reconnect
↓
fetch current session
↓
synchronize state
```

**Do not create a second game session.**

## 48. Desktop / Tablet / Mobile

The entire feature must be responsive.

### Mobile

Games menu:

- bottom sheet or compact modal
- touch-friendly cards
- full-screen Ludo where appropriate

### Tablet

Use larger cards and appropriate spacing.

### Desktop

Games can use a centered modal/panel.

The Ludo game should use the existing responsive Ludo interface.

No fixed-size assumptions that break:

- small phones
- large phones
- tablets
- laptops
- large monitors

## 49. Capacitor Requirements

The same feature must work in:

- Android
- iOS

using the existing Capacitor application.

Important:

- safe-area support
- touch interactions
- keyboard handling
- app resume
- realtime reconnection
- notification state persistence
- responsive game layout
- no accidental browser-style navigation

## 50. Theme Integration

The feature must use the application's existing theme system.

Do not hardcode:

```css
background: #123456;
```

for the new components.

Instead use the existing theme tokens:

- `theme.background`
- `theme.surface`
- `theme.primary`
- `theme.secondary`
- `theme.text`
- `theme.border`
- `theme.accent`

The Games cards, invitation notification, waiting screen, Ludo launch UI and game activity card should all automatically adapt to the selected theme.

## 51. Never Have I Ever — Coming Soon

Never Have I Ever should be implemented as a game catalog entry only.

It should have:

```
status = COMING_SOON
```

The game should **not**:

- create a room
- send an invitation
- start a session
- appear playable
- create a chat activity

Click behavior:

```
Tap
 ↓
Small feedback/modal
 ↓
"Never Have I Ever is coming soon."
```

## 52. Future-Proof Game Registry

Create a configurable game registry rather than hardcoding games throughout the chat UI.

Example:

```
GameRegistry

LUDO
  status:       AVAILABLE
  mode:         PRIVATE_2_PLAYER
  launchType:   INVITATION

NEVER_HAVE_I_EVER
  status:       COMING_SOON
  mode:         PRIVATE_2_PLAYER
  launchType:   INVITATION
```

Future games can be added without rewriting the Games UI.

## 53. API Requirements

Suggested endpoints/actions:

### Create invitation

```
POST /games/invitations
```

Request:

```json
{
  "conversationId": "...",
  "recipientId": "...",
  "gameType": "LUDO"
}
```

### Accept invitation

```
POST /games/invitations/{id}/accept
```

### Decline invitation

```
POST /games/invitations/{id}/decline
```

### Get active invitation

```
GET /games/invitations/active
```

### Get game session

```
GET /games/sessions/{id}
```

### Complete game

The Ludo backend should complete the session through the existing authoritative game engine rather than trusting a client request.

## 54. Idempotency

Invitation actions must be idempotent.

If the user taps:

```
PLAY NOW
```

twice:

Only one acceptance should occur.

Likewise:

```
NOT NOW
```

must not cause duplicate room deletion or duplicate notifications.

Use:

- `invitation_id`
- `request_id`

for idempotency.

## 55. Notifications

The system should support:

### Recipient notification

```
John sent you a Ludo invitation.
```

### Sender acceptance update

```
Sarah accepted your Ludo invitation.
```

This can be shown inside the game/waiting screen rather than necessarily as another system notification.

### Sender decline update

```
Sarah isn't in the mood for a game right now. Invite later.
```

## 56. Chat Activity Message

The completed game should create one shared chat activity.

Example database event:

```
GAME_ACTIVITY

game:      LUDO
players:   User A, User B
duration:  01:24:32
result:    COMPLETED
```

The UI renders:

```
🎲 You played Ludo for 1h 24m
```

for both participants.

## 57. Important: Do Not Create Two Messages

Do not create:

```
User A → "You played Ludo..."
User B → "You played Ludo..."
```

Instead create one conversation-level game activity.

Both users retrieve/render the same activity.

This prevents duplicated history.

## 58. Analytics

Track:

- `games_menu_opened`
- `ludo_selected`
- `ludo_invitation_created`
- `ludo_invitation_received`
- `ludo_invitation_accepted`
- `ludo_invitation_declined`
- `ludo_invitation_expired`
- `ludo_game_started`
- `ludo_game_completed`
- `ludo_game_abandoned`
- `game_duration`

For Never Have I Ever:

- `never_have_i_ever_viewed`
- `never_have_i_ever_coming_soon_clicked`

These events can later help determine which games users actually want.

## 59. Error States

Handle:

- **Opponent unavailable**

  ```
  This player is currently unavailable. Try again later.
  ```

- **Existing invitation**

  ```
  You already have a Ludo invitation waiting.
  ```

- **Room creation failure**

  ```
  We couldn't start the game. Please try again.
  ```

- **Invitation expired**

  ```
  The game invitation has expired.
  ```

- **Opponent already playing another private game**

  ```
  They're currently playing another game.
  ```

- **Network failure**

  ```
  Connection lost. Reconnecting…
  ```

## 60. Race Conditions

Important scenarios must be handled server-side.

- Both users open the invitation simultaneously → Only one state transition is allowed.
- Sender cancels while recipient presses `PLAY NOW` → Server determines the final valid state.
- Invitation expires while recipient presses `PLAY NOW` → Server rejects the expired invitation.
- User presses `PLAY NOW` multiple times → Only one room join occurs.

## 61. Room Lifecycle

### Happy path

```
CREATE
  ↓
WAITING
  ↓
ACCEPTED
  ↓
ACTIVE
  ↓
COMPLETED
  ↓
CLOSED
```

### Decline

```
CREATE
  ↓
WAITING
  ↓
DECLINED
  ↓
CLOSED
```

### Timeout

```
CREATE
  ↓
WAITING
  ↓
EXPIRED
  ↓
CLOSED
```

## 62. Performance Requirements

The feature must remain lightweight.

Avoid:

- unnecessary polling
- repeatedly re-rendering the chat
- large game assets inside chat
- heavy animations
- duplicate realtime subscriptions

Realtime subscriptions should be cleaned up when the relevant screen/session closes.

## 63. Realtime Subscription Rules

The chat listens for:

- new chat messages
- game invitations
- game activity

The Ludo screen listens for:

- game state
- turn changes
- dice events
- player state
- room events

When leaving Ludo:

```
unsubscribe Ludo channels
```

Do not keep Ludo realtime subscriptions alive in the background unnecessarily.

## 64. Final User Experience

The desired experience should feel like:

> "We're chatting, let's play something."

Not:

> "I'm leaving the dating app to enter a completely separate game application."

The transition should therefore be smooth and connected to the conversation.

## 65. Final Product Flow

```
                  DATING CHAT
                       │
                       ▼
                 ┌───────────┐
                 │ 🎮 Games  │
                 └─────┬─────┘
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
          LUDO          NEVER HAVE I EVER
       AVAILABLE            COMING SOON
             │
             ▼
       INVITE CHAT USER
             │
             ▼
      PRIVATE ROOM CREATED
             │
             ├──────────────────────┐
             ▼                      ▼
       SENDER WAITING          RECIPIENT
                                    │
                             MANDATORY INVITE
                                    │
                          ┌─────────┴─────────┐
                          ▼                   ▼
                      PLAY NOW             NOT NOW
                          │                   │
                          ▼                   ▼
                    JOIN ROOM            CLOSE ROOM
                          │                   │
                          ▼                   ▼
                    2 PLAYER LUDO        BACK TO CHAT
                          │
                          ▼
                    GAME FINISHED
                          │
                          ▼
                  GAME ACTIVITY CARD
                          │
                    ┌─────┴─────┐
                    ▼             ▼
                 USER A        USER B
                    │             │
                    └─────┬───────┘
                          ▼
                    DATING CHAT
```

## 66. Acceptance Criteria

The implementation is complete when:

- [ ] Existing 3-dot Dating Chat menu remains functional.
- [ ] Ludo is removed from the 3-dot menu.
- [ ] Never Have I Ever is removed from the 3-dot menu.
- [ ] Truth or Dare is removed from the 3-dot menu.
- [ ] New Games icon exists in Dating Chat.
- [ ] Games menu opens responsively.
- [ ] Ludo appears as available.
- [ ] Never Have I Ever appears as Coming Soon.
- [ ] Truth or Dare does not appear.
- [ ] Ludo automatically targets the current chat user.
- [ ] Ludo creates a private 2-player room.
- [ ] Only the two users can access the room.
- [ ] Recipient receives an in-app Ludo invitation.
- [ ] Invitation cannot be dismissed without selecting Play Now or Not Now.
- [ ] Sender sees a realtime waiting screen.
- [ ] Play Now joins the recipient to the private room.
- [ ] Both users enter the same Ludo session.
- [ ] Not Now immediately declines the invitation.
- [ ] Sender receives realtime decline feedback.
- [ ] Decline message says the user isn't in the mood for a game and to invite later.
- [ ] Private room is closed after decline.
- [ ] Recipient returns to Dating Chat.
- [ ] Sender returns to Dating Chat.
- [ ] Ludo uses the existing Ludo game engine.
- [ ] Game completion is server-authoritative.
- [ ] Game duration is calculated using server timestamps.
- [ ] A single shared game activity is created in the conversation.
- [ ] Both users see the same beautiful game card.
- [ ] Card displays game name.
- [ ] Card displays how long they played.
- [ ] Game activity remains in chat history.
- [ ] Game card does not repeatedly animate when reopening the chat.
- [ ] Theme switching works automatically.
- [ ] Web is responsive.
- [ ] Capacitor Android works.
- [ ] Capacitor iOS works.
- [ ] Reconnection is handled.
- [ ] Duplicate invitations are prevented.
- [ ] Duplicate acceptance/decline actions are prevented.
- [ ] Expired invitations are handled.
- [ ] Private room access is server-authorized.
- [ ] No Dating Premium functionality is modified.
- [ ] Games remain a separate feature within Dating Chat.

## 67. Implementation Principle

The implementation should reuse the existing chat, notification, realtime, theme and Ludo infrastructure wherever possible.

Do not create parallel versions of:

- chat
- notifications
- users
- themes
- Ludo game logic
- realtime infrastructure

Build the Dating Chat Games feature as an **integration layer** around the existing systems.

The architecture should also be generic enough that when Never Have I Ever is ready, it can use the same:

```
Games Menu
      ↓
Game Invitation
      ↓
Private Room
      ↓
Game Session
      ↓
Game Completion
      ↓
Chat Game Activity
```

without requiring another redesign of Dating Chat.
