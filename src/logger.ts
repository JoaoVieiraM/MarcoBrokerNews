import pino from 'pino'
import { config } from './config.js'

export const logger =
  config.NODE_ENV === 'development'
    ? pino({ level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } })
    : pino({ level: config.LOG_LEVEL })
