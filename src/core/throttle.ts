import { logger } from '../logger.js'

export type RateLimit = {
  perMinute?: number
  perDay?: number
}

export const RATE_LIMITS: Readonly<Record<string, RateLimit>> = {
  alphavantage: { perMinute: 5, perDay: 25 },
  newsapi: { perDay: 100 },
  finnhub: { perMinute: 60 },
}

type WindowCounter = {
  window: number
  count: number
}

type SourceState = {
  minute: WindowCounter
  day: WindowCounter
}

const counters = new Map<string, SourceState>()

function getMinuteBucket(): number {
  return Math.floor(Date.now() / 60_000)
}

function getDayBucket(): number {
  return Math.floor(Date.now() / 86_400_000)
}

function getOrCreateState(sourceName: string): SourceState {
  const existing = counters.get(sourceName)
  if (existing) return existing

  const fresh: SourceState = {
    minute: { window: getMinuteBucket(), count: 0 },
    day: { window: getDayBucket(), count: 0 },
  }
  counters.set(sourceName, fresh)
  return fresh
}

function resetIfStale(counter: WindowCounter, currentBucket: number): void {
  if (counter.window !== currentBucket) {
    counter.window = currentBucket
    counter.count = 0
  }
}

export async function withRateLimit<T>(
  sourceName: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const limit = RATE_LIMITS[sourceName]
  if (!limit) return fn()

  const state = getOrCreateState(sourceName)
  const currentMinute = getMinuteBucket()
  const currentDay = getDayBucket()

  resetIfStale(state.minute, currentMinute)
  resetIfStale(state.day, currentDay)

  const minuteExceeded = limit.perMinute !== undefined && state.minute.count >= limit.perMinute
  const dayExceeded = limit.perDay !== undefined && state.day.count >= limit.perDay

  if (minuteExceeded || dayExceeded) {
    logger.warn(
      {
        source: sourceName,
        perMinute: limit.perMinute,
        perDay: limit.perDay,
        minuteUsed: state.minute.count,
        dayUsed: state.day.count,
      },
      'ThrottleExhausted',
    )
    return null
  }

  state.minute.count++
  state.day.count++

  return fn()
}

export function resetCounters(): void {
  counters.clear()
}
