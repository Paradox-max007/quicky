// Quicky — client-side API helpers

// ─── GIFTS HUB types (main game screen modal) ──────────────────────────────

/** One DB-catalog gift (GameItem category 'gift') in the Gifts tab. */
export type GiftsHubGift = {
  id: string
  categoryId: string | null
  name: string
  /** Optional admin-authored gift description (admin-console PRD §6.1). */
  description?: string | null
  /** Resolved display payload — image URL or emoji glyph. */
  icon: string | null
  iconType?: string | null
  emoji: string | null
  priceCoins: number
  maxQuantity?: number | null
  tier?: string | null
  sortOrder?: number
}

/** One ACTIVE cosmetic catalog entry (Frames / Hats / Name Icons tabs). */
export type GiftsHubCosmeticEntry = {
  id: string
  rewardType: string
  name: string
  description: string | null
  rarity: string
  /** Level assets: 1/2 static (image url or emoji), 3 animated. */
  levels?: Record<string, unknown> | null
  /** NAME_DECORATOR left/right glyphs. */
  decorator?: { left?: string; right?: string } | null
  /** Which levels the viewer already owns. */
  ownedLevels: number[]
  anyEquipped: boolean
}

async function jsonFetch<T = any>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  })
  if (res.status === 401) {
    return { error: 'unauthorized' } as any
  }
  const data = await res.json().catch(() => ({ error: 'invalid_json' }))
  if (!res.ok) {
    // Prefer the server's human-readable message (e.g. the Prisma drift
    // remedy from /api/quicky/admin/* routes) over the terse error code.
    const err = new Error((data as any)?.message ?? (data as any)?.error ?? `Request failed (${res.status})`) as any
    err.status = res.status
    err.body = data
    throw err
  }
  return data as T
}

export async function uploadFile(file: File | Blob, kind: 'photo' | 'quicky' | 'voice' = 'photo'): Promise<{ ok: boolean; url: string; filename?: string; kind?: string }> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('kind', kind)
  const res = await fetch('/api/quicky/upload', { method: 'POST', body: fd, credentials: 'include' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.error || `Upload failed (${res.status})`)
  }
  return data
}

