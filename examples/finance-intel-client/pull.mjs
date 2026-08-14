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
        '  --list                 列出全部数据源及说明',
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

  const includePremium = args.premium !== 'false' && args.noPremium !== 'true';
  const only = args.only ? args.only.split(',').map((s) => s.trim()) : undefined;
  const group = args.group && args.group !== 'true' ? args.group : undefined;

  const chosen = selectSources({ group, only, includePremium });
  if (!chosen.length) {
    console.error('没有匹配的数据源。用 --list 查看可用 id / 分组。');
    return 2;
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
  };

  console.log(summarize(snapshot));
  if (args.pretty) console.log(JSON.stringify(snapshot, null, 2));
  if (args.out && args.out !== 'true') {
    await writeFile(args.out, JSON.stringify(snapshot, null, 2));
    console.log(`已写出 ${args.out}`);
  }

  return snapshot.ok > 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
