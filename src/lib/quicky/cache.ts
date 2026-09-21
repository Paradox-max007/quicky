/**
 * Quicky — LOCAL CACHE LAYER (web + Capacitor)
 *
 * One TTL-aware localStorage cache for app data and API responses. In the
 * mobile/Capacitor app, localStorage is the WebView's persistent storage —
 * it survives app restarts and cold starts, so cached screens (discovery
 * deck, games catalog, matches list, session user) paint instantly and
 * revalidate against the server in the background (stale-while-revalidate).
 *
 * Design notes:
 *   · Every entry is JSON: { v: value, e: expiresAt (ms epoch), s: savedAt }.
 *   · TTL is advisory: `get()` returns null once expired, but callers can
 *     pass `allowStale` to paint the stale value while they revalidate.
 *   · All storage failures (private mode, quota, SSR) are swallowed — a
 *     cache must never break the app.
 *   · Key names stay 'qk_*' — the same keys the app already used, so
 *     existing device caches keep working.
 */

const PREFIX = 'qk:'

type Entry<T> = { v: T; e: number; s: number }

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    // Probe: some WebViews throw on ANY access (private mode / locked-down)
    const probe = '__qk_cache_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    return null
  }
}

/** Read a cached value. Null when missing/expired (or `allowStale` bypasses expiry). */
export function cacheGet<T>(key: string, opts: { allowStale?: boolean } = {}): T | null {
  const ls = storage()
  if (!ls) return null
  try {
    const raw = ls.getItem(PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw) as Entry<T>
    if (!entry || typeof entry !== 'object' || !('v' in entry)) return null
    if (!opts.allowStale && typeof entry.e === 'number' && Date.now() > entry.e) return null
    return entry.v
  } catch {
    return null
  }
}

/** Write a cached value with a TTL (default: keep "forever" — no expiry). */
export function cacheSet<T>(key: string, value: T, ttlMs?: number): void {
  const ls = storage()
  if (!ls) return
  try {
    const entry: Entry<T> = { v: value, e: typeof ttlMs === 'number' ? Date.now() + ttlMs : Number.MAX_SAFE_INTEGER, s: Date.now() }
    ls.setItem(PREFIX + key, JSON.stringify(entry))
  } catch {
    // Quota / serialization — ignore, cache is best-effort
  }
}

/** Remove a cached value. */
export function cacheRemove(key: string): void {
  const ls = storage()
  if (!ls) return
  try {
    ls.removeItem(PREFIX + key)
  } catch {}
}

/**
 * Stale-while-revalidate fetch: returns [value, isFresh].
 *   · fresh cache  → value + isFresh true (caller skips the network)
 *   · stale cache  → value + isFresh false (caller paints it, network refreshes)
 *   · no cache     → null + isFresh false
 * The loader is only invoked when the cache is not fresh; on loader failure
 * the (possibly stale) cached value is returned instead of throwing.
 */
export async function cachedFetch<T>(
  key: string,
  loader: () => Promise<T>,
  opts: { ttlMs?: number; allowStale?: boolean } = {}
): Promise<{ value: T | null; fresh: boolean }> {
  const cached = cacheGet<T>(key, { allowStale: true })
  const fresh = cacheGet<T>(key) != null
  if (fresh && cached != null) return { value: cached, fresh: true }
  try {
    const value = await loader()
    cacheSet(key, value, opts.ttlMs)
    return { value, fresh: false }
  } catch (e) {
    if (cached != null) return { value: cached, fresh: false }
    throw e
  }
}
