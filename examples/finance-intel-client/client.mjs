/**
 * World Monitor 金融情报接入客户端（零依赖，Node 18+）
 *
 * 能力：
 *  - 并发受限地批量拉取金融 / 宏观 / 能源 / 地缘 / 贸易数据源
 *  - 指数退避重试（429 与 5xx），尊重 Retry-After
 *  - 每源超时、失败隔离（单源失败不影响整体）
 *  - 可选 JMESPath 服务端投影（?jmespath=...），减小响应体
 *  - 输出规范化信封：{ ok, source, status, ms, data | error }
 */

import { selectSources } from './sources.mjs';

export const DEFAULT_BASE = 'https://api.worldmonitor.app';

/** 构造带重复 key 的查询串（OpenAPI explode: true 语义） */
export function buildQuery(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) sp.append(k, String(item));
    } else {
      sp.append(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function retryDelay(attempt, res) {
  const header = res?.headers?.get?.('retry-after');
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) return Math.min(secs * 1000, 30_000);
  }
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return base + Math.floor(Math.random() * 250); // 抖动，避免同步重试风暴
}

export class WorldMonitorClient {
  /**
   * @param {{apiKey?:string, base?:string, timeoutMs?:number, retries?:number,
   *          concurrency?:number, fetchImpl?:typeof fetch, onEvent?:(e:any)=>void}} opts
   */
  constructor(opts = {}) {
    this.apiKey = opts.apiKey ?? process.env.WM_KEY ?? '';
    this.base = (opts.base ?? process.env.WM_BASE ?? DEFAULT_BASE).replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.retries = opts.retries ?? 2;
    this.concurrency = opts.concurrency ?? 4;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.onEvent = opts.onEvent ?? (() => {});
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('当前运行时没有 fetch，请使用 Node 18+ 或传入 fetchImpl');
    }
  }

  headers() {
    const h = { Accept: 'application/json', 'User-Agent': 'wm-finance-intel-client/1.0' };
    // 托管 API 的认证头；浏览器会话可省略，服务端调用必须带
    if (this.apiKey) h['X-WorldMonitor-Key'] = this.apiKey;
    return h;
  }

  /**
   * 拉取单个数据源。
   * @param {import('./sources.mjs').SourceDef & {method?:string}} source
   * @param {{params?:Record<string,unknown>, jmespath?:string}} [override]
   */
  async fetchSource(source, override = {}) {
    const params = { ...(source.params ?? {}), ...(override.params ?? {}) };
    if (override.jmespath) params.jmespath = override.jmespath;

    const missing = (source.required ?? []).filter(
      (k) => params[k] === undefined || params[k] === '',
    );
    if (missing.length) {
      return {
        ok: false,
        source: source.id,
        group: source.group,
        status: 0,
        ms: 0,
        error: { kind: 'MISSING_PARAM', message: `缺少必填参数: ${missing.join(', ')}` },
      };
    }

    const method = source.method ?? 'GET';
    const isPost = method === 'POST';
    const url = this.base + source.path + (isPost ? '' : buildQuery(params));
    const started = Date.now();
    let lastError = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      try {
        const init = { method, headers: this.headers(), signal: ac.signal };
        if (isPost) {
          init.headers = { ...init.headers, 'Content-Type': 'application/json' };
          init.body = JSON.stringify(params);
        }
        const res = await this.fetchImpl(url, init);
        const text = await res.text();
        clearTimeout(timer);

        if (res.ok) {
          let data;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            return {
              ok: false,
              source: source.id,
              group: source.group,
              status: res.status,
              ms: Date.now() - started,
              error: { kind: 'BAD_JSON', message: text.slice(0, 200) },
            };
          }
          this.onEvent({ type: 'ok', source: source.id, status: res.status });
          return {
            ok: true,
            source: source.id,
            group: source.group,
            status: res.status,
            ms: Date.now() - started,
            fetchedAt: new Date().toISOString(),
            data,
          };
        }

        // 401/402/403/404 等确定性失败：不重试
        const retryable = res.status === 429 || res.status >= 500;
        lastError = {
          kind: httpErrorKind(res.status),
          message: text.slice(0, 300) || res.statusText,
          status: res.status,
        };
        if (!retryable || attempt === this.retries) break;
        this.onEvent({ type: 'retry', source: source.id, status: res.status, attempt });
        await sleep(retryDelay(attempt, res));
      } catch (err) {
        clearTimeout(timer);
        lastError = {
          kind: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
          message: String(err?.message ?? err),
        };
        if (attempt === this.retries) break;
        this.onEvent({ type: 'retry', source: source.id, error: lastError.kind, attempt });
        await sleep(retryDelay(attempt, null));
      }
    }

    this.onEvent({ type: 'fail', source: source.id, error: lastError });
    return {
      ok: false,
      source: source.id,
      group: source.group,
      status: lastError?.status ?? 0,
      ms: Date.now() - started,
      error: lastError ?? { kind: 'UNKNOWN', message: 'unknown failure' },
    };
  }

  /** 并发受限地批量拉取。 */
  async fetchMany(sources, override = {}) {
    const queue = [...sources];
    const results = [];
    const workers = Array.from({ length: Math.min(this.concurrency, queue.length) }, async () => {
      for (;;) {
        const src = queue.shift();
        if (!src) return;
        results.push(await this.fetchSource(src, override));
      }
    });
    await Promise.all(workers);
    // 保持输入顺序，便于稳定 diff
    const order = new Map(sources.map((s, i) => [s.id, i]));
    results.sort((a, b) => order.get(a.source) - order.get(b.source));
    return results;
  }

  /** 按分组/白名单选择并拉取。 */
  async snapshot({ group, only, includePremium = true, jmespath } = {}) {
    const sources = selectSources({ group, only, includePremium });
    const results = await this.fetchMany(sources, jmespath ? { jmespath } : {});
    return {
      base: this.base,
      generatedAt: new Date().toISOString(),
      requested: sources.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }
}

function httpErrorKind(status) {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 402) return 'PAYMENT_REQUIRED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'UPSTREAM';
  return 'HTTP_ERROR';
}
