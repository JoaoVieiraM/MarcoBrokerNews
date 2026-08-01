import cron from 'node-cron'
import { config } from './config.js'
import { logger } from './logger.js'
import { runNewsPipeline, runCvmPipeline, runMacroPipeline } from './core/pipeline.js'
import { refreshFeriados } from './sources/brasilapi.js'

const FERIADOS_CRON = '0 5 * * *'
const TIMEZONE_CRON = config.TIMEZONE

async function main(): Promise<void> {
  logger.info(
    {
      nodeEnv: config.NODE_ENV,
      pregaoOnly: config.PREGAO_ONLY,
      schedules: {
        news: config.CRON_SCHEDULE,
        cvm: config.CRON_SCHEDULE_CVM,
        macro: config.CRON_SCHEDULE_MACRO,
        feriados: FERIADOS_CRON,
      },
    },
    'Boot',
  )

  await refreshFeriados(new Date().getFullYear())

  cron.schedule(
    config.CRON_SCHEDULE,
    async () => {
      await runNewsPipeline()
    },
    { timezone: TIMEZONE_CRON },
  )
  logger.info({ job: 'news', expr: config.CRON_SCHEDULE }, 'CronScheduled')

  cron.schedule(
    config.CRON_SCHEDULE_CVM,
    async () => {
      await runCvmPipeline()
    },
    { timezone: TIMEZONE_CRON },
  )
  logger.info({ job: 'cvm', expr: config.CRON_SCHEDULE_CVM }, 'CronScheduled')

  cron.schedule(
    config.CRON_SCHEDULE_MACRO,
    async () => {
      await runMacroPipeline()
    },
    { timezone: TIMEZONE_CRON },
  )
  logger.info({ job: 'macro', expr: config.CRON_SCHEDULE_MACRO }, 'CronScheduled')

  cron.schedule(
    FERIADOS_CRON,
    async () => {
      await refreshFeriados(new Date().getFullYear())
    },
    { timezone: TIMEZONE_CRON },
  )
  logger.info({ job: 'feriados', expr: FERIADOS_CRON }, 'CronScheduled')

  process.on('SIGINT', () => {
    logger.info('Shutdown')
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    logger.info('Shutdown')
    process.exit(0)
  })
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  logger.error({ error: message }, 'BootCrashed')
  process.exit(1)
})
