#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Build an editorial financial-market report and deliver it to PushPlus WeChat.
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
.fm{--paper:#f2f4f5;--paper2:#e5ebef;--ink:#0a1f3d;--muted:#5f6d78;--line:rgba(10,31,61,.20);--accent:#315d93;--down:#9a4a3a;width:100%;max-width:680px;margin:0 auto;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei UI',sans-serif}
.fm-cover{position:relative;width:100%;aspect-ratio:3/4;min-height:560px;padding:28px 26px 24px;overflow:hidden;background-color:var(--paper);background-image:radial-gradient(circle at 88% 12%,rgba(49,93,147,.15),transparent 31%),radial-gradient(circle at 14% 82%,rgba(10,31,61,.07),transparent 34%);border:1px solid var(--line)}
.fm-row{display:flex;align-items:flex-start;width:100%}.fm-between{justify-content:space-between}.fm-mastrow{align-items:flex-end;padding-bottom:10px;border-bottom:1px solid var(--ink)}
.fm-mast{font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;letter-spacing:.06em}.fm-issue{text-align:right;font:9px/1.5 ui-monospace,'SFMono-Regular',Consolas,monospace;letter-spacing:.16em;color:var(--muted)}
.fm-hero{margin-top:34px;padding-left:17px;border-left:3px solid var(--accent)}.fm-kicker{font:9px/1.5 ui-monospace,'SFMono-Regular',Consolas,monospace;letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}
.fm-hero .fm-kicker{letter-spacing:.22em;color:var(--muted)}.fm-title{margin:16px 0 0;font-family:'Songti SC','Noto Serif SC',STSong,Georgia,serif;font-size:48px;font-weight:500;line-height:1.13;letter-spacing:.06em}.fm-deck{max-width:85%;margin:17px 0 0;font-family:'Songti SC','Noto Serif SC',STSong,Georgia,serif;font-size:15px;line-height:1.75;color:var(--muted)}
.fm-lead{margin-top:42px;padding:20px 0 18px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.fm-label{font:9px/1.5 ui-monospace,'SFMono-Regular',Consolas,monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}.fm-leadrow{align-items:baseline;margin-top:10px}.fm-leadname{font:20px/1.3 'Songti SC','Noto Serif SC',STSong,Georgia,serif}.fm-leadmove{margin-left:auto;font:italic 30px/1 Georgia,'Times New Roman',serif}
.fm-stats{position:absolute;left:26px;right:26px;bottom:24px;border-top:1px solid var(--ink)}.fm-stat{flex:1;padding-top:12px}.fm-stat:nth-child(2){text-align:center}.fm-stat:last-child{text-align:right}.fm-statnum{font:25px/1 Georgia,'Times New Roman',serif}.fm-statlabel{margin-top:4px;font:8px/1.4 ui-monospace,'SFMono-Regular',Consolas,monospace;letter-spacing:.13em;color:var(--muted)}
.fm-section{padding:35px 26px 12px}.fm-news{margin-top:24px;background:var(--paper2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.fm-sectionhead{align-items:flex-end}.fm-section h2{margin:9px 0 0;font:500 30px/1.25 'Songti SC','Noto Serif SC',STSong,Georgia,serif;letter-spacing:.04em}.fm-time{margin-left:auto;text-align:right;font:9px/1.6 ui-monospace,'SFMono-Regular',Consolas,monospace;letter-spacing:.1em;color:var(--muted)}.fm-intro{margin:11px 0 22px;font:14px/1.7 'Songti SC','Noto Serif SC',STSong,Georgia,serif;color:var(--muted)}.fm-ledger{margin-top:20px}
.fm-empty{padding:28px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font:17px/1.7 'Songti SC','Noto Serif SC',STSong,Georgia,serif;color:var(--muted)}.fm-qrow{padding:17px 0 15px;border-top:1px solid var(--line)}.fm-qline{align-items:flex-start}.fm-no{width:44px;flex:0 0 44px;font:11px/1.4 ui-monospace,'SFMono-Regular',Consolas,monospace;letter-spacing:.12em;color:var(--muted)}.fm-qname{font-size:16px;font-weight:600}.fm-qvalue{width:40%;margin-left:auto;text-align:right;font:16px/1.3 ui-monospace,'SFMono-Regular',Consolas,monospace}.fm-change{margin-top:4px;font-size:13px;font-weight:600}.fm-bar{width:100%;height:2px;margin-top:11px;background:var(--paper2)}.fm-bar i{display:block;height:2px}
.fm-story{padding:23px 0 21px;border-top:1px solid var(--line)}.fm-storyno{width:48px;flex:0 0 48px;font:italic 29px/1 'Songti SC','Noto Serif SC',STSong,Georgia,serif;color:var(--accent)}.fm-storybody{flex:1}.fm-storytitle{font:18px/1.58 'Songti SC','Noto Serif SC',STSong,Georgia,serif;letter-spacing:.01em}.fm-storytitle a{color:var(--ink);text-decoration:none}.fm-meta{margin-top:9px;font:10px/1.5 ui-monospace,'SFMono-Regular',Consolas,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.fm-footer{padding:34px 26px 38px;background:var(--ink);color:var(--paper)}.fm-signoff{font:italic 22px/1.35 Georgia,'Times New Roman',serif;letter-spacing:.04em}.fm-accentline{width:42px;height:2px;margin:22px 0;background:var(--accent)}.fm-colophon{font:8px/1.7 ui-monospace,'SFMono-Regular',Consolas,monospace;letter-spacing:.12em;color:#b5c0ca}.fm-disclaimer{margin-left:auto;text-align:right;font:11px/1.7 'Songti SC','Noto Serif SC',STSong,Georgia,serif;color:#c5ced5}
@media(max-width:480px){.fm-title{font-size:44px}.fm-cover{padding-left:22px;padding-right:22px}.fm-stats{left:22px;right:22px}.fm-section,.fm-footer{padding-left:22px;padding-right:22px}}
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
    const tone = quote.changePercent < 0 ? 'var(--down)' : 'var(--accent)';
    const bar = change.width > 0
      ? `<i style="width:${change.width.toFixed(1)}%;background:${tone}"></i>`
      : '';
    return `<div class="fm-qrow"><div class="fm-row fm-qline"><span class="fm-no">${String(index + 1).padStart(2, '0')}</span><span class="fm-qname">${escapeHtml(quote.label)}</span><span class="fm-qvalue">${escapeHtml(formatPrice(quote.price))}${currency}<span class="fm-change" style="display:block;color:${tone}">${change.arrow} ${change.label}</span></span></div><div class="fm-bar">${bar}</div></div>`;
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
    return `<div class="fm-story"><div class="fm-row"><span class="fm-storyno">${String(index + 1).padStart(2, '0')}</span><span class="fm-storybody"><span class="fm-storytitle">${linkedTitle}</span>${meta ? `<span class="fm-meta" style="display:block">${meta}</span>` : ''}</span></div></div>`;
  }).join('');
}

/**
 * Render a portrait, single-column HTML issue for the PushPlus HTML template.
 * The design adapts Guizang's Editorial Magazine × E-ink system to a compact
 * financial ledger: serif display, mono metadata, paper/ink palette, hairline
 * rules, one restrained accent, and intentional 3:4 cover composition.
 */
function renderFinanceReport({ quotes, headlines, generatedAt }) {
  const date = shanghaiParts(generatedAt);
  const finiteMoves = quotes.filter((quote) => Number.isFinite(quote.changePercent));
  const leadQuote = finiteMoves.reduce((strongest, quote) => (
    !strongest || Math.abs(quote.changePercent) > Math.abs(strongest.changePercent) ? quote : strongest
  ), null);
  const advancing = finiteMoves.filter((quote) => quote.changePercent > 0).length;
  const declining = finiteMoves.filter((quote) => quote.changePercent < 0).length;
  const leadChange = leadQuote ? changeParts(leadQuote.changePercent) : null;
  const issueCode = `WM-${date.year}${date.month}${date.day}`;
  const leadName = leadQuote ? escapeHtml(leadQuote.label) : '市场待更新';
  const leadMove = leadChange ? `${leadChange.arrow} ${leadChange.label}` : '— 暂无';
  const leadTone = leadQuote?.changePercent < 0 ? 'var(--down)' : 'var(--accent)';

  return `<style>${REPORT_STYLES}</style><div class="fm" data-finance-template="editorial-portrait"><div class="fm-cover"><div class="fm-row fm-between fm-mastrow"><span class="fm-mast">WORLD MONITOR</span><span class="fm-issue">MARKET REVIEW<br>${escapeHtml(issueCode)}</span></div><div class="fm-hero"><div class="fm-kicker">Global Finance · Daily Edition</div><h1 class="fm-title">金融市场<br>纵览</h1><p class="fm-deck">从全球指数、外汇与大宗商品，到今日值得关注的金融叙事。</p></div><div class="fm-lead"><div class="fm-label">Lead movement</div><div class="fm-row fm-leadrow"><span class="fm-leadname">${leadName}</span><span class="fm-leadmove" style="color:${leadTone}">${leadMove}</span></div></div><div class="fm-row fm-stats"><span class="fm-stat"><span class="fm-statnum">${quotes.length}</span><span class="fm-statlabel" style="display:block">ASSETS</span></span><span class="fm-stat"><span class="fm-statnum">${advancing}/${declining}</span><span class="fm-statlabel" style="display:block">UP / DOWN</span></span><span class="fm-stat"><span class="fm-statnum">${headlines.length}</span><span class="fm-statlabel" style="display:block">STORIES</span></span></div></div><div class="fm-section"><div class="fm-row fm-sectionhead"><span><span class="fm-kicker">01 · Market Ledger</span><h2>市场行情</h2></span><span class="fm-time">${date.year}.${date.month}.${date.day}<br>${date.hour}:${date.minute} CST</span></div><div class="fm-ledger">${quoteLedger(quotes)}</div></div><div class="fm-section fm-news"><div class="fm-kicker">02 · News Desk</div><h2>金融要闻</h2><p class="fm-intro">编辑台精选 · 点击标题阅读全文</p>${headlineLedger(headlines)}</div><div class="fm-footer"><div class="fm-signoff">Read the signal,<br>not the noise.</div><div class="fm-accentline"></div><div class="fm-row"><span class="fm-colophon">WORLD MONITOR<br>GLOBAL FINANCE DESK</span><span class="fm-disclaimer">数据仅供参考<br>不构成投资建议</span></div></div></div>`;
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
    '# 金融市场速报',
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
  lines.push('', '---', '数据仅供参考，不构成投资建议。');
  return lines.join('\n');
}

export function buildPreviewDocument(content) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>金融市场纵览 · PushPlus 预览</title>
</head>
<body style="margin:0;padding:24px 12px;background:#d9dde0;">
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
    title: `金融市场纵览 ${dateTitle(generatedAt)}`,
    content: report,
  });
  console.log('\n[finance] PushPlus 微信推送成功。');
}

function dateTitle(value) {
  const date = shanghaiParts(value);
  return `${date.year}/${date.month}/${date.day}`;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(`[finance] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
