#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Build the「章鱼 AI 全景分析」vertical long-form page and deliver it to PushPlus WeChat.
 *
 * The page adapts Guizang PPT Skill's Style A「电子杂志 × 电子墨水」to a
 * portrait, scroll-friendly long read for WeChat: light-gray paper background,
 * fluorescent-green display type, black body copy, fluorescent-green-on-black
 * highlights, and small type throughout.
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
// This workflow targets the configured PushPlus member channel (100,000 characters).
const PUSHPLUS_CONTENT_LIMIT = 100_000;
const PUSHPLUS_CONTENT_BUDGET = 99_000;
const PREVIEW_FILE = 'finance-push-preview.html';

const REPORT_STYLES = `
.fm,.fm *{box-sizing:border-box}
.fm{
  --bg:#e9e9e7;
  --paper:#f4f4f1;
  --ink:#0b0b0b;
  --ink-soft:#3f3f3d;
  --muted:#8b8b87;
  --line:rgba(11,11,11,.20);
  --neon:#39ff14;
  --neon-deep:#16c50b;
  width:100%;max-width:640px;margin:0 auto;background:var(--bg);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei UI',sans-serif;
  font-size:14px;line-height:1.85;-webkit-font-smoothing:antialiased;
}
.fm-page{padding:28px 22px 0}
.fm-mastrow{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:10px;border-bottom:1px solid var(--ink)}
.fm-mast{font:600 11px/1.5 ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:.2em}
.fm-mastsq{display:inline-block;width:7px;height:7px;background:var(--neon);margin-right:8px}
.fm-mastsub{text-align:right;font:9px/1.7 ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:.16em;color:var(--muted)}
.fm-hero{margin-top:26px}
.fm-kicker{font:600 9.5px/1.5 ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:.24em;text-transform:uppercase;color:var(--neon-deep)}
.fm-title{margin:10px 0 0;font:600 26px/1.4 'Songti SC','Noto Serif SC',STSong,Georgia,serif;letter-spacing:.05em;color:var(--neon)}
.fm-deck{margin:12px 0 0;padding-left:12px;border-left:3px solid var(--ink);font-size:13px;line-height:1.8;color:var(--ink)}
.fm-duorule{display:flex;gap:6px;margin-top:22px}
.fm-duorule i{height:3px}
.fm-duorule i:first-child{flex:2.2;background:var(--ink)}
.fm-duorule i:last-child{flex:1;background:var(--neon)}
.fm-lead{margin-top:20px}
.fm-lead p{margin:0 0 14px;font-size:14px;line-height:1.95;color:var(--ink)}
.fm-hl{background:var(--ink);color:var(--neon);padding:0 5px;font-weight:600}
.fm-chip{display:inline-block;margin:0 4px 3px 0;padding:0 6px;background:var(--ink);color:var(--neon);font:500 11px/1.9 ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:.03em}
.fm-jiayou{color:var(--neon-deep);font-weight:600}
.fm-section{margin-top:30px;border-top:2px solid var(--ink);padding-top:14px}
.fm-sechead{display:flex;align-items:baseline;gap:10px}
.fm-secno{font:600 9.5px/1.5 ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:.18em;color:var(--neon-deep)}
.fm-h2{margin:0;font:600 18px/1.5 'Songti SC','Noto Serif SC',STSong,Georgia,serif;letter-spacing:.06em;color:var(--neon)}
.fm-stamp{margin-left:auto;text-align:right;font:9px/1.6 ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:.08em;color:var(--muted)}
.fm-stats{margin-top:9px;font:500 10px/1.7 ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:.06em;color:var(--ink-soft)}
.fm-stats b{color:var(--neon-deep);font-weight:600}
.fm-qrow{display:grid;grid-template-columns:36px 1fr auto;grid-template-rows:auto auto auto;column-gap:10px;padding:12px 0;border-top:1px solid var(--line)}
.fm-no{grid-column:1;grid-row:1/3;font:500 10px/1.6 ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:.08em;color:var(--muted)}
.fm-qname{grid-column:2;grid-row:1;font-size:13px;font-weight:600;color:var(--ink)}
.fm-qvalue{grid-column:3;grid-row:1;text-align:right;font:500 13px/1.4 ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;color:var(--ink)}
.fm-change{grid-column:2/4;grid-row:2;text-align:right;font:500 11px/1.4 ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;color:var(--ink-soft)}
.fm-bar{grid-column:1/4;grid-row:3;height:2px;margin-top:9px;background:rgba(11,11,11,.08)}
.fm-bar i{display:block;height:2px}
.fm-news{margin-top:30px;background:var(--paper);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:14px 16px 10px}
.fm-empty{padding:16px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:13px;line-height:1.8;color:var(--ink-soft)}
.fm-story{padding:13px 0;border-top:1px solid var(--line)}
.fm-storyrow{display:flex;gap:12px;align-items:flex-start}
.fm-storyno{flex:0 0 28px;font:italic 600 15px/1.7 'Songti SC','Noto Serif SC',STSong,Georgia,serif;color:var(--neon-deep)}
.fm-storybody{flex:1;min-width:0}
.fm-storytitle{font-size:13.5px;line-height:1.75;color:var(--ink)}
.fm-storytitle a{color:var(--ink);text-decoration:none}
.fm-meta{display:block;margin-top:5px;font:9px/1.6 ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.fm-footer{margin:34px -22px 0;background:var(--ink);color:var(--neon);padding:24px 22px 26px}
.fm-signoff{font-size:13px;font-weight:600;letter-spacing:.02em}
.fm-accentline{width:44px;height:2px;margin:14px 0;background:var(--neon)}
.fm-disc{font-size:12px;color:rgba(57,255,20,.82)}
.fm-colophon{margin-top:16px;font:8.5px/1.8 ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;letter-spacing:.14em;color:rgba(57,255,20,.5)}
@media(max-width:420px){
  .fm-title{font-size:24px}
  .fm-page{padding-left:18px;padding-right:18px}
  .fm-footer{margin-left:-18px;margin-right:-18px;padding-left:18px;padding-right:18px}
  .fm-news{padding-left:13px;padding-right:13px}
}
`.replace(/\s+/g, ' ').replace(/\s*([{}:;,])\s*/g, '$1').trim();

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

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHttpUrl(value = '') {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function clipText(value, maxCharacters) {
  const characters = Array.from(String(value ?? ''));
  return characters.length <= maxCharacters
    ? characters.join('')
    : `${characters.slice(0, maxCharacters - 1).join('')}…`;
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return '暂无';
  const absolute = Math.abs(value);
  const digits = absolute >= 1_000 ? 0 : absolute >= 10 ? 2 : absolute >= 1 ? 3 : 4;
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value);
}

