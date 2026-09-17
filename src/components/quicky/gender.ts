// Quicky — client-side gender-slot mirror (Games PRD §5/§11)
// Pure functions — NO server imports. Mirrors the server's seat-gender rules
// (src/lib/quicky/room-assignment.ts) for DISPLAY-only decisions (gift
// recipient filters, spin-gate rendering). The server ALWAYS re-derives the
// authoritative answer — the client copy exists only so the UI can pre-filter
// lists without a network round-trip.

export type SeatGender = 'male' | 'female'

export function normalizeGenderClient(
  gender: string | null | undefined,
  seatIndex?: number | null
): SeatGender | null {
  if (gender === 'male') return 'male'
  if (gender === 'female') return 'female'
  if (seatIndex != null) return seatIndex % 2 === 0 ? 'male' : 'female'
  return null
}
