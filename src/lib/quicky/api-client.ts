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
    send: (matchId: string, data: { type: 'text' | 'image' | 'video' | 'voice'; text?: string; mediaUrl?: string; durationMs?: number; replyToId?: string }) =>
      jsonFetch<{ ok: boolean; message: any }>(`/api/quicky/matches/${matchId}/messages`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    react: (matchId: string, messageId: string, emoji: string | null) =>
      jsonFetch<{ ok: boolean; messageId: string; userId: string; emoji: string | null }>(
        `/api/quicky/matches/${matchId}/messages/${messageId}/react`,
        { method: 'POST', body: JSON.stringify({ emoji }) }
      ),
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
    rules: () =>
      jsonFetch<{ rules: { id: string; title: string; description: string; icon: string; sortOrder: number }[] }>(
        '/api/quicky/games/spin-bottle/rules'
      ),
    leave: (roomId: string) =>
      jsonFetch('/api/quicky/games/spin-bottle/leave', {
        method: 'POST',
        body: JSON.stringify({ roomId }),
      }),
    respond: (roomId: string, choice: 'yes' | 'no') =>
      jsonFetch('/api/quicky/games/spin-bottle/respond', {
        method: 'POST',
        body: JSON.stringify({ roomId, choice }),
      }),
    chat: (roomId: string) =>
      jsonFetch<{ messages: any[] }>(`/api/quicky/games/spin-bottle/chat?roomId=${roomId}`),
    sendChat: (roomId: string, text: string) =>
      jsonFetch<{ ok: boolean; message: any }>('/api/quicky/games/spin-bottle/chat', {
        method: 'POST',
        body: JSON.stringify({ roomId, text }),
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
      send: (roomId: string, recipientId: string, itemId: string, quantity = 1) =>
        jsonFetch<{ ok: boolean; coinBalance: number }>('/api/quicky/games/spin-bottle/gifts', {
          method: 'POST',
          body: JSON.stringify({ roomId, recipientId, itemId, quantity }),
        }),
    },
    coins: {
      balance: () =>
        jsonFetch<{ coinBalance: number }>('/api/quicky/games/spin-bottle/coins'),
      // v3 §30: the SINGLE purchase entry point — swapping the mock for
      // Google Play / Apple IAP / Stripe later only changes this route.
      purchase: (packageId: string) =>
        jsonFetch<{ ok: boolean; mock: boolean; coinsAdded: number; coinBalance: number }>(
          '/api/quicky/games/spin-bottle/coins',
          { method: 'POST', body: JSON.stringify({ packageId }) }
        ),
    },
  },
  admin: {
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
    // Lifecycle PRD §44/§48: "How It Works" rules CRUD (admin-managed).
    gameRules: {
      list: () =>
        jsonFetch<{ rules: any[] }>('/api/quicky/admin/game-rules'),
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
        jsonFetch<{ ok: boolean }>('/api/quicky/admin/stickers', {
          method: 'DELETE',
          body: JSON.stringify({ id }),
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
}
