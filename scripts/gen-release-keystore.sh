#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Quicky — generate a Play Store release (upload) keystore
#
# Creates:
#   android/keystores/quicky-upload.jks   — the PRIVATE key (gitignored, NEVER
#                                           commit, NEVER lose: Play App Signing
#                                           updates depend on it forever)
#   android/keystore.properties           — Gradle signing config (gitignored)
#
# Requirements: keytool (any JDK) — run from the REPO ROOT:
#   bash scripts/gen-release-keystore.sh
#
# Everything is generated LOCALLY on this machine so the private key never
# travels through chat, email, or CI.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ANDROID_DIR="android"
KEYSTORE_DIR="${ANDROID_DIR}/keystores"
KEYSTORE="${KEYSTORE_DIR}/quicky-upload.jks"
PROPS="${ANDROID_DIR}/keystore.properties"

# ── 1. Refuse to overwrite an existing keystore ──────────────────────────────
if [[ -f "${KEYSTORE}" ]]; then
  echo "ERROR: ${KEYSTORE} already exists."
  echo "       If you lost keystore.properties passwords, see"
  echo "       docs/PLAYSTORE-RELEASE.md (Lost keystore section) — do NOT delete it."
  exit 1
fi
mkdir -p "${KEYSTORE_DIR}"

# ── 2. Generate one strong random password for store & key ──────────────────
# (Play App Signing lets store and key share a password; one secret to keep.)
# od+tr with no early-exiting consumer: 21 random bytes → 42 hex chars → 28.
# (Avoids the classic `tr ... /dev/urandom | head` SIGPIPE under pipefail.)
PASS="$(od -An -N21 -tx1 /dev/urandom | tr -d ' \n')"
PASS="${PASS:0:28}"
ALIAS="quicky-upload"
DNAME="CN=Quicky, OU=Mobile, O=Quicky, L=Mumbai, S=Maharashtra, C=IN"
# Override with env vars if you prefer different details:
DNAME="${KEYSTORE_DNAME:-$DNAME}"
ALIAS="${KEYSTORE_ALIAS:-$ALIAS}"
VALIDITY_DAYS=10000   # ~27 years — Play requires validity well beyond 2033

echo "==> Generating RSA-2048 keystore (valid ${VALIDITY_DAYS} days) ..."
keytool -genkeypair -v \
  -keystore "${KEYSTORE}" \
  -alias "${ALIAS}" \
  -keyalg RSA -keysize 2048 \
  -validity "${VALIDITY_DAYS}" \
  -storepass "${PASS}" -keypass "${PASS}" \
  -dname "${DNAME}"

# ── 3. Verify it opens with the password ────────────────────────────────────
keytool -list -v -keystore "${KEYSTORE}" -storepass "${PASS}" > /dev/null

# ── 4. Write the Gradle properties file (gitignored) ────────────────────────
cat > "${PROPS}" <<EOF
# Quicky release signing — AUTO-GENERATED, SECRET, GITIGNORED.
# storeFile is resolved relative to the android/ directory.
storeFile=keystores/quicky-upload.jks
storePassword=${PASS}
keyAlias=${ALIAS}
keyPassword=${PASS}
EOF
chmod 600 "${KEYSTORE}" "${PROPS}"

# ── 5. Password backup record (gitignored) — store in a password manager! ────
cat > "${KEYSTORE_DIR}/KEEP-SAFE-PASSWORDS.txt" <<EOF
QUICKY ANDROID RELEASE KEYSTORE — GENERATED $(date -u '+%Y-%m-%d %H:%M UTC')
=====================================================================

  keystore file : ${KEYSTORE}
  key alias     : ${ALIAS}
  store password: ${PASS}
  key password  : ${PASS}

BACK THIS UP IN 2+ PLACES (password manager + encrypted cloud/offline).
If you lose the keystore or the password you can NEVER update the app
under the same Play Store listing (unless Play App Signing is enabled,
which lets you request an upload-key reset).

BACKUP THE FILE ITSELF TOO: ${KEYSTORE}
EOF
chmod 600 "${KEYSTORE_DIR}/KEEP-SAFE-PASSWORDS.txt"

echo ""
echo "==> Done. Created:"
echo "    ${KEYSTORE}"
echo "    ${PROPS}"
echo "    ${KEYSTORE_DIR}/KEEP-SAFE-PASSWORDS.txt   (password record)"
echo ""
echo "    >>> ACTION REQUIRED: copy the password from"
echo "        ${KEYSTORE_DIR}/KEEP-SAFE-PASSWORDS.txt into your password manager NOW,"
echo "        then back up the .jks file in at least one other safe place."
echo ""
echo "Build a Play Store bundle with:"
echo "    cd android && ./gradlew bundleRelease"
echo "    (or from repo root: bun run android:release)"
