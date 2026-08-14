#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

/**
 * Build a compact financial-market report and deliver it to PushPlus WeChat.
 *
 * Local preview (does not send):
 *   npm run finance:push -- --dry-run
 *
 * Delivery:
 *   PUSHPLUS_TOKEN=... npm run finance:push
 */

const DEFAULT_QUOTE_COUNT = 12;
const DEFAULT_HEADLINE_COUNT = 8;
const PUSHPLUS_ENDPOINT = 'https://www.pushplus.plus/send';

export const FINANCE_SYMBOLS = [
  ['^GSPC', '标普 500'],
  ['^IXIC', '纳斯达克'],
  ['^DJI', '道琼斯'],
  ['^HSI', '恒生指数'],
  ['000001.SS', '上证指数'],
  ['^N225', '日经 225'],
  ['EURUSD=X', '欧元/美元'],
  ['CNY=X', '美元/人民币'],
  ['GC=F', '黄金'],
  ['CL=F', 'WTI 原油'],
  ['BTC-USD', '比特币'],
  ['ETH-USD', '以太坊'],
];

function numberOption(value, fallback, max) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function decodeXml(value = '') {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

function xmlTag(item, tag) {
  return decodeXml(item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] ?? '');
}

export function parseRssItems(xml, limit = DEFAULT_HEADLINE_COUNT) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
    .map((match) => ({
      title: xmlTag(match[1], 'title'),
      link: xmlTag(match[1], 'link'),
      source: xmlTag(match[1], 'source'),
      publishedAt: xmlTag(match[1], 'pubDate'),
    }))
    .filter((item) => item.title && /^https?:\/\//i.test(item.link))
    .slice(0, limit);
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return '暂无';
  const absolute = Math.abs(value);
  const digits = absolute >= 1_000 ? 0 : absolute >= 10 ? 2 : absolute >= 1 ? 3 : 4;
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value);
}

function formatChange(value) {
  if (!Number.isFinite(value)) return '—';
  const icon = value > 0 ? '🔺' : value < 0 ? '🔻' : '➖';
  return `${icon} ${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function quoteFromChart(label, payload) {
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || !Number.isFinite(meta.regularMarketPrice)) return null;
  const previousClose = Number.isFinite(meta.chartPreviousClose)
    ? meta.chartPreviousClose
    : meta.previousClose;
  const changePercent = Number.isFinite(previousClose) && previousClose !== 0
    ? ((meta.regularMarketPrice - previousClose) / previousClose) * 100
    : null;
  return {
    label,
    price: meta.regularMarketPrice,
    changePercent,
    currency: meta.currency ?? '',
    marketTime: Number.isFinite(meta.regularMarketTime) ? meta.regularMarketTime * 1_000 : null,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'WorldMonitor-Finance-Brief/1.0' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function fetchQuotes(symbols = FINANCE_SYMBOLS) {
  const settled = await Promise.allSettled(symbols.map(async ([symbol, label]) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const quote = quoteFromChart(label, await fetchJson(url));
    if (!quote) throw new Error('行情数据为空');
    return quote;
  }));
  return settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
}

export async function fetchFinanceHeadlines(limit = DEFAULT_HEADLINE_COUNT) {
  const query = encodeURIComponent('(股市 OR 金融市场 OR 央行 OR 汇率 OR 债券 OR 黄金) when:1d');
  const url = `https://news.google.com/rss/search?q=${query}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'WorldMonitor-Finance-Brief/1.0' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`新闻源 HTTP ${response.status}`);
  return parseRssItems(await response.text(), limit);
}

export function buildFinanceReport({ quotes, headlines, generatedAt = new Date() }) {
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(generatedAt);

  const lines = [
    '# 📈 金融市场速报',
    '',
    `> 更新时间：${time}（北京时间）`,
    '',
    '## 市场行情',
    '',
  ];

  if (quotes.length === 0) {
    lines.push('行情源暂时不可用，请稍后重试。');
  } else {
    lines.push('| 市场 | 最新 | 涨跌 |', '|---|---:|---:|');
    for (const quote of quotes) {
      lines.push(`| ${quote.label} | ${formatPrice(quote.price)}${quote.currency ? ` ${quote.currency}` : ''} | ${formatChange(quote.changePercent)} |`);
    }
  }

  lines.push('', '## 金融要闻', '');
  if (headlines.length === 0) {
    lines.push('新闻源暂时不可用，请稍后重试。');
  } else {
    headlines.forEach((item, index) => {
      const source = item.source ? ` · ${item.source}` : '';
      lines.push(`${index + 1}. [${item.title}](${item.link})${source}`);
    });
  }
  lines.push('', '---', '数据仅供参考，不构成投资建议。');
  return lines.join('\n');
}

export async function sendToPushPlus({ token, title, content, topic = '' }) {
  if (!token) throw new Error('缺少 PUSHPLUS_TOKEN，请在 GitHub Actions Secrets 中配置。');
  const response = await fetch(PUSHPLUS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, title, content, template: 'markdown', ...(topic ? { topic } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 200) {
    throw new Error(`PushPlus 推送失败：${body.msg || `HTTP ${response.status}`}`);
  }
  return body;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run') || process.env.PUSHPLUS_DRY_RUN === '1';
  const headlineCount = numberOption(process.env.FINANCE_HEADLINE_COUNT, DEFAULT_HEADLINE_COUNT, 15);
  const quoteCount = numberOption(process.env.FINANCE_QUOTE_COUNT, DEFAULT_QUOTE_COUNT, FINANCE_SYMBOLS.length);

  const [quoteResult, headlineResult] = await Promise.allSettled([
    fetchQuotes(FINANCE_SYMBOLS.slice(0, quoteCount)),
    fetchFinanceHeadlines(headlineCount),
  ]);
  const quotes = quoteResult.status === 'fulfilled' ? quoteResult.value : [];
  const headlines = headlineResult.status === 'fulfilled' ? headlineResult.value : [];
  if (quotes.length === 0 && headlines.length === 0) {
    throw new Error('金融行情和新闻源均不可用，未发送空白报告。');
  }

  const report = buildFinanceReport({ quotes, headlines });
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  }

  if (dryRun) {
    console.log('\n[finance] 预览模式：未发送 PushPlus。');
    return;
  }
  await sendToPushPlus({
    token: process.env.PUSHPLUS_TOKEN,
    topic: process.env.PUSHPLUS_TOPIC,
    title: `金融市场速报 ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format(new Date())}`,
    content: report,
  });
  console.log('\n[finance] PushPlus 微信推送成功。');
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(`[finance] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
