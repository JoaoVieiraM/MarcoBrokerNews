import axios from 'axios'
import { isDateFeriado, upsertFeriado } from '../db/sqlite.js'
import { logger } from '../logger.js'

const USER_AGENT = 'marcobroker/0.1 (+https://github.com/JoaoVieiraM/MarcoBrokerNews)'
const REQUEST_TIMEOUT_MS = 15_000

const SAO_PAULO_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

type BrasilApiFeriado = {
  date: string
  name: string
  type: string
}

function buildFeriadosUrl(year: number): string {
  return `https://brasilapi.com.br/api/feriados/v1/${year}`
}

function formatDateInSaoPaulo(date: Date): string {
  return SAO_PAULO_DATE_FORMATTER.format(date)
}

export async function refreshFeriados(year: number): Promise<number> {
  try {
    const response = await axios.get<BrasilApiFeriado[]>(buildFeriadosUrl(year), {
      headers: { 'User-Agent': USER_AGENT },
      timeout: REQUEST_TIMEOUT_MS,
    })

    const feriados = response.data
    for (const feriado of feriados) {
      upsertFeriado({ data: feriado.date, nome: feriado.name })
    }

    const count = feriados.length
    logger.info({ year, count }, 'BrasilapiFetched')
    return count
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.warn({ error: errorMessage }, 'BrasilapiFetchFailed')
    return 0
  }
}

export function isHoliday(date: Date): boolean {
  try {
    const dateYmd = formatDateInSaoPaulo(date)
    return isDateFeriado(dateYmd)
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.debug({ error: errorMessage }, 'BrasilapiHolidayLookupFailed')
    return false
  }
}
