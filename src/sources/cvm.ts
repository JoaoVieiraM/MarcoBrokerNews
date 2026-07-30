import AdmZip from 'adm-zip'
import axios from 'axios'
import { parse } from 'csv-parse/sync'
import iconv from 'iconv-lite'
import { logger } from '../logger.js'
import { type NewsItem } from './rss.js'

const USER_AGENT = 'marcobroker/0.1 (+https://github.com/JoaoVieiraM/MarcoBrokerNews)'
const REQUEST_TIMEOUT_MS = 30_000
const SNIPPET_MAX_LENGTH = 200
const CVM_WINDOW_HOURS = 48
const CVM_URL_TEMPLATE =
  'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS/ipe_cia_aberta_YYYY.zip'
const BRASILIA_UTC_OFFSET_HOURS = -3
const CSV_DELIMITER = ';'
const CSV_ENCODING = 'win1252'

type CvmRow = {
  CNPJ_Companhia: string
  Nome_Companhia: string
  Codigo_CVM: string
  Data_Referencia: string
  Categoria: string
  Tipo: string
  Especie: string
  Assunto: string
  Data_Entrega: string
  Tipo_Apresentacao: string
  Protocolo_Entrega: string
  Versao: string
  Link_Download: string
}

function buildZipUrl(): string {
  const year = new Date().getUTCFullYear()
  return CVM_URL_TEMPLATE.replace('YYYY', String(year))
}

function parseBrazilianTimestamp(raw: string): Date | null {
  let normalized = raw.replace(' ', 'T')
  if (normalized.length === 10) {
    normalized = `${normalized}T00:00:00`
  }
  const sign = BRASILIA_UTC_OFFSET_HOURS < 0 ? '-' : '+'
  const absHours = Math.abs(BRASILIA_UTC_OFFSET_HOURS)
  const offset = `${sign}${String(absHours).padStart(2, '0')}:00`
  const date = new Date(`${normalized}${offset}`)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function isWithinWindow(date: Date): boolean {
  const cutoff = Date.now() - CVM_WINDOW_HOURS * 60 * 60 * 1000
  return date.getTime() >= cutoff
}

function resolveTitle(row: CvmRow): string | null {
  if (!row.Assunto) return null
  if (!row.Nome_Companhia) return row.Assunto
  return `${row.Nome_Companhia} — ${row.Assunto}`
}

function resolveSnippet(row: CvmRow): string {
  if (row.Assunto.length > SNIPPET_MAX_LENGTH) {
    return row.Assunto.slice(0, SNIPPET_MAX_LENGTH)
  }
  return `${row.Categoria} · CNPJ ${row.CNPJ_Companhia}`
}

function normalizeRow(row: CvmRow): NewsItem | null {
  if (row.Categoria !== 'Fato Relevante') return null
  if (!row.Link_Download) return null

  const title = resolveTitle(row)
  if (!title) return null

  if (!row.Data_Entrega) {
    logger.debug({ raw: row.Data_Entrega }, 'CvmDateUnparseable')
    return null
  }

  const publishedDate = parseBrazilianTimestamp(row.Data_Entrega)
  if (!publishedDate) {
    logger.debug({ raw: row.Data_Entrega }, 'CvmDateUnparseable')
    return null
  }

  if (!isWithinWindow(publishedDate)) return null

  return {
    link: row.Link_Download,
    title,
    source: 'CVM',
    publishedAt: publishedDate.toISOString(),
    snippet: resolveSnippet(row),
  }
}

export async function fetchAll(): Promise<NewsItem[]> {
  try {
    const response = await axios.get(buildZipUrl(), {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    })

    const zip = new AdmZip(Buffer.from(response.data as ArrayBuffer))
    const entries = zip.getEntries()
    const csvEntry = entries.find((entry) => entry.entryName.endsWith('.csv'))
    if (!csvEntry) {
      logger.warn({ error: 'No CSV entry found in zip' }, 'CvmFetchFailed')
      return []
    }

    const csvBuffer = csvEntry.getData()
    const decoded = iconv.decode(csvBuffer, CSV_ENCODING)

    const rows = parse(decoded, {
      delimiter: CSV_DELIMITER,
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      trim: true,
    }) as CvmRow[]

    const total = rows.length
    const items = rows.map(normalizeRow).filter((item): item is NewsItem => item !== null)

    logger.info({ total, kept: items.length, count: items.length }, 'CvmFetched')
    return items
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn({ error: errorMessage }, 'CvmFetchFailed')
    return []
  }
}
