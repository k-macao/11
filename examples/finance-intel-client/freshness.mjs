/**
 * 新鲜度校验 —— 保证「24 小时内更新可用」。
 *
 * 判定顺序（取第一个能拿到的时间戳）：
 *   1. 响应体里的时间字段（generatedAt / as_of / updated_at / lastUpdated / timestamp …）
 *   2. 数组条目里的最新一条时间
 *   3. 都没有 → 退化为「本次抓取时间」，标记 provenance: 'fetch-time'，
 *      这只能证明服务可达，不能证明数据本身新鲜，所以单列出来不算作已验证。
 *
 * 结论：
 *   fresh   —— 有可信时间戳且在阈值内
 *   stale   —— 有可信时间戳但超过阈值
 *   unknown —— 拿不到数据自身的时间戳（仅有抓取时间）
 *   failed  —— 该源拉取失败
 */

const TIME_KEYS = [
  'generatedAt',
  'generated_at',
  'as_of',
  'asOf',
  'updated_at',
  'updatedAt',
  'lastUpdated',
  'last_updated',
  'timestamp',
  'date',
  'observedAt',
  'fetchedAt',
];

const MAX_DEPTH = 4;

/** 在对象里深度优先找最新的一个可解析时间戳。 */
export function findLatestTimestamp(value, depth = 0) {
  if (value == null || depth > MAX_DEPTH) return null;

  if (typeof value === 'string' || typeof value === 'number') return parseTs(value);

  if (Array.isArray(value)) {
    let best = null;
    // 只看前 50 条，避免大数组拖慢
    for (const item of value.slice(0, 50)) {
      const t = findLatestTimestamp(item, depth + 1);
      if (t && (!best || t > best)) best = t;
    }
    return best;
  }

  if (typeof value !== 'object') return null;

  let best = null;
  for (const key of TIME_KEYS) {
    if (key in value) {
      const t = parseTs(value[key]);
      if (t && (!best || t > best)) best = t;
    }
  }
  if (best) return best;

  for (const v of Object.values(value)) {
    const t = findLatestTimestamp(v, depth + 1);
    if (t && (!best || t > best)) best = t;
  }
  return best;
}

function parseTs(v) {
  if (v == null) return null;
  if (typeof v === 'number') {
    // 秒 / 毫秒 都接受；小于 1e11 视作秒
    const ms = v < 1e11 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v !== 'string') return null;
  // 纯数字字符串同样按 epoch 处理
  if (/^\d{10}$|^\d{13}$/.test(v)) return parseTs(Number(v));
  // 要求至少像个日期，避免把 "2026" 之类误判
  if (!/\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {{source:string,payload:any}[]} entries  payload 是 client 返回的信封
 * @param {number} maxAgeHours
 */
export function checkFreshness(entries, maxAgeHours = 24) {
  const now = Date.now();
  const maxAgeMs = maxAgeHours * 3600_000;
  const rows = [];

  for (const { source, payload } of entries) {
    if (!payload || !payload.ok) {
      rows.push({
        source,
        state: 'failed',
        ageHours: null,
        provenance: null,
        error: payload?.error?.kind ?? 'MISSING',
      });
      continue;
    }
    const ts = findLatestTimestamp(payload.data);
    if (!ts) {
      rows.push({
        source,
        state: 'unknown',
        ageHours: null,
        provenance: 'fetch-time',
        fetchedAt: payload.fetchedAt ?? null,
      });
      continue;
    }
    // 未来时间戳（时区/时钟偏差）按 0 处理，不当成新鲜度问题隐藏掉
    const ageMs = Math.max(0, now - ts.getTime());
    rows.push({
      source,
      state: ageMs <= maxAgeMs ? 'fresh' : 'stale',
      ageHours: Number((ageMs / 3600_000).toFixed(2)),
      provenance: 'payload',
      observedAt: ts.toISOString(),
    });
  }

  const counts = rows.reduce((acc, r) => {
    acc[r.state] = (acc[r.state] ?? 0) + 1;
    return acc;
  }, {});

  return {
    maxAgeHours,
    checkedAt: new Date().toISOString(),
    // 只有「无 stale 且无 failed」才算通过；unknown 不算失败，但会单独提示
    pass: !counts.stale && !counts.failed,
    counts: {
      fresh: counts.fresh ?? 0,
      stale: counts.stale ?? 0,
      unknown: counts.unknown ?? 0,
      failed: counts.failed ?? 0,
    },
    rows,
  };
}
