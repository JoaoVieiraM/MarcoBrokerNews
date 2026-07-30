import axios from 'axios'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { type NewsItem } from './rss.js'

const USER_AGENT = 'marcobroker/0.1 (+https://github.com/JoaoVieiraM/MarcoBrokerNews)'
const REQUEST_TIMEOUT_MS = 15_000
const SNIPPET_MAX_LENGTH = 200
const BASE_URL = 'https://newsapi.org/v2/everything'
const QUERY = 'B3 OR "Ibovespa" OR "Petrobras" OR "Vale"'
const PAGE_SIZE = 100

type ArticleSource = {
  name: string | null
}

type Article = {
  url: string | null
  title: string | null
  publishedAt: string | null
  description: string | null
  content: string | null
  source: ArticleSource | null
}

type NewsApiResponse = {
  status: string
  articles: Article[]
}

function resolvePublishedAt(article: Article): string {
  if (article.publishedAt) return article.publishedAt
  logger.debug({ url: article.url }, 'NewsapiPubDateMissing')
  return new Date().toISOString()
}

function resolveSnippet(article: Article): string {
  if (article.description) return article.description
  if (article.content) return article.content.slice(0, SNIPPET_MAX_LENGTH)
  return ''
}

function normalizeArticle(article: Article): NewsItem | null {
  if (!article.url || !article.title) return null
  return {
    link: article.url,
    title: article.title,
    source: article.source?.name ?? 'NewsAPI',
    publishedAt: resolvePublishedAt(article),
    snippet: resolveSnippet(article),
  }
}

function redactApiKeyFromMessage(message: string): string {
  if (config.NEWSAPI_KEY === '') return message
  return message.replaceAll(config.NEWSAPI_KEY, '[REDACTED]')
}

export async function fetchAll(): Promise<NewsItem[]> {
  if (config.NEWSAPI_KEY === '') {
    logger.info('NewsapiSkippedNoKey')
    return []
  }

  let response: { data: NewsApiResponse }

  try {
    response = await axios.get<NewsApiResponse>(BASE_URL, {
      params: {
        q: QUERY,
        language: 'pt',
        sortBy: 'publishedAt',
        pageSize: PAGE_SIZE,
        apiKey: config.NEWSAPI_KEY,
      },
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    })
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn({ error: redactApiKeyFromMessage(errorMessage) }, 'NewsapiFetchFailed')
    return []
  }

  if (response.data.status !== 'ok') {
    logger.warn({ status: response.data.status }, 'NewsapiFetchFailed')
    return []
  }

  const items = response.data.articles
    .map(normalizeArticle)
    .filter((item): item is NewsItem => item !== null)

  logger.info({ count: items.length }, 'NewsapiFetched')
  return items
}
