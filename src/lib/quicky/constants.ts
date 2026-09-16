// Quicky — shared constants & rules
// All tunable knobs in one place: daily limits, score rules, ToD prompts, quicky durations.

export const QUICKY = {
  brand: {
    name: 'Quicky',
    tagline: 'Instant sparks. Real connections.',
    coral: '#FF2D55',
    charcoal: '#0F0F14',
    charcoal2: '#1A1A2E',
    lavender: '#B8A4FF',
    gold: '#F5C570',
  },

  // Free-tier limits per PRD §5.2, §8.3
  limits: {
    freeLikesPerDay: 50,
    freeSuperLikesPerDay: 1,
    freeRewindsPerDay: 1,
    freeQuickyPerDay: 8, // mid-range of 5-10
  },

  // Premium multipliers per PRD §6
  premium: {
    superLikesPerDay: 5,
    quickyPerDay: Infinity,
    likesPerDay: Infinity,
    rewindsPerDay: Infinity,
    boostMultiplier: 1.8, // continuous soft boost
    timedBoostMultiplier: 5,
    timedBoostDurationMin: 30,
  },

  // Quicky durations per PRD §8.1
  quickyDurations: [3, 5, 8, 10] as const,
  quickyDefaultDuration: 5,
  quickyMaxVideoSec: 15,
  quickyReplaysFree: 1,

  // Quicky Score rules per PRD §8.2
  score: {
    sent: 1,
    opened: 1,
    mutualExchange24h: 2,
    streak3Day: 5,
    streak7Day: 10,
  },

  // Score tier badges per PRD §8.2
  tiers: [
    { name: 'Bronze', min: 0, color: '#CD7F32' },
    { name: 'Silver', min: 50, color: '#C0C0C0' },
    { name: 'Gold', min: 200, color: '#F5C570' },
    { name: 'Platinum', min: 500, color: '#E5E4E2' },
    { name: 'Diamond', min: 1500, color: '#B9F2FF' },
  ] as const,

  // Discovery weights per PRD §7
  ranking: {
    premiumMultiplier: 1.8,
    timedBoostMultiplier: 5,
    newBoostWindowHours: 24,
    newBoostMultiplier: 2,
    verifiedBonus: 1.15,
    photoCountBonus: 1.08, // per photo up to max
    interestOverlapBonus: 1.1,
    sameCityBonus: 1.05,
  },

  // Subscriptions per PRD §10.2 (USD demo prices)
  subscriptionPlans: [
    { id: 'weekly', label: 'Weekly', price: 14.99, period: '/week', highlight: false },
    { id: 'monthly', label: 'Monthly', price: 39.99, period: '/mo', highlight: true, saveText: 'Most popular' },
    { id: 'quarterly', label: '3-Month', price: 89.99, period: '/3mo', saveText: 'Save 25%' },
    { id: 'annual', label: 'Annual', price: 239.99, period: '/yr', saveText: 'Save 50%' },
  ] as const,

  // Consumable packs per PRD §10.2
  consumables: [
    { id: 'super_likes_5', label: '5 Super Likes', price: 9.99 },
    { id: 'boost_30', label: '30-min Boost', price: 7.99 },
    { id: 'quicky_pack_10', label: '10 Quickies', price: 4.99 },
  ] as const,

  // Match archive after inactivity (PRD §5.4)
  archiveAfterDays: 7,

  // Screenshot detection notice text
  screenshotNotice:
    'Quicky was screenshot. Sender has been notified. Replay has been disabled for this Quicky.',
} as const

// Curated Truth or Dare prompt decks (PRD §9.1)
export const TOD_DECKS: Record<string, { text: string; deck: 'flirty' | 'deep' | 'funny' | 'spicy' }[]> = {
  truth: [
    { text: 'What was your first impression of me?', deck: 'flirty' },
    { text: 'What\u2019s something you\u2019ve never told anyone?', deck: 'deep' },
    { text: 'What\u2019s the most embarrassing song on your playlist?', deck: 'funny' },
    { text: 'What\u2019s the most romantic thing you\u2019ve ever done?', deck: 'flirty' },
    { text: 'What\u2019s a dealbreaker for you in dating?', deck: 'deep' },
    { text: 'What\u2019s the cringiest opening line you\u2019ve used?', deck: 'funny' },
    { text: 'What\u2019s something you wish people noticed about you?', deck: 'deep' },
    { text: 'When was the last time you felt butterflies?', deck: 'flirty' },
    { text: 'What\u2019s the worst date you\u2019ve ever been on?', deck: 'funny' },
    { text: 'What are you most attracted to in a person?', deck: 'flirty' },
    { text: 'What\u2019s a secret talent you have?', deck: 'funny' },
    { text: 'What\u2019s the most spontaneous thing you\u2019ve done this year?', deck: 'deep' },
  ],
  dare: [
    { text: 'Send me a Quicky of your view right now.', deck: 'flirty' },
    { text: 'Send a voice note singing the chorus of your favorite song.', deck: 'funny' },
    { text: 'Text me one word that describes how you\u2019re feeling.', deck: 'deep' },
    { text: 'Send me your most-used emoji of the week.', deck: 'funny' },
    { text: 'Share a photo from your camera roll from exactly one year ago.', deck: 'deep' },
    { text: 'Tell me your biggest guilty pleasure, no hedging.', deck: 'spicy' },
    { text: 'Send a Quicky of you doing your best model pose.', deck: 'spicy' },
    { text: 'Record a 5-second voice note in your best accent.', deck: 'funny' },
    { text: 'Show me the last photo you took before this chat.', deck: 'flirty' },
    { text: 'Reply with three words you\u2019d want on a dating profile about yourself.', deck: 'deep' },
    { text: 'Send a Quicky of your favorite spot in your home.', deck: 'flirty' },
    { text: 'Reveal your screen time average from this week.', deck: 'funny' },
  ],
}

