# Quicky — Monetization Setup Guide

Rewarded ads + real payments, per the Monetization PRD. This guide covers
provider setup, environment variables, database migration, and testing.

Architecture at a glance:

```
                       ┌─────────────────────────────────────────┐
  Watch Ad ──────────▶ │ /rewards/session (limits, cooldown)      │
  (coins or points)    │ RewardAdSession PENDING (uuid)           │
                       └───────────────┬─────────────────────────┘
  AdMob native ad                       │ SSV callback (signed, RSA)
  GAM web ad ─────────── signed postback ▼
                       ┌─────────────────────────────────────────┐
                       │ /rewards/admob/ssv  ·  /rewards/web/*   │
                       │ signature verify → finalize ONCE        │
                       │ crypto-random 10–100 → wallet ledger    │
                       └─────────────────────────────────────────┘

  Buy coins ──────────▶ platform routing (server decides)
   · web  → Stripe Checkout → signed webhook → idempotent fulfillment
   · Android (Play build) → Google Play Billing → server verify → consume
   · iOS  → disabled until Apple billing is implemented
```

## 1. Database migration

New tables: `WalletTransaction`, `RewardAdSession`, `PaymentEvent`
(+ `GameCoinPackage` columns `kind`, `realmPoints`, `plan`,
`stripePriceId`, `googlePlayProductId`).

```bash
# Option A (dev/staging — schema is authoritative):
DATABASE_URL=... DIRECT_URL=... bunx prisma db push

# Option B (exact SQL incl. CHECK constraints — recommended for prod):
psql "$DIRECT_URL" -f prisma/migration-rewards-payments.sql
```

The SQL file adds DB-level guarantees `db push` does not create:
`reward_amount BETWEEN 10 AND 100`, unique provider transaction ids,
non-negative coin balance, valid enums.

## 2. Rewarded ads — Google AdMob (Android/iOS)

The native layer is **preinstalled** in this repo:
`@capacitor-community/admob@8` (npm) is synced into `android/` (gradle) and
`ios/` (SPM), and both platforms carry Google's official **test App ID** so
the SDK initializes safely out of the box (the app would crash without an
App ID — AndroidManifest `APPLICATION_ID` meta-data / iOS `GADApplicationIdentifier`).

Setup when going live:

1. [AdMob console](https://apps.admob.com) → Add app → note the **App ID**
   (`ca-app-pub-…~…`).
2. Add a **Rewarded** ad unit → note the **Ad unit ID**
   (`ca-app-pub-…/…`).
3. On the ad unit → **SSV callback URL**:
   `https://quicky.vercel.app/api/quicky/rewards/admob/ssv`
   (AdMob appends `signature`, `key_id`, `transaction_id`, … and echoes the
   `custom_data` we set = the reward session id).
4. Replace the TEST App IDs with your real ones:
   - `android/app/src/main/AndroidManifest.xml` → the
     `com.google.android.gms.ads.APPLICATION_ID` meta-data (currently
     `ca-app-pub-3940256099942544~3347511713`)
   - `ios/App/App/Info.plist` → `GADApplicationIdentifier` (currently
     `ca-app-pub-3940256099942544~1458002511`)
   - These are App IDs (`~`), NOT ad-unit ids (`/`) — mixing them up is the
     classic AdMob crash.
5. Env (see `.env.example`): `ADMOB_APP_ID_ANDROID`,
   `ADMOB_REWARDED_AD_UNIT_ID_ANDROID`, and the `NEXT_PUBLIC_` mirrors.
   Keep `NEXT_PUBLIC_ADMOB_USE_TEST_ADS=true` in dev/preview — Google's
   test units (`ca-app-pub-3940256099942544/5224354917`) never pay out but
   exercise the exact same flow (PRD §11). Unset it for production.
6. Rebuild the native app (`bun run android:release`) — the plugin is
   compiled into the APK/IPA; the web bundle detects it at runtime via
   `window.Capacitor.Plugins.AdMob`.

### Verification flow (why the client can't cheat)

- The client never sends an amount. It creates a session; the amount is
  rolled **server-side once** and stored on the session.
- The reward is credited **only** when Google's SSV callback arrives with a
  valid RSA-SHA256 signature over the query string, verified against
  Google's rotating public keys (fetched from
  `https://www.googleadapis.com/admob/reward/verifying-keys.json`, keyed by
  `key_id`, cached 24h).
- Duplicate callbacks are no-ops (unique `(provider, providerTransactionId)`
  + session status guard).
- Limits are server-enforced: daily count (default 10, admin-configurable),
  30s cooldown between ad starts, one concurrent pending session.

### Local SSV testing without AdMob traffic

Set `ADMOB_SSV_PUBLIC_KEY_OVERRIDE={"<keyId>":"<PEM>"}` and use
`scripts/qa-rewards.mjs` — it signs a correctly-formed callback with your
local keypair and proves the verify → credit → replay-no-op loop.

## 3. Rewarded ads — web

`WEB_REWARDED_AD_PROVIDER=gam` + `WEB_REWARDED_AD_UNIT_ID=/1234567/rewarded`
loads Google Ad Manager's rewarded web format. **Crediting** still requires
the provider's server-to-server completion postback to
`POST /api/quicky/rewards/web/callback` with
`x-quicky-signature: hex(hmac_sha256(WEB_REWARDED_AD_CALLBACK_SECRET, body))`.
Until a web provider with a verifiable postback is wired, leave it unset —
the UI shows "No ads available" instead of pretending (PRD §1.1).

