import Parser from 'rss-parser'
import { logger } from '../logger.js'
import { FEEDS, type Feed } from './feeds.js'

export type NewsItem = {
  link: string
  title: string
  source: string
  publishedAt: string
  snippet: string
}

const USER_AGENT = 'marcobroker/0.1 (+https://github.com/JoaoVieiraM/MarcoBrokerNews)'
const REQUEST_TIMEOUT_MS = 15_000
const SNIPPET_MAX_LENGTH = 200

const parser = new Parser({
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'User-Agent': USER_AGENT },
})

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

function resolvePublishedAt(item: Parser.Item): string {
  if (item.isoDate) return item.isoDate
  if (item.pubDate) {
    const parsed = new Date(item.pubDate)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  logger.debug({ link: item.link }, 'RssPubDateMissing')
  return new Date().toISOString()
}

function resolveSnippet(item: Parser.Item): string {
  if (item.contentSnippet) return item.contentSnippet
  if (item.content) return stripHtmlTags(item.content).slice(0, SNIPPET_MAX_LENGTH)
  return ''
}

function normalizeItem(item: Parser.Item, source: string): NewsItem | null {
  if (!item.link || !item.title) return null
  return {
    link: item.link,
    title: item.title,
    source,
    publishedAt: resolvePublishedAt(item),
    snippet: resolveSnippet(item),
  }
}

async function fetchFeed(feed: Feed): Promise<NewsItem[]> {
  const result = await parser.parseURL(feed.url)
  const items = result.items
    .map((item) => normalizeItem(item, feed.name))
    .filter((item): item is NewsItem => item !== null)
  logger.info({ source: feed.name, count: items.length }, 'RssFeedFetched')
  return items
}

export async function fetchAll(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed))
  const collected: NewsItem[] = []

  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      collected.push(...result.value)
      continue
    }
    const feedName = FEEDS[index].name
    const errorMessage =
      result.reason instanceof Error ? result.reason.message : String(result.reason)
    logger.warn({ source: feedName, error: errorMessage }, 'RssFeedFailed')
    logger.debug(
      { source: feedName, stack: result.reason instanceof Error ? result.reason.stack : undefined },
      'RssFeedFailedDebug',
    )
  }

  return collected
}
