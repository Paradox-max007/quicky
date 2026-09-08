# Implementation Plan

Three discrete features in one pass, each in its own phase so changes are easy to review and revert.

---

## Phase 1 — Per-post commenting ON/OFF

**Schema**
- Add `commentsEnabled Boolean @default(true)` to `CommunityPost` in `prisma/schema.prisma` (~line 309).
- `npx prisma db push` + `prisma generate`.

**API — `src/app/api/quicky/community/posts/route.ts`**
- `POST` body: accept optional `commentsEnabled: boolean` (default `true`), persist.
- `GET` feed: include `commentsEnabled` in each post payload (line ~37).

**API — `src/app/api/quicky/community/posts/[postId]/comments/route.ts`**
- `POST` (line ~33): after auth + post lookup, short-circuit with `403` + `{ error: 'Comments are off on this post' }` when `post.commentsEnabled === false`. This enforces the gate server-side regardless of UI.

**API client — `src/lib/quicky/api-client.ts`**
- Extend `api.community.create` payload type (line ~178) with `commentsEnabled?: boolean`.
- Add `api.community.editMeta?(postId, patch)` later if needed — out of scope for this phase.

**Composer — `src/components/quicky/MediaComposer.tsx`**
- Add `commentsEnabled` state (default `true`).
- In the step-2 toolbar (after the filter strip, ~line 200), render a small toggle row: "Allow comments" with a Switch (use a tiny inline Switch component — no new dependency). Tailwind matches the existing toggle styling.
- Pass the value to `api.community.create` in `share()` (line ~58).

**Feed rendering — `src/components/quicky/CommunityScreen.tsx`**
- Extend the `Post` type (line ~31) with `commentsEnabled: boolean`.
- In the actions row (line ~367-376), wrap the comment `<button>` in `post.commentsEnabled && ( … )` so the icon disappears entirely. Likewise the "View all N comments" link (line ~394).
- The feed needs to keep showing the comment count for *owner* awareness, but since the icon is hidden for the owner too, we can simply hide the count line for non-owners and not display it. Owners viewing their own post will see the icon regardless (for moderation). Simplest: only render count + icon when `commentsEnabled`.

**No new dependencies. No new env vars. No realtime changes.**

---

## Phase 2 — Double-tap to like on community posts

**Hook — new file `src/lib/quicky/useDoubleTap.ts`**
- Extract the 300ms/30px-radius detector that already exists in `ChatView.tsx` lines 122-142 into a reusable hook so both chat (existing) and community can share it.
- Refactor `ChatView.tsx` to import the hook (delete the local copy) — pure code cleanup, no behavior change.

**Feed — `src/components/quicky/CommunityScreen.tsx`**
- The media block for a normal post (line ~342-363) is currently a bare `<img>`/`<video>` with no interaction.
- Wrap the media in a `<button>` (or div with onPointerUp) that uses the `useDoubleTap` hook to call `togglePostLike(post)`. The existing `togglePostLike` (line ~134) is already optimistic + idempotent server-side, so double-tap safely fires it.
- Add a 0.6s heart-burst animation overlay (same shape as the chat-bubble one from the previous turn): a single ❤️ that scales 0.5→1.4→1.8 and floats up, fades out. Reuse the same motion pattern.
- For **game-result posts** (which have no media), double-tap is a no-op (the existing tap target is the author header, not the media). Out of scope.
- For **video** posts the double-tap still works — it fires on pointer-up, and the user has to tap the video itself.

**Visual feedback**
- On double-tap, also flash the heart in the actions row from empty to filled briefly so the user sees the state changed.
- If the post was already liked, the burst is smaller and the heart just stays red (no toggle off — Instagram-style behavior: double-tap always "likes", tapping the heart icon toggles off).

**No new API routes. No schema changes. Server-side `POST /posts/[postId]/like` already exists and is idempotent (lines 7-27).**

---

## Phase 3 — Spin the Bottle (core gameplay)

### 3.1 Schema additions

