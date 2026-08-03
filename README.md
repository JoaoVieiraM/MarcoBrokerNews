# marcobroker

Agente TypeScript que monitora notícias e dados que impactam a bolsa brasileira (B3), classifica relevância via LLM (MimoV2) e envia alertas para Discord. Roda como daemon com crons escalonados — notícias a cada 10 minutos, dados macro e fatos relevantes da CVM em ciclos diários.

## Features

- 3 pipelines independentes: notícias (10min), CVM (diário), macro (diário)
- 8 fontes ativas: RSS de 4 portais BR (InfoMoney, Valor, Money Times, Brazil Journal), NewsAPI, Finnhub, CVM (fatos relevantes), BCB (Selic/IPCA), IBGE (desemprego), BrasilAPI (feriados/cache do guard de pregão)
- Enriquecimento de cotação sob demanda via Alpha Vantage (Selic, IPCA, preço BR de PETR4/VALE3 etc.)
- Dedup por SHA1 do link, rate limit por fonte, guard de horário de pregão
- Classificação LLM (impacto/tickers/direção/setores/resumo) via OpenCode Zen (MimoV2 free)
- Alertas Discord em embed colorido por direção (verde/vermelho/cinza) com menção `@everyone` no canal de alto impacto

Telegram é planejado, ainda não implementado.

## Requisitos

- Node.js 20+
- Uma chave OpenCode Zen (obrigatório para o LLM classificar)
- Um webhook Discord (obrigatório para receber alertas — sem ele o pipeline classifica mas não notifica)
- **Opcionais** (o pipeline degrada silenciosamente sem eles): NewsAPI, Finnhub, Alpha Vantage. Sem essas chaves, as fontes correspondentes retornam vazio.

## Setup

1. Clonar o repositório:

```bash
git clone https://github.com/JoaoVieiraM/MarcoBrokerNews.git
cd MarcoBrokerNews
```

2. Instalar dependências:

```bash
npm install
```

3. Criar o `.env` a partir do exemplo:

```bash
cp .env.example .env
```

No Windows:

```cmd
copy .env.example .env
```

4. Editar `.env` com as variáveis obrigatórias:

```env
MIMO_API_KEY=<sua_chave_aqui>
MIMO_BASE_URL=https://opencode.ai/zen/v1
MIMO_MODEL=mimo-v2.5-free
DISCORD_WEBHOOK_URL=<url_do_webhook>
```

| Variável | O que é |
|---|---|
| `MIMO_API_KEY` | Chave da API OpenCode Zen |
| `MIMO_BASE_URL` | Endpoint do OpenCode Zen |
| `MIMO_MODEL` | Modelo LLM a ser usado |
| `DISCORD_WEBHOOK_URL` | Webhook principal para alertas |

5. Validar o setup rodando uma vez (sem cron):

```bash
npm run once
```

Saída esperada nos logs: `OnceBoot` → `BrasilapiFetched` → execução dos pipelines → `OnceFinished`.

6. Iniciar o daemon com hot-reload:

```bash
npm run dev
```

## Variáveis de ambiente

| Variável | Descrição | Obrigatória | Default |
|---|---|---|---|
| `MIMO_API_KEY` | Chave da API OpenCode Zen para classificação LLM | Sim | - |
| `MIMO_MODEL` | Modelo LLM a ser usado | Não | `mimo-v2.5-free` |
| `MIMO_BASE_URL` | Endpoint da API OpenCode Zen | Sim | - |
| `MIMO_RPM` | Requisições por minuto para o LLM | Não | `10` |
| `NEWSAPI_KEY` | Chave da NewsAPI (notícias globais e BR) | Não | - |
| `FINNHUB_API_KEY` | Chave do Finnhub (notícias de mercado) | Não | - |
| `ALPHAVANTAGE_API_KEY` | Chave do Alpha Vantage (cotações sob demanda) | Não | - |
| `MASSIVE_API_KEY` | Chave do Massive (fonte adicional) | Não | - |
| `DISCORD_WEBHOOK_URL` | Webhook principal para alertas Discord | Sim | - |
| `DISCORD_WEBHOOK_URL_ALTO` | Webhook separado para impacto alto (com `@everyone`) | Não | - |
| `TELEGRAM_BOT_TOKEN` | Token do bot Telegram (não implementado) | Não | - |
| `TELEGRAM_CHAT_ID` | ID do chat Telegram (não implementado) | Não | - |
| `CRON_SCHEDULE` | Expressão cron para o pipeline de notícias | Não | `*/10 * * * *` |
| `CRON_SCHEDULE_CVM` | Expressão cron para o pipeline CVM | Não | `0 6 * * *` |
| `CRON_SCHEDULE_MACRO` | Expressão cron para o pipeline macro | Não | `0 8 * * *` |
| `PREGAO_ONLY` | Rodar apenas no horário de pregão (9h-18h BRT) | Não | `true` |
| `TIMEZONE` | Fuso horário dos crons | Não | `America/Sao_Paulo` |
| `KEYWORD_PREFILTER` | Pré-filtro por palavras-chave antes do LLM | Não | `true` |
| `DB_PATH` | Caminho do banco SQLite | Não | `./data/news.db` |
| `LOG_LEVEL` | Nível de log (debug, info, warn, error) | Não | `info` |
| `NODE_ENV` | Ambiente (development, production, test) | Não | `development` |

