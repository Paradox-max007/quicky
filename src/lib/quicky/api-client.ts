// Quicky — client-side API helpers

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
    const err = new Error((data as any)?.error ?? `Request failed (${res.status})`) as any
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
      discoveryAgeMin?: number
      discoveryAgeMax?: number
      discoveryDistanceKm?: number
      discoveryShowVerifiedOnly?: boolean
      discoveryRecentlyActive?: boolean
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
      stickerId?: string
    ) =>
      jsonFetch<{ ok: boolean; message: any }>('/api/quicky/games/spin-bottle/chat', {
        method: 'POST',
        body: JSON.stringify({ roomId, text, mentions: mentions ?? [], stickerId: stickerId ?? null }),
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
      stickerId?: string
    ) =>
      jsonFetch<{ ok: boolean; message: any }>('/api/quicky/games/spin-bottle/chat', {
        method: 'POST',
        body: JSON.stringify({ roomId, text, mentions: mentions ?? [], stickerId: stickerId ?? null }),
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
      update: (level: number, data: { promotionThreshold?: number; cycleDurationDays?: number; isActive?: boolean; rewards?: unknown }) =>
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
    realmRewards: {
      list: () =>
        jsonFetch<{ rules: any[]; rewards: any[]; placeLimits: Record<string, number> }>('/api/quicky/admin/realm-rewards'),
      set: (realmLevel: number, rules: { position: number; rewardId: string; level: number; quantity: number }[]) =>
        jsonFetch<{ ok: boolean; realmLevel: number; count: number }>('/api/quicky/admin/realm-rewards', {
          method: 'PUT',
          body: JSON.stringify({ realmLevel, rules }),
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
      jsonFetch<{ comments: any[] }>(`/api/quicky/community/posts/${postId}/comments`),
    comment: (postId: string, text: string) =>
      jsonFetch<{ ok: boolean; comment: any }>(`/api/quicky/community/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text }),
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
      jsonFetch<{ multiplier: number; multiplierEvent: any; realmCycle: any }>('/api/quicky/events/active'),
  },
  // ─── REWARDS (admin-console PRD §12) — popup collection + cosmetics ──
  rewards: {
    pending: () =>
      jsonFetch<{ grants: any[]; cosmetics: any[] }>('/api/quicky/rewards/pending'),
    claim: () =>
      jsonFetch<{ ok: boolean; claimed: any[]; coinBalance: number; cosmetics: any[] }>('/api/quicky/rewards/claim', {
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
  },
}