New models in `prisma/schema.prisma`. None of these touch the existing `GameSession`/`GameTurn`/`GamePost` (those are scoped to 1:1 chat games).

```prisma
model SpinRoom {
  id              String   @id @default(cuid())
  status          String   @default("WAITING") // WAITING | STARTING | PLAYING | PAUSED | CLOSING
  maxPlayers      Int      @default(12)
  minPlayers      Int      @default(2)
  currentTurnIdx  Int      @default(0)
  currentSpinId   String?  @unique
  startedAt       DateTime?
  lastActivityAt  DateTime @default(now())
  createdAt       DateTime @default(now())
  players         SpinRoomPlayer[]
  spins           SpinBottleSpin[]
  messages        SpinRoomMessage[]
  // gender filter — null = any
  // (we'll allow any and pick opposite-gender per spin)

  @@index([status, lastActivityAt])
}

model SpinRoomPlayer {
  id            String   @id @default(cuid())
  roomId        String
  userId        String
  seatIndex     Int      // 0..11
  turnIndex     Int      // 0..N-1
  connection    String   @default("online") // online | reconnecting | offline
  joinedAt      DateTime @default(now())
  leftAt        DateTime?
  isActive      Boolean  @default(true)
  room          SpinRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([roomId, userId])
  @@index([userId, leftAt])
}

model SpinBottleSpin {
  id              String   @id @default(cuid())
  roomId          String
  turnIndex       Int
  spinnerId       String
  targetId        String?
  startRotation   Float
  endRotation     Float
  duration        Int      @default(3500)
  status          String   @default("spinning") // spinning | awaiting | completed
  response        String?  // yes | no | timeout
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  room            SpinRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  events          SpinBottleEvent[]

  @@index([roomId, turnIndex])
}

model SpinBottleEvent {
  id         String   @id @default(cuid())
  spinId     String
  kind       String   // kiss_yes | kiss_no | kiss_timeout | system
  fromUserId String?
  toUserId   String?
  meta       String?  // JSON blob
  createdAt  DateTime @default(now())
  spin       SpinBottleSpin @relation(fields: [spinId], references: [id], onDelete: Cascade)
}

model SpinRoomMessage {
  id        String   @id @default(cuid())
  roomId    String
  userId    String
  text      String
  kind      String   @default("user") // user | system
  createdAt DateTime @default(now())
  room      SpinRoom  @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([roomId, createdAt])
}
```

Add the back-relations to `User`: `spinRooms`, `spinRoomPlayers`, `spinRoomMessages` (lists).

Run `npx prisma db push` + `prisma generate`.

### 3.2 Server library — `src/lib/quicky/spin-bottle.ts`

- `eligibleTargets(spinner, players)` — returns players in the same room whose `gender !== spinner.gender`, are active, and not disconnected. Mirrors the PRD §17 filter.
- `nextBottleRotation(currentRotation, targetAngle)` — returns `{ startRotation, endRotation, duration }`. Server-authoritative; `targetAngle` is the angle from the spinner to the target's seat on the table.
- `scheduleTurn(roomId)` — server-side timer (a `setTimeout` on the Node process) that drives the spin lifecycle. Each tick:
  1. `SPINNING` → after `duration`, transition to `AWAITING`.
  2. `AWAITING` → after 10s, if no response, mark `response='timeout'`, transition to `RESULT`.
  3. `RESULT` → after 2s, advance `currentTurnIdx` to `(currentTurnIdx + 1) % playerCount`, transition to `SPINNING` for the next player.
  4. Persist a `SpinRoomMessage` system message at each transition.

Timers are stored on the room via a `WeakMap<SpinRoom, NodeJS.Timeout>` and cancelled on close.

### 3.3 API routes — `src/app/api/quicky/games/spin-bottle/`

```
GET  /games/spin-bottle/landing-stats   → my games/kisses/coins/etc. (V1: returns 0s for now)
POST /games/spin-bottle/join            → matchmaking, returns { roomId, snapshot }
GET  /games/spin-bottle/room            → snapshot by roomId
POST /games/spin-bottle/leave           → leave current room
POST /games/spin-bottle/respond         → yes/no to current kiss
POST /games/spin-bottle/chat            → room chat message
GET  /games/spin-bottle/chat            → recent messages
POST /games/spin-bottle/close           → forced close (admin/abandoned)
```

