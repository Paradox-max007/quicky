'use client'

// Quicky — useOptimisticResponse (bug-fix PRD v2.1 §4-§13, §72, §88)
//
// Responsibilities (§72):
//   tap → instant local selection → lock buttons → send server request
//   → reconcile
//
// The UI update happens SYNCHRONOUSLY in the same tick as the tap (§11):
// the visual response never waits for the network, Supabase, RPC or the
// database. The server request is fired immediately AFTER the state flip,
// asynchronously. Optimistic ≠ authoritative (§7): if the server rejects
// the response (round expired / already resolved) the local selection is
// rolled back and the authoritative snapshot is fetched (§10/§88).
//
// Duplicate taps only ever produce ONE request (§13): the local selection
// guards re-entry, and the server keeps its own idempotency checks.

import { useCallback, useRef, useState } from 'react'

export type LocalResponse = { spinId: string; choice: 'yes' | 'no' } | null

export type SubmitOutcome = { ok?: boolean; outcome?: 'resolved' | 'submitted' } | null

export function useOptimisticResponse(opts: {
  /** Fire-and-forget authoritative refresh (snapshot fetch / SSE nudge). */
  reconcile: () => void
  /** Surface a server rejection to the user. */
  onError?: (message: string) => void
}) {
  const [response, setResponse] = useState<LocalResponse>(null)
  // Mirrors `response` for synchronous re-entry guards (§13) — the state
  // alone is async and would let a double-tap slip two requests through.
  const responseRef = useRef<LocalResponse>(null)
  const inflight = useRef(false)
  // Keep callbacks stable even though `opts` is rebuilt every render —
  // consumers (e.g. applySnapshot) close over reset/choose.
  const optsRef = useRef(opts)
  optsRef.current = opts

  /** Reset when a new round starts or the room changes. */
  const reset = useCallback(() => {
    responseRef.current = null
    inflight.current = false
    setResponse(null)
  }, [])

  /** Roll the optimistic selection back when the server rejects it (§10). */
  const rollback = useCallback((spinId: string) => {
    if (responseRef.current?.spinId === spinId) {
      responseRef.current = null
      setResponse(null)
    }
  }, [])

  /**
   * Record THIS client's choice. `submit` performs the network call and must
   * never be awaited by the caller — the UI is already updated when it runs.
   */
  const choose = useCallback(
    (spinId: string, choice: 'yes' | 'no', submit: (choice: 'yes' | 'no') => Promise<SubmitOutcome>) => {
      // §13: repeated taps ❤️ ❤️ ❤️ → only the first action is sent.
      if (inflight.current) return
      if (responseRef.current?.spinId === spinId) return
      inflight.current = true
      const next = { spinId, choice }
      responseRef.current = next
      setResponse(next) // ← §6: the button flips THIS frame, not after the round-trip

      // §8: fire immediately — `void`, not `await`.
      void (async () => {
        try {
          const res = await submit(choice)
          // If this was the second answer the server resolved the round —
          // reconcile right away so the result appears without waiting for
          // the next stream push (belt-and-braces; also covers SSE drops).
          if (res?.outcome === 'resolved') optsRef.current.reconcile()
        } catch (e) {
          // §10: server rejected (expired / resolved elsewhere / offline) —
          // roll the optimistic selection back and adopt the server state.
          rollback(spinId)
          optsRef.current.onError?.(e instanceof Error ? e.message : 'Failed to respond')
          optsRef.current.reconcile()
        } finally {
          inflight.current = false
        }
      })()
    },
    [rollback]
  )

  return { response, choose, reset, rollback }
}
