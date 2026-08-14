#!/usr/bin/env node
/**
 * 离线 mock 服务器 —— 在没有 API key 或网络受限时验证客户端链路。
 *
 *   node mock-server.mjs &            # 默认 127.0.0.1:8787
 *   node pull.mjs --group markets --base http://127.0.0.1:8787
 *
 * 行为：
 *  - 已知路由返回形状合理的假数据
 *  - /api/market/v1/get-cot-positioning 前两次返回 429，用来验证重试与退避
 *  - 未知路由返回 404
 */

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = JSON.parse(readFileSync(resolve(HERE, 'catalog.generated.json'), 'utf8'));

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
let flakyHits = 0;

/** 让某个源看起来过期，用于验证新鲜度门禁：STALE=crypto node mock-server.mjs */
const STALE = new Set((process.env.STALE ?? '').split(',').filter(Boolean));

const iso = (hoursAgo = 0) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();

function quoteList(symbols, staleKey) {
  const age = STALE.has(staleKey) ? 48 : 0.2;
  return symbols.map((s, i) => ({
    symbol: s,
    price: Number((50 + ((i * 137) % 900) + 0.5).toFixed(2)),
    change_percent: Number(((((i * 37) % 60) - 30) / 10).toFixed(2)),
    updated_at: iso(age),
  }));
}

/** 7 信号的 mock，形状对齐 MacroSignalsPanel 的 signals 结构。 */
function macroSignalsPayload() {
  const age = STALE.has('macro') ? 48 : 0.5;
  return {
    verdict: 'CASH',
    signals: {
      liquidity: { status: 'BEARISH', value: -2.4, sparkline: [1, 2, 3] },
      flowStructure: { status: 'NEUTRAL', btcReturn5: 1.2, qqqReturn5: 0.4 },
      macroRegime: { status: 'BULLISH', qqqRoc20: 3.1, xlpRoc20: 0.6 },
      technicalTrend: { status: 'BULLISH', btcPrice: 94210, sma50: 91000, mayerMultiple: 1.08 },
      hashRate: { status: 'BULLISH', change30d: 4.7 },
      priceMomentum: { status: 'NEUTRAL' },
      fearGreed: { status: 'GREED', value: 68 },
    },
    meta: { qqqSparkline: [1, 2, 3] },
    generatedAt: iso(age),
  };
}

/** 新闻摘要 mock：按 variant 生成该变体真实的类别构成。 */
function feedDigestPayload(url) {
  const variant = url.searchParams.get('variant') ?? 'full';
  const cats = CATALOG.newsCategories[variant] ?? CATALOG.newsCategories.full;
  const age = STALE.has('news') ? 48 : 0.3;
  const categories = {};
  let n = 0;
  for (const [key, feedCount] of Object.entries(cats)) {
    const items = Array.from({ length: Math.min(6, feedCount) }, (_, i) => ({
      title: `[${key}] mock 头条 ${i + 1}`,
      source: `Mock Source ${((n + i) % 12) + 1}`,
      link: `https://example.com/${key}/${i}`,
      pubDate: iso(age + i * 0.1),
      importanceScore: 90 - i * 7,
      corroborationCount: 5 - (i % 5),
      isAlert: i === 0 && key !== 'positive',
    }));
    n += items.length;
    categories[key] = { items };
  }
  return {
    categories,
    // feedStatuses 只上报非 ok 状态
    feedStatuses: { 'Mock Source 9': 'empty', 'Mock Source 4': 'partial-undated' },
    generatedAt: iso(age),
  };
}

function fakePayload(source, url) {
  const now = iso();

  // 专门的路由优先于按 group 的通用回退
  switch (url.pathname) {
    case '/api/economic/v1/get-macro-signals':
      return macroSignalsPayload();
    case '/api/news/v1/list-feed-digest':
      return feedDigestPayload(url);
    case '/api/market/v1/get-fear-greed-index':
      return {
        value: 68,
        classification: 'Greed',
        history: [{ value: 61, date: iso(24) }],
        generatedAt: iso(STALE.has('fear') ? 48 : 0.4),
      };
    case '/api/market/v1/list-commodity-quotes':
      return {
        quotes: quoteList(CATALOG.commoditySymbols, 'commodities'),
        as_of: iso(STALE.has('commodities') ? 48 : 0.2),
      };
    case '/api/market/v1/list-crypto-quotes':
      return {
        quotes: quoteList(CATALOG.cryptoIds, 'crypto'),
        as_of: iso(STALE.has('crypto') ? 48 : 0.2),
      };
    default:
      break;
  }

  switch (source.group) {
    case 'markets': {
      const symbols = url.searchParams.getAll('symbols');
      return {
        quotes: quoteList(symbols.length ? symbols : ['^GSPC', '^HSI'], 'markets'),
        source: 'mock',
        cached: true,
        as_of: iso(STALE.has('markets') ? 48 : 0.2),
      };
    }
    case 'macro':
      return {
        series: [
          { id: 'DGS10', value: 4.21, date: now.slice(0, 10) },
          { id: 'T10Y2Y', value: 0.35, date: now.slice(0, 10) },
        ],
        verdict: 'CASH',
        as_of: now,
      };
    case 'energy':
      return { metrics: [{ name: 'brent', value: 78.4, unit: 'USD/bbl' }], as_of: now };
    case 'geopolitics':
      return {
        events: [
          { id: 'evt-1', country: 'CN', severity: 'medium', headline: 'mock event', ts: now },
        ],
        as_of: now,
      };
    case 'trade':
      return { items: [{ chokepoint: 'Hormuz', status: 'open', transit_index: 0.92 }], as_of: now };
    default:
      return { data: [], as_of: now };
  }
}

const byPath = new Map(SOURCES.map((s) => [s.path, s]));
// 新闻类路由不在 SOURCES 里（它们是 --news 模式专用），单独注册
byPath.set('/api/news/v1/list-feed-digest', { id: 'feed-digest', group: 'news', path: '/api/news/v1/list-feed-digest' });
byPath.set('/api/news/v1/summarize-article-cache', { id: 'summary-cache', group: 'news', path: '/api/news/v1/summarize-article-cache' });

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const source = byPath.get(url.pathname);

  const send = (code, body, headers = {}) => {
    const payload = JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
    res.end(payload);
  };

  if (!source) return send(404, { error: 'NOT_FOUND', path: url.pathname });

  // 模拟限流，验证客户端退避重试
  if (url.pathname === '/api/market/v1/get-cot-positioning' && flakyHits < 2) {
    flakyHits++;
    return send(429, { error: 'RATE_LIMITED' }, { 'Retry-After': '0' });
  }

  if (source.premium && !req.headers['x-worldmonitor-key']) {
    return send(402, { error: 'PAYMENT_REQUIRED', message: 'PRO tier required' });
  }

  send(200, fakePayload(source, url));
});

server.listen(PORT, HOST, () => {
  console.log(`mock World Monitor API → http://${HOST}:${PORT} (${SOURCES.length} 条路由)`);
});
