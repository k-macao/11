#!/usr/bin/env node
/**
 * 命令行入口：从 World Monitor 托管 API 拉取金融 + 国际形势数据。
 *
 *   export WM_KEY=wm_xxxxxxxx…
 *   node pull.mjs --list
 *   node pull.mjs --group markets,macro
 *   node pull.mjs --only market-quotes,fear-greed --pretty
 *   node pull.mjs --group geopolitics --out snapshot.json
 *   node pull.mjs --only country-risk --param country_code=SA
 *   node pull.mjs --group markets --jmespath 'keys(@)'
 *   node pull.mjs --group macro --base http://127.0.0.1:8787   # 指向本地 mock
 */

import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { WorldMonitorClient } from './client.mjs';
import { checkFreshness } from './freshness.mjs';
import { fetchDigest, VARIANT_CATEGORIES } from './news.mjs';
import { CATALOG, fetchRadar } from './radar.mjs';
import { GROUPS, selectSources, SOURCES } from './sources.mjs';

function parseArgs(argv) {
  const out = { param: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    const key = (eq === -1 ? a.slice(2) : a.slice(2, eq)).replace(/-([a-z])/g, (_, c) =>
      c.toUpperCase(),
    );
    let val = eq === -1 ? undefined : a.slice(eq + 1);
    if (val === undefined) {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        val = next;
        i++;
      } else {
        val = 'true';
      }
    }
    if (key === 'param') {
      const [pk, ...rest] = val.split('=');
      const pv = rest.join('=');
      out.param[pk] = pv.includes(',') ? pv.split(',') : pv;
    } else {
      out[key] = val;
    }
  }
  return out;
}

function printList() {
  console.log('\nWorld Monitor 金融 / 国际形势数据源目录\n');
  for (const [g, label] of Object.entries(GROUPS)) {
    const items = SOURCES.filter((s) => s.group === g);
    console.log(`── ${label} (--group ${g})  ${items.length} 个源`);
    for (const s of items) {
      const tag = s.premium ? ' [PRO]' : '';
      console.log(`   ${s.id.padEnd(26)}${tag}`);
      console.log(`   ${' '.repeat(26)}${s.zh}`);
      console.log(`   ${' '.repeat(26)}${s.path}`);
      console.log(`   ${' '.repeat(26)}上游: ${s.upstream} · 节奏: ${s.cadence}`);
    }
    console.log('');
  }
  console.log(`合计 ${SOURCES.length} 个数据源。用 --group / --only 挑选。\n`);

  console.log('── 金融雷达 (--radar) 静态目录，来自仓库配置');
  const byTier = CATALOG.exchanges.reduce((a, e) => {
    a[e.tier] = (a[e.tier] ?? 0) + 1;
    return a;
  }, {});
  console.log(
    `   交易所 ${CATALOG.exchanges.length} 家 (超大型 ${byTier.mega} / 主要 ${byTier.major} / 新兴 ${byTier.emerging})，其中 ${CATALOG.exchangeIndexSymbols.length} 家有可拉取的基准指数`,
  );
  if (CATALOG.exchangesWithoutIndex.length) {
    console.log(`   无公开基准指数（仅静态元数据）: ${CATALOG.exchangesWithoutIndex.join(', ')}`);
  }
  console.log(
    `   金融中心 ${CATALOG.financialCenters.length} · 央行 ${CATALOG.centralBanks.length} · 商品枢纽 ${CATALOG.commodityHubs.length}`,
  );
  console.log(
    `   大宗商品/外汇 ${CATALOG.commoditySymbols.length} 符号 · 加密 ${CATALOG.cryptoIds.length} 资产 · 默认股票 ${CATALOG.stocks.defaultSymbols.length}/${CATALOG.stocks.catalogSize}\n`,
  );

  console.log('── 新闻摘要 (--news) 变体与类别');
  for (const [variant, cats] of Object.entries(VARIANT_CATEGORIES)) {
    const n = Object.values(cats).reduce((a, b) => a + b, 0);
    console.log(`   --variant ${variant.padEnd(10)} ${Object.keys(cats).length} 类 / ${n} 源`);
  }
  console.log(
    `   条目合计 ${CATALOG.newsFeedEntries}，去重后 ${CATALOG.newsFeedUniqueSources} 家独立信源\n`,
  );
}