export const GAMES: { id: string; name: string; icon: string; desc: string; premium: boolean }[] = [
  { id: 'truth_or_dare', name: 'Truth or Dare', icon: '\u{1F525}', desc: 'Curated decks: Flirty, Deep, Funny, Spicy', premium: true },
  { id: 'never_have_i_ever', name: 'Never Have I Ever', icon: '\u{1F929}', desc: 'Reveal simultaneously, keep score', premium: true },
  { id: 'would_you_rather', name: 'Would You Rather', icon: '\u{1F914}', desc: 'Pick a side, then discuss', premium: true },
  { id: 'icebreaker_roulette', name: 'Icebreaker Roulette', icon: '\u{1F3B0}', desc: 'Spin for a random deep question', premium: true },
  { id: 'two_truths_lie', name: 'Two Truths and a Lie', icon: '\u{1F913}', desc: 'Find the fib in three statements', premium: true },
]

export const INTEREST_TAGS = [
  'hiking', 'coffee', 'vinyl', 'indie-film', 'thrift', 'art',
  'salsa', 'travel', 'podcasts', 'yoga', 'meditation', 'dogs',
  'matcha', 'beach', 'architecture', 'books', 'wine', 'design',
  'running', 'cycling', 'punk', 'beer', 'diy', 'tattoos',
  'cooking', 'true-crime-podcasts', 'gardening', 'cats',
  'photography', 'jazz', 'motorcycles', 'film', 'mezcal', 'soccer',
  'live-music', 'surfing', 'camping', 'climbing', 'whisky',
  'woodworking', 'gaming', 'baking', 'kombucha', 'astrology',
] as const

export const PROFILE_PROMPTS = [
  'My ideal Sunday...',
  'Two truths and a lie...',
  'I\'m looking for...',
  'The way to my heart is...',
  'My most controversial opinion is...',
  'Best travel story...',
  'Green flags I look for...',
] as const

// Helper: get score tier for a given score
export function getScoreTier(score: number) {
  let current: (typeof QUICKY.tiers)[number] = QUICKY.tiers[0]
  let next: (typeof QUICKY.tiers)[number] | null = null
  for (let i = 0; i < QUICKY.tiers.length; i++) {
    const t = QUICKY.tiers[i]
    if (score >= t.min) {
      current = t
      next = i + 1 < QUICKY.tiers.length ? QUICKY.tiers[i + 1] : null
    }
  }
  const progressToNext = next ? Math.min(1, (score - current.min) / (next.min - current.min)) : 1
  return { current, next, progressToNext }
}

// Never Have I Ever statements (PRD §8) — drawn deterministically per
// (sessionId, round) so both clients always show the same prompt.
export const NHIE_STATEMENTS: string[] = [
  'Never have I ever stalked a crush\u2019s social media at 3am',
  'Never have I ever ghosted someone after a great first date',
  'Never have I ever fallen asleep on a video call',
  'Never have I ever sent a text to the wrong person',
  'Never have I ever pretended to know a song I\u2019d never heard',
  'Never have I ever lied about my hobbies on a dating profile',
  'Never have I ever cried during a romantic movie',
  'Never have I ever rehearsed what to say before a call',
  'Never have I ever dated two people at once without them knowing',
  'Never have I ever skinny dipped',
  'Never have I ever said \u201cI love you\u201d just to end an argument',
  'Never have I ever cheated in a game to impress someone',
  'Never have I ever taken over 50 selfies for one post',
  'Never have I ever swiped right just out of boredom',
  'Never have I ever googled \u201chow to tell if someone likes me\u201d',
  'Never have I ever worn matching underwear for a date I planned',
  'Never have I ever drunk-texted an ex',
  'Never have I ever faked being busy to avoid a date',
  'Never have I ever laughed so hard I snorted in public',
  'Never have I ever kept a secret for more than five years',
]