Quando `DISCORD_WEBHOOK_URL_ALTO` está vazio, alertas de alto impacto caem no webhook principal sem menção `@everyone`.

## Comandos npm

| Comando | Descrição |
|---|---|
| `npm run dev` | Daemon com hot-reload via `tsx watch` |
| `npm run once` | Roda todos os pipelines uma vez, sem cron |
| `npm run build` | Compila TypeScript (`tsc`) |
| `npm start` | Roda o build de produção (`node dist/index.js`) |
| `npm run lint` | Lint do código (`eslint`) |
| `npm run format` | Formatação (`prettier`) |

## Como funciona

```
cron → guard (pregão + feriado) → fetch fontes (paralelo)
     → filterUnseen (dedup SQLite) → classifyBatch (LLM)
     → notify (Discord) → save (SQLite)
```

3 pipelines com cronograma padrão:

- **news** — a cada 10 min (`*/10 * * * *`) — RSS + NewsAPI + Finnhub
- **cvm** — diário 6h BRT (`0 6 * * *`) — fatos relevantes CVM
- **macro** — diário 8h BRT (`0 8 * * *`) — BCB (Selic/IPCA) + IBGE
- **feriados** — diário 5h BRT (hardcoded) — refresh do cache BrasilAPI

## Deploy

Recomendação: Fly.io com volume persistente para `data/news.db` (SQLite local). Configurar `DB_PATH=/data/news.db` no `.env` de produção, apontando para o diretório do volume.

Alternativas: Railway (tem suporte a volumes), VPS Linux com systemd, Oracle Free Tier.

O deploy ainda não foi configurado — este é o guia teórico. Arquivos de configuração concretos (`fly.toml`, Dockerfile) virão depois.

## Estrutura de pastas

```
src/
├── sources/
│   ├── rss.ts            — feeds RSS dos portais BR
│   ├── newsapi.ts        — NewsAPI
│   ├── finnhub.ts        — Finnhub
│   ├── alphavantage.ts   — cotações sob demanda
│   ├── cvm.ts            — fatos relevantes CVM
│   ├── bcb.ts            — Selic, IPCA
│   ├── ibge.ts           — indicadores macro
│   ├── brasilapi.ts      — feriados nacionais
│   └── feeds.ts          — lista de URLs RSS
├── core/
│   ├── pipeline.ts       — orquestração dos 3 pipelines
│   ├── dedup.ts          — hash SHA1 + consulta SQLite
│   ├── throttle.ts       — rate limit por fonte
│   └── pregao.ts         — guard de horário e feriados
├── llm/
│   └── mimo.ts           — wrapper MimoV2 + schema zod
├── notify/
│   └── discord.ts        — embed Discord
├── db/
│   └── sqlite.ts         — schema e operações SQLite
├── config.ts             — validação do .env com zod
├── logger.ts             — pino (pretty em dev, JSON em prod)
├── index.ts              — boot + crons (daemon)
└── once.ts               — entrada para execução única
```

## Limitações conhecidas

- Endpoint BCB Copom retorna 404 (problema upstream)
- Endpoint IBGE PIB (agregado 6613) retorna 500 (problema upstream) — apenas Desemprego funciona
- CVM atualiza o zip semanalmente, então alertas de fato relevante têm latência de dias
- Alpha Vantage free tier: 25 req/dia, 5 req/min — enriquecimento é sob demanda
- MimoV2 free tier via OpenCode Zen: sujeito a rate limits do provider

## Licença

Sem licença definida — uso pessoal.
