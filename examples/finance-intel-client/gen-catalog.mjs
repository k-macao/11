#!/usr/bin/env node
/**
 * 从仓库既有配置生成客户端用的静态目录，避免手抄导致漂移。
 *
 *   node gen-catalog.mjs        # 写出 catalog.generated.json
 *
 * 数据来源（全部是仓库里已有的、看板本身在用的配置）：
 *   src/config/finance-geo.ts  → 29 交易所 / 19 金融中心 / 14 央行 / 10 商品枢纽
 *   shared/stocks.json         → 93 标的目录、59 默认标的、6 个区域
 *   shared/commodities.json    → 33 个商品与外汇符号
 *   shared/crypto.json         → 10 个加密资产
 *   src/config/feeds.ts        → 各变体的新闻源分类与条目数
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const read = (p) => readFileSync(resolve(REPO, p), 'utf8');

/** 从 TS 源里抽出一个顶层数组字面量并求值（条目均为纯对象字面量）。 */
function extractArray(src, name) {
  const at = src.indexOf(`export const ${name}`);
  if (at === -1) throw new Error(`未找到 ${name}`);
  const start = src.indexOf('= [', at) + 2;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']' && --depth === 0) {
      // biome-ignore lint/security/noGlobalEval: 构建期读取本仓库自有配置，非外部输入
      return eval(src.slice(start, i + 1));
    }
  }
  throw new Error(`${name} 未闭合`);
}

/** 统计 feeds.ts 里某个变体对象的分类与条目数。 */
function countFeeds(src, declLine) {
  const at = src.indexOf(declLine);
  if (at === -1) throw new Error(`未找到 ${declLine}`);
  const start = src.indexOf('{', at);
  let depth = 0;
  let end = start;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = src.slice(start, end);
  const cats = {};
  const re = /\n {2}([A-Za-z][A-Za-z0-9]*): \[/g;
  let m;
  const marks = [];
  while ((m = re.exec(body))) marks.push({ key: m[1], at: m.index });
  for (let i = 0; i < marks.length; i++) {
    const slice = body.slice(marks[i].at, marks[i + 1]?.at ?? body.length);
    cats[marks[i].key] = (slice.match(/\{ name: /g) ?? []).length;
  }
  return cats;
}

const geo = read('src/config/finance-geo.ts');
const feeds = read('src/config/feeds.ts');
const stocks = JSON.parse(read('shared/stocks.json'));
const commodities = JSON.parse(read('shared/commodities.json'));
const crypto = JSON.parse(read('shared/crypto.json'));

/** 交易所 → 该市场的基准指数符号（与 shared/stocks.json 的符号体系一致）。 */
const EXCHANGE_INDEX = {
  nyse: '^GSPC',
  nasdaq: '^IXIC',
  sse: '000001.SS',
  euronext: '^AEX',
  jpx: '^N225',
  szse: '300750.SZ',
  hkex: '^HSI',
  lse: '^FTSE',
  'nse-india': '^NSEI',
  'bse-india': '^BSESN',
  tsx: '^GSPTSE',
  krx: '^KS11',
  six: '^SSMI',
  asx: '^AXJO',
  xetra: '^GDAXI',
  twse: '^TWII',
  tadawul: '^TASI.SR',
  b3: '^BVSP',
  jse: null,
  sgx: '^STI',
  bme: '^IBEX',
  'euronext-paris': '^FCHI',
  idx: '^JKSE',
  bmv: '^MXX',
  bist: null,
  tase: null,
  adx: null,
  dfm: null,
  qse: null,
};

const exchanges = extractArray(geo, 'STOCK_EXCHANGES').map((e) => ({
  id: e.id,
  name: e.name,
  shortName: e.shortName,
  city: e.city,
  country: e.country,
  lat: e.lat,
  lon: e.lon,
  tier: e.tier,
  marketCapTrillionUsd: e.marketCap ?? null,
  tradingHours: e.tradingHours ?? null,
  timezone: e.timezone ?? null,
  indexSymbol: EXCHANGE_INDEX[e.id] ?? null,
}));

const unmapped = exchanges.filter((e) => !e.indexSymbol).map((e) => e.shortName);

const catalog = {
  generatedAt: new Date().toISOString(),
  generatedFrom: [
    'src/config/finance-geo.ts',
    'shared/stocks.json',
    'shared/commodities.json',
    'shared/crypto.json',
    'src/config/feeds.ts',
  ],
  exchanges,
  exchangeIndexSymbols: exchanges.map((e) => e.indexSymbol).filter(Boolean),
  exchangesWithoutIndex: unmapped,
  financialCenters: extractArray(geo, 'FINANCIAL_CENTERS').map((c) => ({
    id: c.id,
    city: c.city,
    country: c.country,
    type: c.type,
    gfciRank: c.gfciRank ?? null,
  })),
  centralBanks: extractArray(geo, 'CENTRAL_BANKS').map((b) => ({
    id: b.id,
    shortName: b.shortName,
    country: b.country,
    type: b.type,
    currency: b.currency ?? null,
  })),
  commodityHubs: extractArray(geo, 'COMMODITY_HUBS').map((h) => ({
    id: h.id,
    name: h.name,
    country: h.country,
    type: h.type,
  })),
  stocks: {
    defaultSymbols: stocks.defaultSymbols,
    catalogSize: stocks.symbols.length,
    regions: stocks.regions,
  },
  commoditySymbols: commodities.commodities.map((c) => c.symbol),
  cryptoIds: crypto.ids,
  newsCategories: {
    full: countFeeds(feeds, 'const FULL_FEEDS'),
    finance: countFeeds(feeds, 'const FINANCE_FEEDS'),
    tech: countFeeds(feeds, 'const TECH_FEEDS'),
    commodity: countFeeds(feeds, 'const COMMODITY_FEEDS'),
    happy: countFeeds(feeds, 'const HAPPY_FEEDS'),
  },
};

// 条目总数含跨变体复用；去重后的实际信源家数才是「500+ 精选新闻源」的口径。
const feedNames = [...feeds.matchAll(/\{ name: '([^']*)'/g)].map((m) => m[1]);
const totalFeeds = feedNames.length;
catalog.newsFeedEntries = totalFeeds;
catalog.newsFeedUniqueSources = new Set(feedNames).size;

const out = resolve(HERE, 'catalog.generated.json');
writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`);

console.log(`已写出 ${out}`);
console.log(
  `交易所 ${catalog.exchanges.length}（已映射指数 ${catalog.exchangeIndexSymbols.length}，无公开指数 ${unmapped.length}: ${unmapped.join(', ')}）`,
);
console.log(
  `金融中心 ${catalog.financialCenters.length} · 央行 ${catalog.centralBanks.length} · 商品枢纽 ${catalog.commodityHubs.length}`,
);
console.log(
  `商品/外汇符号 ${catalog.commoditySymbols.length} · 加密 ${catalog.cryptoIds.length} · 默认股票 ${catalog.stocks.defaultSymbols.length}`,
);
for (const [variant, cats] of Object.entries(catalog.newsCategories)) {
  const n = Object.values(cats).reduce((a, b) => a + b, 0);
  console.log(`  新闻 ${variant}: ${Object.keys(cats).length} 类 / ${n} 源`);
}
console.log(
  `新闻源条目 ${totalFeeds} 条，去重后 ${catalog.newsFeedUniqueSources} 家独立信源`,
);
