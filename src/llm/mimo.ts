import axios from 'axios'
import { z } from 'zod'
import { config } from '../config.js'
import { type HashedItem } from '../core/dedup.js'
import { logger } from '../logger.js'
import { type NewsItem } from '../sources/rss.js'

const MIMO_BATCH_SIZE = 5
const MIMO_TIMEOUT_MS = 30_000
const MAX_ATTEMPTS = 3
const BACKOFF_DELAYS_MS = [1000, 2000]
const USER_AGENT = 'marcobroker/0.1 (+https://github.com/JoaoVieiraM/MarcoBrokerNews)'

const SYSTEM_PROMPT = [
  'Você é um analista do mercado financeiro brasileiro.',
  'Classifique cada notícia recebida quanto ao impacto potencial na B3 (Bolsa de São Paulo).',
  'Retorne APENAS um objeto JSON com a chave "resultados" contendo um array na mesma ordem das notícias enviadas.',
  "Cada resultado deve ter: impacto ('alto'|'medio'|'baixo'|'nenhum'), tickers_afetados (array de códigos como PETR4, VALE3), setores (array), direcao ('positivo'|'negativo'|'neutro'), resumo (1-2 frases em português).",
  '`direcao` é o efeito esperado sobre o preço da ação ou setor citado no curto prazo (positivo = tende a subir, negativo = tende a cair, neutro = sem direção clara), não o efeito macroeconômico.',
  "Se a notícia não tem ligação com o mercado BR, use impacto 'nenhum'.",
].join('\n')

type MimoChoiceMessage = {
  content: string
}

type MimoChoice = {
  message: MimoChoiceMessage
}

type MimoResponseData = {
  choices: MimoChoice[]
}

type ChunkPromptItem = {
  index: number
  title: string
  source: string
  snippet: string
}

export const ClassificationSchema = z.object({
  impacto: z.enum(['alto', 'medio', 'baixo', 'nenhum']),
  tickers_afetados: z.array(z.string()),
  setores: z.array(z.string()),
  direcao: z.enum(['positivo', 'negativo', 'neutro']),
  resumo: z.string(),
})

export type Classification = z.infer<typeof ClassificationSchema>

export type ClassifiedItem = {
  item: NewsItem
  hash: string
  classification: Classification
}

function redactApiKeyFromMessage(message: string): string {
  if (config.MIMO_API_KEY === '') return message
  return message.replaceAll(config.MIMO_API_KEY, '[REDACTED]')
}

function isRetryable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return true
  if (!error.response) return true
  const status = error.response.status
  return status === 429 || status >= 500
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildUserMessage(items: HashedItem[]): string {
  const payload: ChunkPromptItem[] = items.map((hashed, index) => ({
    index,
    title: hashed.item.title,
    source: hashed.item.source,
    snippet: hashed.item.snippet,
  }))
  return JSON.stringify(payload)
}

function parseChunkResponse(data: MimoResponseData, expectedLength: number): Classification[] {
  const content = data.choices[0].message.content

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('response content is not valid JSON')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('parsed content is not an object')
  }

  const resultados = (parsed as Record<string, unknown>).resultados
  if (!Array.isArray(resultados)) {
    throw new Error('response content missing resultados array')
  }

  if (resultados.length !== expectedLength) {
    throw new Error(
      `resultados length ${resultados.length} does not match input length ${expectedLength}`,
    )
  }

  return resultados.map((raw, index) => {
    const result = ClassificationSchema.safeParse(raw)
    if (!result.success) {
      throw new Error(`classification at index ${index} failed validation`)
    }
    return result.data
  })
}

async function retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (error: unknown) {
      if (attempt === MAX_ATTEMPTS || !isRetryable(error)) throw error
      const delayMs = BACKOFF_DELAYS_MS[attempt - 1]
      const reason = redactApiKeyFromMessage(error instanceof Error ? error.message : String(error))
      logger.warn({ attempt, delayMs, reason }, 'MimoRetry')
      await sleep(delayMs)
    }
  }
  throw new Error('retryWithBackoff exhausted all attempts')
}

async function classifyChunk(chunk: HashedItem[], chunkIndex: number): Promise<ClassifiedItem[]> {
  const userMessage = buildUserMessage(chunk)

  const callApi = async (): Promise<Classification[]> => {
    const response = await axios.post<MimoResponseData>(
      `${config.MIMO_BASE_URL}/chat/completions`,
      {
        model: config.MIMO_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${config.MIMO_API_KEY}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        timeout: MIMO_TIMEOUT_MS,
      },
    )
    return parseChunkResponse(response.data, chunk.length)
  }

  const classifications = await retryWithBackoff(callApi)

  logger.info({ chunkIndex, size: chunk.length }, 'MimoBatchClassified')

  return chunk.map((hashed, index) => ({
    item: hashed.item,
    hash: hashed.hash,
    classification: classifications[index],
  }))
}

export async function classifyBatch(items: HashedItem[]): Promise<ClassifiedItem[]> {
  if (items.length === 0) return []

  if (config.MIMO_API_KEY === '') {
    logger.info('MimoSkippedNoKey')
    return []
  }

  const classified: ClassifiedItem[] = []
  let dropped = 0

  for (let offset = 0; offset < items.length; offset += MIMO_BATCH_SIZE) {
    const chunk = items.slice(offset, offset + MIMO_BATCH_SIZE)
    const chunkIndex = Math.floor(offset / MIMO_BATCH_SIZE)

    try {
      const results = await classifyChunk(chunk, chunkIndex)
      classified.push(...results)
    } catch (error: unknown) {
      dropped += chunk.length
      const reason = redactApiKeyFromMessage(error instanceof Error ? error.message : String(error))
      logger.warn({ chunkIndex, size: chunk.length, reason }, 'MimoBatchFailed')
    }
  }

  logger.info({ input: items.length, classified: classified.length, dropped }, 'MimoFetched')

  return classified
}
