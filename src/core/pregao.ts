import { config } from '../config.js'
import { logger } from '../logger.js'
import { isHoliday } from '../sources/brasilapi.js'

const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'short',
})

const hourFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  hour12: false,
})

function isWeekday(date: Date): boolean {
  return WEEKDAYS.has(weekdayFormatter.format(date))
}

function hourInSaoPaulo(date: Date): number {
  return parseInt(hourFormatter.format(date), 10)
}

export function isDuringPregao(now: Date = new Date()): boolean {
  if (!isWeekday(now)) return false
  if (isHoliday(now)) return false
  const hour = hourInSaoPaulo(now)
  return hour >= 9 && hour < 18
}

export function shouldRunPipeline(now: Date = new Date()): boolean {
  if (!config.PREGAO_ONLY) return true

  if (isDuringPregao(now)) return true

  let reason: 'weekend' | 'holiday' | 'off_hours'
  if (!isWeekday(now)) {
    reason = 'weekend'
  } else if (isHoliday(now)) {
    reason = 'holiday'
  } else {
    reason = 'off_hours'
  }

  logger.debug({ reason }, 'PregaoGuardBlocked')
  return false
}
