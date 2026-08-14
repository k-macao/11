# 金融情报接入客户端 (finance-intel-client)

从 World Monitor **托管 API**（`https://api.worldmonitor.app`）接入看板数据。零依赖，Node 18+ 直接跑。

三种模式：

| 模式 | 命令 | 内容 |
|---|---|---|
| **金融雷达** | `--radar` | 29 家证券交易所 + 33 个大宗商品/外汇 + 10 个加密资产 + 7 信号市场综合指标 |
| **新闻摘要** | `--news` | 500+ 精选信源、按类别聚合、AI 综合简报 |
| 逐源拉取 | `--group` / `--only` | 62 个金融 / 宏观 / 能源 / 地缘 / 贸易 / 推演数据源 |

三种模式**都强制 24 小时新鲜度校验**，未通过时进程退出码为 1，可直接用于 CI 和告警。

## 快速开始

```bash
cd examples/finance-intel-client

# key: Dashboard → Settings → API Keys（wm_ + 40 位小写十六进制）
export WM_KEY=wm_0123456789abcdef0123456789abcdef01234567

node pull.mjs --list      # 看完整目录（不发请求）
node pull.mjs --radar     # 金融雷达
node pull.mjs --news      # 新闻摘要（默认 finance 变体）
```

---

## 1. 金融雷达 `--radar`

```bash
node pull.mjs --radar
node pull.mjs --radar --exchanges NYSE,HKEX,Tadawul     # 只看某几家
node pull.mjs --radar --out radar.json --pretty
```

一次调用聚合 5 个 RPC：

| 内容 | 接口 |
|---|---|
| 交易所基准指数 | `GET /api/market/v1/list-market-quotes` |
| 大宗商品 + 外汇 | `GET /api/market/v1/list-commodity-quotes` |
| 加密货币 | `GET /api/market/v1/list-crypto-quotes` |
| 7 信号综合指标 | `GET /api/economic/v1/get-macro-signals` |
| 恐慌贪婪 | `GET /api/market/v1/get-fear-greed-index` |

输出示例：

```
交易所 29 家 · 有行情 21 · 当前开盘 8

  ── 超大型 (>$5T)
     ○闭 NYSE       US  ^GSPC              6180.50   +0.42%
     ●开 Euronext   NL  ^AEX                921.30   -0.18%
  ── 新兴/区域
     ●开 MOEX       RU  （无公开基准指数）

7 信号综合指标 — 结论: CASH · 已获取 7/7
     流动性          BEARISH    JPY 30 日变动率 —— 日元套息平仓即全球流动性收紧
     资金结构         NEUTRAL    BTC 与 QQQ 的 5 日收益对比
     宏观状态         BULLISH    QQQ 与 XLP 的 20 日 ROC —— 成长 vs 防御
     BTC 技术趋势     BULLISH    SMA50 / SMA200 / VWAP / Mayer Multiple
     算力           BULLISH    比特币全网算力 30 日变化
     价格动能         NEUTRAL    Mayer Multiple 偏离度
     恐慌贪婪         GREED      综合情绪指数，含 30 日历史

新鲜度 (阈值 24h) ✓ 通过 — 新鲜 5 · 过期 0 · 无时间戳 0 · 失败 0
```

**关于「29 家交易所」的诚实说明**：29 家全部有静态元数据（坐标、市值、交易时段、时区），其中 **21 家**在 `shared/stocks.json` 里有对应的基准指数符号，能拉到实时行情。另外 8 家（JSE、SET、BVL、MOEX、NGX、EGX、NZX、TASE）看板里没有配置公开指数符号，标记为 `quoteStatus: 'no-index'` —— 这是配置边界，不是拉取失败，所以不计入错误、也不拖累新鲜度判定。要补齐的话，在 `gen-catalog.mjs` 的 `EXCHANGE_INDEX` 里加映射即可。

`marketOpen` 用交易所的 `tradingHours` + `timezone` 判断，粗粒度、**不含节假日**，别拿它当交易系统的开闭市依据。

---

## 2. 新闻摘要 `--news`

```bash
node pull.mjs --news                                       # finance 变体
node pull.mjs --news --variant full --lang zh
node pull.mjs --news --categories crypto,centralbanks --limit 5
node pull.mjs --news --alerts-only --min-importance 85
```