function changeParts(value) {
  if (!Number.isFinite(value)) {
    return { arrow: '—', label: '暂无', width: 0 };
  }
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '—';
  return {
    arrow,
    label: `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`,
    width: Math.min(100, Math.max(8, Math.abs(value) * 18)),
  };
}

function formatChange(value) {
  const change = changeParts(value);
  return `${change.arrow} ${change.label}`;
}

function shanghaiParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const record = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: record.year,
    month: record.month,
    day: record.day,
    hour: record.hour,
    minute: record.minute,
  };
}

function formatPublishedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = shanghaiParts(date);
  return `${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
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
  const settled = await Promise.allSettled(symbols.map(async ([symbol, label], index) => {
    // Stagger Yahoo requests instead of bursting the whole watchlist at once.
    if (index > 0) await delay(index * 150);
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

function quoteLedger(quotes) {
  if (quotes.length === 0) {
    return '<div class="fm-empty">行情源暂时不可用，请稍后重试。</div>';
  }

  return quotes.map((quote, index) => {
    const change = changeParts(quote.changePercent);
    const currency = quote.currency ? ` ${escapeHtml(quote.currency)}` : '';
    // 涨用荧光绿、跌用黑，其余一律黑字 —— 只允许荧光绿与黑两种搭配。
    const barTone = change.width > 0 && quote.changePercent > 0 ? 'var(--neon)' : 'var(--ink)';
    const bar = change.width > 0
      ? `<i style="width:${change.width.toFixed(1)}%;background:${barTone}"></i>`
      : '';
    return `<div class="fm-qrow"><span class="fm-no">${String(index + 1).padStart(2, '0')}</span><span class="fm-qname">${escapeHtml(quote.label)}</span><span class="fm-qvalue">${escapeHtml(formatPrice(quote.price))}${currency}</span><span class="fm-change">${change.arrow} ${change.label}</span><div class="fm-bar">${bar}</div></div>`;
  }).join('');
}

function headlineLedger(headlines) {
  if (headlines.length === 0) {
    return '<div class="fm-empty">新闻源暂时不可用，请稍后重试。</div>';
  }

  return headlines.map((item, index) => {
    const url = safeHttpUrl(item.link);
    const title = escapeHtml(item.title);
    const linkedTitle = url
      ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${title}</a>`
      : title;
    const published = formatPublishedAt(item.publishedAt);
    const meta = [item.source, published].filter(Boolean).map(escapeHtml).join(' · ');
    return `<div class="fm-story"><div class="fm-storyrow"><span class="fm-storyno">${String(index + 1).padStart(2, '0')}</span><span class="fm-storybody"><span class="fm-storytitle">${linkedTitle}</span>${meta ? `<span class="fm-meta">${meta}</span>` : ''}</span></div></div>`;
  }).join('');
}

