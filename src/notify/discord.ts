import axios from 'axios'
import { config } from '../config.js'
import { type ClassifiedItem } from '../llm/mimo.js'
import { logger } from '../logger.js'

const USER_AGENT = 'marcobroker/0.1 (+https://github.com/JoaoVieiraM/MarcoBrokerNews)'
const REQUEST_TIMEOUT_MS = 15_000
const EMBED_TITLE_MAX_LENGTH = 256
const EMBED_DESCRIPTION_MAX_LENGTH = 4096
const EMBED_FIELD_VALUE_MAX_LENGTH = 1024
const WEBHOOK_TOKEN_PATTERN = /\/api\/webhooks\/(\d+)\/([\w-]+)/g
const DEFAULT_RETRY_AFTER_SEC = 1

const DIRECAO_COLOR: Record<string, number> = {
  positivo: 0x2ecc71,
  negativo: 0xe74c3c,
  neutro: 0x95a5a6,
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return value.slice(0, maxLength - 1) + '…'
}

function redactWebhookToken(message: string): string {
  return message.replace(WEBHOOK_TOKEN_PATTERN, '/api/webhooks/$1/[REDACTED]')
}

function formatPublishedAtFooter(publishedAt: string): string {
  const date = new Date(publishedAt)
  if (Number.isNaN(date.getTime())) {
    logger.debug({ publishedAt }, 'DiscordInvalidPublishedAt')
    return formatBrt(new Date())
  }
  return formatBrt(date)
}

function formatBrt(date: Date): string {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return formatter.format(date) + ' BRT'
}

function capitalize(value: string): string {
  if (value.length === 0) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function buildEmbed(item: ClassifiedItem) {
  const { classification } = item
  const tickerValue =
    classification.tickers_afetados.length > 0 ? classification.tickers_afetados.join(', ') : '—'

  return {
    title: truncate(item.item.title, EMBED_TITLE_MAX_LENGTH),
    url: item.item.link,
    description: truncate(classification.resumo, EMBED_DESCRIPTION_MAX_LENGTH),
    color: DIRECAO_COLOR[classification.direcao] ?? DIRECAO_COLOR.neutro,
    fields: [
      {
        name: 'Impacto',
        value: truncate(classification.impacto.toUpperCase(), EMBED_FIELD_VALUE_MAX_LENGTH),
        inline: true,
      },
      {
        name: 'Tickers',
        value: truncate(tickerValue, EMBED_FIELD_VALUE_MAX_LENGTH),
        inline: true,
      },
      {
        name: 'Direção',
        value: truncate(capitalize(classification.direcao), EMBED_FIELD_VALUE_MAX_LENGTH),
        inline: true,
      },
      {
        name: 'Fonte',
        value: truncate(item.item.source, EMBED_FIELD_VALUE_MAX_LENGTH),
        inline: false,
      },
    ],
    footer: { text: formatPublishedAtFooter(item.item.publishedAt) },
    timestamp: new Date(item.item.publishedAt).toISOString(),
  }
}

function resolveWebhookUrl(item: ClassifiedItem): string {
  if (item.classification.impacto === 'alto' && config.DISCORD_WEBHOOK_URL_ALTO !== '') {
    return config.DISCORD_WEBHOOK_URL_ALTO
  }
  return config.DISCORD_WEBHOOK_URL
}

async function postEmbed(
  webhookUrl: string,
  item: ClassifiedItem,
  mentionEveryone: boolean,
): Promise<boolean> {
  const embed = buildEmbed(item)
  const payload: Record<string, unknown> = { embeds: [embed] }
  if (mentionEveryone) {
    payload.content = '@everyone'
  }

  try {
    const response = await axios.post(webhookUrl, payload, {
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: (status) => status < 400 || status === 429,
    })

    if (response.status === 429) {
      const retryAfterSec =
        typeof response.data === 'object' &&
        response.data !== null &&
        typeof (response.data as Record<string, unknown>).retry_after === 'number'
          ? (response.data as Record<string, number>).retry_after
          : DEFAULT_RETRY_AFTER_SEC
      logger.warn({ retryAfterSec }, 'DiscordRateLimited')
      await new Promise<void>((resolve) => setTimeout(resolve, Math.ceil(retryAfterSec * 1000)))

      const retryResponse = await axios.post(webhookUrl, payload, {
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
        timeout: REQUEST_TIMEOUT_MS,
      })
      if (retryResponse.status >= 200 && retryResponse.status < 300) {
        logger.info(
          {
            impacto: item.classification.impacto,
            source: item.item.source,
            ticker0: item.classification.tickers_afetados[0] ?? 'none',
          },
          'DiscordAlertSent',
        )
        return true
      }
      logger.warn(
        { status: retryResponse.status, message: 'retry did not succeed' },
        'DiscordSendFailed',
      )
      return false
    }

    logger.info(
      {
        impacto: item.classification.impacto,
        source: item.item.source,
        ticker0: item.classification.tickers_afetados[0] ?? 'none',
      },
      'DiscordAlertSent',
    )
    return true
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const status = axios.isAxiosError(error) ? error.response?.status : undefined
    logger.warn({ status, message: redactWebhookToken(errorMessage) }, 'DiscordSendFailed')
    return false
  }
}

export async function sendDiscordAlert(item: ClassifiedItem): Promise<boolean> {
  const webhookUrl = resolveWebhookUrl(item)
  if (webhookUrl === '') {
    logger.info('DiscordSkippedNoWebhook')
    return false
  }

  const mentionEveryone =
    item.classification.impacto === 'alto' && webhookUrl === config.DISCORD_WEBHOOK_URL_ALTO

  return postEmbed(webhookUrl, item, mentionEveryone)
}
