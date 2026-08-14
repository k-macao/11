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

import { createServer } from 'node:http';
import { SOURCES } from './sources.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
let flakyHits = 0;

function fakePayload(source, url) {
  const now = new Date().toISOString();
  switch (source.group) {
    case 'markets': {
      const symbols = url.searchParams.getAll('symbols');
      const list = (symbols.length ? symbols : ['^GSPC', '^HSI']).map((s, i) => ({
        symbol: s,
        price: 100 + i * 37.5,
        change_percent: (i % 2 ? -1 : 1) * (0.4 + i * 0.15),
        updated_at: now,
      }));
      return { quotes: list, source: 'mock', cached: true, as_of: now };
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
