# 🔥 Quicky

> Instant sparks. Real connections.

A premium dating app MVP built end-to-end from a comprehensive PRD. Dark-mode-first UI with coral-pink accents, disappearing "Quicky" media, a Quicky Score system, streaks, exclusive Premium games (Truth or Dare), and clear visibility advantages for Premium subscribers.

Built with **Next.js 16 + TypeScript + Tailwind CSS 4 + shadcn/ui + Prisma + Framer Motion + Zustand**.

---

## ✨ Features

### Free tier
- **Phone OTP auth** (mocked — code shown on screen for demo)
- **Multi-step onboarding**: DOB (18+ age gate), gender, looking-for, 2–6 photos, bio (300 char), up to 8 interests, optional prompts
- **Discovery feed**: card stack with swipe gestures (Like / Pass / Super Like)
  - 50 likes/day, 1 Super Like/day, 1 Rewind/day
  - Visibility ranking per PRD §7 (premium boost, new user boost, verified bonus, photo count, interest overlap, same city)
- **Match celebration** with confetti animation
- **Chat** (matched users only): text, image, video, Quicky
  - Message polling every 4s (production would use WebSocket)
  - Unmatch flow
- **Quicky** (signature feature): disappearing photo/video with timer countdown (3/5/8/10s), screenshot detection, 24h expiry
- **Quicky Score** with tier badges (Bronze → Silver → Gold → Platinum → Diamond)
  - +1 sent, +1 opened, +2 mutual exchange 24h, +5 3-day streak, +10 7-day streak
- **Photo verification** (selfie + live challenge → verified badge)
- **Reporting & blocking**

### Premium
- Unlimited likes, Quickies, rewinds
- 5 Super Likes/day
- See Who Liked You (full list — free sees blurred previews only)
- Priority placement + continuous soft boost (×1.8) + timed Boosts (×5 for 30 min)
- Advanced filters (height, education, lifestyle, verified-only, recently active)
- Passport / travel mode
- Read receipts, last-seen, custom chat themes
- **Truth or Dare** game inside matched chats (Flirty / Deep / Funny / Spicy decks)
- Profile insights (views, like rate, top attracting interests)
- Premium badge on profile and in chat

### Monetization
- 4 subscription plans (weekly / monthly / quarterly / annual)
- Consumable packs (extra super likes, one-time boosts, extra Quickies)
- Paywalls at natural friction points (like limit, Quicky limit, See Who Liked You, Games, Advanced Filters)

---

## 🚀 Quick start

```bash
# 1. Install deps
bun install

# 2. Set up the database
bun run db:push          # creates SQLite db at db/custom.db
bun run scripts:gen-personas   # generates 12 AI portrait photos (uses z-ai-web-dev-sdk)
bun run scripts:seed      # seeds 12 demo personas + their photos + premium subscriptions

# 3. Start the dev server
bun run dev
# App: http://localhost:3000
```

### Logging in
- Use any phone number like `+1 555 555 0100`
- The 4-digit OTP is shown on screen (no real SMS — mocked for demo)
- Enter the code to verify

Or log in as one of the 12 seeded personas (see `scripts/seed.ts` for their phone numbers).

---

## 🗂️ Project structure

