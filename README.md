# marcobroker

![marcobroker — Marco Antônio acompanhando a B3](src/assets/fotoReadme.png)

Agente TypeScript que monitora notícias e dados que impactam a bolsa brasileira (B3), classifica relevância via LLM e envia alertas para o Discord. Roda como daemon 24/7 com crons escalonados: notícias a cada 10 minutos, dados macro diários, fatos relevantes da CVM diários. Ferramenta pessoal — não day-trade de alta frequência.

**Status atual:** pausado (`flyctl scale count 0`). Ver [Como pausar e retomar](#como-pausar-e-retomar).

---

## Índice

1. [Features](#features)
2. [Requisitos](#requisitos)
3. [Setup rápido](#setup-rápido)
4. [Comandos npm](#comandos-npm)
5. [Variáveis de ambiente](#variáveis-de-ambiente)
6. [Deploy no Fly.io](#deploy-no-flyio)
7. [Como pausar e retomar](#como-pausar-e-retomar)
8. [Gerenciamento de custo](#gerenciamento-de-custo)
9. [Arquitetura](#arquitetura)
10. [Estrutura de pastas](#estrutura-de-pastas)
11. [LLM: MimoV2 via OpenCode Zen](#llm-mimov2-via-opencode-zen)
12. [Limitações conhecidas](#limitações-conhecidas)
13. [Decisões de projeto (com o porquê)](#decisões-de-projeto-com-o-porquê)
14. [Extensões futuras](#extensões-futuras)
15. [Licença](#licença)

---

## Features

- **3 pipelines independentes:** notícias (10 min), macro (diário 8h), CVM fatos relevantes (diário 6h)
- **8 fontes ativas:** RSS de 4 portais BR (InfoMoney, Valor, Money Times, Brazil Journal), NewsAPI, Finnhub, CVM Dados Abertos, BCB (Selic/IPCA), IBGE (Desemprego), BrasilAPI (feriados)
- **Enriquecimento de cotação sob demanda** via Alpha Vantage (PETR4, VALE3 etc.)
- **Dedup por SHA1 do link** persistido em SQLite — mesma notícia nunca gera 2 alertas
- **Filtro de idade** (24h por padrão) — dropa notícia velha antes de gastar LLM
- **Rate limit por fonte** (in-memory, respeitando 100/dia da NewsAPI, 60/min do Finnhub, 25/dia do Alpha Vantage)
- **Guard de horário de pregão** (9h-18h BRT, dias úteis, não-feriados) — só o pipeline de news respeita
- **Classificação LLM via OpenCode Zen (MimoV2 free)** com schema zod, retry+backoff, batch de 5
- **Alertas Discord** em embed colorido por direção (verde/vermelho/cinza), `@everyone` opcional em canal de alto impacto
- **Deploy pronto pra Fly.io** com volume SQLite persistente na região `gru` (São Paulo)

Telegram é planejado, ainda não implementado.

---

## Requisitos

- **Node.js 20+**
- **Chave OpenCode Zen** (obrigatória — sem ela o LLM não classifica e nada é notificado)
- **Webhook Discord** (obrigatório — sem ele o pipeline classifica mas não envia)
- **Opcionais** (o pipeline degrada silenciosamente sem eles): `NEWSAPI_KEY`, `FINNHUB_API_KEY`, `ALPHAVANTAGE_API_KEY`

---

## Setup rápido

```bash
git clone https://github.com/JoaoVieiraM/MarcoBrokerNews.git
cd MarcoBrokerNews
npm install
cp .env.example .env      # Windows CMD: copy .env.example .env
```

Editar `.env` preenchendo o mínimo:

```env
MIMO_API_KEY=<sua_chave_opencode_zen>
MIMO_BASE_URL=https://opencode.ai/zen/v1
MIMO_MODEL=mimo-v2.5-free
DISCORD_WEBHOOK_URL=<url_do_seu_webhook>
```

Validar rodando uma vez sem cron:

```bash
npm run once
```

Se alertas chegarem no Discord, tá tudo redondo. Pra iniciar o daemon com hot-reload:

```bash
npm run dev
```

---

## Comandos npm

| Comando | O que faz |
|---|---|
| `npm run dev` | Daemon com hot-reload (`tsx watch src/index.ts`) |
| `npm run once` | Roda os 3 pipelines uma vez sequencialmente e sai |
| `npm run build` | Compila TypeScript (`tsc`) → `dist/` |
| `npm start` | Roda o build de produção (`node dist/index.js`) — usado pelo Docker |
| `npm run lint` | ESLint no `src/**/*.ts` |
| `npm run format` | Prettier no `src/**/*.ts` |

---

## Variáveis de ambiente

| Variável | Descrição | Obrigatória | Default |
|---|---|---|---|
| `MIMO_API_KEY` | Chave da API OpenCode Zen | Sim | - |
| `MIMO_MODEL` | Modelo LLM | Não | `mimo-v2.5-free` |
| `MIMO_BASE_URL` | Endpoint OpenAI-compatible | Sim | - |
| `MIMO_RPM` | Requests per minute alvo (não enforçado; retry+backoff cobre 429) | Não | `10` |
| `NEWSAPI_KEY` | Chave NewsAPI (100 req/dia free) | Não | - |
| `FINNHUB_API_KEY` | Chave Finnhub (60 req/min free) | Não | - |
| `ALPHAVANTAGE_API_KEY` | Chave Alpha Vantage (25 req/dia + 5 req/min free) | Não | - |
| `MASSIVE_API_KEY` | Não usada — fonte skipped (Massive só cobre US) | Não | - |
| `DISCORD_WEBHOOK_URL` | Webhook principal | Sim | - |
| `DISCORD_WEBHOOK_URL_ALTO` | Webhook separado pra impacto alto (com `@everyone`) | Não | - |
| `TELEGRAM_BOT_TOKEN` | Placeholder — Telegram não implementado | Não | - |
| `TELEGRAM_CHAT_ID` | Placeholder | Não | - |
| `CRON_SCHEDULE` | Cron do pipeline de news | Não | `*/10 * * * *` |
| `CRON_SCHEDULE_CVM` | Cron do pipeline CVM | Não | `0 6 * * *` |
| `CRON_SCHEDULE_MACRO` | Cron do pipeline macro | Não | `0 8 * * *` |
| `PREGAO_ONLY` | Só roda news em horário de pregão | Não | `true` |
| `TIMEZONE` | Fuso dos crons | Não | `America/Sao_Paulo` |
| `KEYWORD_PREFILTER` | Reservado (não implementado ativamente) | Não | `true` |
| `MAX_ITEM_AGE_HOURS` | Idade máxima de item antes do LLM | Não | `24` |
| `DB_PATH` | Caminho do SQLite | Não | `./data/news.db` (prod: `/data/news.db`) |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` | Não | `info` |
| `NODE_ENV` | `development` \| `production` \| `test` | Não | `development` |

Quando `DISCORD_WEBHOOK_URL_ALTO` está vazio, alertas de alto impacto caem no webhook principal sem `@everyone`.

---

## Deploy no Fly.io

Assumindo `flyctl` instalado e logado (`flyctl auth login`).

### Primeira vez

```bash
# 1. Criar volume persistente pra SQLite
flyctl volumes create data --region gru --size 1

# 2. Setar secrets (colar seus valores)
flyctl secrets set \
  MIMO_API_KEY=... \
  MIMO_BASE_URL=https://opencode.ai/zen/v1 \
  MIMO_MODEL=mimo-v2.5-free \
  DISCORD_WEBHOOK_URL=... \
  NEWSAPI_KEY=... \
  FINNHUB_API_KEY=... \
  ALPHAVANTAGE_API_KEY=... \
  PREGAO_ONLY=true \
  NODE_ENV=production \
  LOG_LEVEL=info \
  DB_PATH=/data/news.db

# 3. Deploy
flyctl deploy

# 4. Confirmar boot
flyctl logs
```

Esperar por `Boot` + `BrasilapiFetched` + 4× `CronScheduled` nos logs.

### Gotchas

- **Máquina inicial vai pra `iad` (EUA), não `gru`.** O `fly launch` cria uma máquina na região default antes de você editar `fly.toml`. Fix: `flyctl machine list` → `flyctl machine destroy <id> --force` → `flyctl deploy` (recria em `gru` e auto-monta o volume).
- **Trial mode limita máquina a 5 min.** Contas sem cartão são paradas após 5 minutos com log `Trial machine stopping`. Fix: adicionar cartão em `https://fly.io/trial` (Fly não cobra dentro do free tier).

### Deploys subsequentes

```bash
flyctl deploy                      # rebuild + rollout
flyctl secrets set VAR=valor       # update secret + auto-restart
```

---

## Como pausar e retomar

**Pausar** (0 compute, mantém volume + secrets + config):

```bash
flyctl scale count 0
```

**Retomar:**

```bash
flyctl scale count 1
```

Ao retomar após dias parado, o daemon vai processar as últimas 24h de notícias que estavam nos feeds — pode gerar uma pequena avalanche de "catch-up". Pra minimizar:

```bash
flyctl secrets set MAX_ITEM_AGE_HOURS=6
flyctl scale count 1
# depois de estabilizar:
flyctl secrets set MAX_ITEM_AGE_HOURS=24
```

---

## Gerenciamento de custo

### Free tier cobre folgado

- **3 machines shared-cpu-1x 256MB grátis** — usamos 1
- **3GB de volumes grátis** — usamos 1GB
- **160GB outbound bandwidth grátis** — praticamente nada saindo

Custo esperado: **$0/mês permanentemente**.

### Como não estourar

1. Não escalar RAM. Se mudar `memory` no `fly.toml` pra `1gb`, sai do free tier ($3-5/mês).
2. Não adicionar máquinas. `flyctl scale count 2` = paga a segunda.
3. Não crescer volume > 3GB.
4. Não adicionar serviços Fly pagos (Postgres, Redis, LiteFS gerenciado).

### Spending limit (freio de emergência recomendado)

Abrir `https://fly.io/dashboard/personal/billing` → seção **Spending Limit** → `$1/month`. Se qualquer coisa tentar ultrapassar, Fly **suspende** máquinas antes de cobrar.

### Monitoramento

```bash
flyctl dashboard
```

Uma vez por mês, ver seção **Usage** — se qualquer barra > 50%, investigar.

---

## Arquitetura

### Fluxo de um ciclo do pipeline de notícias

```
cron dispara (a cada 10 min em pregão)
    ↓
guard de pregão (dia útil + 9h-18h BRT + não-feriado)
    ↓
fetch em paralelo (RSS + NewsAPI + Finnhub)
    ↓
filterByAge (drop items > 24h)
    ↓
filterUnseen (dedup SHA1 do link via SQLite)
    ↓
classifyBatch (LLM, chunks de 5, retry+backoff)
    ↓
notify Discord (só se impacto = alto ou medio)
    ↓
save + markNotified (SQLite no volume persistente)
```

### 3 pipelines independentes

| Pipeline | Cadência | Fontes | Guard de pregão? |
|---|---|---|---|
| `runNewsPipeline` | `*/10 * * * *` | RSS + NewsAPI + Finnhub | Sim |
| `runCvmPipeline` | `0 6 * * *` | CVM (fatos relevantes) | Não — vale 24/7 |
| `runMacroPipeline` | `0 8 * * *` | BCB + IBGE | Não — vale 24/7 |

Um 4º cron diário às 5h BRT roda `refreshFeriados` pra manter o cache do BrasilAPI atualizado.

### Módulos-chave

- **`src/core/pipeline.ts`** — orquestração dos 3 pipelines + helper `classifyAndPartition` compartilhado + `filterByAge`
- **`src/core/dedup.ts`** — hash SHA1 normalizado (trim + lowercase) + consulta SQLite `isSeen`
- **`src/core/throttle.ts`** — rate limiter in-memory por fonte
- **`src/core/pregao.ts`** — `shouldRunPipeline()` = PREGAO_ONLY + hora SP + dia semana + isHoliday
- **`src/llm/mimo.ts`** — cliente MimoV2 + schema zod + batch + retry+backoff
- **`src/notify/discord.ts`** — embed colorido + rate-limit handling + redação de token
- **`src/db/sqlite.ts`** — schema `news` + `feriados`, prepared statements

---

## Estrutura de pastas

```
.
├── src/
│   ├── sources/
│   │   ├── rss.ts             — 4 feeds RSS BR (define NewsItem — contrato de todos)
│   │   ├── feeds.ts           — const FEEDS com as 4 URLs
│   │   ├── newsapi.ts         — NewsAPI (skip se key vazia)
│   │   ├── finnhub.ts         — Finnhub (skip se key vazia)
│   │   ├── cvm.ts             — zip CVM + CSV Latin-1 + filtro 48h
│   │   ├── bcb.ts             — Selic + IPCA + Copom (endpoints em paralelo)
│   │   ├── ibge.ts            — PIB + Desemprego (SIDRA v3)
│   │   ├── brasilapi.ts       — feriados (refresh + lookup, não retorna NewsItem)
│   │   └── alphavantage.ts    — cotação on-demand (getQuote, não retorna NewsItem)
│   ├── llm/
│   │   └── mimo.ts            — cliente OpenCode Zen + zod + batch + retry
│   ├── notify/
│   │   └── discord.ts         — embed + rate-limit + token redaction
│   ├── db/
│   │   └── sqlite.ts          — schema news + feriados, prepared statements
│   ├── core/
│   │   ├── pipeline.ts        — 3 pipelines + classifyAndPartition + filterByAge
│   │   ├── dedup.ts           — hash SHA1 + filterUnseen
│   │   ├── throttle.ts        — withRateLimit por fonte
│   │   └── pregao.ts          — isDuringPregao + shouldRunPipeline
│   ├── assets/                — imagens do README
│   ├── config.ts              — validação do .env com zod (single source of truth)
│   ├── logger.ts              — pino (pretty em dev, JSON em prod)
│   ├── index.ts               — boot + node-cron (daemon 24/7)
│   └── once.ts                — roda os 3 pipelines uma vez e sai (debug)
├── data/                       — SQLite local (gitignored)
├── fly.toml                    — config Fly.io (região gru, volume, sem http_service)
├── Dockerfile                  — build multi-stage Node 22, DB_PATH=/data/news.db
├── .env.example                — todas as env vars com defaults
├── docinfoprojeto.md           — spec original do projeto
├── TASKS.md                    — backlog (26 tasks marcadas)
├── package.json
└── tsconfig.json
```

---

## LLM: MimoV2 via OpenCode Zen

O classificador é a peça central. Toda notícia que sobrevive dedup + filtro de idade passa por aqui — o resultado determina se vira alerta ou não.

**Modelo escolhido:** `mimo-v2.5-free` — MimoV2, tier gratuito hospedado no gateway **OpenCode Zen**.

**Endpoint:** `https://opencode.ai/zen/v1/chat/completions` (OpenAI-compatible — mesmo formato JSON que a OpenAI usa).

**Por que essa combinação:**

- **Free tier real e útil.** Diferente da maioria dos providers que dão trial limitado, o Zen mantém `mimo-v2.5-free` disponível continuamente. Custo permanente do LLM: R$0.
- **Compatibilidade OpenAI.** Se um dia o Zen mudar de política, trocar o provider é mudar `MIMO_BASE_URL` e `MIMO_MODEL` no `.env` — zero mudança de código.
- **Alternativas disponíveis no mesmo gateway:** `minimax-m2.5`, `minimax-m2.7`, `minimax-m3`. Se o MiMo ficar rate-limitado ou for descontinuado, é uma linha no `.env`.
- **Reaproveitamento de conta.** A chave OpenCode Zen já era usada em outros contextos, então o setup foi zero atrito.

**Como o LLM é chamado (`src/llm/mimo.ts`):**

- **Batching:** notícias vão em chunks de **5 items** por request. Reduz latência total sem sobrecarregar o modelo.
- **Response format forçado:** `{ "type": "json_object" }` — o modelo é obrigado a devolver JSON válido.
- **Validação com zod:** cada classificação passa por schema estrito antes de virar `ClassifiedItem`. Se qualquer campo faltar ou vier com valor fora do enum, a batch inteira é dropada.
- **Retry + backoff exponencial:** 3 tentativas (delay `1s → 2s → 4s`) só pra `429` e `5xx`. Erro `4xx` (exceto `429`) e erro de parse zod são **não-retryáveis** (dropa direto — retentar com mesmo prompt geralmente falha igual).
- **Redação de key:** qualquer mensagem de erro que possa ecoar a `MIMO_API_KEY` (URL echo em axios error) passa por `redactApiKeyFromMessage` antes de ir pro log.

**Schema da classificação (validado com zod):**

```ts
{
  impacto: 'alto' | 'medio' | 'baixo' | 'nenhum',
  tickers_afetados: string[],   // ex: ["PETR4", "VALE3"]
  setores: string[],            // ex: ["Petróleo e Gás"]
  direcao: 'positivo' | 'negativo' | 'neutro',
  resumo: string                // 1-2 frases em pt-BR
}
```

**Prompt em português** (`SYSTEM_PROMPT` em `src/llm/mimo.ts`) foca em analista do mercado BR. Um ponto importante: `direcao` é **perspectiva da empresa/setor no curto prazo**, não macro. Um aumento de preço do diesel pela Petrobras é `positivo` (bom pra margem da PETR4), mesmo sendo macro-negativo (inflação). Isso está explícito no prompt pra evitar leitura ambígua.

**Custo estimado:** com dedup + filtro de idade, o LLM classifica ~50-300 notícias únicas por dia. Todas dentro do free tier do Zen. Se um dia estourar, o `retry+backoff` segura os 429 sem crashar o pipeline.

---

## Limitações conhecidas

Não são bugs nossos — coisas que afetam o produto vindas de fora:

- **Endpoint BCB Copom retorna 404.** O path documentado (`https://olinda.bcb.gov.br/olinda/servico/CalendarioCopom/versao/v1/odata/CalendarioCopom`) retorna 404 — provavelmente foi movido/renomeado pelo BCB. `runMacroPipeline` continua rodando com Selic + IPCA + IBGE Desemprego; só a próxima reunião do Copom não é anunciada.

- **Endpoint IBGE PIB retorna 500.** SIDRA agregado 6613 (variação trimestral do PIB) retorna 500 pra qualquer período. Confirmado via `curl` direto — problema do lado do IBGE. `ibge.ts` continua entregando Taxa de Desocupação normal.

- **CVM atualiza o zip semanalmente.** Fatos relevantes ganham latência de dias — publicados no site em tempo real, mas o dataset agregado é regenerado só aos fins de semana.

- **Alpha Vantage free tier é agressivo:** 25 req/dia + 5 req/min. Por isso está como enriquecimento on-demand, não como fonte periódica do pipeline.

- **`flyctl logs` mostra tudo em UTC.** É o viewer da Fly, não a gente. Nossos alertas Discord e outros timestamps user-facing já usam BRT via `Intl.DateTimeFormat`.

- **Trial mode do Fly requer cartão** (ver seção de Deploy). Sem cartão, máquina morre a cada 5 min.

---

## Decisões de projeto (com o porquê)

Estas são decisões **conscientemente tomadas**, muitas contrariando o que o `docinfoprojeto.md` original pedia. Estão documentadas aqui pra evitar re-litígio.

### 1. Fly.io como plataforma de deploy

**Escolhido em vez de:** Railway, VPS (Hetzner/Contabo/Oracle Free Tier), PC local sempre ligado.

**Por quê:** free tier permanentemente gratuito (3 shared-cpu-1x 256MB + 3GB volume), região `gru` (baixa latência pros feeds BR e endpoints CVM/BCB), volume persistente pra SQLite, deploy em 1 comando.

### 2. Sem `[http_service]` no `fly.toml`

**O que:** removido o bloco padrão que o `fly launch` gerou.

**Por quê:** marcobroker é daemon cron-driven, não HTTP server. Com `[http_service]`, Fly assume que a máquina só deve rodar quando tem tráfego HTTP → auto-stop → cron nunca dispara. Sem o bloco, Fly deixa a Machine rodando.

### 3. LLM: OpenCode Zen com `mimo-v2.5-free`

Ver seção [LLM: MimoV2 via OpenCode Zen](#llm-mimov2-via-opencode-zen) pro detalhamento.

**Gotcha registrado:** endpoint `/models` do Zen aceita a key, mas `/chat/completions` retorna 401 se o modelo slug estiver errado. Slug correto é `mimo-v2.5-free` (não `mimo-v2`, nem `mimo`).

### 4. Discord agora, Telegram deferred

Discord basta pro MVP — canal com embed colorido, `@everyone` em impacto alto, push mobile nativo. Adicionar Telegram duplicaria complexidade sem ganho real. Se um dia rolar, `sendTelegramAlert(item)` deve mirrorar exatamente o contrato do Discord.

### 5. Massive skipped

Docs do Massive confirmaram zero cobertura BR — só US stocks, options, forex, crypto, futures. Adicionar uma fonte que só traz notícia US pra um agente de bolsa BR queimaria tokens LLM classificando ruído. Key fica guardada caso um dia expanda pra US.

### 6. `PREGAO_ONLY=true` em produção

Classificar notícia às 3h da manhã queima quota LLM sem chance de reação humana. Pipelines de CVM e macro têm seus próprios crons diários que ignoram o guard (têm valor 24/7). News respeita 9-18h BRT em dia útil não-feriado.

### 7. `CRON_SCHEDULE_CVM=0 6 * * *` (diário, não 15min)

CVM regenera o zip IPE **semanalmente** (sábado/domingo). Polling de 15 em 15 min baixaria o mesmo arquivo multi-MB 96× por dia com zero dado novo. Diário às 6h basta.

### 8. Age filter (`MAX_ITEM_AGE_HOURS=24`)

RSS do Valor retorna 100 headlines indo até semanas atrás. NewsAPI ordena por data mas não corta janela. Sem filtro, o pipeline classificava notícia de 3 dias atrás — alerta velho, LLM desperdiçado. Com filter de 24h no início do `classifyAndPartition`, cortamos ~60-80% do lixo antes do dedup e LLM.

Data inválida ou futura → mantém item (safer default — BCB às vezes manda datas futuras).

### 9. `direcao` é perspectiva-empresa, não macro

Primeiro teste do LLM classificou "aumento do diesel pela Petrobras" como `direcao: positivo` (bom pra margem de PETR4) mesmo sendo macro-negativo (inflação). Frase adicionada ao `SYSTEM_PROMPT` esclarecendo que `direcao` é o efeito sobre o preço da ação/setor no curto prazo, não o efeito macro.

### 10. Alpha Vantage como enriquecimento on-demand

Free tier tem cotação BR (`PETR4.SAO`), mas rate limit é agressivo (25 req/dia). Como fonte periódica queimaria quota sem valor. On-demand, chamando `getQuote(ticker)` quando um alerta de impacto alto for enviado, faz mais sentido. Wire desse enriquecimento fica pra iteração futura.

### 11. Filtro semântico de duplicatas: **deixado como está**

Dedup atual é por SHA1 do link. Se InfoMoney e Money Times cobrem o mesmo evento com URLs diferentes, geram 2 alertas separados. Aceito conscientemente — 2 portais reportando é validação, não spam.

### 12. Retention do SQLite: **não implementado**

SQLite aguenta milhões de linhas. Com dedup + age filter, o crescimento é 500-2000 rows/dia. Volume de 1GB dá pra anos. Só implementar `DELETE FROM news WHERE seen_at < date('now','-90 days')` quando passar de ~500MB.

### 13. Dashboard web: **deferred**

Discord + `flyctl logs` já resolvem "ver alertas" e "ver histórico". Dashboard editável por non-tech transformaria daemon simples em web app (config mutável em runtime, HTTP server, auth, UI) — 8-12 dias single-user, 20-30 multi-user. Fora do escopo do MVP. Alternativa mais barata se um dia quiser: config em YAML/JSON commitado no git.

---

<div align="center">
  <img src="src/assets/fotoreadme2.png" width="280" alt="Marco Antônio, mascote do marcobroker" />
</div>

## Extensões futuras

Ideias consideradas mas **não implementadas** de propósito:

- **Telegram notifier** — `notify/telegram.ts` planejado. Só faz sentido se quiser redundância além do Discord.
- **Dashboard web** — página friendly pra non-tech user editar prompt e config. Análise concluiu que custo em complexidade supera ganho vs Discord + logs.
- **Retention automática do SQLite** — só quando o arquivo passar de ~500MB.
- **Enriquecimento on-demand com Alpha Vantage** — chamar `getQuote(ticker)` ao notificar impacto alto e anexar preço atual no embed.
- **Fontes adicionais:** Twitter/X (breaking news de contas de analistas), Reddit BR-invest, YouTube canais financeiros. Seguir o mesmo pattern dos sources existentes (`fetchAll(): Promise<NewsItem[]>`).
- **Dedup semântico** — hoje é por hash de link. Dois portais reportando o mesmo evento com URLs diferentes gera 2 alertas. Aceito como validação por múltiplas fontes.
- **Massive** como fonte de expansão pra cobertura US (a key está guardada).
- **Cron mais frequente (`*/5` ou menos)** — `*/5` é meio termo seguro. Sub-5-min estoura NewsAPI free tier e não traz ganho de latência real.

---

## Licença

Sem licença definida — projeto pessoal.
