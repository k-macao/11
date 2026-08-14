/**
 * 金融雷达 —— 把看板的「29 家交易所 + 大宗商品 + 加密货币 + 7 信号综合指标」
 * 组装成一次调用就能拿到的结构化快照。
 *
 * 用到的托管 API（全部免费档可用）：
 *   GET /api/market/v1/list-market-quotes      交易所基准指数
 *   GET /api/market/v1/list-commodity-quotes   33 个商品与外汇符号
 *   GET /api/market/v1/list-crypto-quotes      10 个加密资产
 *   GET /api/economic/v1/get-macro-signals     7 信号综合指标 + BUY/CASH 结论
 *   GET /api/market/v1/get-fear-greed-index    恐慌贪婪（7 信号之一，独立成源）
 *
 * 交易所 → 指数符号的映射来自 catalog.generated.json（由 gen-catalog.mjs
 * 从 src/config/finance-geo.ts 与 shared/stocks.json 生成，不手抄）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFreshness } from './freshness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const CATALOG = JSON.parse(
  readFileSync(resolve(HERE, 'catalog.generated.json'), 'utf8'),
);

/** 7 信号的显示名与含义（对应 MacroSignalsPanel）。 */
export const MACRO_SIGNAL_LABELS = {
  liquidity: { zh: '流动性', detail: 'JPY 30 日变动率 —— 日元套息平仓即全球流动性收紧' },
  flowStructure: { zh: '资金结构', detail: 'BTC 与 QQQ 的 5 日收益对比 —— 风险资产内部轮动' },
  macroRegime: { zh: '宏观状态', detail: 'QQQ 与 XLP 的 20 日 ROC —— 成长 vs 防御的相对强弱' },
  technicalTrend: { zh: 'BTC 技术趋势', detail: 'SMA50 / SMA200 / VWAP / Mayer Multiple' },
  hashRate: { zh: '算力', detail: '比特币全网算力 30 日变化 —— 矿工的资本开支信心' },
  priceMomentum: { zh: '价格动能', detail: 'Mayer Multiple 偏离度' },
  fearGreed: { zh: '恐慌贪婪', detail: '综合情绪指数，含 30 日历史' },
};

/**
 * 拉取完整金融雷达快照。
 * @param {import('./client.mjs').WorldMonitorClient} client
 * @param {{exchanges?:string[], maxAgeHours?:number}} [opts]
 *        exchanges  只要某几家交易所（用 shortName，如 ['NYSE','HKEX']）
 *        maxAgeHours 新鲜度门槛，默认 24 小时
 */
export async function fetchRadar(client, opts = {}) {
  const maxAgeHours = opts.maxAgeHours ?? 24;

  let exchanges = CATALOG.exchanges;
  if (opts.exchanges?.length) {
    const want = new Set(opts.exchanges.map((s) => s.toUpperCase()));
    exchanges = exchanges.filter(
      (e) => want.has(e.shortName.toUpperCase()) || want.has(e.id.toUpperCase()),
    );
  }
  const indexSymbols = exchanges.map((e) => e.indexSymbol).filter(Boolean);

  const jobs = [
    {
      id: 'exchange-indices',
      group: 'markets',
      path: '/api/market/v1/list-market-quotes',
      params: { symbols: indexSymbols },
    },
    { id: 'commodities', group: 'markets', path: '/api/market/v1/list-commodity-quotes' },
    { id: 'crypto', group: 'markets', path: '/api/market/v1/list-crypto-quotes' },
    { id: 'macro-signals', group: 'macro', path: '/api/economic/v1/get-macro-signals' },
    { id: 'fear-greed', group: 'markets', path: '/api/market/v1/get-fear-greed-index' },
  ];

  const results = await client.fetchMany(jobs);
  const by = Object.fromEntries(results.map((r) => [r.source, r]));

  // ── 交易所 ──────────────────────────────────────────────
  const quoteIndex = indexQuotes(by['exchange-indices']?.data);
  const exchangeRows = exchanges.map((e) => {
    const q = e.indexSymbol ? quoteIndex.get(e.indexSymbol) : undefined;
    return {
      id: e.id,
      shortName: e.shortName,
      name: e.name,
      country: e.country,
      city: e.city,
      tier: e.tier,
      marketCapTrillionUsd: e.marketCapTrillionUsd,
      tradingHours: e.tradingHours,
      timezone: e.timezone,
      marketOpen: isMarketOpen(e),
      indexSymbol: e.indexSymbol,
      price: q?.price ?? null,
      changePercent: q?.changePercent ?? null,
      // 无公开基准指数的交易所（如 MOEX、TASE）只有静态元数据，不是拉取失败
      quoteStatus: e.indexSymbol ? (q ? 'ok' : 'missing') : 'no-index',
    };
  });

  // ── 7 信号 ──────────────────────────────────────────────
  const macro = by['macro-signals']?.data;
  const fg = by['fear-greed']?.data;
  const signals = normalizeSignals(macro, fg);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    exchanges: {
      total: exchangeRows.length,
      withQuote: exchangeRows.filter((r) => r.quoteStatus === 'ok').length,
      open: exchangeRows.filter((r) => r.marketOpen).length,
      rows: exchangeRows,
    },
    commodities: {
      expectedSymbols: CATALOG.commoditySymbols.length,
      quotes: listQuotes(by.commodities?.data),
    },
    crypto: {
      expectedIds: CATALOG.cryptoIds.length,
      quotes: listQuotes(by.crypto?.data),
    },
    macroSignals: signals,
    errors: results.filter((r) => !r.ok).map((r) => ({ source: r.source, ...r.error })),
  };

  snapshot.freshness = checkFreshness(
    [
      { source: 'exchange-indices', payload: by['exchange-indices'] },
      { source: 'commodities', payload: by.commodities },
      { source: 'crypto', payload: by.crypto },
      { source: 'macro-signals', payload: by['macro-signals'] },
      { source: 'fear-greed', payload: by['fear-greed'] },
    ],
    maxAgeHours,
  );

  return snapshot;
}

