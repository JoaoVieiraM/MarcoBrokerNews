# Agente de Notícias da Bolsa BR → Discord/Telegram

Projeto de um agente em TypeScript que monitora notícias e dados que impactam a bolsa brasileira (B3), classifica relevância via LLM (MimoV2) e envia alertas em tempo quase real para Discord ou Telegram.

## Objetivo

Receber alertas rápidos (5–15 min de latência) sobre eventos que movimentam o mercado brasileiro: geopolítica (ex: conflito no Oriente Médio → petróleo → PETR4/PRIO3), decisões do Copom, dados macro, resultados de empresas, fatos relevantes na CVM, etc.

**Escopo:** ferramenta pessoal de acompanhamento. Não é para day trade de alta frequência.

---

## Princípios do projeto (leia antes de codar)

Estes princípios valem para **todo commit** e devem guiar decisões de design. Se algo neste doc conflitar com eles, os princípios ganham.

### 1. Clean Code
- Nomes descritivos em inglês para código, português é aceitável em textos de UI/mensagens
- Funções pequenas e com responsabilidade única (regra prática: se precisa rolar a tela pra ler, quebra)
- Evitar comentários que explicam **o que** o código faz — o código deve dizer isso sozinho. Comentário só pra explicar **por quê** de uma decisão não óbvia
- Sem código morto, sem `console.log` esquecido, sem `any` gratuito no TypeScript
- Formatação consistente: `prettier` + `eslint` configurados desde o dia 1

