# Quicky — Play Store Release Guide

Everything needed to go from this repo to a listing on the Google Play Store.
The signing setup is already wired into Gradle — you only supply the keystore.

---

## 1. How signing is wired

| File | Purpose | Committed? |
|---|---|---|
| `android/app/build.gradle` | Reads `android/keystore.properties` and signs `release` builds. Falls back to the DEBUG key with a warning if the file is absent. | ✅ yes |
| `android/variables.gradle` | `versionCode` / `versionName` — the single source of truth for version bumps. | ✅ yes |
| `android/keystore.properties` | Secrets: keystore path + passwords. | ❌ gitignored |
| `android/keystores/quicky-upload.jks` | The private key — the app's permanent identity. | ❌ gitignored |
| `scripts/gen-release-keystore.sh` | One-shot generator for the two files above. | ✅ yes |
| `scripts/bump-android-version.ts` | Safe version bumper (validates monotonic `versionCode`). | ✅ yes |

## 2. Create the keystore (once, on YOUR machine)

```bash
bash scripts/gen-release-keystore.sh
```

This generates the keystore locally so the private key never leaves your
machine. It prints the password and writes it to
`android/keystores/KEEP-SAFE-PASSWORDS.txt`.

> **You have two options here:**
>
> **A (more secure, recommended):** run the script on your own machine to
> create a fresh keystore. The one generated on the build machine was a
> working sample delivered alongside the repo — using your own locally
> generated key means the private key has never traveled anywhere.
>
> **B (faster):** use the delivered `quicky-upload.jks` +
> `keystore.properties` files as-is.

Either way, **after this one-time setup** every release build is just
`bun run android:release`.

### ⚠️ The two rules of the keystore

1. **NEVER commit it.** `.gitignore` already blocks
   `android/keystore.properties` and `android/keystores/` — keep it that way.
2. **NEVER lose it.** Copy the `.jks` file and the password to at least two
   safe places (password manager + encrypted offline/cloud backup). If you
   lose it you can never update the app under the same listing (see §6).

## 3. Build the release bundle

```bash
# from repo root
bun run android:release          # AAB (.aab) — REQUIRED for Play Store
bun run android:release-apk       # APK — only for direct sideloading/testing
```

Output:
`android/app/build/outputs/bundle/release/app-release.aab`

The AAB is signed automatically when `android/keystore.properties` exists.
Gradle prints a loud warning and signs with the debug key if it doesn't —
**never upload a debug-signed build to Play**.

Install the release AAB locally to smoke-test before uploading:

```bash
bunx bundletool build-apks --bundle=android/app/build/outputs/bundle/release/app-release.aab \
  --output=quicky.apks --mode=universal --ks=android/keystores/quicky-upload.jks
bunx bundletool install-apks --apks=quicky.apks
```

## 4. Upload to Play Console (first time)

1. Create a developer account: https://play.google.com/console (one-time
   **$25 registration fee**).
2. **Create app** → name `Quicky`, type *App*, free/paid as you prefer.
3. **App content** questionnaire — you'll need privacy policy, content
   rating, data safety and target-audience answers (dating apps get extra
   scrutiny: declare the 18+ target audience, and be ready to explain
   moderation + reporting features; the app already has blocking, reporting
   and complaint flows which helps here).
4. **Internal testing** track first: upload the AAB, add testers, roll out.
   This validates the bundle without public exposure.
5. **Production** track: when you're happy, roll out to production.
   Review for new dating apps typically takes a few days.

### Enable Play App Signing (do this during first upload)

When Play Console asks (Setup → App signing), **enroll**:
- Play generates and manages the *app signing key* it ships to users.
- Your keystore becomes the *upload key* — only used to authenticate your
  uploads.

Why enroll: if you ever lose your upload keystore, Google can reset it after
identity verification. Without enrollment, a lost keystore = dead listing.

## 5. Every subsequent release

```bash
bun run android:bump            # versionCode 1 -> 2 (REQUIRED each upload)
bun run android:release        # build signed AAB
# upload android/app/build/outputs/bundle/release/app-release.aab to Play Console
```

Version bump options:

```bash
bun run android:bump --patch   # 1.0.0 -> 1.0.1 (+code)
bun run android:bump --minor    # 1.0.0 -> 1.1.0 (+code)
bun run android:bump --major    # 1.0.0 -> 2.0.0 (+code)
bun run android:bump --name 2.1.0 --code 42
```

The script refuses to lower `versionCode` (Play rejects non-monotonic codes).

## 6. Lost keystore / lost password

- **Password lost, keystore file intact:** the password cannot be recovered,
  but with Play App Signing enrolled you can generate a NEW upload key and
  ask Google to reset the upload credential
  (Play Console → Help → contact support → "reset my upload key").
- **Keystore file lost, NOT enrolled:** the listing is permanently stuck —
  a new keystore means a new package name / new listing.
- **Keystore file lost, enrolled:** same reset flow as above; users keep
  receiving updates because Play's own app-signing key never changed.

## 7. Pre-upload checklist

- [ ] `capacitor.config.ts` → `server.url` points at the production URL
- [ ] Deployment (Vercel) is live and login works (`POST /api/quicky/auth/otp` → 200)
- [ ] `bunx cap sync android` re-run after any web config change
- [ ] `android/keystore.properties` present (Gradle shows NO debug-key warning)
- [ ] `versionCode` bumped since the last upload
- [ ] AAB smoke-installed and opened on a real device
- [ ] Privacy policy URL reachable (required for dating apps)
- [ ] `targetSdkVersion 36` meets the current Play target-API requirement
