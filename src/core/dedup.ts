import { createHash } from 'node:crypto'
import { isSeen } from '../db/sqlite.js'
import { logger } from '../logger.js'
import { type NewsItem } from '../sources/rss.js'

export type HashedItem = {
  item: NewsItem
  hash: string
}

export function computeHash(item: NewsItem): string {
  return createHash('sha1').update(item.link.trim().toLowerCase()).digest('hex')
}

export function filterUnseen(items: NewsItem[]): HashedItem[] {
  if (items.length === 0) return []

  const seenHashes = new Set<string>()
  const unseen: HashedItem[] = []
  let intraBatchCollisions = 0

  for (const item of items) {
    const hash = computeHash(item)
    if (seenHashes.has(hash)) {
      intraBatchCollisions++
      continue
    }
    seenHashes.add(hash)
    if (isSeen(hash)) continue
    unseen.push({ item, hash })
  }

  if (intraBatchCollisions > 0) {
    logger.debug({ count: intraBatchCollisions }, 'DedupIntraBatchCollision')
  }

  logger.info(
    { input: items.length, unseen: unseen.length, intraBatch: intraBatchCollisions },
    'DedupFiltered',
  )

  return unseen
}
