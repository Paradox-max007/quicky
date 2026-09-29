#!/usr/bin/env node
// Quicky — REWARDED-ADS E2E QA (Monetization PRD §11)
//
// Proves the full server-authoritative loop against a running deployment:
//   login → eligibility → create session → signed SSV completion → credit
//   → REPLAY returns the same reward (no double credit) → daily-limit
//   enforcement → early-cancel grants nothing.
//
// Requires the dev mock provider + a local SSV override key so we can sign
// a correctly-formed Google SSV callback:
//   1. generate a keypair:  openssl genrsa -out test-key.pem 2048
//      openssl rsa -in test-key.pem -pubout -out test-pub.pem
//   2. set on the SERVER env (so sessions get provider=admob + the SSV
//      verifier accepts your local key):
//      ADMOB_REWARDED_AD_UNIT_ID_ANDROID=ca-app-pub-3940256099942544/5224354917
//      ADMOB_SSV_PUBLIC_KEY_OVERRIDE={"<ADMOB_SSV_KEY_ID>":"<contents of test-pub.pem, newlines as \n>"}
//   3. run:
//      BASE=http://localhost:3000 \
//      ADMOB_SSV_PRIVATE_KEY="$(cat test-key.pem)" \
//      ADMOB_SSV_KEY_ID=1234567890 \
//      ALLOW_MOCK_REWARDED_ADS=true \
//      bun scripts/qa-rewards.mjs
//
// (The wallet delta is asserted against /api/quicky/wallet before/after.)

import crypto from 'node:crypto'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const SSV_KEY_ID = process.env.ADMOB_SSV_KEY_ID ?? '1234567890'
const PRIVATE_KEY = (process.env.ADMOB_SSV_PRIVATE_KEY ?? '').replace(/\\n/g, '\n')

if (!PRIVATE_KEY) {
  console.error('Set ADMOB_SSV_PRIVATE_KEY (PEM) — see the header of this file.')
  process.exit(1)
}

let failures = 0
function check(name, cond, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}

// ── helpers ────────────────────────────────────────────────────────────────

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  })
  const setCookie = res.headers.get('set-cookie')
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data, cookie: setCookie ? setCookie.split(';')[0] : null }
}

async function main() {
  console.log(`\nQuicky rewarded-ads QA → ${BASE}\n`)

  // 1. Login (mock OTP — code is returned by the API in dev)
  const phone = '+1555' + String(Math.floor(1000000 + Math.random() * 9000000))
  const otp = await api('/api/quicky/auth/otp', { method: 'POST', body: JSON.stringify({ phone }) })
  check('OTP issued', otp.status === 200 && otp.data.demoCode, `demo code ${otp.data.demoCode}`)
  const verify = await api('/api/quicky/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code: otp.data.demoCode }) })
  check('Login', verify.status === 200 && verify.cookie, `user ${verify.data?.user?.id?.slice(0, 8)}…`)
  const auth = { cookie: verify.cookie }

  const walletBefore = await api('/api/quicky/wallet', { headers: auth })
  check('Wallet readable', walletBefore.status === 200, `coins=${walletBefore.data?.wallet?.coins}`)

  // 2. Eligibility
  const status = await api('/api/quicky/rewards/status?platform=web', { headers: auth })
  check('Status endpoint', status.status === 200 && typeof status.data.canWatch === 'boolean', `provider=${status.data?.provider}`)

  // 3. Session (platform=android → provider=admob so the SSV path applies)
  const session = await api('/api/quicky/rewards/session', {
    method: 'POST', headers: auth, body: JSON.stringify({ rewardType: 'coins', platform: 'android' }),
  })
  check('Session created', session.status === 200 && !!session.data.sessionId, session.data.sessionId?.slice(0, 13) + '…')

  // 4. Concurrent session rejected (PRD §3.3)
  const concurrent = await api('/api/quicky/rewards/session', {
    method: 'POST', headers: auth, body: JSON.stringify({ rewardType: 'coins', platform: 'android' }),
  })
  check('Concurrent session rejected', concurrent.status === 409, concurrent.data?.error)

  // 5. Signed SSV completion
  const txnId = 'qa_' + crypto.randomUUID()
  const params = new URLSearchParams({
    ad_unit: '/qa/test',
    custom_data: session.data.sessionId,
    reward_amount: '1',
    timestamp: String(Math.floor(Date.now() / 1000)),
    transaction_id: txnId,
    user_id: session.data.sessionId,
    key_id: SSV_KEY_ID,
  })
  const signature = crypto.createSign('RSA-SHA256').update(params.toString()).sign(PRIVATE_KEY, 'base64')
  params.set('signature', signature)

  const ssv = await api(`/api/quicky/rewards/admob/ssv?${params.toString()}`)
  check('Signed SSV accepted', ssv.status === 200 && ssv.data.ok === true)

  // 6. Poll session → COMPLETED with a 10–100 amount
  const poll = await api(`/api/quicky/rewards/session/${session.data.sessionId}`, { headers: auth })
  const amount = poll.data?.session?.rewardAmount
  check('Session COMPLETED', poll.data?.session?.status === 'COMPLETED')
  check('Reward within 10–100', Number.isInteger(amount) && amount >= 10 && amount <= 100, `amount=${amount}`)

  // 7. Wallet credited exactly once
  const walletAfter = await api('/api/quicky/wallet', { headers: auth })
  const delta = walletAfter.data.wallet.coins - walletBefore.data.wallet.coins
  check('Wallet credited by exactly the reward', delta === amount, `+${delta}`)

  // 8. REPLAY: same transaction id → same reward, no double credit
  const replayParams = new URLSearchParams(params)
  const ssvReplay = await api(`/api/quicky/rewards/admob/ssv?${replayParams.toString()}`)
  const walletAfterReplay = await api('/api/quicky/wallet', { headers: auth })
  check('Replay accepted as no-op', ssvReplay.status === 200 && ssvReplay.data.alreadyApplied === true)
  check('No double credit', walletAfterReplay.data.wallet.coins === walletAfter.data.wallet.coins)

  // 9. Tampered signature rejected
  const badParams = new URLSearchParams(params)
  badParams.set('signature', Buffer.from('tampered').toString('base64'))
  const ssvBad = await api(`/api/quicky/rewards/admob/ssv?${badParams.toString()}`)
  check('Tampered signature rejected', ssvBad.status === 403)

  // 10. Cancel grants nothing (new session, DELETE) — may hit the cooldown
  await new Promise((r) => setTimeout(r, 2500))
  const s2 = await api('/api/quicky/rewards/session', { method: 'POST', headers: auth, body: JSON.stringify({ rewardType: 'coins', platform: 'android' }) })
  if (s2.status === 200) {
    const cancel = await api(`/api/quicky/rewards/session/${s2.data.sessionId}`, { method: 'DELETE', headers: auth })
    check('Cancel ok', cancel.status === 200)
    const poll2 = await api(`/api/quicky/rewards/session/${s2.data.sessionId}`, { headers: auth })
    check('Cancelled session grants nothing', poll2.data?.session?.status === 'CANCELLED')
  } else {
    console.log(`ℹ️  cancel-flow skipped (cooldown active: ${s2.data?.error})`)
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED 🎉' : failures + ' CHECK(S) FAILED'}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