走 `GET /api/news/v1/list-feed-digest?variant=…&lang=…`：服务端已经把全部 RSS 抓好、去重、打分、按类别聚合。**不要自己逐个抓 RSS** —— 既慢又会撞对方限流，而且拿不到 corroboration 交叉验证分。

变体与类别构成（由 `gen-catalog.mjs` 从 `src/config/feeds.ts` 统计，不手抄）：

| 变体 | 类别数 | 源条目 |
|---|---|---|
| `full` | 15 | 252 |
| `finance` | 13 | 67 |
| `tech` | 21 | 154 |
| `commodity` | 3 | 51 |
| `happy` | 5 | 27 |

全仓合计 **629 条源条目、去重后 586 家独立信源** —— 这就是「500+ 精选新闻源」的实际口径（`full` 单个变体是 252 条，跨变体去重后才到 586）。

每条新闻带 `importanceScore`（重要性）、`corroborationCount`（几家独立信源交叉印证）、`isAlert`（告警）、`location`（经纬度）。客户端默认按重要性降序、其次按时间排序。

`feedStatuses` 只上报非 ok 状态（`empty` / `timeout` / `all-undated` / `partial-undated`），缺席即正常 —— 客户端把它们汇总成 `degradedFeeds` 打印出来，方便你知道这次摘要有多少源掉线了。

**AI 综合简报**：`fetchCachedSummary(client, cacheKey)` 走 `summarize-article-cache`（CDN 可缓存、便宜）。现算的 `POST /api/news/v1/summarize-article` **本模块刻意不默认调用** —— 它按 LLM 配额计费，免费额度很容易被一次批量跑光。要用请自己显式调。

---

## 3. 逐源拉取（62 个数据源）

| 分组 | `--group` | 数量 | 内容 |
|---|---|---|---|
| 市场行情 | `markets` | 13 | 股指/个股、加密、商品、板块、恐贪、广度、COT、ETF 流、海湾市场、黄金 |
| 宏观与央行 | `macro` | 17 | 宏观雷达、FRED 批量、BIS 政策利率/REER/信贷、ECB 汇率与曲线、金融压力、中国官方宏观 |
| 能源与商品 | `energy` | 8 | EIA 原油/天然气库存、欧洲储气、油价、燃油零售价、关键矿产 |
| 国际形势 | `geopolitics` | 12 | **事件→市场影响映射**、国家不稳定指数、预测市场、制裁、ACLED 冲突、GDELT 主题热度、安全警告 |
| 贸易与供应链 | `trade` | 8 | WTO 贸易限制与关税、Comtrade 流量、咽喉水道状态、运价、航行警告 |
| 推演与预测 | `risk` | 4 | 预测评分卡、情景模板、能源冲击与成本冲击测算 |

```bash
node pull.mjs --group markets,macro
node pull.mjs --only country-risk --param country_code=SA
node pull.mjs --group markets --jmespath 'keys(@)'      # 服务端投影，省带宽
node pull.mjs --no-premium                              # 跳过 PRO 源
```

---

## 24 小时新鲜度门禁

`freshness.mjs` 独立于取数逻辑，判定顺序：

1. 响应体里的时间字段（`generatedAt` / `as_of` / `updated_at` / `pubDate` / `timestamp` …，深度优先取最新）
2. 数组条目里的最新一条时间（只扫前 50 条，避免大数组拖慢）
3. 都没有 → 退化为抓取时间，标记 `provenance: 'fetch-time'`

四种状态：

| 状态 | 含义 | 计入 `pass` 失败？ |
|---|---|---|
| `fresh` | 有可信时间戳且在阈值内 | — |
| `stale` | 有可信时间戳但超阈值 | ✗ 是 |
| `unknown` | 拿不到数据自身的时间戳，只能确认服务可达 | 否，但单独列出 |
| `failed` | 该源拉取失败 | ✗ 是 |

关键取舍：**`unknown` 不算通过、也不算失败**。只有抓取时间只能证明「服务活着」，不能证明「数据是新的」—— 把它算成 fresh 是自欺欺人，算成 stale 又会误伤本来就不带时间戳的接口。所以单独一档，明确提示。

