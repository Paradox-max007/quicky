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

async function uploadFile(file: File, kind: 'photo' | 'quicky' | 'voice' = 'photo'): Promise<{ ok: boolean; url: string; filename?: string; kind?: string }> {
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
  community: {
    feed: () => jsonFetch<{ posts: any[] }>('/api/quicky/community/posts'),
    create: (data: { mediaUrl: string; mediaType?: 'image' | 'video'; caption?: string; filter?: string }) =>
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
