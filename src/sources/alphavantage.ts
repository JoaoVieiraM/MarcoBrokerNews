import axios from 'axios'
import { config } from '../config.js'
import { logger } from '../logger.js'

const USER_AGENT = 'marcobroker/0.1 (+https://github.com/JoaoVieiraM/MarcoBrokerNews)'
const REQUEST_TIMEOUT_MS = 15_000
const BASE_URL = 'https://www.alphavantage.co/query'
const INFORMATION_MAX_LENGTH = 200

export type Quote = {
  symbol: string
  price: number
  change: number
  changePercent: number
  previousClose: number
  latestTradingDay: string
}

type AlphavantageResponse = {
  'Global Quote'?: Record<string, string>
  Note?: string
  Information?: string
  'Error Message'?: string
}

function redactApiKeyFromMessage(message: string): string {
  if (config.ALPHAVANTAGE_API_KEY === '') return message
  return message.replaceAll(config.ALPHAVANTAGE_API_KEY, '[REDACTED]')
}

function parseQuote(raw: Record<string, string>): Quote | null {
  const symbol = raw['01. symbol']
  const price = parseFloat(raw['05. price'])
  const change = parseFloat(raw['09. change'])
  const changePercent = parseFloat(raw['10. change percent']?.replace('%', ''))
  const previousClose = parseFloat(raw['08. previous close'])
  const latestTradingDay = raw['07. latest trading day']

  if (!symbol || !latestTradingDay) return null
  if (!Number.isFinite(price) || !Number.isFinite(change) || !Number.isFinite(previousClose))
    return null
  if (!Number.isFinite(changePercent)) return null

  return { symbol, price, change, changePercent, previousClose, latestTradingDay }
}

export async function getQuote(ticker: string): Promise<Quote | null> {
  if (config.ALPHAVANTAGE_API_KEY === '') {
    logger.info('AlphavantageSkippedNoKey')
    return null
  }

  let response: { data: AlphavantageResponse }

  try {
    response = await axios.get<AlphavantageResponse>(BASE_URL, {
      params: {
        function: 'GLOBAL_QUOTE',
        symbol: ticker,
        apikey: config.ALPHAVANTAGE_API_KEY,
      },
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    })
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn({ error: redactApiKeyFromMessage(errorMessage) }, 'AlphavantageFetchFailed')
    return null
  }

  if (response.data.Note) {
    logger.warn('AlphavantageRateLimited')
    return null
  }

  if (response.data.Information) {
    logger.warn(
      { information: response.data.Information.slice(0, INFORMATION_MAX_LENGTH) },
      'AlphavantageBlocked',
    )
    return null
  }

  if (response.data['Error Message']) {
    logger.warn({ error: response.data['Error Message'] }, 'AlphavantageErrorResponse')
    return null
  }

  const globalQuote = response.data['Global Quote']
  if (!globalQuote || Object.keys(globalQuote).length === 0) {
    logger.debug({ ticker }, 'AlphavantageEmptyQuote')
    return null
  }

  const quote = parseQuote(globalQuote)
  if (!quote) {
    logger.warn({ ticker }, 'AlphavantageMalformedQuote')
    return null
  }

  logger.info({ symbol: quote.symbol, price: quote.price }, 'AlphavantageFetched')
  return quote
}
