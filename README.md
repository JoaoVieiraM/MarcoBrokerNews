# marcobroker

![marcobroker — Marco Antônio acompanhando a B3](src/assets/fotoReadme.png)

Agente TypeScript que monitora notícias e dados que impactam a bolsa brasileira (B3), classifica relevância via LLM e envia alertas para o Discord. Roda como daemon com crons escalonados: notícias a cada 10 minutos, dados macro diários, fatos relevantes da CVM diários. Pensado como ferramenta pessoal de acompanhamento (não day-trade de alta frequência).

**Status atual:** pausado (`flyctl scale count 0`). Ver [Como pausar e retomar](#como-pausar-e-retomar).

---

## Índice

1. [O que o agente faz](#o-que-o-agente-faz)
2. [Arquitetura](#arquitetura)
3. [Estrutura de pastas](#estrutura-de-pastas)
4. [Decisões de projeto (com o porquê)](#decisões-de-projeto-com-o-porquê)
5. [Requisitos](#requisitos)
6. [Setup local](#setup-local)
7. [Variáveis de ambiente](#variáveis-de-ambiente)
8. [Comandos npm](#comandos-npm)
9. [Deploy no Fly.io](#deploy-no-flyio)
10. [Gerenciamento de custo](#gerenciamento-de-custo)
11. [Como pausar e retomar](#como-pausar-e-retomar)
12. [Limitações conhecidas](#limitações-conhecidas)
13. [Extensões futuras (deferred)](#extensões-futuras-deferred)
14. [Licença](#licença)

---

## O que o agente faz

Um ciclo típico do pipeline de notícias:

```
cron dispara (a cada 10 min em pregão)
    ↓
guard de pregão (dia útil + 9h-18h BRT + não-feriado)
    ↓
fetch em paralelo (RSS + NewsAPI + Finnhub)
    ↓
filterByAge (drop items > 24h — evita alerta velho)
    ↓
filterUnseen (dedup SHA1 do link via SQLite)
    ↓
classifyBatch (LLM MimoV2, chunks de 5, retry+backoff)
    ↓
notify Discord (só se impacto = alto ou medio)
    ↓
save + markNotified (SQLite persistente no volume)
```

Objetivo: receber alertas rápidos (5-15 min de latência) sobre eventos que movimentam o mercado brasileiro — geopolítica, decisões do Copom, dados macro, resultados de empresas, fatos relevantes na CVM.

---

## Arquitetura

### 3 pipelines independentes

| Pipeline | Cadência | Fontes | Guard pregão? |
|---|---|---|---|
| `runNewsPipeline` | `*/10 * * * *` (a cada 10 min) | RSS + NewsAPI + Finnhub | Sim — só roda em horário útil |
| `runCvmPipeline` | `0 6 * * *` (diário 6h BRT) | CVM (fatos relevantes) | Não — fato relevante vale 24/7 |
| `runMacroPipeline` | `0 8 * * *` (diário 8h BRT) | BCB (Selic/IPCA) + IBGE (Desemprego) | Não — dado macro vale 24/7 |

Um 4º cron diário às 5h BRT roda `refreshFeriados` pra manter o cache do BrasilAPI atualizado.

### Módulos de fonte (10 total)

**Retornam `NewsItem[]` — consumidos pelos pipelines:**

- `sources/rss.ts` — 4 portais BR (InfoMoney, Valor Econômico, Money Times, Brazil Journal) via `rss-parser`
- `sources/newsapi.ts` — NewsAPI com filtro `B3 OR Ibovespa OR Petrobras OR Vale` em PT
- `sources/finnhub.ts` — notícias de mercado internacional
- `sources/cvm.ts` — zip anual do CVM Dados Abertos → CSV Windows-1252 → filtro `Categoria='Fato Relevante'` últimas 48h
- `sources/bcb.ts` — 3 endpoints em paralelo: Selic (SGS 432), IPCA (SGS 433), próxima reunião Copom
- `sources/ibge.ts` — PIB (agregado 6613) + Desemprego (agregado 6381) via SIDRA v3

**Não retornam `NewsItem[]` — reference/on-demand:**

- `sources/brasilapi.ts` — feriados nacionais → SQLite. Expõe `refreshFeriados(ano)` e `isHoliday(date)` pro guard de pregão
- `sources/alphavantage.ts` — cotação sob demanda por ticker. Expõe `getQuote(ticker)`. Reservado pra enriquecimento futuro de alertas

**Preparados mas não wired:**

- `sources/massive.ts` — não implementado (Massive só cobre US/crypto/forex, não bate com escopo BR)

### Núcleo do pipeline (`src/core/`)

- `dedup.ts` — hash SHA1 do link (normalizado: trim + lowercase) + consulta SQLite `isSeen`
- `throttle.ts` — rate limiter in-memory por fonte. Registrados: `alphavantage` (5/min + 25/dia), `newsapi` (100/dia), `finnhub` (60/min)
- `pregao.ts` — `shouldRunPipeline()` combina PREGAO_ONLY + hora SP + dia semana + isHoliday
- `pipeline.ts` — orquestração dos 3 pipelines + helper `classifyAndPartition` compartilhado + filtro de idade

### LLM (`src/llm/mimo.ts`)

Chama endpoint OpenAI-compatible (`/chat/completions`) com JSON forçado. Schema `zod` valida cada classificação:

```
{
  impacto: 'alto' | 'medio' | 'baixo' | 'nenhum',
  tickers_afetados: string[],
  setores: string[],
  direcao: 'positivo' | 'negativo' | 'neutro',
  resumo: string
}
```

Retry+backoff (1s → 2s → 4s) em 429/5xx. Zod fail e length mismatch são não-retryáveis (drop imediato). `direcao` é sempre **perspectiva da empresa/setor no curto prazo**, não macro (esclarecido no prompt).

### Notificação (`src/notify/discord.ts`)

Embed colorido por direção: verde (positivo) / vermelho (negativo) / cinza (neutro). Campos Impacto/Tickers/Direção/Fonte, footer com timestamp em BRT via `Intl.DateTimeFormat('pt-BR')`. Se `DISCORD_WEBHOOK_URL_ALTO` estiver setado, alertas `impacto=alto` vão pra lá com `@everyone`. Redação do token do webhook em qualquer log de erro.

### Persistência (`src/db/sqlite.ts`)

SQLite via `better-sqlite3` (síncrono). Duas tabelas:

- `news` — histórico do que foi visto/classificado/notificado. Cresce ilimitado (retention pode ser adicionada quando o arquivo passar de ~500 MB)
- `feriados` — cache dos feriados nacionais do ano (populado por `refreshFeriados`)

Funções expostas: `isSeen(hash)`, `save(record)` (idempotente via `INSERT OR IGNORE`), `markNotified(hash)`, `isDateFeriado(dateYmd)`, `upsertFeriado(row)`.

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
│   │   ├── brasilapi.ts       — feriados (refresh + lookup, não NewsItem)
│   │   └── alphavantage.ts    — cotação on-demand (getQuote, não NewsItem)
│   ├── llm/
│   │   └── mimo.ts            — cliente MimoV2 + zod + batch + retry
│   ├── notify/
│   │   └── discord.ts         — embed + rate-limit handling + token redaction
│   ├── db/
│   │   └── sqlite.ts          — schema news + feriados, prepared statements
│   ├── core/
│   │   ├── pipeline.ts        — 3 pipelines + classifyAndPartition + filterByAge
│   │   ├── dedup.ts           — hash + filterUnseen
│   │   ├── throttle.ts        — withRateLimit por fonte
│   │   └── pregao.ts          — isDuringPregao + shouldRunPipeline
│   ├── config.ts              — validação do .env com zod (single source of truth)
│   ├── logger.ts              — pino (pretty em dev, JSON em prod)
│   ├── index.ts               — boot + node-cron (daemon 24/7)
│   └── once.ts                — roda os 3 pipelines uma vez e sai (debug)
├── data/                       — SQLite local (gitignored)
├── docs/
│   └── FEATURE-MAP.md         — mapa de features (opcional)
├── fly.toml                    — config Fly.io (região gru, volume data, sem http_service)
├── Dockerfile                  — build multi-stage Node 22, DB_PATH=/data/news.db
├── .env.example                — todas as env vars com defaults
├── docinfoprojeto.md           — spec original do projeto
├── TASKS.md                    — backlog (todas as 26 tasks marcadas)
├── package.json
└── tsconfig.json
```

---

## Decisões de projeto (com o porquê)

Estas são decisões **conscientemente tomadas**, muitas contra o que o `docinfoprojeto.md` original pedia. Estão documentadas aqui pra evitar re-litígio.

### 1. Fly.io como plataforma de deploy

**Escolhido em vez de:** Railway, VPS (Hetzner/Contabo/Oracle Free Tier), PC local sempre ligado.

**Por quê:** free tier permanentemente gratuito (3 shared-cpu-1x 256MB + 3GB volume), primary_region `gru` (São Paulo — baixa latência pros feeds BR e CVM), volume persistente pra SQLite, deploy em 1 comando (`fly deploy`).

**Trade-off aceito:** exige cartão de crédito no cadastro (validação anti-abuso). Free tier fica realmente gratuito enquanto usar dentro dos limites.

### 2. Sem `[http_service]` no `fly.toml`

**O que:** removido o bloco padrão que o `fly launch` gerou.

**Por quê:** marcobroker é daemon cron-driven, não HTTP server. Com `[http_service]`, Fly assume que a máquina só deve rodar quando tem tráfego HTTP → auto-stop → cron nunca dispara. Sem o bloco, Fly deixa a Machine rodando.

### 3. LLM: OpenCode Zen com modelo `mimo-v2.5-free`

**Escolhido em vez de:** OpenAI, Anthropic direto, Groq, DeepSeek.

**Por quê:** já tenho conta OpenCode (usada pra outros fins), key reaproveitada. Free tier suficiente pro volume (~50-300 classificações/dia). Endpoint OpenAI-compatible facilita troca no futuro se necessário.

**Gotcha registrado:** endpoint `/models` do Zen aceita a key, mas `/chat/completions` retorna 401 se o modelo slug estiver errado. Slug correto é `mimo-v2.5-free` (não `mimo-v2`, nem `mimo`).

### 4. Discord agora, Telegram deferred

**O que:** implementado só `notify/discord.ts`. `notify/telegram.ts` planejado mas não construído.

**Por quê:** Discord basta pro MVP — canal com embed colorido, `@everyone` em impacto alto, mobile push nativo do app. Adicionar Telegram no pipeline duplica complexidade (`Promise.allSettled` entre 2 notifiers) sem ganho real de sinal. Se um dia quiser redundância ou push separado, `notify/telegram.ts` deve mirrorar exatamente o contrato de `notify/discord.ts` (`sendTelegramAlert(item): Promise<boolean>`, skip com token vazio).

### 5. Massive skipped

**O que:** `MASSIVE_API_KEY` fica no `.env` mas nenhum código consome.

**Por quê:** análise dos docs do Massive (`https://massive.com/docs/llms.txt`) confirmou zero cobertura BR — só US stocks, options, forex, crypto, futures. Adicionar uma fonte que só traz US news pra um agente de bolsa BR queimaria tokens LLM classificando ruído. Key permanece caso um dia expanda pra cobertura US.

### 6. `PREGAO_ONLY=true` em produção

**Por quê:** classificar notícia às 3h da manhã queima quota LLM sem chance de reação humana. Fato relevante da CVM e macro data seguem próprios pipelines diários que ignoram o guard (têm valor 24/7). News pipeline respeita — só roda 9h-18h BRT em dia útil não-feriado.

### 7. `CRON_SCHEDULE_CVM=0 6 * * *` (diário, não 15min)

**Por quê:** CVM regenera o zip IPE **semanalmente** (aos sábados/domingos). Polling de 15 em 15 min baixaria o mesmo arquivo multi-MB 96 vezes por dia com **zero dado novo**. Diário às 6h basta — pega o refresh semanal quando existir, ignora o resto.

### 8. Age filter (`MAX_ITEM_AGE_HOURS=24`)

**Por quê:** RSS do Valor retorna 100 headlines indo até semanas atrás. NewsAPI ordena por data mas não corta janela. Sem filtro, o pipeline classificava notícia de 3 dias atrás — alerta velho, LLM desperdiçado. Com filter de 24h no início do `classifyAndPartition`, cortamos ~60-80% do lixo antes do dedup e LLM.

Data inválida ou futura → mantém item (safer default — BCB às vezes manda datas futuras).

### 9. `direcao` é perspectiva-empresa, não macro

**Por quê:** primeiro teste do LLM classificou "aumento do diesel pela Petrobras" como `direcao: positivo` (bom pra margem de PETR4) mesmo sendo macro-negativo (inflação). Nenhuma leitura está errada — o prompt não desambiguava. Frase adicionada ao `SYSTEM_PROMPT`:

> `direcao` é o efeito esperado sobre o preço da ação ou setor citado no curto prazo (positivo = tende a subir, negativo = tende a cair, neutro = sem direção clara), não o efeito macroeconômico.

### 10. Alpha Vantage como enriquecimento on-demand (não fonte de news pipeline)

**Por quê:** Alpha Vantage free tier tem cotação BR (`PETR4.SAO` funciona), mas rate limit é agressivo: 25 req/dia, 5 req/min. Chamar como fonte periódica queimaria quota sem valor. Faz mais sentido usar sob demanda, chamando `getQuote(ticker)` quando um alerta de impacto alto for enviado, pra anexar preço atual. Wire desse enriquecimento fica pra iteração futura.

### 11. Filtro semântico de duplicatas: **deixado como está**

**Por quê:** dedup atual é por SHA1 do link. Se InfoMoney e Money Times cobrem o mesmo evento com URLs diferentes, geram 2 alertas separados. Isso é conscientemente aceito — 2 portais reportando a mesma coisa é validação, não spam. Dedup semântico (embedding similarity, LLM comparação) adicionaria complexidade sem ganho claro pro caso pessoal.

### 12. Retention do SQLite: **não implementado**

**Por quê:** SQLite aguenta milhões de linhas. Com dedup + age filter, o crescimento realista é 500-2000 rows/dia. Volume Fly de 1GB dá pra anos. Só implementar `DELETE FROM news WHERE seen_at < date('now','-90 days')` quando o arquivo passar de ~500MB. Até lá, YAGNI.

### 13. Dashboard web: **deferred**

**Por quê:** Discord + `flyctl logs` já resolvem "ver alertas" e "ver histórico". Um dashboard "editável por non-tech" transformaria daemon simples em web app (config mutável em runtime, HTTP server, auth, UI) — 8-12 dias de trabalho pra single-user, 20-30 pra multi-user. Fora do escopo do MVP. Alternativa mais barata se algum dia quiser: config em YAML/JSON commitado no git, edita via GitHub UI, redeploy automático — 1-2 dias, sem virar web app.

---

## Requisitos

- **Node.js 20+**
- **Uma chave OpenCode Zen** (obrigatório — sem ela o LLM não classifica e nada é notificado)
- **Um webhook Discord** (obrigatório — sem ele o pipeline classifica mas não notifica)
- **Opcionais** (o pipeline degrada silenciosamente sem eles):
  - `NEWSAPI_KEY` — sem ela, `sources/newsapi` retorna vazio
  - `FINNHUB_API_KEY` — sem ela, `sources/finnhub` retorna vazio
  - `ALPHAVANTAGE_API_KEY` — só usada pelo módulo on-demand (não afeta pipeline principal ainda)

---

## Setup local

1. **Clonar:**
   ```bash
   git clone https://github.com/JoaoVieiraM/MarcoBrokerNews.git
   cd MarcoBrokerNews
   ```

2. **Instalar deps:**
   ```bash
   npm install
   ```

3. **Criar `.env`:**
   ```bash
   cp .env.example .env
   ```
   No Windows CMD: `copy .env.example .env`

4. **Editar `.env` com os valores obrigatórios:**
   ```env
   MIMO_API_KEY=<sua_key_opencode_zen>
   MIMO_BASE_URL=https://opencode.ai/zen/v1
   MIMO_MODEL=mimo-v2.5-free
   DISCORD_WEBHOOK_URL=<url_do_seu_webhook_discord>
   ```

5. **Rodar uma vez (sem cron) pra validar:**
   ```bash
   npm run once
   ```
   Espera ver: `OnceBoot` → `BrasilapiFetched` → logs dos 3 pipelines → `OnceFinished`. Se alertas chegarem no Discord, tá tudo redondo.

6. **Iniciar o daemon com hot-reload:**
   ```bash
   npm run dev
   ```
   Fica rodando até Ctrl+C. Cron dispara conforme os schedules.

---

## Variáveis de ambiente

| Variável | Descrição | Obrigatória | Default |
|---|---|---|---|
| `MIMO_API_KEY` | Chave da API OpenCode Zen | Sim | - |
| `MIMO_MODEL` | Modelo LLM | Não | `mimo-v2.5-free` |
| `MIMO_BASE_URL` | Endpoint OpenAI-compatible | Sim | - |
| `MIMO_RPM` | Requests per minute alvo (não enforçado hoje, retry+backoff cobre 429) | Não | `10` |
| `NEWSAPI_KEY` | Chave NewsAPI (100 req/dia free) | Não | - |
| `FINNHUB_API_KEY` | Chave Finnhub (60 req/min free) | Não | - |
| `ALPHAVANTAGE_API_KEY` | Chave Alpha Vantage (25 req/dia + 5 req/min free) | Não | - |
| `MASSIVE_API_KEY` | Chave Massive (não usada — fonte skipped) | Não | - |
| `DISCORD_WEBHOOK_URL` | Webhook principal para alertas | Sim | - |
| `DISCORD_WEBHOOK_URL_ALTO` | Webhook separado pra impacto alto (com `@everyone`) | Não | - |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram (não implementado — placeholder pra futuro) | Não | - |
| `TELEGRAM_CHAT_ID` | ID chat Telegram (não implementado) | Não | - |
| `CRON_SCHEDULE` | Cron do pipeline de news | Não | `*/10 * * * *` |
| `CRON_SCHEDULE_CVM` | Cron do pipeline CVM | Não | `0 6 * * *` |
| `CRON_SCHEDULE_MACRO` | Cron do pipeline macro | Não | `0 8 * * *` |
| `PREGAO_ONLY` | Só rodar news em horário de pregão (9-18h BRT dia útil não-feriado) | Não | `true` |
| `TIMEZONE` | Fuso horário dos crons | Não | `America/Sao_Paulo` |
| `KEYWORD_PREFILTER` | Pré-filtro por keywords (reservado — não implementado ativamente) | Não | `true` |
| `MAX_ITEM_AGE_HOURS` | Idade máxima de item antes do LLM | Não | `24` |
| `DB_PATH` | Caminho do SQLite | Não | `./data/news.db` (prod: `/data/news.db`) |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` | Não | `info` |
| `NODE_ENV` | `development` \| `production` \| `test` | Não | `development` |

Quando `DISCORD_WEBHOOK_URL_ALTO` está vazio, alertas de alto impacto caem no webhook principal sem `@everyone`.

---

## Comandos npm

| Comando | O que faz |
|---|---|
| `npm run dev` | Daemon com hot-reload via `tsx watch src/index.ts` |
| `npm run once` | Roda os 3 pipelines uma vez sequencialmente e sai |
| `npm run build` | Compila TypeScript (`tsc`) → `dist/` |
| `npm start` | Roda o build de produção: `node dist/index.js` (usado pelo Dockerfile) |
| `npm run lint` | ESLint no `src/**/*.ts` |
| `npm run format` | Prettier no `src/**/*.ts` |

---

## Deploy no Fly.io

Assumindo que você já tem `flyctl` instalado e logado (`flyctl auth login`).

### Primeira vez

1. **Criar volume persistente** (pra SQLite sobreviver deploys):
   ```bash
   flyctl volumes create data --region gru --size 1
   ```

2. **Setar secrets** (colar seus valores):
   ```bash
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
   ```

3. **Deploy:**
   ```bash
   flyctl deploy
   ```

4. **Confirmar boot:**
   ```bash
   flyctl logs
   ```
   Esperar por `Boot` + `BrasilapiFetched` + 4× `CronScheduled`.

### Gotcha: máquina inicial vai pra região errada

O `fly launch` cria uma máquina na região default (`iad`) antes de você editar `fly.toml`. Editar `primary_region = 'gru'` depois **não move a máquina**. Fix:

```bash
flyctl machine list
flyctl machine destroy <id-da-máquina-em-iad> --force
flyctl deploy
```

Novo deploy sem máquina existente cria em `gru` e auto-monta o volume que também está em `gru`.

### Gotcha: trial mode limita máquina a 5 min

Contas sem cartão de crédito registrado estão em trial mode: cada máquina é parada automaticamente após 5 minutos com log `Trial machine stopping. To run for longer than 5m0s, add a credit card by visiting https://fly.io/trial.`

Fix: adicionar cartão em `https://fly.io/trial`. Fly **não cobra** enquanto uso ficar no free tier. Cartão é validação anti-abuso.

### Deploys subsequentes

Basta:
```bash
flyctl deploy
```

Se só mudou secret sem tocar em código:
```bash
flyctl secrets set NOVA_VAR=valor
```
(secret update reinicia a máquina automaticamente)

---

## Gerenciamento de custo

### Free tier do Fly cobre folgado

- **3 machines shared-cpu-1x 256MB grátis** — a gente usa 1
- **3GB de volumes grátis** — a gente usa 1GB
- **160GB outbound bandwidth grátis** — praticamente nada saindo (não é HTTP server)

Custo esperado: **$0/mês permanentemente**.

### Como não estourar

1. **Não escalar RAM.** Se mudar `memory` no `fly.toml` pra `1gb`, sai do free tier ($3-5/mês). Node cabe em 256MB.
2. **Não adicionar máquinas.** `flyctl scale count 2` = paga a segunda.
3. **Não crescer volume > 3GB.** SQLite provavelmente nunca chega lá com dedup + age filter.
4. **Não adicionar serviços Fly pagos** (Postgres, Redis, LiteFS gerenciado). Não precisamos.

### Spending limit (freio de emergência)

Recomendado: setar hard limit no dashboard Fly:

- Abrir `https://fly.io/dashboard/personal/billing`
- Seção **Spending Limit** → coloca `$1/month`
- Se por qualquer motivo o uso ultrapassar, Fly **suspende** máquinas antes de cobrar

### Monitoramento

Uma vez por mês:
```bash
flyctl dashboard
```
Ver seção **Usage** — se qualquer barra estiver > 50%, investigar.

---

## Como pausar e retomar

Se sair de férias, quiser parar de gastar, ou só descansar do projeto:

**Pausar (0 compute, mantém volume + secrets + config):**
```bash
flyctl scale count 0
```

**Retomar:**
```bash
flyctl scale count 1
```
Ou:
```bash
flyctl deploy
```

Ao retomar após dias parado, o daemon vai processar **as últimas 24h** de notícias que estavam nos feeds (age filter) — pode gerar uma pequena avalanche de alertas de "catch-up". Se planeja pausar por muitos dias e quer minimizar isso ao voltar, temporariamente baixe a janela:

```bash
flyctl secrets set MAX_ITEM_AGE_HOURS=6
flyctl scale count 1
# depois de estabilizar:
flyctl secrets set MAX_ITEM_AGE_HOURS=24
```

---

## Limitações conhecidas

Coisas que **não são bugs nossos** mas afetam o produto:

- **Endpoint BCB Copom retorna 404.** O path `https://olinda.bcb.gov.br/olinda/servico/CalendarioCopom/versao/v1/odata/CalendarioCopom` que estava documentado retorna 404. Provavelmente movido/renomeado. `runMacroPipeline` continua rodando com Selic + IPCA + IBGE Desemprego — apenas a próxima reunião do Copom não é anunciada.

- **Endpoint IBGE PIB retorna 500.** SIDRA agregado 6613 (variável 9808 — variação trimestral do PIB) retorna 500 pra qualquer período. Confirmado via `curl` direto — problema do lado do IBGE. `ibge.ts` continua entregando Taxa de Desocupação normal.

- **CVM atualiza o zip semanalmente.** Fatos relevantes ganham latência de dias — publicados no site em tempo real, mas o dataset agregado que a gente puxa só é regenerado aos fins de semana. Solução futura possível: trocar por scraping do RSS oficial da CVM (mais complexo, mas em tempo real).

- **Alpha Vantage free tier é agressivo.** 25 req/dia + 5 req/min. Por isso está como enriquecimento on-demand, não como fonte periódica.

- **MimoV2 free tier via OpenCode Zen.** Rate limits do provider não documentados publicamente. Backoff automático segura, mas se um dia apertar, `MIMO_RPM` está pronto pra ser enforçado no código.

- **`flyctl logs` mostra tudo em UTC.** É o viewer da Fly, não a gente. Nossos alertas Discord e outros timestamps user-facing já usam BRT via `Intl.DateTimeFormat`.

- **Trial mode do Fly requer cartão.** Ver [Deploy no Fly.io](#deploy-no-flyio). Sem cartão, máquina morre a cada 5 min.

---

<div align="center">
  <img src="src/assets/fotoreadme2.png" width="280" alt="Marco Antônio, mascote do marcobroker" />
</div>

## Extensões futuras (deferred)

Ideias considerdas mas **não implementadas** de propósito:

- **Telegram notifier** — `notify/telegram.ts` planejado. Só faz sentido se quiser redundância além do Discord.
- **Dashboard web** — página friendly pra non-tech user editar prompt e config. Analisado que custo em complexidade (2-3 semanas de trabalho pra versão multi-user) supera ganho vs Discord + logs.
- **Retention automática do SQLite** — só quando o arquivo passar de ~500MB.
- **Enriquecimento on-demand com Alpha Vantage** — chamar `getQuote(ticker)` ao notificar impacto alto e anexar preço atual no embed.
- **Fontes adicionais:** Twitter/X (breaking news de contas de analistas), Reddit BR-invest, YouTube canais financeiros. Se um dia adicionar, seguir o mesmo pattern dos sources existentes (`fetchAll(): Promise<NewsItem[]>`).
- **Dedup semântico** — hoje é por hash de link. 2 portais reportando o mesmo evento com URLs diferentes gera 2 alertas. Aceito como "validação por múltiplas fontes", não como bug.
- **Massive** como fonte de expansão pra cobertura US (a key está guardada). Só se um dia o projeto crescer pra cobrir mercado americano.
- **Cron mais frequente (`*/5` ou menos)** — `*/5` é meio termo seguro. Sub-5-min estoura NewsAPI free tier e não traz ganho de latência real.

---

## Licença

Sem licença definida — projeto pessoal.
