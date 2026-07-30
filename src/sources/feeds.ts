export type Feed = {
  name: string
  url: string
}

export const FEEDS: readonly Feed[] = [
  { name: 'InfoMoney', url: 'https://www.infomoney.com.br/feed/' },
  { name: 'Valor Econômico', url: 'https://valor.globo.com/rss/valor/' },
  { name: 'Money Times', url: 'https://www.moneytimes.com.br/feed/' },
  { name: 'Brazil Journal', url: 'https://braziljournal.com/feed/' },
]