function summarize(snapshot) {
  const lines = [];
  lines.push('');
  lines.push(`基址 ${snapshot.base}`);
  lines.push(
    `时间 ${snapshot.generatedAt} · 请求 ${snapshot.requested} · 成功 ${snapshot.ok} · 失败 ${snapshot.failed}`,
  );
  lines.push('');
  for (const r of snapshot.results) {
    if (r.ok) {
      lines.push(`  ✓ ${r.source.padEnd(26)} ${String(r.status).padEnd(4)} ${r.ms}ms  ${shape(r.data)}`);
    } else {
      lines.push(
        `  ✗ ${r.source.padEnd(26)} ${String(r.status || '-').padEnd(4)} ${r.error.kind}: ${String(
          r.error.message,
        ).slice(0, 90)}`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

const pct = (v) => (v == null ? '  --  ' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`.padStart(7));
const price = (v) => (v == null ? '--' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));

function renderFreshness(f) {
  const c = f.counts;
  const badge = f.pass ? '✓ 通过' : '✗ 未通过';
  const lines = [
    `新鲜度 (阈值 ${f.maxAgeHours}h) ${badge} — 新鲜 ${c.fresh} · 过期 ${c.stale} · 无时间戳 ${c.unknown} · 失败 ${c.failed}`,
  ];
  for (const r of f.rows) {
    if (r.state === 'fresh') continue; // 只显示需要注意的
    const detail =
      r.state === 'stale'
        ? `已 ${r.ageHours}h`
        : r.state === 'failed'
          ? r.error
          : '响应体无时间戳，仅能确认服务可达';
    lines.push(`   · ${r.source}: ${r.state} (${detail})`);
  }
  return lines.join('\n');
}

function renderRadar(r) {
  const L = ['', '═══ 金融雷达 ═══', ''];

  const e = r.exchanges;
  L.push(`交易所 ${e.total} 家 · 有行情 ${e.withQuote} · 当前开盘 ${e.open}`);
  L.push('');
  for (const tier of ['mega', 'major', 'emerging']) {
    const rows = e.rows.filter((x) => x.tier === tier);
    if (!rows.length) continue;
    const label = { mega: '超大型 (>$5T)', major: '主要 ($1-5T)', emerging: '新兴/区域' }[tier];
    L.push(`  ── ${label}`);
    for (const x of rows) {
      const open = x.marketOpen === null ? ' ? ' : x.marketOpen ? '●开' : '○闭';
      const q =
        x.quoteStatus === 'no-index'
          ? '（无公开基准指数）'
          : x.quoteStatus === 'missing'
            ? '（未返回行情）'
            : `${(x.indexSymbol ?? '').padEnd(12)} ${price(x.price).padStart(12)}  ${pct(x.changePercent)}`;
      L.push(`     ${open} ${x.shortName.padEnd(10)} ${x.country}  ${q}`);
    }
    L.push('');
  }

  const c = r.commodities;
  L.push(`大宗商品 / 外汇 ${c.quotes.length}/${c.expectedSymbols}`);
  for (const q of c.quotes.slice(0, 12)) {
    L.push(`     ${String(q.symbol).padEnd(12)} ${price(q.price).padStart(12)}  ${pct(q.changePercent)}`);
  }
  if (c.quotes.length > 12) L.push(`     … 其余 ${c.quotes.length - 12} 项见 JSON`);
  L.push('');

  const k = r.crypto;
  L.push(`加密货币 ${k.quotes.length}/${k.expectedIds}`);
  for (const q of k.quotes.slice(0, 12)) {
    L.push(`     ${String(q.symbol).padEnd(12)} ${price(q.price).padStart(12)}  ${pct(q.changePercent)}`);
  }
  L.push('');

  const m = r.macroSignals;
  L.push(`7 信号综合指标 — 结论: ${m.verdict ?? '（未返回）'} · 已获取 ${m.presentCount}/7`);
  for (const s of m.signals) {
    const status = s.present ? (s.status ?? 'n/a') : '缺失';
    L.push(`     ${s.label.padEnd(12)} ${String(status).padEnd(10)} ${s.detail}`);
  }
  L.push('');

  if (r.errors.length) {
    L.push('错误:');
    for (const err of r.errors) L.push(`     ✗ ${err.source}: ${err.kind} ${String(err.message ?? '').slice(0, 80)}`);
    L.push('');
  }

  L.push(renderFreshness(r.freshness));
  L.push('');
  return L.join('\n');
}

function renderNews(d) {
  const L = ['', '═══ 新闻摘要 ═══', ''];
  if (!d.ok) {
    L.push(`✗ 拉取失败: ${d.error.kind} ${String(d.error.message ?? '').slice(0, 160)}`);
    L.push('');
    L.push(renderFreshness(d.freshness));
    L.push('');
    return L.join('\n');
  }

  L.push(`变体 ${d.variant} · 生成于 ${d.generatedAt ?? '未知'}`);
  L.push(
    `类别 ${d.returnedCategories}/${d.configuredCategories} · 条目 ${d.totalItems} · 告警 ${d.alerts}`,
  );
  if (d.degradedFeeds.length) {
    L.push(`降级信源 ${d.degradedFeeds.length}: ${d.degradedFeeds.slice(0, 6).map((f) => `${f.feed}(${f.state})`).join(', ')}${d.degradedFeeds.length > 6 ? ' …' : ''}`);
  }
  L.push('');

  for (const cat of d.categories) {
    L.push(`  ── ${cat.label} (${cat.key}) · ${cat.count} 条`);
    for (const it of cat.items.slice(0, 5)) {
      const score = it.importanceScore != null ? `[${it.importanceScore}]` : '[--]';
      const alert = it.isAlert ? ' 🔴' : '';
      L.push(`     ${score}${alert} ${String(it.title ?? '').slice(0, 78)}`);
      L.push(`            ${it.source ?? '?'} · ${it.publishedAt ?? '无时间'}`);
    }
    if (cat.count > 5) L.push(`     … 其余 ${cat.count - 5} 条见 JSON`);
    L.push('');
  }

  L.push(renderFreshness(d.freshness));
  L.push('');
  return L.join('\n');
}

function shape(data) {
  if (Array.isArray(data)) return `array(${data.length})`;
  if (data && typeof data === 'object') {
    const keys = Object.keys(data);
    const arrKey = keys.find((k) => Array.isArray(data[k]));
    const n = arrKey ? `${arrKey}[${data[arrKey].length}]` : '';
    return `{${keys.slice(0, 5).join(',')}${keys.length > 5 ? ',…' : ''}} ${n}`.trim();
  }
  return typeof data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(
      [
        '',
        '用法: node pull.mjs [选项]',
        '',
        '模式:',
        '  --radar                金融雷达: 29 交易所 + 大宗商品 + 加密 + 7 信号',
        '  --news                 新闻摘要: 500+ 源、多类别、AI 简报',
        '  --list                 列出全部数据源及说明',
        '  (默认)                 按 --group / --only 逐源拉取',
        '',
        '金融雷达选项:',
        '  --exchanges <A,B>      只要某几家交易所 (shortName，如 NYSE,HKEX)',
        '',
        '新闻选项:',
        '  --variant <v>          full | finance | tech | commodity | happy (默认 finance)',
        '  --lang <code>          ISO 639-1 语言码，如 zh / en',
        '  --categories <a,b>     只要某几个类别',
        '  --limit <n>            每类最多几条',
        '  --min-importance <n>   重要性下限',
        '  --alerts-only          只要 alert 条目',
        '',
        '通用选项:',
        '  --max-age <hours>      新鲜度阈值，默认 24',
        '  --group <a,b>          按分组拉取: ' + Object.keys(GROUPS).join(' | '),
        '  --only <id,id>         按源 id 拉取',
        '  --param k=v            覆盖查询参数 (可重复)，如 --param country_code=SA',
        '  --jmespath <expr>      服务端投影，减小响应体',
        '  --no-premium           跳过 PRO 源',
        '  --base <url>           API 基址 (默认 https://api.worldmonitor.app)',
        '  --key <wm_...>         API key (默认取环境变量 WM_KEY)',
        '  --concurrency <n>      并发数 (默认 4)',
        '  --timeout <ms>         单源超时 (默认 20000)',
        '  --retries <n>          重试次数 (默认 2)',
        '  --out <file.json>      写出完整 JSON',
        '  --pretty               终端打印完整 JSON',
        '',
      ].join('\n'),
    );
    return 0;
  }

  if (args.list) {
    printList();
    return 0;
  }

  const key = args.key ?? process.env.WM_KEY ?? '';
  if (!key) {
    console.error(
      '提示: 未设置 WM_KEY。服务端调用托管 API 需要 key（Dashboard → Settings → API Keys）。继续尝试匿名请求…',
    );
  }

  const client = new WorldMonitorClient({
    apiKey: key,
    base: args.base,
    timeoutMs: Number(args.timeout ?? 20_000),
    retries: Number(args.retries ?? 2),
    concurrency: Number(args.concurrency ?? 4),
    onEvent: (e) => {
      if (e.type === 'retry') {
        console.error(`  … 重试 ${e.source} (第 ${e.attempt + 1} 次, ${e.status ?? e.error})`);
      }
    },
  });

  const maxAgeHours = Number(args.maxAge ?? 24);
  const emit = async (payload, text) => {
    console.log(text);
    if (args.pretty) console.log(JSON.stringify(payload, null, 2));
    if (args.out && args.out !== 'true') {
      await writeFile(args.out, JSON.stringify(payload, null, 2));
      console.log(`已写出 ${args.out}`);
    }
  };

  // ── 模式一：金融雷达 ──────────────────────────────────
  if (args.radar) {
    const radar = await fetchRadar(client, {
      exchanges:
        args.exchanges && args.exchanges !== 'true'
          ? args.exchanges.split(',').map((s) => s.trim())
          : undefined,
      maxAgeHours,
    });
    await emit(radar, renderRadar(radar));
    return radar.freshness.pass ? 0 : 1;
  }

  // ── 模式二：新闻摘要 ──────────────────────────────────
  if (args.news) {
    const digest = await fetchDigest(client, {
      variant: args.variant && args.variant !== 'true' ? args.variant : 'finance',
      lang: args.lang && args.lang !== 'true' ? args.lang : undefined,
      categories:
        args.categories && args.categories !== 'true'
          ? args.categories.split(',').map((s) => s.trim())
          : undefined,
      limit: args.limit ? Number(args.limit) : undefined,
      minImportance: args.minImportance ? Number(args.minImportance) : undefined,
      alertsOnly: args.alertsOnly === 'true',
      maxAgeHours,
    });
    await emit(digest, renderNews(digest));
    return digest.ok && digest.freshness.pass ? 0 : 1;
  }

  // ── 模式三：逐源拉取 ──────────────────────────────────
  const includePremium = args.premium !== 'false' && args.noPremium !== 'true';
  const only = args.only ? args.only.split(',').map((s) => s.trim()) : undefined;
  const group = args.group && args.group !== 'true' ? args.group : undefined;

  const chosen = selectSources({ group, only, includePremium });
  if (!chosen.length) {
    console.error('没有匹配的数据源。用 --list 查看可用 id / 分组。');
    return 2;
  }

  const override = {};
  if (Object.keys(args.param).length) override.params = args.param;
  if (args.jmespath && args.jmespath !== 'true') override.jmespath = args.jmespath;

  const results = await client.fetchMany(chosen, override);
  const snapshot = {
    base: client.base,
    generatedAt: new Date().toISOString(),
    requested: chosen.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
    freshness: checkFreshness(
      results.map((r) => ({ source: r.source, payload: r })),
      maxAgeHours,
    ),
  };

  await emit(snapshot, `${summarize(snapshot)}\n${renderFreshness(snapshot.freshness)}\n`);
  return snapshot.ok > 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
