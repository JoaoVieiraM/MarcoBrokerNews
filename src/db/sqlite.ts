import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../config.js'
import { logger } from '../logger.js'

export type NewsRecord = {
  hash: string
  link: string
  title: string
  source: string
  publishedAt?: string
  impacto?: string
  tickers?: string
  setores?: string
  direcao?: string
  resumoLlm?: string
}

mkdirSync(dirname(config.DB_PATH), { recursive: true })

const db = new Database(config.DB_PATH)

db.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT UNIQUE NOT NULL,
    link TEXT NOT NULL,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    published_at TEXT,
    seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    impacto TEXT,
    tickers TEXT,
    setores TEXT,
    direcao TEXT,
    resumo_llm TEXT,
    notified INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_news_hash ON news(hash);
  CREATE INDEX IF NOT EXISTS idx_news_seen ON news(seen_at);

  CREATE TABLE IF NOT EXISTS feriados (
    data TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`)

logger.debug({ module: 'sqlite' }, 'DbInit')

const isSeenStmt = db.prepare('SELECT 1 FROM news WHERE hash = ? LIMIT 1')
const saveStmt = db.prepare(
  `INSERT OR IGNORE INTO news
    (hash, link, title, source, published_at, impacto, tickers, setores, direcao, resumo_llm)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
const markNotifiedStmt = db.prepare('UPDATE news SET notified = 1 WHERE hash = ?')

export function isSeen(hash: string): boolean {
  return isSeenStmt.get(hash) !== undefined
}

export function save(item: NewsRecord): void {
  saveStmt.run(
    item.hash,
    item.link,
    item.title,
    item.source,
    item.publishedAt ?? null,
    item.impacto ?? null,
    item.tickers ?? null,
    item.setores ?? null,
    item.direcao ?? null,
    item.resumoLlm ?? null,
  )
}

export function markNotified(hash: string): void {
  const result = markNotifiedStmt.run(hash)
  if (result.changes === 0) {
    logger.debug({ hash }, 'DbMarkNotifiedMissing')
  }
}