## 4. Stripe (web purchases)

1. Create products + prices in the Stripe dashboard (or via the API).
2. Put the **Price IDs** (`price_…`) on the Quicky catalog products —
   Admin → Game Store → product → `stripePriceId` field (one internal
   product ↔ one provider id; prices themselves live ONLY in Stripe).
3. Webhook endpoint:
   `https://quicky.vercel.app/api/quicky/payments/stripe/webhook`
   with events: `checkout.session.completed`,
   `checkout.session.expired`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `charge.refunded`.
4. Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

Flow: client picks a product → server validates it against the catalog →
creates a `PENDING GamePurchase` + Checkout Session (metadata carries the
purchase id) → user pays on Stripe → signed webhook re-checks
`payment_status === 'paid'` → fulfills **exactly once** (PaymentEvent dedup
+ wallet idempotency keys). Reaching the success URL alone grants nothing.

## 5. Google Play Billing (Android)

The native billing plugin is **preinstalled**: a first-party Capacitor
module at `android/quicky-google-play-billing/` (Play Billing Library 8.x,
wired via `android/settings.gradle` + `android/app/build.gradle` — both
hand-edited so `cap sync` never strips it). It registers the runtime plugin
`GooglePlayBilling` (`window.Capacitor.Plugins.GooglePlayBilling`) and only
runs the purchase sheet; verification/crediting/acknowledge/consume happen
server-side. No npm package or third-party account is needed.

1. Play Console → Monetize → Products: create the coin packs / point packs
   (`productId` strings) and subscriptions that mirror the Quicky catalog.
2. Put the **Play product ids** on the catalog products
   (`googlePlayProductId` in Admin → Game Store).
3. Service account with API access → download JSON → env
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` + `GOOGLE_PLAY_PACKAGE_NAME`.
4. RTDN: create a Pub/Sub topic, push subscription pointing to
   `https://quicky.vercel.app/api/quicky/payments/google-play/notifications`
   with a bearer token you set as `GOOGLE_PLAY_NOTIFICATIONS_TOKEN`.
5. Rebuild the native app (`bun run android:release`) — the module is
   compiled into the APK.

Flow: native purchase → client sends `(productId, purchaseToken)` → server
calls Google's Developer API (`purchases.products.get` /
`subscriptionsv2`) → only `PURCHASED`/`ACTIVE` states credit → consumables
are consumed (re-buyable), subscriptions acknowledged + the existing
premium entitlement updated. Subscriptions follow the existing
Subscription model (PRD §8): renewals/cancellations arrive via RTDN and
flip the same `User.isPremium/premiumUntil` the app already reads.

## 6. Admin console

- **Rewarded Ads** (new): enable/disable globally + per currency, 10–100
  range (clamped — can never widen), daily limit, cooldown, timezone;
  30-day impressions/completions/verification-failure stats; session
  search by user. Changes apply to NEW sessions only.
- **Payments** (new): order list with provider/status/user filters,
  gross/refund KPIs, provider event audit trail, safe refunds
  (provider charge first, then record — currency is reversed via a
  compensating ledger entry, history is never deleted).
- **Game Store** (existing): product catalog — now also covers Realm
  Point packs (`kind=REALM_POINTS_PACK`) and subscriptions
  (`kind=SUBSCRIPTION` + `plan`) with their provider id mappings.

## 7. Testing checklist (PRD §11)

```bash
# Unit tests (no DB needed)
bun test tests/rewards-payments.test.ts

# E2E against a dev deployment (uses the mock provider + signed SSV):
BASE=http://localhost:3000 \
ADMOB_SSV_PRIVATE_KEY="$(cat test-key.pem)" \
ADMOB_SSV_KEY_ID=1234567890 \
ALLOW_MOCK_REWARDED_ADS=true \
bun scripts/qa-rewards.mjs
```

The qa script proves: eligibility → session → signed completion → credit →
**replay returns the same reward (no double credit)** → daily-limit
enforcement → cancel grants nothing.

Stripe/Play test flows: use test cards + Google's license-tester accounts
on an internal testing track (Play Console) before production.

## 8. Production checklist

- [ ] `ALLOW_MOCK_REWARDED_ADS=false`, `ALLOW_MOCK_PAYMENTS=false` (or unset)
- [ ] Real ad units replace test units; `NEXT_PUBLIC_ADMOB_USE_TEST_ADS` unset
- [ ] TEST AdMob App IDs swapped for real ones (AndroidManifest + Info.plist)
- [ ] Stripe webhook signing secret belongs to the PRODUCTION endpoint
- [ ] Play service account JSON + RTDN token configured in Vercel
- [ ] `prisma/migration-rewards-payments.sql` applied to the prod database
- [ ] Native rebuild shipped (`bun run android:release`) with the AdMob +
      GooglePlayBilling plugins compiled in
- [ ] Watch a real ad end-to-end on a device and confirm the SSV credit
- [ ] Buy a real coin pack on an internal testing track and confirm the
      credit + the consumable becoming re-buyable
