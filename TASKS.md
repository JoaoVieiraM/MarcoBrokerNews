# TASKS

Lista viva de tasks do projeto. **Fazer na ordem, uma por vez.** Nunca começar task 2 sem terminar task 1 (terminar = mergeado e rodando).

**Critério de aceite genérico para toda task:** compila sem erro, sem `any` novo, sem `console.log`, roda `npm run dev` sem crash, tem pelo menos um teste manual documentado no PR.

---

## Fase 1 — Fundação

- [x] **T-01** Setup do projeto (`package.json`, `tsconfig.json`, `.gitignore`, `prettier`, `eslint`, scripts npm)
- [x] **T-02** `config.ts` carregando `.env` e validando com `zod`
- [x] **T-03** `logger.ts` com `pino` (pretty em dev, JSON em prod)
- [x] **T-04** `db/sqlite.ts` com init de schema e funções `isSeen`, `save`, `markNotified`

## Fase 2 — Coleta

- [x] **T-05** `sources/rss.ts` com `fetchAll()` normalizado + lista em `feeds.ts`
- [x] **T-06** `sources/newsapi.ts`
- [x] **T-07** `sources/finnhub.ts`
- [x] **T-08** `sources/cvm.ts` (fatos relevantes)
- [ ] **T-09** `sources/brasilapi.ts` (feriados + cache)
- [ ] **T-10** `sources/bcb.ts` (Selic/IPCA/agenda Copom)
- [ ] **T-11** `sources/ibge.ts`
- [ ] **T-12** `sources/alphavantage.ts` (usado sob demanda)
- [ ] **T-13** `sources/massive.ts`

## Fase 3 — Núcleo

- [ ] **T-14** `core/dedup.ts` (hash + integração com SQLite)
- [ ] **T-15** `core/throttle.ts` (rate limit por fonte)
- [ ] **T-16** `core/pregao.ts` (guard horário + feriados)
- [ ] **T-17** `llm/mimo.ts` com prompt, batch, validação zod, retry+backoff

## Fase 4 — Saída

- [ ] **T-18** `notify/discord.ts` (embed)
- [ ] **T-19** `notify/telegram.ts` (Markdown)

## Fase 5 — Orquestração

- [ ] **T-20** `core/pipeline.ts` (fluxo notícias)
- [ ] **T-21** Pipeline separado pra CVM
- [ ] **T-22** Pipeline separado pra macro (diário)
- [ ] **T-23** `index.ts` com `node-cron` e boot

## Fase 6 — Operação

- [ ] **T-24** Script `npm run once` (roda 1x sem cron pra debug)
- [ ] **T-25** README com instruções de setup e deploy
- [ ] **T-26** Deploy em Railway/Fly.io/VPS
