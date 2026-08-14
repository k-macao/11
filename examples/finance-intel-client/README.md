# 金融情报接入客户端 (finance-intel-client)

从 World Monitor **托管 API**（`https://api.worldmonitor.app`）拉取看板里的金融数据，以及影响金融的国际形势数据。零依赖，Node 18+ 直接跑。

covers **62 个数据源**，分 6 组：

| 分组 | `--group` | 数量 | 内容 |
|---|---|---|---|
| 市场行情 | `markets` | 13 | 股指/个股、加密、商品、板块、恐贪、广度、COT、ETF 流、海湾市场、黄金 |
| 宏观与央行 | `macro` | 17 | 宏观雷达、FRED 批量、BIS 政策利率/REER/信贷、ECB 汇率与曲线、金融压力、中国官方宏观 |
| 能源与商品 | `energy` | 8 | EIA 原油/天然气库存、欧洲储气、油价、燃油零售价、关键矿产 |
| 国际形势 | `geopolitics` | 12 | **事件→市场影响映射**、国家不稳定指数、预测市场、制裁、ACLED 冲突、GDELT 主题热度、安全警告 |
| 贸易与供应链 | `trade` | 8 | WTO 贸易限制与关税、Comtrade 流量、咽喉水道状态、运价、航行警告 |
| 推演与预测 | `risk` | 4 | 预测评分卡、情景模板、能源冲击与成本冲击测算 |

## 快速开始

```bash
cd examples/finance-intel-client

# 1) 看目录（不发请求）
node pull.mjs --list

# 2) 配置 key：Dashboard → Settings → API Keys，形如 wm_ + 40 位小写十六进制
export WM_KEY=wm_0123456789abcdef0123456789abcdef01234567

# 3) 拉数据
node pull.mjs --group markets,macro
node pull.mjs --only market-implications,risk-scores,prediction-markets --out geo.json
node pull.mjs --only country-risk --param country_code=SA
node pull.mjs --group markets --jmespath 'keys(@)'      # 服务端投影，省带宽
node pull.mjs                                            # 全部 62 源
```

不带 `--group/--only` 时拉全部。`--no-premium` 跳过 PRO 源（如全球债务时钟）。

## 离线自测（无 key / 无外网时）

```bash
node mock-server.mjs &                       # 127.0.0.1:8787，覆盖全部 62 条路由
node pull.mjs --base http://127.0.0.1:8787 --key wm_test
```

mock 会对 `get-cot-positioning` 前两次返回 429，用来验证客户端的退避重试；对 PRO 源在无 key 时返回 402，用来验证失败隔离。

## 作为库使用

```js
import { WorldMonitorClient } from './client.mjs';
import { selectSources } from './sources.mjs';

const wm = new WorldMonitorClient({ apiKey: process.env.WM_KEY, concurrency: 6 });

// 组合快照
const snap = await wm.snapshot({ group: 'markets,geopolitics' });
console.log(snap.ok, '/', snap.requested);

// 单源 + 参数覆盖
const [risk] = await wm.fetchMany(selectSources({ only: ['country-risk'] }), {
  params: { country_code: 'SA' },
});
console.log(risk.data);
```

返回统一信封：

```jsonc
{
  "ok": true,
  "source": "market-quotes",
  "group": "markets",
  "status": 200,
  "ms": 143,
  "fetchedAt": "2026-08-14T10:41:15.174Z",
  "data": { /* 上游原样 JSON */ }
}
```

失败时 `ok:false`，`error.kind ∈ AUTH | PAYMENT_REQUIRED | NOT_FOUND | RATE_LIMITED | UPSTREAM | TIMEOUT | NETWORK | MISSING_PARAM | BAD_JSON`。单源失败不会中断整体拉取。

## 工程细节

- **认证**：`X-WorldMonitor-Key` 头。服务端调用、非受信浏览器来源必须带 key。
- **重试**：仅对 429 与 5xx 重试；指数退避 + 抖动，遵守 `Retry-After`。401/402/403/404 视为确定性失败，立即返回。
- **并发**：默认 4，`--concurrency` 调整。别把托管 API 当高频行情源打——数据本身是种子缓存节奏（5–30 分钟到日更），高频轮询只会撞限流。
- **参数展开**：数组参数按 OpenAPI `explode: true` 展开为重复 key（`?symbols=AAPL&symbols=TSLA`）。
- **批量替代方案**：要一次性水合整个看板，用 `GET /api/bootstrap`，一个请求拿到全部种子缓存，比逐源拉便宜得多。本客户端是给「按需挑选特定源」的场景用的。

## 各源上游与刷新节奏

`node pull.mjs --list` 会打印每个源的上游提供方（FRED / ECB / BIS / Eurostat / EIA / GIE AGSI+ / IEA / CFTC / CoinGecko / WTO / UN Comtrade / IMF PortWatch / ACLED / GDELT / Polymarket …）与刷新节奏。定义都在 `sources.mjs`，加源只需往数组里追加一条，CLI 与 mock 会自动识别。

路由已对照仓库内 `docs/api/*.openapi.yaml` 校验；完整字段结构见 `docs/finance-data.mdx` 与 `docs/data-sources.mdx`。

## 文件

| 文件 | 作用 |
|---|---|
| `sources.mjs` | 62 个数据源的目录（路由、参数、上游、节奏、中文说明） |
| `client.mjs` | HTTP 客户端（重试、超时、并发、错误规范化） |
| `pull.mjs` | CLI |
| `mock-server.mjs` | 离线 mock API |