/** 报价数组在不同 RPC 里可能挂在不同 key 下，统一取出。 */
function listQuotes(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.map(normalizeQuote);
  for (const key of ['quotes', 'items', 'markets', 'tokens', 'data', 'results']) {
    if (Array.isArray(data[key])) return data[key].map(normalizeQuote);
  }
  const firstArray = Object.values(data).find(Array.isArray);
  return Array.isArray(firstArray) ? firstArray.map(normalizeQuote) : [];
}

function normalizeQuote(q) {
  if (!q || typeof q !== 'object') return { symbol: String(q), price: null };
  return {
    symbol: q.symbol ?? q.id ?? q.ticker ?? q.name ?? null,
    name: q.name ?? null,
    price: num(q.price ?? q.value ?? q.current_price ?? q.last),
    changePercent: num(
      q.change_percent ?? q.changePercent ?? q.change_pct ?? q.price_change_percentage_24h,
    ),
    updatedAt: q.updated_at ?? q.updatedAt ?? q.as_of ?? null,
  };
}

function indexQuotes(data) {
  const m = new Map();
  for (const q of listQuotes(data)) if (q.symbol) m.set(q.symbol, q);
  return m;
}

function num(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** 用交易所的 tradingHours + timezone 判断此刻是否在盘中（粗粒度，不含节假日）。 */
export function isMarketOpen(exchange, now = new Date()) {
  if (!exchange.tradingHours || !exchange.timezone) return null;
  const m = exchange.tradingHours.match(/(\d{2}):(\d{2})-(\d{2}):(\d{2})/);
  if (!m) return null;
  let local;
  try {
    local = new Intl.DateTimeFormat('en-US', {
      timeZone: exchange.timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  } catch {
    return null;
  }
  const get = (t) => local.find((p) => p.type === t)?.value;
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const mins = Number(get('hour')) * 60 + Number(get('minute'));
  const open = Number(m[1]) * 60 + Number(m[2]);
  const close = Number(m[3]) * 60 + Number(m[4]);
  return mins >= open && mins <= close;
}

/** 把 get-macro-signals + fear-greed 归一成 7 条统一结构。 */
function normalizeSignals(macro, fearGreed) {
  const raw = macro?.signals ?? macro ?? {};
  const out = { verdict: macro?.verdict ?? macro?.overall ?? null, signals: [] };
  for (const [key, meta] of Object.entries(MACRO_SIGNAL_LABELS)) {
    const s = key === 'fearGreed' ? (raw.fearGreed ?? fearGreed) : raw[key];
    out.signals.push({
      key,
      label: meta.zh,
      detail: meta.detail,
      status: s?.status ?? null,
      value: s?.value ?? s?.score ?? s?.btcPrice ?? null,
      present: s != null,
    });
  }
  out.presentCount = out.signals.filter((s) => s.present).length;
  return out;
}