```
src/
├── app/
│   ├── api/quicky/         # 15 API routes
│   │   ├── auth/           # OTP, verify, me, logout, photos
│   │   ├── discovery/      # discovery feed + limits
│   │   ├── swipe/          # record swipe + check match
│   │   ├── matches/        # list matches + [matchId]/messages|quicky|game|unmatch
│   │   ├── likes-you/      # See Who Liked You (blurred for free)
│   │   ├── upload/         # photo/quicky media upload
│   │   ├── verify-photo/   # photo verification flow
│   │   ├── premium/        # subscription management
│   │   ├── onboarding/     # complete onboarding
│   │   └── profile/[userId]  # public profile view
│   ├── layout.tsx
│   ├── page.tsx            # root — renders AppRoot in PhoneFrame
│   └── globals.css         # Quicky palette + animations
├── components/quicky/      # 16 UI components
│   ├── PhoneFrame.tsx      # phone-shell wrapper (desktop) / full-screen (mobile)
│   ├── AppRoot.tsx         # view state machine
│   ├── AuthScreen.tsx      # phone + OTP
│   ├── OnboardingFlow.tsx  # multi-step onboarding
│   ├── DiscoveryFeed.tsx   # swipe cards
│   ├── MatchCelebration.tsx
│   ├── ChatList.tsx
│   ├── ChatView.tsx         # messages + Quicky + ToD launcher
│   ├── QuickyViewer.tsx     # full-screen timer + screenshot detection
│   ├── TruthOrDareGame.tsx  # ToD game session
│   ├── LikesYouView.tsx
│   ├── MyProfileView.tsx
│   ├── PremiumView.tsx
│   ├── ProfileView.tsx     # public profile
│   ├── ProfileSheet.tsx
│   ├── PhotoVerification.tsx
│   ├── PaywallModal.tsx    # contextual premium upsells
│   ├── BottomNav.tsx
│   └── brand.tsx
├── lib/
│   ├── db.ts                # Prisma client
│   └── quicky/
│       ├── constants.ts    # limits, score rules, ToD decks, subscription plans
│       ├── auth.ts          # session + OTP helpers
│       ├── score.ts         # Quicky Score + streak computation
│       ├── discovery.ts     # discovery ranking algorithm
│       └── api-client.ts    # typed client wrappers
├── store/
│   └── quicky.ts            # Zustand store (view routing + user state)
└── prisma/
    └── schema.prisma        # 11 models: User, Photo, Swipe, Match, Message, QuickyEvent, GameSession, GameTurn, Subscription, Report, Block, Session, OtpCode

scripts/
├── gen-personas.ts         # parallel batch portrait generator
├── gen-personas-serial.ts  # rate-limit-safe retry version
├── seed.ts                 # seeds 12 demo personas
├── complete-onboarding.ts  # dev helper: complete onboarding for a session token
└── simulate-mia-quicky.ts  # dev helper: simulate inbound Quicky
```

---

## 🎨 Visual identity

Per PRD §4:
- **Primary accent**: `#FF2D55` (vibrant coral-pink)
- **Backgrounds**: `#0F0F14`, `#1A1A2E` (deep charcoal / near-black)
- **Premium accents**: `#F5C570` (gold), `#B8A4FF` (lavender)
- **Typography**: clean sans (Geist / system)
- **Motion**: fluid card transitions, haptic-style micro-animations, Quicky pulse glow, streak flame flicker, confetti on match

---

## 🗃️ Data model (Prisma)

| Model | Purpose |
|---|---|
| `User` | name, age, DOB, gender, looking-for, bio, city, interests (JSON), prompts (JSON), isPremium, isVerified, quickyScore, onboardedAt |
| `Photo` | url, position, isPrimary |
| `Swipe` | from → to, type (like/superlike/pass), unique constraint |
| `Match` | userA ↔ userB, status (active/unmatched/archived), lastMessageAt |
| `Message` | matchId, senderId, type (text/image/video/quicky/system), text, mediaUrl, quickyDuration, quickyOpenedAt, quickyExpiresAt, screenshotFlagged |
| `QuickyEvent` | senderId, recipientId, eventId, type (sent/opened/replay/screenshot/streak_milestone), pointsAwarded |
| `GameSession` | matchId, gameType, currentPlayerId, currentTurn |
| `GameTurn` | sessionId, playerId, promptDeck, promptText, choice, answerText, skipped |
| `Subscription` | userId, plan (weekly/monthly/quarterly/annual), status, startedAt, expiresAt |
| `Report` | reporterId, reportedId, category, details, screenshotUrl, status |
| `Block` | blockerId, blockedId, unique constraint |
| `Session` | userId, token, expiresAt |
| `OtpCode` | phone, code, expiresAt, consumed |

---

## 🎯 What's mocked (per MVP scope)

| Concern | Mocked as |
|---|---|
| Phone OTP | 4-digit code shown on screen + in API response (no real SMS) |
| Real-time chat | Polling every 4s (production: Socket.io mini-service) |
| Payments (Stripe/RevenueCat) | Instant subscription flip on plan selection (no real charge) |
| Push notifications | In-app toasts only |
| Photo moderation | No NSFW model — rule-based stub |
| Native haptics | CSS animations + visual feedback |

---

## 🛣️ Roadmap (not yet implemented)

- **v1.1**: Never Have I Ever, Would You Rather, Icebreaker Roulette, Two Truths and a Lie (API is game-agnostic — easy to extend)
- **v1.1**: Advanced filters, Passport mode, streak badges
- **v1.2**: Profile insights, Incognito mode, custom chat themes
- **v1.2**: WebSocket mini-service for real-time chat & presence
- **v1.2**: Web admin panel for moderation & content decks
- **v1.3**: Stripe test mode integration, real Apple/Google IAP

---

## 📜 License

MIT — see [LICENSE](./LICENSE).

---

## 🙌 Credits

Built from a comprehensive PRD. Persona portraits generated via `z-ai-web-dev-sdk` image generation.
