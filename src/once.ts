import { config } from './config.js'
import { logger } from './logger.js'
import { runNewsPipeline, runMacroPipeline, runCvmPipeline } from './core/pipeline.js'
import { refreshFeriados } from './sources/brasilapi.js'

async function main(): Promise<void> {
  const startedAt = Date.now()

  logger.info(
    {
      nodeEnv: config.NODE_ENV,
      pregaoOnly: config.PREGAO_ONLY,
    },
    'OnceBoot',
  )

  await refreshFeriados(new Date().getFullYear())

  await runNewsPipeline()
  await runMacroPipeline()
  await runCvmPipeline()

  const durationMs = Date.now() - startedAt
  logger.info({ durationMs }, 'OnceFinished')
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  logger.error({ error: message }, 'OnceCrashed')
  process.exit(1)
})