// ── Spin the Bottle in-game economy ──────────────────────────────────────────

export const SPIN_BOTTLE_GIFTS = [
  // Row 1 — affordable
  { id: 'rose',       name: 'Rose',        emoji: '🌹', coinPrice: 10,   tier: 'default'  },
  { id: 'heart',      name: 'Heart',       emoji: '💖', coinPrice: 25,   tier: 'default'  },
  { id: 'teddy',      name: 'Teddy',       emoji: '🧸', coinPrice: 50,   tier: 'default'  },
  { id: 'champagne',  name: 'Champagne',   emoji: '🥂', coinPrice: 100,  tier: 'default'  },
  // Row 2 — mid-tier
  { id: 'crown',      name: 'Crown',       emoji: '👑', coinPrice: 250,  tier: 'premium'  },
  { id: 'diamond',    name: 'Diamond',     emoji: '💎', coinPrice: 500,  tier: 'premium'  },
  { id: 'rocket',     name: 'Rocket',      emoji: '🚀', coinPrice: 750,  tier: 'premium'  },
  { id: 'kiss',       name: 'Kiss',        emoji: '💋', coinPrice: 1000, tier: 'premium'  },
] as const

export type GiftId = (typeof SPIN_BOTTLE_GIFTS)[number]['id']

// Coin packs users can buy (for future IAP flow)
export const COIN_PACKS = [
  { id: 'coins_100',  coins: 100,  price: 0.99,  label: '100 Coins',  bestValue: false },
  { id: 'coins_500',  coins: 500,  price: 3.99,  label: '500 Coins',  bestValue: false },
  { id: 'coins_1500', coins: 1500, price: 9.99,  label: '1,500 Coins', bestValue: true },
  { id: 'coins_5000', coins: 5000, price: 24.99, label: '5,000 Coins', bestValue: false },
] as const

// Task 8 — premium coin store perks: premium members get +20% bonus coins on
// standard packs, 10% off the displayed price, and two exclusive coin sets
// (server-enforced in the coins purchase route — free members get 403).
export const PREMIUM_COIN_BONUS_PCT = 0.2
export const PREMIUM_PRICE_DISCOUNT_PCT = 0.1
export const PREMIUM_EXCLUSIVE_COIN_PACKS = [
  { id: 'pcoins_12000', coins: 12000, price: 49.99, label: '12,000 Coins', bestValue: false, exclusive: true },
  { id: 'pcoins_30000', coins: 30000, price: 99.99, label: '30,000 Coins', bestValue: true, exclusive: true },
] as const

// Coin rewards for game events
export const COIN_REWARDS = {
  kissYes: 20,       // target says yes
  kissReceived: 10,  // spinner gets a yes
  dailyLogin: 50,    // once per day
} as const

// Profile frame catalog — cssClass maps to a @keyframes / CSS class in globals.css
export const PROFILE_FRAMES = [
  { id: 'frame_default',   name: 'Default',    cssClass: 'frame-default',   coinPrice: 0,    tier: 'default',  frameType: 'static'   },
  { id: 'frame_coral',     name: 'Coral',      cssClass: 'frame-coral',     coinPrice: 200,  tier: 'default',  frameType: 'static'   },
  { id: 'frame_lavender',  name: 'Lavender',   cssClass: 'frame-lavender',  coinPrice: 200,  tier: 'default',  frameType: 'static'   },
  { id: 'frame_gold',      name: 'Gold',       cssClass: 'frame-gold',      coinPrice: 500,  tier: 'premium',  frameType: 'static'   },
  { id: 'frame_neon',      name: 'Neon',       cssClass: 'frame-neon',      coinPrice: 750,  tier: 'premium',  frameType: 'animated' },
  { id: 'frame_rainbow',   name: 'Rainbow',    cssClass: 'frame-rainbow',   coinPrice: 1000, tier: 'premium',  frameType: 'animated' },
  { id: 'frame_hearts',    name: 'Hearts',     cssClass: 'frame-hearts',    coinPrice: 300,  tier: 'default',  frameType: 'animated' },
  { id: 'frame_royal',     name: 'Royal',      cssClass: 'frame-royal',     coinPrice: 1500, tier: 'premium',  frameType: 'animated' },
] as const

export type FrameId = (typeof PROFILE_FRAMES)[number]['id']

// Discovery / profile detail option sets (shared by Edit Profile,
// Discovery Preferences and the discovery detail cards)
export const EDUCATION_OPTIONS = [
  'High school',
  "Bachelor's degree",
  "Master's degree",
  'PhD / Doctorate',
  'Trade / vocational',
]

export const LIFESTYLE_OPTIONS = [
  'Non-smoker',
  'Smoker',
  'Social drinker',
  'Non-drinker',
  'Gym & fitness',
  'Foodie',
  'Night owl',
  'Early bird',
  'Pet lover',
  'Traveler',
]


