import axios from 'axios'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { type NewsItem } from './rss.js'

const USER_AGENT = 'marcobroker/0.1 (+https://github.com/JoaoVieiraM/MarcoBrokerNews)'
const REQUEST_TIMEOUT_MS = 15_000
const BASE_URL = 'https://finnhub.io/api/v1/news'

type Article = {
  category: string | null
  datetime: number | null
  headline: string | null
  id: number | null
  image: string | null
  related: string | null
  source: string | null
  summary: string | null
  url: string | null
}

function resolvePublishedAt(article: Article): string {
  if (article.datetime && article.datetime > 0) {
    return new Date(article.datetime * 1000).toISOString()
  }
  logger.debug({ url: article.url }, 'FinnhubPubDateMissing')
  return new Date().toISOString()
}

function resolveSnippet(article: Article): string {
  if (article.summary) return article.summary
  return ''
}

function normalizeArticle(article: Article): NewsItem | null {
  if (!article.url || !article.headline) return null
  return {
    link: article.url,
    title: article.headline,
    source: article.source ?? 'Finnhub',
    publishedAt: resolvePublishedAt(article),
    snippet: resolveSnippet(article),
  }
}

function redactApiKeyFromMessage(message: string): string {
  if (config.FINNHUB_API_KEY === '') return message
  return message.replaceAll(config.FINNHUB_API_KEY, '[REDACTED]')
}

export async function fetchAll(): Promise<NewsItem[]> {
  if (config.FINNHUB_API_KEY === '') {
    logger.info('FinnhubSkippedNoKey')
    return []
  }

  let response: { data: Article[] }

  try {
    response = await axios.get<Article[]>(BASE_URL, {
      params: {
        category: 'general',
        token: config.FINNHUB_API_KEY,
      },
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    })
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn({ error: redactApiKeyFromMessage(errorMessage) }, 'FinnhubFetchFailed')
    return []
  }

  const items = response.data
    .map(normalizeArticle)
    .filter((item): item is NewsItem => item !== null)

  logger.info({ count: items.length }, 'FinnhubFetched')
  return items
}