The matchmaker `join` route:
1. Auth.
2. End any other active `SpinRoomPlayer` rows for this user.
3. Look for an open `WAITING`/`STARTING` room with < 12 players. If found, add the player. Otherwise create a new `WAITING` room.
4. If the room now has ≥ 2 active players, set status `STARTING` and start the spin loop.
5. Return the full room snapshot.

`respond` route:
1. Auth + active player lookup.
2. Find the current spin where `targetId === me.id` and `status === 'awaiting'`.
3. Set `response` and `status='completed'`. Insert a `SpinBottleEvent`.
4. Schedule the RESULT → NEXT_TURN transition (cancel the current `AWAITING` timer; schedule the result + next spin in 2s).
5. Broadcast the new state.

All routes also **broadcast** the snapshot to `room:<roomId>` via a small server-side helper that posts to Supabase. We don't have a server-side Supabase client yet — so V1 uses polling on the client (every 2s when in room) as a fallback, and the realtime path is a stretch goal that I'll add if there's time. The PRD's hard realtime is a "V1.1 enhancement" per §96; V1 polls.

### 3.4 Per-room realtime helper — `src/lib/quicky/realtime.ts`

Mirror the `joinMatchChannel` registry pattern with a sibling `joinRoomChannel(roomId, handlers)`:
- Topic: `room:${roomId}`.
- Broadcast events: `state` (full snapshot), `chat` (new message), `kiss` (response).
- Refcounted dedupe via a new `roomChannels` / `roomHandlerRegistry` / `roomRefs` map.
- Returns `null` if Supabase env is missing (client falls back to polling).

### 3.5 Client — game landing

