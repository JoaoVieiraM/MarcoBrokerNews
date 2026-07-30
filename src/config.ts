import 'dotenv/config'
import { z } from 'zod'

const booleanFromEnv = z.preprocess((val) => {
  if (val === 'true' || val === '1') return true
  if (val === 'false' || val === '0') return false
  return val
}, z.boolean())

const optionalSecret = z.string().default('')

const envSchema = z.object({
  MIMO_API_KEY: optionalSecret,
  MIMO_MODEL: z.string().default('mimo-v2'),
  MIMO_BASE_URL: optionalSecret,
  MIMO_RPM: z.coerce.number().default(10),

  NEWSAPI_KEY: optionalSecret,
  FINNHUB_API_KEY: optionalSecret,
  ALPHAVANTAGE_API_KEY: optionalSecret,
  MASSIVE_API_KEY: optionalSecret,

  DISCORD_WEBHOOK_URL: optionalSecret,
  DISCORD_WEBHOOK_URL_ALTO: optionalSecret,
  TELEGRAM_BOT_TOKEN: optionalSecret,
  TELEGRAM_CHAT_ID: optionalSecret,

  CRON_SCHEDULE: z.string().default('*/10 * * * *'),
  CRON_SCHEDULE_CVM: z.string().default('*/15 * * * *'),
  CRON_SCHEDULE_MACRO: z.string().default('0 8 * * *'),
  PREGAO_ONLY: booleanFromEnv.default(true),
  TIMEZONE: z.string().default('America/Sao_Paulo'),
  KEYWORD_PREFILTER: booleanFromEnv.default(true),

  DB_PATH: z.string().default('./data/news.db'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const failures = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n')
  throw new Error(`Configuração inválida:\n${failures}`)
}

export const config = Object.freeze(parsed.data)