// XHR-based upload so the UI can show real progress (fetch can't report
// upload progress). Same contract as uploadFile.
function uploadFileWithProgress(
  file: File | Blob,
  kind: 'photo' | 'quicky' | 'voice',
  filename?: string,
  onProgress?: (pct: number) => void
): Promise<{ ok: boolean; url: string; filename?: string; kind?: string }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append('file', file, filename ?? (file instanceof File ? file.name : 'blob'))
    fd.append('kind', kind)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/quicky/upload')
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      let data: any = {}
      try { data = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new Error(data?.error || `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Upload failed — network error'))
    xhr.send(fd)
  })
}

export const api = {
  auth: {
    otp: (phone: string) => jsonFetch<{ ok: boolean; phone: string; demoCode: string }>('/api/quicky/auth/otp', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),
    verify: (phone: string, code: string) =>
      jsonFetch<{ ok: boolean; user: any; onboarded: boolean }>('/api/quicky/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, code }),
      }),
    me: () => jsonFetch<{ user: any | null }>('/api/quicky/auth/me'),
    update: (data: {
      name?: string
      dateOfBirth?: string
      gender?: string
      lookingFor?: string
      bio?: string
      city?: string
      interests?: string[]
      prompts?: { prompt: string; answer: string }[]
      // Premium Party Games PRD §24 — body height. Pass `null` to clear
      // ("Prefer not to say"). Server validates 120–230 cm.
      heightCm?: number | null
      education?: string | null
      lifestyle?: string | null
      // Premium Party Games PRD §B — imprecise lat/lng for the distance
      // filter. Pass `null` to clear. Server validates -90..90 / -180..180.
      lat?: number | null
      lng?: number | null
      discoveryAgeMin?: number
      discoveryAgeMax?: number
      discoveryDistanceKm?: number
      discoveryShowVerifiedOnly?: boolean
      discoveryRecentlyActive?: boolean
      discoveryHeightMin?: number
      discoveryHeightMax?: number
      // The server stores these as JSON-encoded strings but ACCEPTS arrays
      // in the request body (it does JSON.stringify itself — see
      // src/app/api/quicky/auth/me/route.ts lines 242–254). The client
      // shape is therefore string[] (matches the discovery UI).
      discoveryEducations?: string[]
      discoveryLifestyles?: string[]
    }) =>
      jsonFetch<{ ok: boolean; user: any }>('/api/quicky/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    logout: () => jsonFetch('/api/quicky/auth/logout', { method: 'POST' }),
  },
  onboarding: {
    complete: (data: any) =>
      jsonFetch('/api/quicky/onboarding', { method: 'PATCH', body: JSON.stringify(data) }),
  },
  photos: {
    add: (url: string, position?: number, isPrimary?: boolean, isPrivate?: boolean) =>
      jsonFetch('/api/quicky/auth/me/photos', {
        method: 'POST',
        body: JSON.stringify({ url, position, isPrimary, isPrivate }),
      }),
    delete: (id: string) =>
      jsonFetch(`/api/quicky/auth/me/photos/${id}`, { method: 'DELETE' }),
    update: (id: string, data: { position?: number; isPrimary?: boolean; isPrivate?: boolean }) =>
      jsonFetch(`/api/quicky/auth/me/photos/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
  discovery: () =>
    jsonFetch<{ queue: any[]; limits: { likes: number | 'unlimited'; superLikes: number; quicky: number | 'unlimited'; isPremium: boolean } }>(
      '/api/quicky/discovery'
    ),
  swipe: (toUserId: string, type: 'like' | 'superlike' | 'pass' | 'rewind') =>
    jsonFetch<{ ok: boolean; match?: { id: string; partnerId: string } | null; error?: string; paywall?: string; limits?: any }>(
      '/api/quicky/swipe',
      { method: 'POST', body: JSON.stringify({ toUserId, type }) }
    ),
  swipeBatch: (swipes: { toUserId: string; type: 'like' | 'superlike' | 'pass' }[]) =>
    jsonFetch<{
      ok: boolean
      results: { toUserId: string; ok: boolean; match?: { id: string; partnerId: string } | null; error?: string; paywall?: 'likes' | 'superlikes' }[]
      limits?: any
    }>('/api/quicky/swipe', { method: 'POST', body: JSON.stringify({ swipes }) }),
  matches: () => jsonFetch<{ matches: any[] }>('/api/quicky/matches'),
  likesYou: () =>
    jsonFetch<{ likes: any[]; isPremium: boolean; lockedCount: number; unviewedCount?: number }>('/api/quicky/likes-you'),
  // PRD §3.1: viewing a liker's profile from the Likes page is the ONLY path
  // that clears that like's badge entry
  markLikeViewed: (swipeId: string) =>
    jsonFetch<{ ok: boolean }>('/api/quicky/likes-you', { method: 'PATCH', body: JSON.stringify({ swipeId }) }),
  iLiked: () =>
    jsonFetch<{ liked: any[]; count: number }>('/api/quicky/i-liked'),
  chat: {
    messages: (matchId: string) =>
      jsonFetch<{ match: any; me: { id: string; isPremium: boolean }; messages: any[]; readMessageIds?: string[] }>(
        `/api/quicky/matches/${matchId}/messages`
      ),
    send: (
      matchId: string,
      data: {
        type: 'text' | 'image' | 'video' | 'voice' | 'sticker'
        text?: string
        mediaUrl?: string
        durationMs?: number
        replyToId?: string
        /** type === 'sticker' — the server resolves + ownership-checks it. */
        stickerId?: string
      }
    ) =>
      jsonFetch<{ ok: boolean; message: any }>(`/api/quicky/matches/${matchId}/messages`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    react: (matchId: string, messageId: string, emoji: string | null) =>
      jsonFetch<{ ok: boolean; messageId: string; userId: string; emoji: string | null }>(
        `/api/quicky/matches/${matchId}/messages/${messageId}/react`,
        { method: 'POST', body: JSON.stringify({ emoji }) }
      ),
    /** Refactor PRD §56 — per-user Clear Chat (dating conversations). */
    clear: (matchId: string) =>
      jsonFetch<{ ok: boolean }>(`/api/quicky/matches/${matchId}/messages`, { method: 'DELETE' }),
  },
  quicky: {
    pending: (matchId: string) =>
      jsonFetch<{ quickies: any[] }>(`/api/quicky/matches/${matchId}/quicky`),
    send: (matchId: string, data: { mediaUrl: string; duration: number; text?: string }) =>
      jsonFetch<{ ok: boolean; message: any; limits?: any }>(`/api/quicky/matches/${matchId}/quicky`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    open: (matchId: string, messageId: string, action: 'open' | 'replay' | 'screenshot' | 'consume') =>
      jsonFetch(`/api/quicky/matches/${matchId}/quicky`, {
        method: 'PATCH',
        body: JSON.stringify({ messageId, action }),
      }),
  },
  game: {
    get: (matchId: string) => jsonFetch<{ session: any }>(`/api/quicky/matches/${matchId}/game`),
    start: (matchId: string, gameType = 'truth_or_dare') =>
      jsonFetch(`/api/quicky/matches/${matchId}/game`, {
        method: 'POST',
        body: JSON.stringify({ gameType }),
      }),
    action: (
      matchId: string,
      sessionId: string,
      action:
        | 'truth' | 'dare' | 'skip' | 'answer' | 'choice' | 'next_round'
        | 'roll' | 'move' | 'end',
      payload?: any
    ) =>
      jsonFetch(`/api/quicky/matches/${matchId}/game`, {
        method: 'PATCH',
        body: JSON.stringify({ sessionId, action, ...payload }),
      }),
  },
  // ── Dating Chat Games PRD §53 — persisted, server-authoritative game
  // invitation state machine. See src/lib/quicky/dating-games/invitations.ts.
  gameInvitations: {
    /** Create a new PENDING invitation (sender flow). Idempotent —
     *  returns the existing PENDING/ACCEPTED row if one already exists
     *  for this (matchId, gameType). */
    create: (opts: { conversationId: string; recipientId: string; gameType: 'ludo' | 'never_have_i_ever' | 'truth_or_dare' }) =>
      jsonFetch<{ ok: boolean; invitation: any; created: boolean }>(
        '/api/quicky/games/invitations',
        { method: 'POST', body: JSON.stringify(opts) }
      ),
    /** Accept — recipient taps PLAY NOW. Idempotent. */
    accept: (invitationId: string) =>
      jsonFetch<{ ok: boolean; invitation: any }>(
        `/api/quicky/games/invitations/${invitationId}/accept`,
        { method: 'POST' }
      ),
    /** Decline — recipient taps NOT NOW. Idempotent. */
    decline: (invitationId: string) =>
      jsonFetch<{ ok: boolean; invitation: any }>(
        `/api/quicky/games/invitations/${invitationId}/decline`,
        { method: 'POST' }
      ),
    /** Cancel — sender pulls the invitation back (PRD §45). Idempotent. */
    cancel: (invitationId: string) =>
      jsonFetch<{ ok: boolean; invitation: any }>(
        `/api/quicky/games/invitations/${invitationId}/cancel`,
        { method: 'POST' }
      ),
    /** Get the active invitation for a specific match (+ optional gameType). */
    activeForMatch: (matchId: string, gameType?: string) =>
      jsonFetch<{ invitation: any }>(
        `/api/quicky/games/invitations?matchId=${encodeURIComponent(matchId)}${gameType ? `&gameType=${encodeURIComponent(gameType)}` : ''}`
      ),
    /** List ALL PENDING invitations where I am the recipient (PRD §13 —
     *  popup persistence across app sessions). */
    listActive: () =>
      jsonFetch<{ invitations: any[] }>(`/api/quicky/games/invitations`),
  },
  gamePosts: {
    list: () => jsonFetch<{ posts: any[] }>('/api/quicky/game-posts'),
    share: (sessionId: string) =>
      jsonFetch<{ ok: boolean; postId: string; mutual?: boolean; alreadyShared?: boolean }>(
        '/api/quicky/game-posts/share',
        { method: 'POST', body: JSON.stringify({ sessionId }) }
      ),
  },
  unmatch: (matchId: string) =>
    jsonFetch(`/api/quicky/matches/${matchId}/unmatch`, { method: 'POST' }),
  games: {
    /** Game Hub PRD §11: the DB-driven game catalog (+ §16 live activePlayers). */
    list: () => jsonFetch<{ games: { id: string; slug: string; name: string; shortDescription: string; description: string; icon: string; artwork: string; supportedModes: string; minPlayers: number; maxPlayers: number; isPlayable: boolean; isFeatured: boolean; sortOrder: number; activePlayers: number }[] }>('/api/quicky/games'),
    /** Games PRD §39 — near-realtime active-player counts per game slug. */
    activePlayers: () =>
      jsonFetch<{ counts: Record<string, number>; serverNow: number }>('/api/quicky/games/active-players'),
    /** Admin-console PRD §5 — per-game "How It Works" rules (public read). */
    rules: (gameType?: string) =>
      jsonFetch<{ rules: { id: string; title: string; description: string; icon: string; sortOrder: number }[]; gameType: string }>(
        `/api/quicky/games/spin-bottle/rules${gameType ? `?gameType=${encodeURIComponent(gameType)}` : ''}`
      ),
  },
  // ── Quicky Ludo (Ludo PRD §48/§49/§81) — the client NEVER sends dice,
  // positions, winners or turns: only actionIds + a token id. ───────────────
  ludo: {
    landing: () =>
      jsonFetch<{
        coins: number
        gamesPlayed: number
        quickyPoints: number
        ludoGames: number
        ludoWins: number
        tokensFinished: number
        captures: number
      }>('/api/quicky/games/ludo/landing'),
    join: (mode: 2 | 4 = 2) =>
      jsonFetch<{ ok: boolean; roomId: string; mode: number; createdNewRoom: boolean; snapshot: any }>(
        '/api/quicky/games/ludo/join',
        { method: 'POST', body: JSON.stringify({ mode }) }
      ),
    room: (roomId: string) =>
      jsonFetch<{ ok: boolean; snapshot: any }>(`/api/quicky/games/ludo/room?roomId=${roomId}`),
    ping: (roomId: string) =>
      jsonFetch<{ ok: boolean; touched: boolean }>('/api/quicky/games/ludo/ping', {
        method: 'POST',
        body: JSON.stringify({ roomId }),
      }),
    /** ROUND-4 — tiny keepalive: heals a stalled auto-roll/watchdog chain
     * (multiplayer PRD §30/§47). Never returns state — the SSE stream does. */
    tick: (roomId: string) =>
      jsonFetch<{ ok: boolean }>('/api/quicky/games/ludo/tick', {
        method: 'POST',
        body: JSON.stringify({ roomId }),
      }),
    leave: (roomId: string) =>
      jsonFetch<{ ok: boolean; roomDeleted?: boolean }>('/api/quicky/games/ludo/leave', {
        method: 'POST',
        body: JSON.stringify({ roomId }),
      }),
    move: (roomId: string, tokenId: string, actionId: string) =>
      jsonFetch<{ ok: boolean; stateVersion: number; state: any }>(
        '/api/quicky/games/ludo/move',
        { method: 'POST', body: JSON.stringify({ roomId, tokenId, actionId }) }
      ),
    chat: (roomId: string) =>
      jsonFetch<{ messages: any[] }>(`/api/quicky/games/spin-bottle/chat?roomId=${roomId}`),
    sendChat: (
      roomId: string,
      text: string,
      mentions?: { userId: string; displayName: string }[],
      stickerId?: string,
      replyToId?: string
    ) =>
      jsonFetch<{ ok: boolean; message: any }>('/api/quicky/games/spin-bottle/chat', {
        method: 'POST',
        body: JSON.stringify({
          roomId,
          text,
          mentions: mentions ?? [],
          stickerId: stickerId ?? null,
          replyToId: replyToId ?? null,
        }),
      }),
    gifts: {
      catalog: () =>
        jsonFetch<{ categories: any[]; gifts: any[] }>('/api/quicky/games/spin-bottle/gifts'),
      send: (roomId: string, recipientId: string, itemId: string, quantity = 1) =>
        jsonFetch<{ ok: boolean; coinBalance: number }>(
          '/api/quicky/games/spin-bottle/gifts',
          { method: 'POST', body: JSON.stringify({ roomId, recipientId, itemId, quantity }) }
        ),
      sendBulk: (
        roomId: string,
        itemId: string,
        recipientFilter: 'all' | 'male' | 'female',
        quantity: number
      ) =>
        jsonFetch<{ ok: boolean; coinBalance: number; recipientCount: number; quantity: number; totalCost: number }>(
          '/api/quicky/games/spin-bottle/gifts',
          { method: 'POST', body: JSON.stringify({ roomId, itemId, recipientFilter, quantity }) }
        ),
    },
    /** Room-chat settings: my own mention privacy for ONE room (shared by
     *  both room games — the membership table is shared). */
    roomMentions: (roomId: string, enabled: boolean) =>
      jsonFetch<{ ok: boolean; roomId: string; mentionsEnabled: boolean }>(
        '/api/quicky/games/spin-bottle/mention-settings',
        { method: 'POST', body: JSON.stringify({ roomId, enabled }) }
      ),
  },
  /** Refactor PRD §25/§26/§80 — friendships. */
  friends: {
    list: () => jsonFetch<{ friends: any[] }>('/api/quicky/friends'),
    add: (userId: string) =>
      jsonFetch<{ ok: boolean }>('/api/quicky/friends', { method: 'POST', body: JSON.stringify({ userId }) }),
    remove: (userId: string) =>
      jsonFetch<{ ok: boolean }>(`/api/quicky/friends?userId=${userId}`, { method: 'DELETE' }),
  },
  /** Refactor PRD §55/§80 — server-side blocks. */
  blocks: {
    add: (userId: string) =>
      jsonFetch<{ ok: boolean }>('/api/quicky/blocks', { method: 'POST', body: JSON.stringify({ userId }) }),
    remove: (userId: string) =>
      jsonFetch<{ ok: boolean }>(`/api/quicky/blocks?userId=${userId}`, { method: 'DELETE' }),
  },
  /** Refactor PRD §57/§80 — complaints. */
  complaints: {
    create: (data: { reportedUserId: string; reason: string; description?: string; roomId?: string; messageId?: string; conversationId?: string }) =>
      jsonFetch<{ ok: boolean; complaintId: string }>('/api/quicky/complaints', { method: 'POST', body: JSON.stringify(data) }),
  },
  /** Refactor PRD §54/§96 — relationship-aware action menus. */
  relationship: (userId: string) =>
    jsonFetch<{ userId: string; isFriend: boolean; iBlockedThem: boolean; theyBlockedMe: boolean }>(
      `/api/quicky/relationship?userId=${userId}`
    ),
  /** Refactor PRD §9/§10/§80 — persisted profile photo display height. */
  profileMedia: {
    update: (photoId: string, displayHeight: number | null) =>
      jsonFetch<{ ok: boolean; photo: { id: string; displayHeight: number | null } }>(
        `/api/quicky/profile/media/${photoId}`,
        { method: 'PATCH', body: JSON.stringify({ displayHeight }) }
      ),
  },
  spinBottle: {
    landing: () =>
      jsonFetch<{
        gamesPlayed: number
        kissesReceived: number
        kissesGiven: number
        giftsSent: number
        giftsReceived: number
        coins: number
        level: number
      }>(
        '/api/quicky/games/spin-bottle/landing-stats'
      ),
    join: () =>
      jsonFetch<{ ok: boolean; roomId: string; snapshot: any }>('/api/quicky/games/spin-bottle/join', {
        method: 'POST',
      }),
    room: (roomId: string) =>
      jsonFetch<{ ok: boolean; snapshot: any }>(`/api/quicky/games/spin-bottle/room?roomId=${roomId}`),
    // Lifecycle PRD §27/§28/§29: why did my room disappear? Drives the
    // closure dialog ("no other players joined" vs "removed for inactivity").
    roomStatus: (roomId: string) =>
      jsonFetch<{ closed: boolean; exists: boolean; amMember: boolean; reason?: string }>(
        `/api/quicky/games/spin-bottle/room-status?roomId=${roomId}`
      ),
    // Lifecycle PRD §12/§13: throttled server-side presence keep-alive.
    ping: (roomId: string) =>
      jsonFetch<{ ok: boolean; touched: boolean }>('/api/quicky/games/spin-bottle/ping', {
        method: 'POST',
        body: JSON.stringify({ roomId }),
      }),
    // Lifecycle PRD §50: active "How It Works" rules, admin-defined order.
    // Admin-console PRD §5 — per-game (?gameType= defaults to spin).
    rules: (gameType?: string) =>
      jsonFetch<{ rules: { id: string; title: string; description: string; icon: string; sortOrder: number }[]; gameType: string }>(
        `/api/quicky/games/spin-bottle/rules${gameType ? `?gameType=${encodeURIComponent(gameType)}` : ''}`
      ),
    leave: (roomId: string) =>
      jsonFetch('/api/quicky/games/spin-bottle/leave', {
        method: 'POST',
        body: JSON.stringify({ roomId }),
      }),
    // Games PRD §9 — server-authoritative Change Table: one call leaves the
    // current table and claims a gender-compatible seat on another one. The
    // client never decides the assignment (§9/§71).
    changeTable: (roomId: string) =>
      jsonFetch<{ ok: boolean; roomId: string; changed: boolean; createdNewRoom: boolean; snapshot: any }>(
        '/api/quicky/games/spin-bottle/change',
        { method: 'POST', body: JSON.stringify({ roomId }) }
      ),
    respond: (roomId: string, choice: 'yes' | 'no') =>
      jsonFetch('/api/quicky/games/spin-bottle/respond', {
        method: 'POST',
        body: JSON.stringify({ roomId, choice }),
      }),
    chat: (roomId: string) =>
      jsonFetch<{ messages: any[] }>(`/api/quicky/games/spin-bottle/chat?roomId=${roomId}`),
    sendChat: (
      roomId: string,
      text: string,
      mentions?: { userId: string; displayName: string }[],
      stickerId?: string,
      replyToId?: string
    ) =>
      jsonFetch<{ ok: boolean; message: any }>('/api/quicky/games/spin-bottle/chat', {
        method: 'POST',
        body: JSON.stringify({
          roomId,
          text,
          mentions: mentions ?? [],
          stickerId: stickerId ?? null,
          replyToId: replyToId ?? null,
        }),
      }),
    close: (roomId: string) =>
      jsonFetch('/api/quicky/games/spin-bottle/close', {
        method: 'POST',
        body: JSON.stringify({ roomId }),
      }),
    gifts: {
      catalog: () =>
        jsonFetch<{
          categories: { id: string; name: string; slug: string; icon: string; sortOrder: number }[]
          catalog: {
            id: string
            categoryId: string | null
            name: string
            icon: string
            iconType: string
            iconValue: string
            emoji: string
            priceCoins: number
            tier: string
            sortOrder: number
            isActive: boolean
          }[]
          coinBalance: number
        }>('/api/quicky/games/spin-bottle/gifts'),
      send: (roomId: string, recipientId: string, itemId: string, quantity = 1, giftEventId?: string) =>
        jsonFetch<{ ok: boolean; coinBalance: number; multiplier?: number; senderPoints?: number; receiverPoints?: number; duplicate?: boolean }>('/api/quicky/games/spin-bottle/gifts', {
          method: 'POST',
          body: JSON.stringify({ roomId, recipientId, itemId, quantity, giftEventId }),
        }),
      // Games PRD §23-§26 — bulk send: the SERVER resolves the recipient
      // list from the room + filter ('all' | 'male' | 'female'), computes
      // totalCost = price × quantity × recipients, and deducts atomically.
      sendBulk: (
        roomId: string,
        itemId: string,
        recipientFilter: 'all' | 'male' | 'female',
        quantity: number,
        giftEventId?: string
      ) =>
        jsonFetch<{ ok: boolean; coinBalance: number; recipientCount: number; quantity: number; totalCost: number; multiplier?: number; senderPoints?: number; receiverPoints?: number }>(
          '/api/quicky/games/spin-bottle/gifts',
          { method: 'POST', body: JSON.stringify({ roomId, itemId, recipientFilter, quantity, giftEventId }) }
        ),
    },
    /** Room-chat settings: my own mention privacy for ONE room (shared by
     *  both room games — the membership table is shared). */
    roomMentions: (roomId: string, enabled: boolean) =>
      jsonFetch<{ ok: boolean; roomId: string; mentionsEnabled: boolean }>(
        '/api/quicky/games/spin-bottle/mention-settings',
        { method: 'POST', body: JSON.stringify({ roomId, enabled }) }
      ),
    coins: {
      balance: () =>
        jsonFetch<{ coinBalance: number }>('/api/quicky/games/spin-bottle/coins'),
      // v3 §30: the SINGLE purchase entry point — swapping the mock for
      // Google Play / Apple IAP / Stripe later only changes this route.
      purchase: (packageId: string) =>
        jsonFetch<{ ok: boolean; mock: boolean; coinsAdded: number; bonusCoins?: number; premium?: boolean; coinBalance: number }>(
          '/api/quicky/games/spin-bottle/coins',
          { method: 'POST', body: JSON.stringify({ packageId }) }
        ),
    },
  },
  admin: {
    /** Refactor PRD §19/§84 — game configuration + rotating descriptions. */
    games: {
      list: () => jsonFetch<{ games: any[]; descriptionItems: any[] }>('/api/quicky/admin/games'),
      create: (kind: 'game' | 'description', data: any) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/games', { method: 'POST', body: JSON.stringify({ kind, data }) }),
      update: (kind: 'game' | 'description', id: string, data: any) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/games', { method: 'PATCH', body: JSON.stringify({ kind, id, data }) }),
      remove: (kind: 'game' | 'description', id: string) =>
        jsonFetch<{ ok: boolean }>(`/api/quicky/admin/games?kind=${kind}&id=${id}`, { method: 'DELETE' }),
    },
    /** Refactor PRD §60 — admin complaints queue. */
    complaints: {
      list: (status?: string) =>
        jsonFetch<{ complaints: any[] }>(`/api/quicky/admin/complaints${status ? `?status=${status}` : ''}`),
      setStatus: (id: string, status: string) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/complaints', { method: 'PATCH', body: JSON.stringify({ id, status }) }),
    },
    gifts: {
      list: () =>
        jsonFetch<{ categories: any[]; gifts: any[] }>('/api/quicky/admin/gifts'),
      create: (kind: 'category' | 'gift', data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/gifts', {
          method: 'POST',
          body: JSON.stringify({ kind, data }),
        }),
      update: (kind: 'category' | 'gift', id: string, data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/gifts', {
          method: 'PATCH',
          body: JSON.stringify({ kind, id, data }),
        }),
      // admin-console PRD §18.1 — move-up/move-down reorder (persists
      // server-side as a sortOrder swap).
      move: (kind: 'category' | 'gift', id: string, direction: 'up' | 'down') =>
        jsonFetch<{ ok: boolean; moved: boolean }>('/api/quicky/admin/gifts', {
          method: 'PATCH',
          body: JSON.stringify({ kind, id, move: direction }),
        }),
      remove: (kind: 'category' | 'gift', id: string) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/gifts', {
          method: 'DELETE',
          body: JSON.stringify({ kind, id }),
        }),
    },
    // Lifecycle PRD §44/§48: "How It Works" rules CRUD (admin-managed);
    // admin-console PRD §5 — per-game via ?gameType=.
    gameRules: {
      list: (gameType?: string) =>
        jsonFetch<{ rules: any[]; gameType: string }>(
          `/api/quicky/admin/game-rules${gameType ? `?gameType=${encodeURIComponent(gameType)}` : ''}`
        ),
      create: (data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; rule: any }>('/api/quicky/admin/game-rules', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; rule: any }>('/api/quicky/admin/game-rules', {
          method: 'PATCH',
          body: JSON.stringify({ id, data }),
        }),
      // admin-console PRD §5.1/§18.1 — move-up / move-down reorder control;
      // the new order persists (sortOrder swap server-side).
      move: (id: string, direction: 'up' | 'down') =>
        jsonFetch<{ ok: boolean; moved: boolean }>('/api/quicky/admin/game-rules', {
          method: 'PATCH',
          body: JSON.stringify({ id, move: direction }),
        }),
      remove: (id: string) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/game-rules', {
          method: 'DELETE',
          body: JSON.stringify({ id }),
        }),
    },
    // Game-chat PRD §69/§70/§115: admin sticker bundle + item management.
    stickers: {
      bundles: () =>
        jsonFetch<{ bundles: any[]; leagues: any[]; seasons: any[] }>(
          '/api/quicky/admin/stickers/bundles'
        ),
      createBundle: (data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; bundle: any }>('/api/quicky/admin/stickers/bundles', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      updateBundle: (id: string, data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; bundle: any }>('/api/quicky/admin/stickers/bundles', {
          method: 'PATCH',
          body: JSON.stringify({ id, data }),
        }),
      removeBundle: (id: string) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/stickers/bundles', {
          method: 'DELETE',
          body: JSON.stringify({ id }),
        }),
      listByBundle: (bundleId: string) =>
        jsonFetch<{ stickers: any[] }>(`/api/quicky/admin/stickers?bundleId=${bundleId}`),
      createSticker: (data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; sticker: any }>('/api/quicky/admin/stickers', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      updateSticker: (id: string, data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; sticker: any }>('/api/quicky/admin/stickers', {
          method: 'PATCH',
          body: JSON.stringify({ id, data }),
        }),
      removeSticker: (id: string) =>
        jsonFetch<{ ok: boolean; deleted: number }>('/api/quicky/admin/stickers', {
          method: 'DELETE',
          body: JSON.stringify({ id }),
        }),
      /** Bulk delete — the admin multi-select flow posts the whole selection. */
      removeStickers: (ids: string[]) =>
        jsonFetch<{ ok: boolean; deleted: number }>('/api/quicky/admin/stickers', {
          method: 'DELETE',
          body: JSON.stringify({ ids }),
        }),
    },
    // Games PRD §64/§65 — Live Tables monitor (read-only room inspection).
    liveRooms: {
      list: () =>
        jsonFetch<{
          rooms: {
            id: string
            status: string
            playerCount: number
            maxPlayers: number
            maleCount: number
            femaleCount: number
            canSpin: boolean
            currentSpin: { status: string; result: string | null } | null
            createdAt: string
            lastActivityAt: string
            players: { userId: string; name: string | null; gender: string | null; seatIndex: number; connection: string; isActive: boolean }[]
          }[]
          totals: { rooms: number; players: number }
        }>('/api/quicky/admin/live-rooms'),
    },
    // Games PRD §66 — user management (server-side role checks).
    users: {
      list: (params?: { q?: string }) =>
        jsonFetch<{ users: any[] }>(
          `/api/quicky/admin/users${params?.q ? `?q=${encodeURIComponent(params.q)}` : ''}`
        ),
      setAdmin: (id: string, isAdmin: boolean) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/users', {
          method: 'PATCH',
          body: JSON.stringify({ id, isAdmin }),
        }),
      // admin-console PRD §12 — per-user reset from the Users console (same
      // operations the designated test account gets in Settings).
      reset: (id: string, kind: 'reset-progress' | 'reset-inventory') =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/users', {
          method: 'PATCH',
          body: JSON.stringify({ id, action: kind }),
        }),
    },
    // Games PRD §67 — audit log viewer.
    audit: {
      list: (params?: { take?: number }) =>
        jsonFetch<{ entries: any[] }>(
          `/api/quicky/admin/audit${params?.take ? `?take=${params.take}` : ''}`
        ),
    },
    // ─── REALM SYSTEM (realm PRD §50-§55) ────────────────────────────
    realmConfig: {
      list: () =>
        jsonFetch<{ realms: any[]; itemOptions: any[] }>('/api/quicky/admin/realm-config'),
      update: (level: number, data: { promotionThreshold?: number; cycleDurationDays?: number; isActive?: boolean; rewards?: unknown; cratePoints?: number; cratePointsByPlace?: Record<string, number> }) =>
        jsonFetch<{ ok: boolean; realm: any }>('/api/quicky/admin/realm-config', {
          method: 'PATCH',
          body: JSON.stringify({ level, ...data }),
        }),
    },
    multiplierEvents: {
      list: () =>
        jsonFetch<{ events: any[] }>('/api/quicky/admin/multiplier-events'),
      create: (data: { name: string; multiplier: number; durationMs: number; startsAt?: string }) =>
        jsonFetch<{ ok: boolean; event: any }>('/api/quicky/admin/multiplier-events', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      cancel: (id: string) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/multiplier-events', {
          method: 'PATCH',
          body: JSON.stringify({ id }),
        }),
      remove: (id: string) =>
        jsonFetch<{ ok: boolean }>(`/api/quicky/admin/multiplier-events?id=${id}`, { method: 'DELETE' }),
    },
    realmCycles: {
      dashboard: () =>
        jsonFetch<{ realms: any[]; totals: any; memberCountByCohort: Record<string, number> }>('/api/quicky/admin/realm-cycles'),
      cohort: (cohortId: string) =>
        jsonFetch<{ cohort: any }>(`/api/quicky/admin/realm-cycles?cohortId=${cohortId}`),
      settle: () =>
        jsonFetch<{ ok: boolean; settled: number }>('/api/quicky/admin/realm-cycles?settle=1'),
      // admin-console PRD §7 — finalize ONE cycle immediately (server-
      // authoritative rankings + grants, idempotent SETTLING lock).
      forceSettle: (cycleId: string) =>
        jsonFetch<{ ok: boolean; settled: number }>(
          `/api/quicky/admin/realm-cycles?forceSettle=${encodeURIComponent(cycleId)}`
        ),
    },
    // ─── ADMIN CONSOLE PRD — assets / reward catalog / seasons / test account
    assets: {
      info: () =>
        jsonFetch<{ ok: boolean; folders: string[]; storage: { mode: string; bucket: string; configured: boolean } }>(
          '/api/quicky/admin/assets/upload'
        ),
      /** XHR upload with real progress (admin-console PRD §18.1 ImageUploader). */
      upload: (
        file: File | Blob,
        folder: string,
        onProgress?: (pct: number) => void
      ): Promise<{ ok: boolean; url: string; path: string; animated: boolean; storage: { mode: string; bucket: string; configured: boolean } }> =>
        new Promise((resolve, reject) => {
          const fd = new FormData()
          fd.append('file', file, file instanceof File ? file.name : 'asset.png')
          fd.append('folder', folder)
          const xhr = new XMLHttpRequest()
          xhr.open('POST', '/api/quicky/admin/assets/upload')
          xhr.withCredentials = true
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
          }
          xhr.onload = () => {
            let data: any = {}
            try { data = JSON.parse(xhr.responseText) } catch {}
            if (xhr.status >= 200 && xhr.status < 300) resolve(data)
            else reject(Object.assign(new Error(data?.message || data?.error || `Upload failed (${xhr.status})`), { status: xhr.status, body: data }))
          }
          xhr.onerror = () => reject(new Error('Upload failed — network error'))
          xhr.onabort = () => reject(new Error('Upload cancelled'))
          xhr.send(fd)
        }),
    },
    rewards: {
      list: () =>
        jsonFetch<{ rewards: any[]; rewardTypes: string[]; rarities: string[] }>('/api/quicky/admin/rewards'),
      create: (data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; reward: any }>('/api/quicky/admin/rewards', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; reward: any }>('/api/quicky/admin/rewards', {
          method: 'PATCH',
          body: JSON.stringify({ id, data }),
        }),
      remove: (id: string) =>
        jsonFetch<{ ok: boolean; disabled: boolean }>('/api/quicky/admin/rewards', {
          method: 'DELETE',
          body: JSON.stringify({ id }),
        }),
    },
    seasons: {
      list: () =>
        jsonFetch<{ seasons: any[] }>('/api/quicky/admin/seasons'),
      create: (data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; season: any }>('/api/quicky/admin/seasons', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/seasons', {
          method: 'PATCH',
          body: JSON.stringify({ id, data }),
        }),
      remove: (id: string) =>
        jsonFetch<{ ok: boolean; disabled: boolean }>('/api/quicky/admin/seasons', {
          method: 'DELETE',
          body: JSON.stringify({ id }),
        }),
    },
    // ─── crate-pass PRD — monthly seasons + crates ─────────────────────
    monthlySeasons: {
      list: () =>
        jsonFetch<{ seasons: any[]; itemOptions: any[] }>('/api/quicky/admin/monthly-seasons'),
      create: (data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; season: any }>('/api/quicky/admin/monthly-seasons', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/monthly-seasons', {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) =>
        jsonFetch<{ ok: boolean; error?: string; message?: string }>(`/api/quicky/admin/monthly-seasons?id=${id}`, {
          method: 'DELETE',
        }),
    },
    crates: {
      list: () =>
        jsonFetch<{ crates: any[]; itemOptions: any[]; realms: any[] }>('/api/quicky/admin/crates'),
      levels: (crateId: string) =>
        jsonFetch<{ levels: any[] }>(`/api/quicky/crates/${crateId}`),
      create: (data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; crate: any }>('/api/quicky/admin/crates', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; crate?: any; error?: string; message?: string }>('/api/quicky/admin/crates', {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      remove: (id: string) =>
        jsonFetch<{ ok: boolean; error?: string; message?: string }>(`/api/quicky/admin/crates?id=${id}`, {
          method: 'DELETE',
        }),
    },
    realmRewards: {
      list: () =>
        jsonFetch<{ rules: any[]; rewards: any[]; stickerBundles: { id: string; name: string }[]; placeLimits: Record<string, number> }>(
          '/api/quicky/admin/realm-rewards'
        ),
      /** ONE set of rewards per won place — kinds: coins / crate points /
       *  sticker sets (auto-managed rows) + frames / hats / name icons
       *  (catalog references, cosmetics take a level). */
      set: (
        realmLevel: number,
        entries: { position: number; kind: 'COINS' | 'CRATE_POINTS' | 'STICKER_SET' | 'REWARD'; amount?: number; bundleId?: string; rewardId?: string; level?: number }[]
      ) =>
        jsonFetch<{ ok: boolean; realmLevel: number; count: number }>('/api/quicky/admin/realm-rewards', {
          method: 'PUT',
          body: JSON.stringify({ realmLevel, entries }),
        }),
    },
    testAccount: {
      get: () =>
        jsonFetch<{ testAccount: any; environment: string }>('/api/quicky/admin/test-account'),
      save: (data: { userId: string; displayName?: string; enabled: boolean; allowedEnvironments?: string }) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/test-account', {
          method: 'POST',
          body: JSON.stringify({ action: 'save', ...data }),
        }),
      reset: (userId: string, kind: 'reset-progress' | 'reset-inventory') =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/test-account', {
          method: 'POST',
          body: JSON.stringify({ action: kind, userId }),
        }),
    },
    consoleSettings: {
      get: () =>
        jsonFetch<{
          settings: { webAppUrl: string }
          storage: { mode: string; bucket: string; configured: boolean }
          stats: any
        }>('/api/quicky/admin/console-settings'),
      set: (key: string, value: string) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/console-settings', {
          method: 'POST',
          body: JSON.stringify({ key, value }),
        }),
    },
    // ─── Game Economy PRD §63 — the Game Store console (packages, crates,
    // final-hours boost config + the monetization dashboard §59) ──────────
    gameStore: {
      list: () =>
        jsonFetch<{
          packages: any[]
          crates: any[]
          boosts: { id: string; realmLevel: number | null; hoursBeforeEnd: number; multiplier: number; enabled: boolean }[]
          stats: any
          giftOptions: { id: string; name: string; emoji: string; coinPrice: number }[]
          cosmeticOptions: { id: string; name: string; rewardType: string }[]
        }>('/api/quicky/admin/game-store'),
      create: (kind: 'package' | 'crate' | 'boost', data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; row: any }>('/api/quicky/admin/game-store', {
          method: 'POST',
          body: JSON.stringify({ kind, data }),
        }),
      update: (kind: 'package' | 'crate' | 'boost', id: string | null, data: Record<string, unknown>) =>
        jsonFetch<{ ok: boolean; row?: any }>('/api/quicky/admin/game-store', {
          method: 'PATCH',
          body: JSON.stringify({ kind, id, data }),
        }),
      remove: (kind: 'package' | 'crate' | 'boost', id: string, realmLevel?: string) =>
        jsonFetch<{ ok: boolean; disabled?: boolean }>(
          `/api/quicky/admin/game-store?kind=${kind}&id=${id}${realmLevel ? `&realmLevel=${realmLevel}` : ''}`,
          { method: 'DELETE' }
        ),
      /** PRD §67 — refund a completed purchase (ledger + balance reconciliation). */
      refund: (purchaseId: string) =>
        jsonFetch<{ ok: boolean; coinsReclaimed: number; crateRevoked: boolean; status: string }>(
          '/api/quicky/admin/game-store',
          { method: 'POST', body: JSON.stringify({ kind: 'refund', data: { purchaseId } }) }
        ),
    },
  },
  // ─── GAME CHAT (game-chat PRD §7+) — private player-to-player messaging,
  // fully separate from the Dating Chat (matches) system above.
  gameChat: {
    conversations: () =>
      jsonFetch<{ conversations: any[] }>('/api/quicky/game-chat/conversations'),
    messages: (params: { peerUserId?: string; conversationId?: string; before?: string }) => {
      const q = new URLSearchParams()
      if (params.peerUserId) q.set('peerUserId', params.peerUserId)
      if (params.conversationId) q.set('conversationId', params.conversationId)
      if (params.before) q.set('before', params.before)
      return jsonFetch<{
        conversationId: string | null
        peer: { id: string; name: string | null; avatar: string | null }
        hasMore: boolean
        oldestCursor: string | null
        messages: any[]
        myLastReadAt: string | null
        peerLastReadAt: string | null
      }>(`/api/quicky/game-chat/messages?${q.toString()}`)
    },
    send: (data: {
      peerUserId?: string
      conversationId?: string
      messageType?: 'text' | 'sticker' | 'image' | 'voice' | 'quicky_image'
      text?: string
      stickerId?: string
      mediaUrl?: string
      mediaDuration?: number
      replyToMessageId?: string
      clientMessageId?: string
    }) =>
      jsonFetch<{ ok: boolean; conversationId: string; message: any }>(
        '/api/quicky/game-chat/messages',
        { method: 'POST', body: JSON.stringify(data) }
      ),
    /** Refactor PRD §56 — per-user Clear Chat marker (game DMs). */
    clear: (conversationId: string) =>
      jsonFetch<{ ok: boolean }>(`/api/quicky/game-chat/messages?conversationId=${conversationId}`, {
        method: 'DELETE',
      }),
    markRead: (conversationId: string) =>
      jsonFetch<{ ok: boolean; lastReadAt: string }>('/api/quicky/game-chat/read', {
        method: 'POST',
        body: JSON.stringify({ conversationId }),
      }),
    react: (messageId: string, reaction: string | null) =>
      jsonFetch<{ ok: boolean }>('/api/quicky/game-chat/react', {
        method: 'POST',
        body: JSON.stringify({ messageId, reaction }),
      }),
    stickers: () =>
      jsonFetch<{ bundles: any[]; coinBalance: number }>('/api/quicky/game-chat/stickers'),
    stickerAction: (action: 'purchase' | 'claim', bundleId: string) =>
      jsonFetch<{ ok: boolean; coinBalance?: number; alreadyOwned?: boolean }>(
        '/api/quicky/game-chat/stickers',
        { method: 'POST', body: JSON.stringify({ action, bundleId }) }
      ),
  },
  frames: {
    catalog: () =>
      jsonFetch<{ catalog: any[]; equippedFrameId: string; coinBalance: number }>('/api/quicky/games/frames'),
    buy: (frameId: string) =>
      jsonFetch<{ ok: boolean }>('/api/quicky/games/frames', {
        method: 'POST',
        body: JSON.stringify({ frameId, action: 'buy' }),
      }),
    equip: (frameId: string) =>
      jsonFetch<{ ok: boolean; equippedFrameId: string | null }>('/api/quicky/games/frames', {
        method: 'POST',
        body: JSON.stringify({ frameId, action: 'equip' }),
      }),
  },
  community: {
    feed: () => jsonFetch<{ posts: any[] }>('/api/quicky/community/posts'),
    create: (data: { mediaUrl: string; mediaType?: 'image' | 'video'; caption?: string; filter?: string; commentsEnabled?: boolean }) =>
      jsonFetch<{ ok: boolean; postId: string }>('/api/quicky/community/posts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    edit: (postId: string, caption: string) =>
      jsonFetch<{ ok: boolean; caption: string | null }>(`/api/quicky/community/posts/${postId}`, {
        method: 'PATCH',
        body: JSON.stringify({ caption }),
      }),
    remove: (postId: string) =>
      jsonFetch<{ ok: boolean }>(`/api/quicky/community/posts/${postId}`, { method: 'DELETE' }),
    like: (postId: string) =>
      jsonFetch<{ ok: boolean; likedByMe: boolean; likeCount: number }>(
        `/api/quicky/community/posts/${postId}/like`,
        { method: 'POST' }
      ),
    comments: (postId: string) =>
      jsonFetch<{
        comments: any[]
        viewer?: { id: string; isOwner: boolean; isBanned: boolean; ownerName: string | null }
      }>(`/api/quicky/community/posts/${postId}/comments`),
    comment: (postId: string, text: string) =>
      jsonFetch<{ ok: boolean; comment: any }>(`/api/quicky/community/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    /** Delete a comment — allowed for the comment author or the post owner. */
    commentDelete: (postId: string, commentId: string) =>
      jsonFetch<{ ok: boolean }>(`/api/quicky/community/posts/${postId}/comments/${commentId}`, {
        method: 'DELETE',
      }),
    /** Post owner bans the comment's author from commenting on ALL of the
     *  owner's posts (past and future; per-owner, not global). */
    commentBan: (postId: string, commentId: string) =>
      jsonFetch<{ ok: boolean }>(`/api/quicky/community/posts/${postId}/comments/${commentId}/ban`, {
        method: 'POST',
      }),
  },
  rolls: {
    list: () =>
      jsonFetch<{ isPremium: boolean; rolls: any[] }>('/api/quicky/rolls'),
    create: (data: { mediaUrl: string; mediaType?: 'image' | 'video'; caption?: string; filter?: string }) =>
      jsonFetch<{ ok: boolean; rollId: string }>('/api/quicky/rolls', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    remove: (rollId: string) =>
      jsonFetch<{ ok: boolean }>(`/api/quicky/rolls/${rollId}`, { method: 'DELETE' }),
    like: (rollId: string) =>
      jsonFetch<{ ok: boolean; likedByMe: boolean; likeCount: number }>(
        `/api/quicky/rolls/${rollId}/like`,
        { method: 'POST' }
      ),
    comments: (rollId: string) =>
      jsonFetch<{ comments: any[] }>(`/api/quicky/rolls/${rollId}/comments`),
    comment: (rollId: string, text: string) =>
      jsonFetch<{ ok: boolean; comment: any }>(`/api/quicky/rolls/${rollId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
  },
  dm: (toUserId: string, text: string) =>
    jsonFetch<{ ok: boolean; matchId: string; createdMatch: boolean }>(`/api/quicky/dm`, {
      method: 'POST',
      body: JSON.stringify({ toUserId, text }),
    }),
  profile: (userId: string) =>
    jsonFetch<{ profile: any; isMe: boolean; relationship?: { hasMatch: boolean; matchId: string | null; theyLikedMe: boolean; superLike: boolean } }>(`/api/quicky/profile/${userId}`),
  premium: {
    get: () => jsonFetch('/api/quicky/premium'),
    subscribe: (plan: string) =>
      jsonFetch('/api/quicky/premium', { method: 'POST', body: JSON.stringify({ plan }) }),
    cancel: () =>
      jsonFetch('/api/quicky/premium', { method: 'POST', body: JSON.stringify({ action: 'cancel' }) }),
  },
  verifyPhoto: (action: 'request_challenge' | 'submit') =>
    jsonFetch('/api/quicky/verify-photo', { method: 'POST', body: JSON.stringify({ action }) }),
  settings: {
    get: () => jsonFetch<{ settings: any }>('/api/quicky/settings'),
    update: (data: any) =>
      jsonFetch('/api/quicky/settings', { method: 'PATCH', body: JSON.stringify(data) }),
    phone: {
      otp: (newPhone: string) =>
        jsonFetch<{ ok: boolean; demoCode: string }>('/api/quicky/settings/phone', {
          method: 'POST',
          body: JSON.stringify({ action: 'request_otp', newPhone }),
        }),
      verify: (newPhone: string, code: string) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/settings/phone', {
          method: 'POST',
          body: JSON.stringify({ action: 'verify', newPhone, code }),
        }),
    },
    email: {
      otp: (email: string) =>
        jsonFetch<{ ok: boolean; demoCode: string }>('/api/quicky/settings/email', {
          method: 'POST',
          body: JSON.stringify({ action: 'request_otp', email }),
        }),
      verify: (email: string, code: string) =>
        jsonFetch<{ ok: boolean }>('/api/quicky/settings/email', {
          method: 'POST',
          body: JSON.stringify({ action: 'verify', email, code }),
        }),
    },
    blocked: {
      list: () => jsonFetch<{ blocked: any[] }>('/api/quicky/settings/blocked'),
      unblock: (blockId: string) =>
        jsonFetch(`/api/quicky/settings/blocked?blockId=${blockId}`, { method: 'DELETE' }),
    },
  },
  upload: uploadFile,
  uploadWithProgress: uploadFileWithProgress,
  // ─── FCM PUSH (Settings → Notifications → Enable push) ───────────────
  push: {
    register: (token: string, platform: 'web' | 'ios' | 'android') =>
      jsonFetch<{ ok: boolean }>('/api/quicky/push/register', {
        method: 'POST',
        body: JSON.stringify({ token, platform }),
      }),
    unregister: (token: string) =>
      jsonFetch<{ ok: boolean }>('/api/quicky/push/register', {
        method: 'DELETE',
        body: JSON.stringify({ token }),
      }),
  },
  // ─── MONETIZATION: wallet + rewarded-ad sessions (Monetization PRD §7) ──
  wallet: {
    get: () =>
      jsonFetch<{ wallet: { coins: number; realmPoints: number | null; lifetimeRealmPoints: number | null } }>('/api/quicky/wallet'),
  },
  rewardedAds: {
    status: (platform: 'web' | 'android' | 'ios') =>
      jsonFetch<{
        canWatch: boolean
        reason: string | null
        provider: 'admob' | 'web_ad' | 'mock' | null
        nextAdAtMs: number | null
        cooldownRemainingMs: number | null
        adsToday: number | null
        dailyLimit: number
        config: { minReward: number; maxReward: number; coinsEnabled: boolean; pointsEnabled: boolean; cooldownSeconds: number }
      }>(`/api/quicky/rewards/status?platform=${platform}`),
    createSession: (rewardType: 'coins' | 'realm_points', platform: 'web' | 'android' | 'ios') =>
      jsonFetch<{ sessionId: string; status: 'pending'; rewardType: 'COINS' | 'REALM_POINTS'; provider: string; expiresAt: string }>(
        '/api/quicky/rewards/session',
        { method: 'POST', body: JSON.stringify({ rewardType, platform }) }
      ),
    getSession: (sessionId: string) =>
      jsonFetch<{
        session: {
          sessionId: string
          status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED'
          rewardType: 'COINS' | 'REALM_POINTS'
          provider: string
          rewardAmount: number | null
          coinBalance: number | null
          cyclePoints: number | null
        }
      }>(`/api/quicky/rewards/session/${sessionId}`),
    cancelSession: (sessionId: string) =>
      jsonFetch<{ ok: boolean; cancelled: boolean }>(`/api/quicky/rewards/session/${sessionId}`, { method: 'DELETE' }),
    mockComplete: (sessionId: string) =>
      jsonFetch<{ ok: boolean; rewardAmount: number; rewardType: 'COINS' | 'REALM_POINTS'; coinBalance: number | null; cyclePoints: number | null }>(
        '/api/quicky/rewards/mock-complete',
        { method: 'POST', body: JSON.stringify({ sessionId }) }
      ),
  },
  // ─── MONETIZATION: store + real payments (Monetization PRD §5/§7) ────────
  store: {
    products: (platform: 'web' | 'android' | 'ios') =>
      jsonFetch<{
        platform: string
        products: Array<{
          id: string
          name: string
          kind: 'COIN_PACK' | 'REALM_POINTS_PACK' | 'SUBSCRIPTION'
          coins: number
          bonusCoins: number
          realmPoints: number | null
          plan: string | null
          price: number
          currency: string
          badge: string | null
          featured: boolean
          premiumOnly?: boolean
          stripePriceId: string | null
          googlePlayProductId: string | null
          purchaseProvider: 'stripe' | 'google_play' | 'apple_pending' | 'mock' | 'unavailable'
        }>
      }>(`/api/quicky/store/products?platform=${platform}`),
  },
  payments: {
    stripeCheckout: (productId: string) =>
      jsonFetch<{ url: string; purchaseId: string }>('/api/quicky/payments/stripe/checkout', {
        method: 'POST',
        body: JSON.stringify({ productId }),
      }),
    googlePlayVerify: (productId: string, purchaseToken: string) =>
      jsonFetch<{ ok: boolean; alreadyCompleted?: boolean; kind?: string; coinBalance?: number | null; cyclePoints?: number | null }>(
        '/api/quicky/payments/google-play/verify',
        { method: 'POST', body: JSON.stringify({ productId, purchaseToken }) }
      ),
    history: () =>
      jsonFetch<{
        purchases: Array<{ id: string; productType: string; provider: string; currency: string; amount: number; coins: number | null; bonusCoins: number | null; status: string; createdAt: string }>
        walletTransactions: Array<{ id: string; currencyType: string; amount: number; transactionType: string; source: string; balanceAfter: number | null; createdAt: string }>
      }>('/api/quicky/payments/history'),
  },
  // ─── REALM PROGRESSION (realm PRD §61) — shared across every game ─────
  realm: {
    status: () => jsonFetch<{ realm: any }>('/api/quicky/realm/me'),
    leaderboard: () => jsonFetch<{ realm: any; cycle: any; threshold: number; rows: any[] }>('/api/quicky/realm/leaderboard'),
    history: (limit = 50) =>
      jsonFetch<{ history: any[] }>(`/api/quicky/realm/points/history?limit=${limit}`),
    claim: (cycleId?: string) =>
      jsonFetch<{ ok: boolean }>('/api/quicky/realm/claim', {
        method: 'POST',
        body: JSON.stringify({ cycleId }),
      }),
    activeEvents: () =>
      jsonFetch<{
        multiplier: number
        multiplierEvent: any
        realmCycle: any
        finalBoost?: { active: boolean; multiplier: number; hoursBeforeEnd: number; endsAt: string | null; realmLevel: number | null }
      }>('/api/quicky/events/active'),
  },
  // ─── REWARDS (admin-console PRD §12) — popup collection + cosmetics ──
  rewards: {
    pending: () =>
      jsonFetch<{ grants: any[]; cosmetics: any[] }>('/api/quicky/rewards/pending'),
    claim: () =>
      jsonFetch<{ ok: boolean; claimed: any[]; coinBalance: number; cratePointsAwarded?: number; cosmetics: any[] }>('/api/quicky/rewards/claim', {
        method: 'POST',
      }),
    equip: (rewardId: string, level: number, equip: boolean) =>
      jsonFetch<{ ok: boolean; cosmetics: any[] }>('/api/quicky/rewards/equip', {
        method: 'POST',
        body: JSON.stringify({ rewardId, level, equip }),
      }),
  },
  cosmetics: {
    list: () => jsonFetch<{ cosmetics: any[] }>('/api/quicky/cosmetics'),
    /** Wardrobe + the full ACTIVE cosmetic catalog with owned levels —
     *  powers the Gifts & Cosmetics modal's browse tabs. */
    catalog: () => jsonFetch<{ cosmetics: any[]; catalog: GiftsHubCosmeticEntry[] }>('/api/quicky/cosmetics?catalog=1'),
  },
  // ─── GIFTS HUB (main game screen — friend gifting, no room) ─────────
  giftsHub: {
    catalog: () =>
      jsonFetch<{ catalog: GiftsHubGift[]; coinBalance: number; giftsSent: number; giftsReceived: number }>('/api/quicky/gifts'),
    send: (recipientId: string, itemId: string, quantity = 1) =>
      jsonFetch<{ ok: boolean; coinBalance: number; recipientName: string; quantity: number; totalCost: number }>('/api/quicky/gifts', {
        method: 'POST',
        body: JSON.stringify({ recipientId, itemId, quantity }),
      }),
  },
  // ─── MONTHLY SEASON (crate-pass PRD — the ❤ room chip) ──────────────
  season: {
    status: () => jsonFetch<any>('/api/quicky/season'),
  },
  // ─── CRATES — the realm pass (crown 👑 room chip) ─────────────────────
  crates: {
    list: () => jsonFetch<{ crates: any[] }>('/api/quicky/crates'),
    detail: (crateId: string) => jsonFetch<any>(`/api/quicky/crates/${crateId}`),
    purchase: (crateId: string) =>
      jsonFetch<{ ok: boolean; coinBalance: number; currentLevel: number; newLevels: number[] }>('/api/quicky/crates', {
        method: 'POST',
        body: JSON.stringify({ action: 'purchase', crateId }),
      }),
    buyLevels: (crateId: string, levels: number) =>
      jsonFetch<{ ok: boolean; coinBalance: number; currentLevel: number; newLevels: number[] }>('/api/quicky/crates/buy', {
        method: 'POST',
        body: JSON.stringify({ crateId, levels }),
      }),
    // Claim ONE level's prize (tap → modal → CLAIM). track: 'FREE' | 'CRATE'.
    claim: (crateId: string, level: number, track: 'FREE' | 'CRATE') =>
      jsonFetch<{
        ok: true
        track: 'FREE' | 'CRATE'
        level: number
        prize: { type: string; name: string; emoji: string; quantity: number }
        coinBalance: number | null
      }>('/api/quicky/crates/claim', {
        method: 'POST',
        body: JSON.stringify({ crateId, level, track }),
      }),
  },
  // ─── GAME STORE (Game Economy PRD) — the Games section's own economy ────
  gameStore: {
    payload: (tab?: string) =>
      jsonFetch<any>(
        `/api/quicky/game-store?platform=${clientPlatform()}${tab ? `&tab=${encodeURIComponent(tab)}` : ''}`
      ),
    purchaseCoins: (packageId: string) =>
      jsonFetch<{ ok: boolean; coinBalance: number; coinsAdded: number; bonusCoins: number; purchaseId: string; mock: boolean }>(
        '/api/quicky/game-store/purchase-coins',
        { method: 'POST', body: JSON.stringify({ packageId, platform: clientPlatform() }) }
      ),
    purchaseCrate: (crateProductId: string) =>
      jsonFetch<{ ok: boolean; cratePurchaseId: string; purchaseId: string; name: string; emoji: string; mock: boolean }>(
        '/api/quicky/game-store/purchase-crate',
        { method: 'POST', body: JSON.stringify({ crateProductId, platform: clientPlatform() }) }
      ),
    openCrate: (cratePurchaseId: string) =>
      jsonFetch<{
        ok: true
        rewards: {
          realmPoints: number
          coins: number
          coinBalance: number
          realmPointsAwarded: boolean
          gift: { itemId: string; name: string; emoji: string; quantity: number } | null
          cosmetic: { rewardId: string; name: string; icon: string } | null
        }
      }>('/api/quicky/game-store/open-crate', {
        method: 'POST',
        body: JSON.stringify({ cratePurchaseId }),
      }),
    purchaseCosmetic: (rewardId: string, level = 1) =>
      jsonFetch<{ ok: boolean; coinBalance: number; priceCoins: number }>(
        '/api/quicky/game-store/purchase-cosmetic',
        { method: 'POST', body: JSON.stringify({ rewardId, level }) }
      ),
    sync: () =>
      jsonFetch<{ pending: any[]; ownedCrates: any[] }>('/api/quicky/game-store/purchases'),
    track: (type: string, metadata?: Record<string, unknown>) =>
      jsonFetch<{ ok: boolean }>('/api/quicky/game-store/track', {
        method: 'POST',
        body: JSON.stringify({ type, metadata }),
      }),
  },
}

/** PRD §12 — the platform the payment adapter routes by (web vs native). */
function clientPlatform(): 'web' | 'android' | 'ios' {
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor
    if (cap?.isNativePlatform?.()) {
      const p = cap.getPlatform?.()
      return p === 'ios' ? 'ios' : 'android'
    }
  } catch {}
  return 'web'
}