`src/components/quicky/SpinBottleLanding.tsx`:
- Top: profile avatar + name + level (level = `Math.floor(quickyScore / 50)` for V1, simple).
- Stats grid: Games played, Kisses received, Kisses given (all 0 in V1 since we don't track them).
- Big "Play" CTA — `taps → setStatus('finding') → api.spinBottle.join() → navigate to room`.
- "Finding room…" animated state with rotating status copy: "Finding a room…" → "Looking for players…" → "Joining party…" → "Almost ready…".
- Uses existing theme tokens (no hardcoded colors).

### 3.6 Client — game room

`src/components/quicky/SpinBottleRoom.tsx`:
- Fullscreen overlay (z-150, like `LudoGame.tsx`).
- Header: Back arrow + "Spin the Bottle" + room code + players `n/12` + ⋮ menu.
- Table area (the canvas, 55-65% of viewport):
  - 2D Three.js scene with an orthographic camera (per PRD §14).
  - 12 player seats on a rectangle (12 positions around a centered bottle).
  - Three.js renders: a static table image (rectangular gradient using `--qk-card` and `--qk-purple`), a bottle sprite (a thin PNG with rotational interpolation), and 12 avatar circles using each player's primary photo.
  - On every state update, the canvas re-renders the current `endRotation` of the bottle. During SPINNING, framer interpolates from `startRotation` to `endRotation` with a 5-power ease-out over `duration` ms.
  - When the spin completes and the target is set, the target's avatar pulse-glows.
- Bottom: turn indicator + chat drawer toggle + exit button.
- Kiss response modal: when `me.id === currentSpin.targetId` and `status === 'AWAITING'`, show a fullscreen modal with 10s countdown. Auto-NO on timeout.
- Result banner: when `currentSpin.response` is set, show "X said YES" / "X said NO" for 2s.
- Chat drawer: 60% screen height, animated up from bottom. Standard text input, optimistic send. System messages rendered with a different style.

The Three.js scene uses **plain Sprites + Plane textures** (no physics engine) — this matches the PRD §14 ("Use Three.js primarily as a 2D renderer") and §40 ("When bottle isn't spinning: No continuous physics calculation needed"). One requestAnimationFrame loop runs only while spinning.

### 3.7 Entry point

- Add `'spin-bottle'` and `'spin-bottle-room'` to `AppView` union in `src/store/quicky.ts` (line ~5-29).
- Add a new helper `setView` already exists; no new store methods needed.
- In `src/components/quicky/CommunityScreen.tsx`, render a `<button>` near the rolls tray (line ~188) showing a large gradient card with the Spin the Bottle icon + "Tap to play" + a small live player count. Tapping it calls `useQuickyStore.getState().setView('spin-bottle')`.
- In `src/components/quicky/AppRoot.tsx` (line ~88-110), add `{view === 'spin-bottle' && <SpinBottleLanding onClose={() => setView('community')} onJoined={(roomId) => setView('spin-bottle-room')} />}` and the room case. Both views are FULLSCREEN (no bottom nav) per the existing pattern.

### 3.8 API client surface — `src/lib/quicky/api-client.ts`

```ts
spinBottle: {
  landing: () => jsonFetch<{ gamesPlayed: number; kissesReceived: number; kissesGiven: number }>('/api/quicky/games/spin-bottle/landing-stats'),
  join: () => jsonFetch<{ roomId: string; snapshot: RoomSnapshot }>('/api/quicky/games/spin-bottle/join', { method: 'POST' }),
  room: (roomId: string) => jsonFetch<{ snapshot: RoomSnapshot }>(`/api/quicky/games/spin-bottle/room?roomId=${roomId}`),
  leave: (roomId: string) => jsonFetch('/api/quicky/games/spin-bottle/leave', { method: 'POST', body: JSON.stringify({ roomId }) }),
  respond: (roomId: string, choice: 'yes' | 'no') => jsonFetch('/api/quicky/games/spin-bottle/respond', { method: 'POST', body: JSON.stringify({ roomId, choice }) }),
  chat: (roomId: string) => jsonFetch<{ messages: ChatItem[] }>(`/api/quicky/games/spin-bottle/chat?roomId=${roomId}`),
  sendChat: (roomId: string, text: string) => jsonFetch('/api/quicky/games/spin-bottle/chat', { method: 'POST', body: JSON.stringify({ roomId, text }) }),
}
```

### 3.9 Out of scope (intentionally, per V1 scope question)

- Coins, gifts, profile frames, friend-join, sound/haptics (besides the existing Haptics helper which we'll fire on kiss prompts), leaderboards, seasonal events, admin controls, the GET `/api/quicky/game-posts` route (not needed for this PRD), reconnects beyond simple polling, advanced moderation.

---

## Build & verify

1. `npx prisma db push` after each schema change.
2. `npx prisma generate` to refresh the client.
3. `npx tsc --noEmit` to verify types after every phase.
4. `npx next build` once at the end.
5. Manual smoke: start dev server, hit each endpoint with curl, verify the community feed + double-tap like + comment-off gate work, and the spin bottle entry card shows up.

## Risk / known unknowns

- **Timers on serverless**: Spin the Bottle uses `setTimeout` to drive the spin loop. Vercel/Next.js serverless functions may not honor long-running timers across invocations. For local dev + the current standalone build (`bun .next/standalone/server.js`) this works fine. We'll note this as a deployment concern — the V1 should work in the current standalone setup.
- **Race on `respond`**: the 10s response timer could fire while a `respond` request is in-flight. Mitigation: the `respond` route uses `updateMany where: { status: 'awaiting' }` (idempotent), so a late response after the timeout simply gets ignored.
- **Three.js bundle size**: adding Three.js (~150 KB minified) is the biggest bundle-size hit. PRD §40 says minimize the JS bundle. We'll add a dynamic import (`next/dynamic` with `ssr: false`) so Three.js only loads when the user enters the Spin the Bottle room.
- **Three.js image generation**: the table image and bottle sprite are static assets. For V1 we'll generate them procedurally with Three.js at mount (a `Mesh` with a procedural texture) — no asset files needed.
