import axios from 'axios'
import { logger } from '../logger.js'
import { type NewsItem } from './rss.js'

const USER_AGENT = 'marcobroker/0.1 (+https://github.com/JoaoVieiraM/MarcoBrokerNews)'
const REQUEST_TIMEOUT_MS = 15_000

const PIB_URL =
  'https://servicodados.ibge.gov.br/api/v3/agregados/6613/periodos/-1/variaveis/9808?localidades=N1[all]'
const DESEMPREGO_URL =
  'https://servicodados.ibge.gov.br/api/v3/agregados/6381/periodos/-1/variaveis/4099?localidades=N1[all]'

const PIB_LINK = 'https://www.ibge.gov.br/explica/pib.php'
const DESEMPREGO_LINK = 'https://www.ibge.gov.br/explica/desemprego.php'

const PORTUGUESE_MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

type IbgeSidraResponse = Array<{
  id: string
  variavel: string
  unidade: string
  resultados: Array<{
    classificacoes: unknown[]
    series: Array<{
      localidade: { id: string; nome: string }
      serie: Record<string, string>
    }>
  }>
}>

function periodoLegivel(periodKey: string, kind: 'quarterly' | 'monthly'): string {
  if (kind === 'quarterly') {
    const match = /^(\d{4})(0[1-4])$/.exec(periodKey)
    if (!match) return periodKey
    const year = match[1]
    const quarter = parseInt(match[2], 10)
    return `${quarter}º trimestre de ${year}`
  }

  const match = /^(\d{4})(0[1-9]|1[0-2])$/.exec(periodKey)
  if (!match) return periodKey
  const year = match[1]
  const monthIndex = parseInt(match[2], 10) - 1
  return `${PORTUGUESE_MONTHS[monthIndex]}/${year}`
}

async function fetchPib(): Promise<NewsItem | null> {
  try {
    const response = await axios.get<IbgeSidraResponse>(PIB_URL, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    })

    const variable = response.data[0]
    const series = variable?.resultados?.[0]?.series
    const entry = series?.[0]
    const serieData = entry?.serie
    if (!serieData) throw new Error('missing series data')

    const periodKeys = Object.keys(serieData)
    if (periodKeys.length === 0) throw new Error('empty series')

    const periodKey = periodKeys[0]
    const rawValue = serieData[periodKey]

    if (!rawValue || rawValue === '-' || rawValue === '...') {
      throw new Error(`suppressed value: ${String(rawValue)}`)
    }

    const parsedValue = parseFloat(rawValue)
    if (!Number.isFinite(parsedValue)) {
      throw new Error(`unparseable value: ${rawValue}`)
    }

    return {
      link: `${PIB_LINK}#period=${periodKey}`,
      title: `IBGE — PIB variou ${rawValue}% no trimestre (${periodoLegivel(periodKey, 'quarterly')})`,
      source: 'IBGE',
      publishedAt: new Date().toISOString(),
      snippet:
        'Variação em volume do PIB em relação ao trimestre anterior, série trimestral do IBGE.',
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn({ error: errorMessage }, 'IbgePibFailed')
    return null
  }
}

async function fetchDesemprego(): Promise<NewsItem | null> {
  try {
    const response = await axios.get<IbgeSidraResponse>(DESEMPREGO_URL, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    })

    const variable = response.data[0]
    const series = variable?.resultados?.[0]?.series
    const entry = series?.[0]
    const serieData = entry?.serie
    if (!serieData) throw new Error('missing series data')

    const periodKeys = Object.keys(serieData)
    if (periodKeys.length === 0) throw new Error('empty series')

    const periodKey = periodKeys[0]
    const rawValue = serieData[periodKey]

    if (!rawValue || rawValue === '-' || rawValue === '...') {
      throw new Error(`suppressed value: ${String(rawValue)}`)
    }

    const parsedValue = parseFloat(rawValue)
    if (!Number.isFinite(parsedValue)) {
      throw new Error(`unparseable value: ${rawValue}`)
    }

    return {
      link: `${DESEMPREGO_LINK}#period=${periodKey}`,
      title: `IBGE — Taxa de desocupação: ${rawValue}% (${periodoLegivel(periodKey, 'monthly')})`,
      source: 'IBGE',
      publishedAt: new Date().toISOString(),
      snippet:
        'Taxa de desocupação medida pela PNAD Contínua, trimestre móvel, série mensal do IBGE.',
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn({ error: errorMessage }, 'IbgeDesempregoFailed')
    return null
  }
}

export async function fetchAll(): Promise<NewsItem[]> {
  const results = await Promise.allSettled([fetchPib(), fetchDesemprego()])

  const items = results
    .filter(
      (result): result is PromiseFulfilledResult<NewsItem | null> => result.status === 'fulfilled',
    )
    .map((result) => result.value)
    .filter((item): item is NewsItem => item !== null)

  logger.info({ count: items.length }, 'IbgeFetched')
  return items
}