```bash
node pull.mjs --radar --max-age 6      # 收紧到 6 小时
echo $?                                 # 0 = 通过，1 = 有 stale 或 failed
```

---

## 离线自测（无 key / 无外网）

```bash
node mock-server.mjs &
node pull.mjs --radar --base http://127.0.0.1:8787 --key wm_test
node pull.mjs --news  --base http://127.0.0.1:8787 --key wm_test

# 验证新鲜度门禁真的会拦截
STALE=crypto,news node mock-server.mjs &
node pull.mjs --radar --base http://127.0.0.1:8787 --key wm_test; echo "exit=$?"   # → 1
```

mock 覆盖全部 62 条路由 + 新闻摘要，并内置三条异常路径：`get-cot-positioning` 前两次返回 429（验证退避重试）、PRO 源无 key 时返回 402（验证失败隔离）、`STALE=` 环境变量制造过期数据（验证新鲜度门禁）。

---

## 作为库使用

```js
import { WorldMonitorClient } from './client.mjs';
import { fetchRadar } from './radar.mjs';
import { fetchDigest } from './news.mjs';
import { checkFreshness } from './freshness.mjs';

const wm = new WorldMonitorClient({ apiKey: process.env.WM_KEY, concurrency: 6 });

const radar = await fetchRadar(wm, { maxAgeHours: 24 });
if (!radar.freshness.pass) throw new Error('金融雷达数据过期');
console.log(radar.macroSignals.verdict);                       // BUY / CASH
console.log(radar.exchanges.rows.filter((e) => e.marketOpen));  // 当前开盘的市场

const news = await fetchDigest(wm, { variant: 'finance', limit: 10, minImportance: 80 });
for (const cat of news.categories) console.log(cat.label, cat.count);
```

统一响应信封：

```jsonc
{
  "ok": true, "source": "market-quotes", "group": "markets",
  "status": 200, "ms": 143, "fetchedAt": "2026-08-14T10:41:15.174Z",
  "data": { /* 上游原样 JSON */ }
}
```

失败时 `ok:false`，`error.kind ∈ AUTH | PAYMENT_REQUIRED | NOT_FOUND | RATE_LIMITED | UPSTREAM | TIMEOUT | NETWORK | MISSING_PARAM | BAD_JSON`。单源失败不中断整体。

---

## 目录同步

`catalog.generated.json` 由 `gen-catalog.mjs` 从仓库既有配置生成，**不要手改**：

```bash
node gen-catalog.mjs
```

来源：`src/config/finance-geo.ts`（29 交易所 / 19 金融中心 / 14 央行 / 10 商品枢纽）、`shared/stocks.json`（93 标的目录、59 默认）、`shared/commodities.json`（33 符号）、`shared/crypto.json`（10 资产）、`src/config/feeds.ts`（新闻类别与源数）。改了这些配置后重跑一次即可，避免客户端与看板漂移。

## 工程细节

- **认证**：`X-WorldMonitor-Key` 头。服务端调用必须带 key。
- **重试**：仅对 429 与 5xx 重试，指数退避 + 抖动，遵守 `Retry-After`。401/402/403/404 视为确定性失败立即返回。
- **并发**：默认 4。数据本身是种子缓存节奏（5–30 分钟到日更），别当高频行情源轮询，只会撞限流。
- **参数展开**：数组参数按 OpenAPI `explode: true` 展开为重复 key（`?symbols=AAPL&symbols=TSLA`）。
- **批量替代**：要一次性水合整个看板用 `GET /api/bootstrap`，一个请求拿到全部种子缓存，比逐源拉便宜得多。

## 文件

| 文件 | 作用 |
|---|---|
| `sources.mjs` | 62 个数据源的目录（路由、参数、上游、节奏、中文说明） |
| `radar.mjs` | 金融雷达聚合（交易所 / 商品 / 加密 / 7 信号） |
| `news.mjs` | 新闻摘要与 AI 简报 |
| `freshness.mjs` | 24 小时新鲜度校验 |
| `client.mjs` | HTTP 客户端（重试、超时、并发、错误规范化） |
| `pull.mjs` | CLI |
| `gen-catalog.mjs` | 从仓库配置生成 `catalog.generated.json` |
| `mock-server.mjs` | 离线 mock API |
