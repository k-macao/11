/**
 * 新闻源接入 —— 500+ 精选信源、多类别、AI 综合简报。
 *
 * 主接口是 ListFeedDigest：服务端已经把全部 RSS 源抓好、去重、打分、聚合，
 * 一次调用拿到按类别分好的结果。不要自己去逐个抓 RSS —— 那既慢又会撞对方限流。
 *
 *   GET /api/news/v1/list-feed-digest?variant=finance&lang=zh
 *
 * variant: full | tech | finance | happy | commodity（energy 等回落到 full）
 * 响应: { categories: { <类别>: { items: NewsItem[] } }, feedStatuses, generatedAt }
 *
 * AI 综合简报：
 *   GET /api/news/v1/summarize-article-cache?cache_key=...   命中缓存（CDN 可缓存，便宜）
 *   POST /api/news/v1/summarize-article                      现算（贵，按配额计费）
 * 本模块默认只走 cache 变体，避免免费额度被 LLM 调用吃掉。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFreshness } from './freshness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = JSON.parse(readFileSync(resolve(HERE, 'catalog.generated.json'), 'utf8'));

export const VARIANTS = ['full', 'finance', 'tech', 'commodity', 'happy'];

/** 各变体在仓库配置里的类别构成（源自 src/config/feeds.ts）。 */
export const VARIANT_CATEGORIES = CATALOG.newsCategories;

/** 类别中文名 —— 覆盖 full 与 finance 两个变体的全部类别。 */
export const CATEGORY_LABELS = {
  // full
  politics: '国际政治',
  us: '美国',
  europe: '欧洲',
  middleeast: '中东',
  asia: '亚洲',
  africa: '非洲',
  latam: '拉美',
  tech: '科技',
  ai: '人工智能',
  finance: '财经',
  gov: '政府与官方',
  layoffs: '裁员',
  thinktanks: '智库分析',
  crisis: '危机与人道',
  energy: '能源',
  // finance
  markets: '股市',
  forex: '外汇',
  bonds: '债市',
  commodities: '大宗商品',
  crypto: '加密货币',
  centralbanks: '央行',
  economic: '宏观经济',
  ipo: 'IPO',
  derivatives: '衍生品',
  fintech: '金融科技',
  institutional: '机构动向',
  analysis: '深度分析',
  gccNews: '海湾财经',
};

/**
 * 拉取新闻摘要。
 * @param {import('./client.mjs').WorldMonitorClient} client
 * @param {{variant?:string, lang?:string, categories?:string[], limit?:number,
 *          maxAgeHours?:number, minImportance?:number, alertsOnly?:boolean}} [opts]
 */
export async function fetchDigest(client, opts = {}) {
  const variant = opts.variant ?? 'finance';
  const maxAgeHours = opts.maxAgeHours ?? 24;

  const params = { variant };
  if (opts.lang) params.lang = opts.lang;

  const [res] = await client.fetchMany([
    { id: 'feed-digest', group: 'news', path: '/api/news/v1/list-feed-digest', params },
  ]);

  if (!res.ok) {
    return {
      variant,
      ok: false,
      error: res.error,
      freshness: checkFreshness([{ source: 'feed-digest', payload: res }], maxAgeHours),
    };
  }

  const data = res.data ?? {};
  const categoriesRaw = data.categories ?? {};
  const wanted = opts.categories?.length ? new Set(opts.categories) : null;

  const categories = [];
  let totalItems = 0;
  let alerts = 0;

  for (const [key, bucket] of Object.entries(categoriesRaw)) {
    if (wanted && !wanted.has(key)) continue;
    let items = (bucket?.items ?? []).map(normalizeItem);
    if (opts.alertsOnly) items = items.filter((i) => i.isAlert);
    if (typeof opts.minImportance === 'number') {
      items = items.filter((i) => (i.importanceScore ?? 0) >= opts.minImportance);
    }
    // 重要性优先，其次时间
    items.sort(
      (a, b) =>
        (b.importanceScore ?? 0) - (a.importanceScore ?? 0) ||
        (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
    );
    if (opts.limit) items = items.slice(0, opts.limit);

    totalItems += items.length;
    alerts += items.filter((i) => i.isAlert).length;
    categories.push({
      key,
      label: CATEGORY_LABELS[key] ?? key,
      count: items.length,
      items,
    });
  }

  categories.sort((a, b) => b.count - a.count);

  // feedStatuses 只上报非 ok 状态，缺席即正常
  const statuses = data.feedStatuses ?? {};
  const degraded = Object.entries(statuses).map(([feed, state]) => ({ feed, state }));

  return {
    variant,
    ok: true,
    generatedAt: data.generatedAt ?? null,
    fetchedAt: res.fetchedAt,
    configuredCategories: Object.keys(VARIANT_CATEGORIES[variant] ?? {}).length,
    returnedCategories: categories.length,
    totalItems,
    alerts,
    degradedFeeds: degraded,
    categories,
    freshness: checkFreshness([{ source: 'feed-digest', payload: res }], maxAgeHours),
  };
}

function normalizeItem(i) {
  return {
    title: i.title ?? null,
    source: i.source ?? null,
    link: i.link ?? null,
    publishedAt: i.pubDate ?? i.publishedAt ?? i.date ?? null,
    importanceScore: i.importanceScore ?? null,
    corroborationCount: i.corroborationCount ?? null,
    isAlert: Boolean(i.isAlert),
    location: i.location ?? null,
    summary: i.summary ?? i.description ?? null,
  };
}

/**
 * 取一篇文章的 AI 综合简报（只读缓存，不触发现算）。
 * @param {import('./client.mjs').WorldMonitorClient} client
 * @param {string} cacheKey  由 buildSummaryCacheKey() 生成的确定性 key
 */
export async function fetchCachedSummary(client, cacheKey) {
  const [res] = await client.fetchMany([
    {
      id: 'summary-cache',
      group: 'news',
      path: '/api/news/v1/summarize-article-cache',
      params: { cache_key: cacheKey },
      required: ['cache_key'],
    },
  ]);
  return res;
}