/**
 * Render the「章鱼 AI 全景分析」vertical long-form page for the PushPlus HTML template.
 * Style A「电子杂志 × 电子墨水」adapted to WeChat reading: light-gray paper, small
 * fluorescent-green display type, black body copy, neon-on-black highlights, and a
 * black sign-off block — no emoji, no big radii, no card stacks.
 */
function renderFinanceReport({ quotes, headlines, generatedAt }) {
  const date = shanghaiParts(generatedAt);
  const finiteMoves = quotes.filter((quote) => Number.isFinite(quote.changePercent));
  const advancing = finiteMoves.filter((quote) => quote.changePercent > 0).length;
  const declining = finiteMoves.filter((quote) => quote.changePercent < 0).length;

  return `<style>${REPORT_STYLES}</style><div class="fm" data-finance-template="octopus-panorama-longform"><div class="fm-page"><div class="fm-mastrow"><span class="fm-mast"><span class="fm-mastsq"></span>章鱼 AI</span><span class="fm-mastsub">OCTOPUS AI<br>AI PANORAMA</span></div><header class="fm-hero"><div class="fm-kicker">Multi-Model AI · Panorama Research</div><h1 class="fm-title">章鱼 AI 全景分析</h1><p class="fm-deck">全网 AI 调研境内境外数据，由多个大模型混合部署</p></header><div class="fm-duorule"><i></i><i></i></div><section class="fm-lead"><p>全网境内外为你寻找蛛丝马迹 —— 提供<span class="fm-hl">全景视野分析</span>，由<span class="fm-hl">多模型协同推理决策</span>。底层所使用的大语言模型（LLM）多模式背后结合使用了多种不同的先进模型，包括但不限于 <span class="fm-chip">Claude</span>、<span class="fm-chip">ChatGPT</span>、<span class="fm-chip">Gemini</span>、<span class="fm-chip">Grok</span>、<span class="fm-chip">Qwen</span> 以及 <span class="fm-chip">Kimi</span>。</p><p>根据不同的资产管理任务需求，更好地发挥各个模型的优势来提供数据支持！<span class="fm-jiayou">[加油]</span></p></section><section class="fm-section"><div class="fm-sechead"><span class="fm-secno">01</span><h2 class="fm-h2">市场全景</h2><span class="fm-stamp">数据 · ${date.month}.${date.day} ${date.hour}:${date.minute}</span></div><div class="fm-stats">共 <b>${quotes.length}</b> 项行情 · <b>${advancing}</b> 涨 <b>${declining}</b> 跌 · <b>${headlines.length}</b> 条要闻</div>${quoteLedger(quotes)}</section><section class="fm-news"><div class="fm-sechead"><span class="fm-secno">02</span><h2 class="fm-h2">全网要闻</h2></div>${headlineLedger(headlines)}</section><footer class="fm-footer"><div class="fm-signoff">作者：章鱼 ai</div><div class="fm-accentline"></div><div class="fm-disc">仅供参考，分析研究</div><div class="fm-colophon">OCTOPUS AI · MULTI-MODEL ENSEMBLE<br>CLAUDE · CHATGPT · GEMINI · GROK · QWEN · KIMI</div></footer></div></div>`;
}