### 2. Sem overengineering
- **YAGNI** (You Aren't Gonna Need It): não criar abstração para 1 uso. Só extrair quando aparecer o segundo caso concreto
- Nada de DDD, hexagonal, clean architecture cheia de camadas para um projeto desse porte. Módulos simples e coesos bastam
- Sem framework de DI, sem factory de factory, sem interface para tudo. Classe/função concreta até doer
- Preferir biblioteca pequena e direta a framework grande. Ex: `axios` cru em vez de wrapper HTTP customizado
- Se der pra resolver com uma função de 20 linhas, resolve com uma função de 20 linhas
- Otimização vem depois de funcionar. Perfil primeiro, otimiza depois

### 3. Trabalho dividido por tasks
- **Toda mudança nasce como uma task pequena e fechada**, com critério de aceite claro
- Uma task = um PR = um commit lógico (squash na hora do merge se precisar)
- Task grande demais? Quebra em subtasks antes de começar a codar
- Formato sugerido pra descrever task:
  ```
  Título: [módulo] verbo objetivo
  Contexto: 1–2 linhas
  Aceite:
    - [ ] critério objetivo 1
    - [ ] critério objetivo 2
  Fora de escopo: o que NÃO faz parte
  ```
- Manter lista viva em `TASKS.md` na raiz, ou em issues do repositório
- **Nunca começar task 2 sem terminar task 1.** Terminar = mergeado e rodando

### 4. Complementares
- **Fail loud em dev, fail safe em prod:** exceções devem quebrar em dev, mas em prod logar e seguir (um feed quebrado não pode derrubar o pipeline)
- **Idempotência sempre:** rodar 2x seguidas nunca gera efeito colateral duplicado (notificação repetida, gravação dupla)
- **Config no `.env`, nunca hardcoded:** URL, token, cron, RPM, tudo
- **Log estruturado** desde o começo (`pino` é suficiente)
- **Um commit não deixa o `main` quebrado.** Se quebrou, reverte antes de consertar

---

## Stack

- **Runtime:** Node.js 20+ com TypeScript (usar `tsx` para dev)
- **HTTP:** `axios`
- **RSS:** `rss-parser`
- **LLM:** MimoV2 (free tier) via HTTP
- **Storage:** SQLite via `better-sqlite3`
- **Scheduler:** `node-cron`
- **Validação:** `zod` (para respostas do LLM e config)
- **Log:** `pino`
- **Config:** `dotenv`
- **Notificação:** Webhook do Discord e Bot API do Telegram

---

## Fontes de dados (APIs)

| Serviço | Uso no projeto | Auth | Link |
|---|---|---|---|
| **NewsAPI** | Notícias globais e BR. Filtro sugerido: `B3 OR "Ibovespa" OR "Petrobras" OR "Vale"` | API key (free tier) | https://newsapi.org/ |
| **Finnhub** | Notícias de mercado internacional, cotações, calendário econômico | API key (free tier) | https://finnhub.io/dashboard |
| **Alpha Vantage** | Cotações e indicadores técnicos (fallback / enriquecimento) | API key (free tier, 25 req/dia) | https://www.alphavantage.co/support/#api-key |
| **Massive** | Fonte adicional de dados/notícias | API key | https://massive.com/dashboard |
| **CVM Dados Abertos** | Fatos relevantes, comunicados ao mercado, IPE, ITR/DFP | Pública, sem key | https://dados.cvm.gov.br/ |
| **BrasilAPI** | CNPJ, feriados nacionais (útil pra guard de pregão), taxas | Pública, sem key | https://brasilapi.com.br/docs |
| **BCB Dados Abertos** | Selic, IPCA, câmbio, agenda Copom | Pública, sem key | https://dadosabertos.bcb.gov.br/ |
| **IBGE (via gov.br Conecta)** | Indicadores macro (PIB, desemprego, inflação) | Pública | https://www.gov.br/conecta/catalogo/apis/metadados-estatisticos-do-ibge |
| **RSS de portais BR** | InfoMoney, Valor, Money Times, Brazil Journal | Pública | vários |

### Estratégia por fonte

- **Notícias em tempo real:** RSS dos portais BR + NewsAPI + Finnhub (roda no cron principal, a cada 10 min)
- **CVM (fatos relevantes):** cron separado a cada 15–30 min, dentro do horário de pregão
- **BCB / IBGE / Alpha Vantage:** cron diário (dados macro mudam devagar)
- **BrasilAPI feriados:** consultado 1x/dia pra popular cache local de dias sem pregão
- **Cotações (Finnhub/Alpha Vantage):** sob demanda, apenas para enriquecer alertas de impacto alto/médio

### Cuidados com rate limit das APIs

Cada API tem seu limite. Manter em `src/config.ts` um mapa `RATE_LIMITS` e usar um throttler por fonte. Alpha Vantage é o mais restritivo (25/dia no free) — usar só como fallback.

---

## Estrutura de pastas

```
.
├── src/
│   ├── sources/
│   │   ├── rss.ts              # feeds RSS dos portais BR
│   │   ├── newsapi.ts
│   │   ├── finnhub.ts
│   │   ├── alphavantage.ts
│   │   ├── massive.ts
│   │   ├── cvm.ts              # fatos relevantes
│   │   ├── bcb.ts              # Selic, IPCA, agenda Copom
│   │   ├── ibge.ts
│   │   ├── brasilapi.ts        # feriados
│   │   └── feeds.ts            # lista de RSS URLs
│   ├── llm/
│   │   └── mimo.ts             # wrapper MimoV2 + schema zod
│   ├── notify/
│   │   ├── discord.ts
│   │   └── telegram.ts
│   ├── db/
│   │   └── sqlite.ts
│   ├── core/
│   │   ├── pipeline.ts         # orquestração
│   │   ├── dedup.ts            # hash + checagem
│   │   ├── throttle.ts         # rate limiting genérico
│   │   └── pregao.ts           # guard de horário/feriados
│   ├── config.ts
│   ├── logger.ts
│   └── index.ts                # boot + cron
├── data/
│   └── news.db                 # gitignored
├── TASKS.md                    # lista viva de tasks
├── .env.example
├── .gitignore
├── .prettierrc
├── .eslintrc.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## Fluxo do pipeline principal

1. **Cron dispara** a cada N min (default 10)
2. **Guard de pregão:** se `PREGAO_ONLY=true`, checa horário (9h–18h BRT) e feriado (BrasilAPI cacheada). Sai cedo se fora do horário.
3. **Coleta paralela:** todas as fontes de notícia ativas retornam `NewsItem[]` normalizado:
   ```ts
   type NewsItem = {
     link: string
     title: string
     source: string
     publishedAt: string
     snippet: string
   }
   ```
4. **Dedup:** hash SHA1 do link, consulta SQLite, remove os já vistos
5. **Pré-filtro por keyword** (opcional, `KEYWORD_PREFILTER=true`): regex de termos-chave. Marca como visto sem chamar LLM se não bate.
6. **Classificação LLM (MimoV2)** em batch (até 5 por prompt). Resposta validada com `zod`:
   ```ts
   {
     impacto: 'alto' | 'medio' | 'baixo' | 'nenhum',
     tickers_afetados: string[],
     setores: string[],
     direcao: 'positivo' | 'negativo' | 'neutro',
     resumo: string
   }
   ```
7. **Decisão:** notifica se `impacto` é `alto` ou `medio`
8. **Notifica:** Discord (embed colorido) e/ou Telegram (Markdown)
9. **Persiste:** grava no SQLite marcando `notified=1`

Pipeline separado para CVM roda em paralelo com fluxo similar, mas fonte fixa.

---

## Variáveis de ambiente (`.env.example`)

```
# LLM
MIMO_API_KEY=
MIMO_MODEL=mimo-v2
MIMO_BASE_URL=
MIMO_RPM=10

# APIs de dados
NEWSAPI_KEY=
FINNHUB_API_KEY=
ALPHAVANTAGE_API_KEY=
MASSIVE_API_KEY=

# Notificação
DISCORD_WEBHOOK_URL=
DISCORD_WEBHOOK_URL_ALTO=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Pipeline
CRON_SCHEDULE=*/10 * * * *
CRON_SCHEDULE_CVM=*/15 * * * *
CRON_SCHEDULE_MACRO=0 8 * * *
PREGAO_ONLY=true
TIMEZONE=America/Sao_Paulo
KEYWORD_PREFILTER=true

# Storage
DB_PATH=./data/news.db

# Log
LOG_LEVEL=info
NODE_ENV=development
```

---

## Schema SQLite

```sql
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT UNIQUE NOT NULL,
  link TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  published_at TEXT,
  seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  impacto TEXT,
  tickers TEXT,
  setores TEXT,
  direcao TEXT,
  resumo_llm TEXT,
  notified INTEGER DEFAULT 0
);

