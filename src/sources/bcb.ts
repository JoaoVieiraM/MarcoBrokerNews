import axios from 'axios'
import { logger } from '../logger.js'
import { type NewsItem } from './rss.js'

const USER_AGENT = 'marcobroker/0.1 (+https://github.com/JoaoVieiraM/MarcoBrokerNews)'
const REQUEST_TIMEOUT_MS = 15_000
const MACRO_WINDOW_HOURS = 48
const BRASILIA_UTC_OFFSET_HOURS = -3

const SELIC_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json'
const IPCA_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/1?formato=json'
const COPOM_URL =
  'https://olinda.bcb.gov.br/olinda/servico/CalendarioCopom/versao/v1/odata/CalendarioCopom?$format=json'

const SELIC_LINK = 'https://www.bcb.gov.br/controleinflacao/historicotaxasjuros'
const IPCA_LINK = 'https://www.bcb.gov.br/estatisticas/indprecos'
const COPOM_LINK = 'https://www.bcb.gov.br/publicacoes/atascopom'

type SgsRow = {
  data: string
  valor: string
}

type CopomMeeting = {
  Ano: string
  DataInicioReuniao: string
  DataFimReuniao: string
}

type CopomResponse = {
  value: CopomMeeting[]
}

function parseBrazilianDate(raw: string): Date | null {
  const sign = BRASILIA_UTC_OFFSET_HOURS < 0 ? '-' : '+'
  const absHours = Math.abs(BRASILIA_UTC_OFFSET_HOURS)
  const offset = `${sign}${String(absHours).padStart(2, '0')}:00`

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split('/')
    const date = new Date(`${year}-${month}-${day}T00:00:00${offset}`)
    if (Number.isNaN(date.getTime())) return null
    return date
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00${offset}`)
    if (Number.isNaN(date.getTime())) return null
    return date
  }

  return null
}

function isWithinWindow(date: Date): boolean {
  const cutoff = Date.now() - MACRO_WINDOW_HOURS * 60 * 60 * 1000
  return date.getTime() >= cutoff
}

function formatBrazilianDate(raw: string): string {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-')
    return `${day}/${month}/${year}`
  }
  return raw
}

async function fetchSelic(): Promise<NewsItem | null> {
  try {
    const response = await axios.get<SgsRow[]>(SELIC_URL, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    })

    const row = response.data[0]
    if (!row) return null

    const publishedDate = parseBrazilianDate(row.data)
    if (!publishedDate) return null

    if (!isWithinWindow(publishedDate)) {
      logger.debug('BcbSelicSkippedStale')
      return null
    }

    const displayDate = formatBrazilianDate(row.data)

    return {
      link: SELIC_LINK,
      title: `Selic definida em ${row.valor}% (referência ${displayDate})`,
      source: 'BCB',
      publishedAt: publishedDate.toISOString(),
      snippet: `Meta da taxa Selic anunciada pelo Copom. Valor atual: ${row.valor}% ao ano.`,
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn({ error: errorMessage }, 'BcbSelicFailed')
    return null
  }
}

async function fetchIpca(): Promise<NewsItem | null> {
  try {
    const response = await axios.get<SgsRow[]>(IPCA_URL, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    })

    const row = response.data[0]
    if (!row) return null

    const publishedDate = parseBrazilianDate(row.data)
    if (!publishedDate) return null

    if (!isWithinWindow(publishedDate)) {
      logger.debug('BcbIpcaSkippedStale')
      return null
    }

    const displayDate = formatBrazilianDate(row.data)

    return {
      link: IPCA_LINK,
      title: `IPCA de ${displayDate}: ${row.valor}%`,
      source: 'BCB',
      publishedAt: publishedDate.toISOString(),
      snippet: 'Índice Nacional de Preços ao Consumidor Amplo (IPCA) — variação mensal.',
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn({ error: errorMessage }, 'BcbIpcaFailed')
    return null
  }
}

async function fetchCopom(): Promise<NewsItem | null> {
  try {
    const response = await axios.get<CopomResponse>(COPOM_URL, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    })

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const futureMeetings = response.data.value
      .filter((meeting) => {
        const startDate = parseBrazilianDate(meeting.DataInicioReuniao)
        return startDate !== null && startDate >= today
      })
      .sort((left, right) => {
        const leftDate = parseBrazilianDate(left.DataInicioReuniao)
        const rightDate = parseBrazilianDate(right.DataInicioReuniao)
        if (leftDate === null || rightDate === null) return 0
        return leftDate.getTime() - rightDate.getTime()
      })

    const nextMeeting = futureMeetings[0]
    if (!nextMeeting) {
      logger.debug('BcbCopomSkippedNoUpcoming')
      return null
    }

    const dataInicio = formatBrazilianDate(nextMeeting.DataInicioReuniao)
    const dataFim = formatBrazilianDate(nextMeeting.DataFimReuniao)
    const titleSuffix = dataFim === dataInicio ? '' : ` a ${dataFim}`

    return {
      link: COPOM_LINK,
      title: `Próxima reunião do Copom: ${dataInicio}${titleSuffix}`,
      source: 'BCB',
      publishedAt: new Date().toISOString(),
      snippet: 'Reunião do Comitê de Política Monetária agendada. Definição da taxa Selic.',
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn({ error: errorMessage }, 'BcbCopomFailed')
    return null
  }
}

export async function fetchAll(): Promise<NewsItem[]> {
  const results = await Promise.allSettled([fetchSelic(), fetchIpca(), fetchCopom()])

  const items = results
    .filter(
      (result): result is PromiseFulfilledResult<NewsItem | null> => result.status === 'fulfilled',
    )
    .map((result) => result.value)
    .filter((item): item is NewsItem => item !== null)

  logger.info({ count: items.length }, 'BcbFetched')
  return items
}
