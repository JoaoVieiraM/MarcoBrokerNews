import { markNotified, save } from '../db/sqlite.js'
import { sendDiscordAlert } from '../notify/discord.js'
import { type ClassifiedItem, classifyBatch } from '../llm/mimo.js'
import { type HashedItem, filterUnseen } from './dedup.js'
import { shouldRunPipeline } from './pregao.js'
import { withRateLimit } from './throttle.js'
import { logger } from '../logger.js'
import * as rssSource from '../sources/rss.js'
import * as newsapiSource from '../sources/newsapi.js'
import * as finnhubSource from '../sources/finnhub.js'
import * as cvmSource from '../sources/cvm.js'
import * as bcbSource from '../sources/bcb.js'
import * as ibgeSource from '../sources/ibge.js'
import { type NewsItem } from '../sources/rss.js'

const NEWS_SOURCES: Record<string, () => Promise<NewsItem[]>> = {
  rss: rssSource.fetchAll,
  newsapi: newsapiSource.fetchAll,
  finnhub: finnhubSource.fetchAll,
  bcb: bcbSource.fetchAll,
  ibge: ibgeSource.fetchAll,
}

async function fetchAllSources(): Promise<{
  allItems: NewsItem[]
  bySource: Record<string, number>
}> {
  const sourceEntries = Object.entries(NEWS_SOURCES)
  const results = await Promise.allSettled(
    sourceEntries.map(([sourceName, fetchFn]) => withRateLimit(sourceName, fetchFn)),
  )

  const allItems: NewsItem[] = []
  const bySource: Record<string, number> = {}

  for (const [index, result] of results.entries()) {
    const sourceName = sourceEntries[index][0]
    if (result.status === 'fulfilled') {
      const items = result.value ?? []
      bySource[sourceName] = items.length
      allItems.push(...items)
      continue
    }
    const error = result.reason instanceof Error ? result.reason.message : String(result.reason)
    logger.warn({ source: sourceName, error }, 'PipelineSourceFailed')
    bySource[sourceName] = 0
  }

  return { allItems, bySource }
}

async function persistClassified(classified: ClassifiedItem[]): Promise<{ notifiedCount: number }> {
  let notifiedCount = 0

  for (const item of classified) {
    save({
      hash: item.hash,
      link: item.item.link,
      title: item.item.title,
      source: item.item.source,
      publishedAt: item.item.publishedAt,
      impacto: item.classification.impacto,
      tickers: item.classification.tickers_afetados.join(','),
      setores: item.classification.setores.join(','),
      direcao: item.classification.direcao,
      resumoLlm: item.classification.resumo,
    })

    const { impacto } = item.classification
    if (impacto === 'alto' || impacto === 'medio') {
      const notifySuccess = await sendDiscordAlert(item)
      if (notifySuccess) {
        markNotified(item.hash)
      }
      logger.info(
        { hash: item.hash.slice(0, 8), impacto, success: notifySuccess },
        'PipelineNotified',
      )
      if (notifySuccess) notifiedCount++
    }
  }

  return { notifiedCount }
}

function persistFailed(failed: HashedItem[]): void {
  for (const item of failed) {
    save({
      hash: item.hash,
      link: item.item.link,
      title: item.item.title,
      source: item.item.source,
      publishedAt: item.item.publishedAt,
    })
  }
}

async function classifyAndPartition(items: NewsItem[]): Promise<{
  classified: ClassifiedItem[]
  failed: HashedItem[]
}> {
  const unseen = filterUnseen(items)
  if (unseen.length === 0) return { classified: [], failed: [] }

  const classified = await classifyBatch(unseen)
  const failed = unseen.filter(
    (hashed) => !classified.some((classified) => classified.hash === hashed.hash),
  )

  return { classified, failed }
}

export async function runNewsPipeline(): Promise<void> {
  try {
    if (!shouldRunPipeline()) {
      logger.info({ reason: 'guard' }, 'PipelineSkipped')
      return
    }

    const { allItems, bySource } = await fetchAllSources()
    logger.info({ total: allItems.length, bySource }, 'PipelineFetched')

    const { classified, failed } = await classifyAndPartition(allItems)

    if (classified.length === 0 && failed.length === 0) {
      logger.warn('PipelineNoClassifications')
      return
    }

    const { notifiedCount } = await persistClassified(classified)
    persistFailed(failed)

    logger.info(
      {
        fetched: allItems.length,
        classified: classified.length,
        failed: failed.length,
        notified: notifiedCount,
      },
      'PipelineFinished',
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn({ error: message }, 'PipelineCrashed')
  }
}

export async function runCvmPipeline(): Promise<void> {
  try {
    logger.info('CvmPipelineStarted')

    const items = await cvmSource.fetchAll()
    logger.info({ total: items.length }, 'CvmPipelineFetched')

    if (items.length === 0) {
      logger.info('CvmPipelineNoItems')
      return
    }

    const { classified, failed } = await classifyAndPartition(items)

    if (classified.length === 0 && failed.length === 0) {
      logger.warn('CvmPipelineNoClassifications')
      return
    }

    const { notifiedCount } = await persistClassified(classified)
    persistFailed(failed)

    logger.info(
      {
        fetched: items.length,
        classified: classified.length,
        failed: failed.length,
        notified: notifiedCount,
      },
      'CvmPipelineFinished',
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn({ error: message }, 'CvmPipelineCrashed')
  }
}