CREATE INDEX idx_news_hash ON news(hash);
CREATE INDEX idx_news_seen ON news(seen_at);

CREATE TABLE IF NOT EXISTS feriados (
  data TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## Formatos de notificação

**Discord** — embed com:
- Título com link
- Cor: verde (positivo) / vermelho (negativo) / cinza (neutro)
- Campos: Impacto, Tickers, Direção, Fonte
- Descrição: resumo do LLM
- Footer: timestamp
- Impacto `alto` → menciona `@everyone` no canal dedicado

**Telegram** — Markdown:
```
*[ALTO IMPACTO]* 🔴
*PETR4, PRIO3* — negativo

Bombardeio no Irã eleva risco geopolítico e pressiona petróleo.

[Ler no InfoMoney](https://...)
```

---

## Backlog inicial de tasks

Copiar isso para `TASKS.md` e ir marcando. **Fazer na ordem, uma por vez.**

### Fase 1 — Fundação
- [ ] **T-01** Setup do projeto (`package.json`, `tsconfig.json`, `.gitignore`, `prettier`, `eslint`, scripts npm)
- [ ] **T-02** `config.ts` carregando `.env` e validando com `zod`
- [ ] **T-03** `logger.ts` com `pino` (pretty em dev, JSON em prod)
- [ ] **T-04** `db/sqlite.ts` com init de schema e funções `isSeen`, `save`, `markNotified`

### Fase 2 — Coleta
- [ ] **T-05** `sources/rss.ts` com `fetchAll()` normalizado + lista em `feeds.ts`
- [ ] **T-06** `sources/newsapi.ts`
- [ ] **T-07** `sources/finnhub.ts`
- [ ] **T-08** `sources/cvm.ts` (fatos relevantes)
- [ ] **T-09** `sources/brasilapi.ts` (feriados + cache)
- [ ] **T-10** `sources/bcb.ts` (Selic/IPCA/agenda Copom)
- [ ] **T-11** `sources/ibge.ts`
- [ ] **T-12** `sources/alphavantage.ts` (usado sob demanda)
- [ ] **T-13** `sources/massive.ts`

### Fase 3 — Núcleo
- [ ] **T-14** `core/dedup.ts` (hash + integração com SQLite)
- [ ] **T-15** `core/throttle.ts` (rate limit por fonte)
- [ ] **T-16** `core/pregao.ts` (guard horário + feriados)
- [ ] **T-17** `llm/mimo.ts` com prompt, batch, validação zod, retry+backoff

### Fase 4 — Saída
- [ ] **T-18** `notify/discord.ts` (embed)
- [ ] **T-19** `notify/telegram.ts` (Markdown)

### Fase 5 — Orquestração
- [ ] **T-20** `core/pipeline.ts` (fluxo notícias)
- [ ] **T-21** Pipeline separado pra CVM
- [ ] **T-22** Pipeline separado pra macro (diário)
- [ ] **T-23** `index.ts` com `node-cron` e boot

### Fase 6 — Operação
- [ ] **T-24** Script `npm run once` (roda 1x sem cron pra debug)
- [ ] **T-25** README com instruções de setup e deploy
- [ ] **T-26** Deploy em Railway/Fly.io/VPS

**Critério de aceite genérico para toda task:** compila sem erro, sem `any` novo, sem console.log, roda `npm run dev` sem crash, tem pelo menos um teste manual documentado no PR.

---

## Comandos

```bash
npm run dev        # tsx watch
npm run once       # pipeline 1x sem cron
npm run build      # tsc
npm start          # node dist/index.js
npm run lint
npm run format
```

---

## Extensões futuras (não fazer agora)

- Twitter/X (contas de breaking news)
- Filtro por carteira pessoal
- Dashboard web de histórico
- Resumo diário 18h30
- Fallback pra Llama local (Ollama) quando estourar rate limit
- Alertas por preço (cotação cruza X)