export function buildFinanceReport({ quotes, headlines, generatedAt = new Date() }) {
  const compactQuotes = quotes.slice(0, DEFAULT_QUOTE_COUNT).map((quote) => ({
    ...quote,
    label: clipText(quote.label, 40),
    currency: clipText(quote.currency, 12),
  }));
  const compactHeadlines = headlines.slice(0, 15).map((headline) => ({
    ...headline,
    title: clipText(headline.title, 120),
    source: clipText(headline.source, 60),
    link: String(headline.link ?? '').length <= 900 ? headline.link : '',
  }));

  for (let count = compactHeadlines.length; count >= 0; count -= 1) {
    const report = renderFinanceReport({
      quotes: compactQuotes,
      headlines: compactHeadlines.slice(0, count),
      generatedAt,
    });
    if (report.length <= PUSHPLUS_CONTENT_BUDGET) return report;
  }
  throw new Error(`金融杂志 HTML 超过 PushPlus ${PUSHPLUS_CONTENT_LIMIT} 字限制。`);
}

/** Markdown is kept only for logs and the GitHub Actions run summary. */
export function buildFinanceSummary({ quotes, headlines, generatedAt = new Date() }) {
  const date = shanghaiParts(generatedAt);
  const lines = [
    '# 章鱼 AI 全景分析',
    '',
    `> 更新时间：${date.year}-${date.month}-${date.day} ${date.hour}:${date.minute}（北京时间）`,
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
  lines.push('', '---', '作者：章鱼 ai · 仅供参考，分析研究。');
  return lines.join('\n');
}

export function buildPreviewDocument(content) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>章鱼 AI 全景分析</title>
</head>
<body style="margin:0;padding:24px 0;background:#e9e9e7;">
${content}
</body>
</html>`;
}

export async function sendToPushPlus({ token, title, content, topic = '' }) {
  if (!token) throw new Error('缺少 PUSHPLUS_TOKEN，请在 GitHub Actions Secrets 中配置。');
  if (content.length > PUSHPLUS_CONTENT_LIMIT) {
    throw new Error(`PushPlus 推送内容超过 ${PUSHPLUS_CONTENT_LIMIT} 字限制。`);
  }
  const response = await fetch(PUSHPLUS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, title, content, template: 'html', ...(topic ? { topic } : {}) }),
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

  const generatedAt = new Date();
  const report = buildFinanceReport({ quotes, headlines, generatedAt });
  const summary = buildFinanceSummary({ quotes, headlines, generatedAt });
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }

  if (dryRun) {
    const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
    const outputPath = resolve(process.cwd(), outputArgument?.slice('--output='.length) || process.env.FINANCE_PREVIEW_PATH || PREVIEW_FILE);
    await writeFile(outputPath, buildPreviewDocument(report), 'utf8');
    console.log(`\n[finance] 预览模式：未发送 PushPlus。HTML 已写入 ${outputPath}`);
    return;
  }
  await sendToPushPlus({
    token: process.env.PUSHPLUS_TOKEN,
    topic: process.env.PUSHPLUS_TOPIC,
    title: '章鱼 AI 全景分析',
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
