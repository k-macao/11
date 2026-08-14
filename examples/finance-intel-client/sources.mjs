/**
 * 金融数据 + 影响金融的国际形势数据源目录（World Monitor 托管 API）
 *
 * 每条记录说明：
 *   id        本地唯一标识，用于 --only / --group 过滤
 *   group     分组：markets | macro | energy | geopolitics | trade | risk
 *   path      托管 API 路由（相对 --base，默认 https://api.worldmonitor.app）
 *   params    默认查询参数（数组值会展开成重复 query key，符合 OpenAPI explode: true）
 *   required  必填参数名列表（缺失则跳过该源并提示）
 *   cadence   数据刷新节奏（来自 docs/finance-data.mdx 与 docs/data-sources.mdx）
 *   upstream  上游数据提供方
 *   premium   true = 需要 PRO / 付费档位，免费 key 可能返回 402/403
 *   zh        中文说明：这个源能告诉你什么
 *
 * 路由已对照 docs/api/*.openapi.yaml 校验。
 */

/** @typedef {{id:string,group:string,path:string,params?:Record<string,unknown>,required?:string[],cadence:string,upstream:string,premium?:boolean,zh:string}} SourceDef */

/** @type {SourceDef[]} */
export const SOURCES = [
  // ────────────────────────────── 市场行情 markets ──────────────────────────────
  {
    id: 'market-quotes',
    group: 'markets',
    path: '/api/market/v1/list-market-quotes',
    params: { symbols: ['^GSPC', '^IXIC', '^HSI', '000001.SS', '^N225', '^STOXX50E'] },
    cadence: '种子 5–30 分钟',
    upstream: 'Alpha Vantage → Finnhub（种子优先，命中不回源）',
    zh: '股票与指数报价。空 symbols 返回默认 59 只全球标的；自定义最多 120 个/次。',
  },
  {
    id: 'crypto-quotes',
    group: 'markets',
    path: '/api/market/v1/list-crypto-quotes',
    cadence: '种子 + 有界补拉',
    upstream: 'CoinGecko → CoinPaprika',
    zh: 'BTC/ETH/SOL/XRP 等主流币报价，风险偏好的高频代理变量。',
  },
  {
    id: 'commodity-quotes',
    group: 'markets',
    path: '/api/market/v1/list-commodity-quotes',
    cadence: '种子节奏',
    upstream: 'Alpha Vantage 实物商品序列 + 残余源',
    zh: '黄金、原油等商品期货报价。只支持配置好的种子集合，传其他符号无效。',
  },
  {
    id: 'sector-summary',
    group: 'markets',
    path: '/api/market/v1/get-sector-summary',
    cadence: '种子（bootstrap 键 sectors）',
    upstream: '行情种子聚合',
    zh: '板块热力与估值上下文，看资金在哪些行业轮动。',
  },
  {
    id: 'fear-greed',
    group: 'markets',
    path: '/api/market/v1/get-fear-greed-index',
    cadence: '每日',
    upstream: 'Fear & Greed 合成指标 + 美国 KCFSI',
    zh: '恐慌贪婪指数含 30 天历史，同时是金融压力面板的美国分量。',
  },
  {
    id: 'market-breadth',
    group: 'markets',
    path: '/api/market/v1/get-market-breadth-history',
    cadence: '每日',
    upstream: '广度种子',
    zh: '市场广度历史（涨跌家数结构），用于识别指数与内部结构背离。',
  },
  {
    id: 'stablecoin-markets',
    group: 'markets',
    path: '/api/market/v1/list-stablecoin-markets',
    cadence: '种子',
    upstream: 'CoinGecko',
    zh: 'USDT/USDC/DAI/FDUSD/USDe 脱锚健康度——加密美元流动性的应急信号。',
  },
  {
    id: 'etf-flows',
    group: 'markets',
    path: '/api/market/v1/list-etf-flows',
    cadence: '每日',
    upstream: 'BTC 现货 ETF 披露',
    zh: 'IBIT/FBTC/GBTC 等 10 只比特币现货 ETF 的资金净流。',
  },
  {
    id: 'cot-positioning',
    group: 'markets',
    path: '/api/market/v1/get-cot-positioning',
    cadence: '每周（CFTC 发布）',
    upstream: 'CFTC COT',
    zh: '期货持仓报告，机构在黄金/原油等品种上的多空拥挤度。',
  },
  {
    id: 'gulf-quotes',
    group: 'markets',
    path: '/api/market/v1/list-gulf-quotes',
    cadence: '8 分钟缓存 / 60 秒轮询',
    upstream: 'GCC 交易所行情链路',
    zh: '海湾市场：Tadawul、DFM、阿布扎比、卡塔尔、马斯喀特 + 6 种盯美元货币 + WTI/Brent。',
  },
  {
    id: 'earnings-calendar',
    group: 'markets',
    path: '/api/market/v1/list-earnings-calendar',
    cadence: '每日',
    upstream: '财报日历种子',
    zh: '未来财报事件，事件驱动型波动的日程表。',
  },
  {
    id: 'hyperliquid-flow',
    group: 'markets',
    path: '/api/market/v1/get-hyperliquid-flow',
    cadence: '近实时',
    upstream: 'Hyperliquid',
    zh: '链上永续合约 24/7 持仓与资金流，周末唯一还在定价地缘风险的市场。',
  },
  {
    id: 'gold-intelligence',
    group: 'markets',
    path: '/api/market/v1/get-gold-intelligence',
    cadence: '每日',
    upstream: '黄金综合（价格 + 央行购金 + 持仓）',
    zh: '黄金情报聚合，避险需求最直接的读数。',
  },

  // ────────────────────────────── 宏观 macro ──────────────────────────────
  {
    id: 'macro-signals',
    group: 'macro',
    path: '/api/economic/v1/get-macro-signals',
    cadence: '每日',
    upstream: 'FRED / 复合信号',
    zh: '7 信号宏观雷达 + BUY/CASH 综合结论——看板金融面的核心摘要。',
  },
  {
    id: 'fred-batch',
    group: 'macro',
    path: '/api/economic/v1/get-fred-series-batch',
    params: { series_ids: ['DGS10', 'DGS2', 'FEDFUNDS', 'T10Y2Y', 'DTWEXBGS', 'CPIAUCSL'] },
    method: 'POST',
    cadence: 'FRED 发布节奏',
    upstream: 'FRED（圣路易斯联储）',
    zh: '一次拉多条美国宏观序列：10Y/2Y 国债、联邦基金、期限利差、美元指数、CPI。',
  },
  {
    id: 'fred-series',
    group: 'macro',
    path: '/api/economic/v1/get-fred-series',
    params: { series_id: 'DGS10' },
    cadence: 'FRED 发布节奏',
    upstream: 'FRED',
    zh: '单条 FRED 序列回退接口，批量接口不可用时用它。',
  },
  {
    id: 'bis-policy-rates',
    group: 'macro',
    path: '/api/economic/v1/get-bis-policy-rates',
    cadence: '央行议息后',
    upstream: 'BIS Statistics',
    zh: '主要经济体政策利率表，全球流动性的定价锚。',
  },
  {
    id: 'bis-exchange-rates',
    group: 'macro',
    path: '/api/economic/v1/get-bis-exchange-rates',
    cadence: '月度',
    upstream: 'BIS REER',
    zh: '实际有效汇率，判断某国货币被高估/低估与竞争性贬值压力。',
  },
  {
    id: 'bis-credit',
    group: 'macro',
    path: '/api/economic/v1/get-bis-credit',
    cadence: '季度',
    upstream: 'BIS 信贷统计',
    zh: '信贷/GDP 排名，识别加杠杆过热与债务风险国家。',
  },
  {
    id: 'ecb-fx-rates',
    group: 'macro',
    path: '/api/economic/v1/get-ecb-fx-rates',
    cadence: '每工作日 16:00 CET',
    upstream: 'ECB Data Portal',
    zh: '欧央行欧元参考汇率，官方口径的 FX 基准。',
  },
  {
    id: 'eu-yield-curve',
    group: 'macro',
    path: '/api/economic/v1/get-eu-yield-curve',
    cadence: '每工作日',
    upstream: 'ECB',
    zh: '欧元区收益率曲线，衰退与再融资压力的先行读数。',
  },
  {
    id: 'eu-fsi',
    group: 'macro',
    path: '/api/economic/v1/get-eu-fsi',
    cadence: '每工作日',
    upstream: 'ECB 金融压力指数',
    zh: '欧洲金融压力，与 KCFSI 一起构成看板的金融压力面板。',
  },
  {
    id: 'economic-stress',
    group: 'macro',
    path: '/api/economic/v1/get-economic-stress',
    cadence: '每日',
    upstream: '复合压力指标',
    zh: '综合经济压力信号，跨国排序。',
  },
  {
    id: 'eurostat-country-data',
    group: 'macro',
    path: '/api/economic/v1/get-eurostat-country-data',
    cadence: 'Eurostat 发布节奏',
    upstream: 'Eurostat',
    zh: '欧盟各国 CPI、失业率、GDP 增速。',
  },
  {
    id: 'economic-calendar',
    group: 'macro',
    path: '/api/economic/v1/get-economic-calendar',
    cadence: '每日',
    upstream: '经济日历种子',
    zh: '重要宏观数据发布日程，提前布防波动窗口。',
  },
  {
    id: 'china-macro-snapshot',
    group: 'macro',
    path: '/api/economic/v1/get-china-macro-snapshot',
    cadence: 'NBS/SAFE 发布节奏',
    upstream: '国家统计局 / 外汇管理局（含修订版本管理）',
    zh: '中国官方宏观快照 + 发布日历，带口径修订追踪。',
  },
  {
    id: 'china-activity-nowcast',
    group: 'macro',
    path: '/api/economic/v1/get-china-activity-nowcast',
    cadence: '每日',
    upstream: '官方口径 vs 复核代理指标',
    zh: '中国经济活动即时预测，官方数据与代理指标的确定性对照。',
  },
  {
    id: 'national-debt',
    group: 'macro',
    path: '/api/economic/v1/get-national-debt',
    cadence: '每日',
    upstream: '各国财政部 / IMF',
    premium: true,
    zh: 'PRO：全球债务时钟，主权债务负担与增速。',
  },
  {
    id: 'bls-series',
    group: 'macro',
    path: '/api/economic/v1/get-bls-series',
    cadence: 'BLS 发布节奏',
    upstream: 'U.S. BLS',
    zh: '美国非农就业与雇佣成本指数序列。',
  },
  {
    id: 'fao-food-price-index',
    group: 'macro',
    path: '/api/economic/v1/get-fao-food-price-index',
    cadence: '月度',
    upstream: 'FAO',
    zh: '粮食价格指数——新兴市场通胀与社会动荡的领先指标。',
  },

  // ────────────────────────────── 能源与商品 energy ──────────────────────────────
  {
    id: 'energy-prices',
    group: 'energy',
    path: '/api/economic/v1/get-energy-prices',
    cadence: '每日',
    upstream: 'U.S. EIA',
    zh: 'WTI/Brent 价格、产量与库存指标。',
  },
  {
    id: 'oil-inventories',
    group: 'energy',
    path: '/api/economic/v1/get-oil-inventories',
    cadence: '每周',
    upstream: 'EIA + GIE AGSI+ + IEA',
    zh: '石油库存综合面板：原油、SPR、美欧天然气库存、IEA 覆盖天数、炼厂上下文。',
  },
  {
    id: 'crude-inventories',
    group: 'energy',
    path: '/api/economic/v1/get-crude-inventories',
    cadence: '每周三 EIA',
    upstream: 'U.S. EIA',
    zh: '美国原油库存周度变化，油价短线最敏感的数据。',
  },
  {
    id: 'nat-gas-storage',
    group: 'energy',
    path: '/api/economic/v1/get-nat-gas-storage',
    cadence: '每周四 EIA',
    upstream: 'U.S. EIA',
    zh: '美国工作气量库存。',
  },
  {
    id: 'eu-gas-storage',
    group: 'energy',
    path: '/api/economic/v1/get-eu-gas-storage',
    cadence: '每日',
    upstream: 'GIE AGSI+',
    zh: '欧洲天然气库存率——冬季能源危机与欧元区通胀的关键变量。',
  },
  {
    id: 'energy-crisis-policies',
    group: 'energy',
    path: '/api/economic/v1/get-energy-crisis-policies',
    cadence: '事件驱动',
    upstream: '政策追踪',
    zh: '各国能源危机应对政策（补贴、限价、配给），财政冲击的来源。',
  },
  {
    id: 'fuel-prices',
    group: 'energy',
    path: '/api/economic/v1/list-fuel-prices',
    cadence: '每周',
    upstream: '燃油价格种子',
    zh: '各国零售燃油价格，传导到 CPI 与社会稳定。',
  },
  {
    id: 'critical-minerals',
    group: 'energy',
    path: '/api/supply-chain/v1/get-critical-minerals',
    cadence: '每日',
    upstream: '关键矿产供应链模型',
    zh: '锂、稀土、钴等关键矿产的供应集中度与断供风险。',
  },

  // ────────────────────── 影响金融的国际形势 geopolitics ──────────────────────
  {
    id: 'market-implications',
    group: 'geopolitics',
    path: '/api/intelligence/v1/list-market-implications',
    cadence: '事件驱动',
    upstream: 'WorldMonitor 事件→市场映射引擎',
    zh: '★最直接的桥梁：把地缘事件翻译成对具体资产/板块的影响判断。',
  },
  {
    id: 'risk-scores',
    group: 'geopolitics',
    path: '/api/intelligence/v1/get-risk-scores',
    cadence: '每小时',
    upstream: 'CII（ACLED + UCDP + 网络 + 新闻 + 旅行警告）',
    zh: '国家不稳定指数全量打分，主权风险溢价的量化输入。',
  },
  {
    id: 'country-risk',
    group: 'geopolitics',
    path: '/api/intelligence/v1/get-country-risk',
    params: { country_code: 'CN' },
    required: ['country_code'],
    cadence: '每小时',
    upstream: 'CII',
    zh: '单一国家风险分解（冲突/网络/新闻/警告分量）。改 country_code 换国家。',
  },
  {
    id: 'country-intel-brief',
    group: 'geopolitics',
    path: '/api/intelligence/v1/get-country-intel-brief',
    params: { country_code: 'CN' },
    required: ['country_code'],
    cadence: '每日',
    upstream: '多源合成简报',
    zh: '国家情报简报，人读友好的形势综述。',
  },
  {
    id: 'cross-source-signals',
    group: 'geopolitics',
    path: '/api/intelligence/v1/list-cross-source-signals',
    cadence: '近实时',
    upstream: '跨源交叉验证',
    zh: '多个独立信源同时指向同一事件时触发的高置信信号——降低单源噪声。',
  },
  {
    id: 'prediction-markets',
    group: 'geopolitics',
    path: '/api/prediction/v1/list-prediction-markets',
    cadence: '近实时',
    upstream: 'Polymarket',
    zh: '预测市场概率（选举、冲突、政策），比新闻更快定价的地缘领先指标。',
  },
  {
    id: 'sanctions-pressure',
    group: 'geopolitics',
    path: '/api/sanctions/v1/list-sanctions-pressure',
    cadence: '事件驱动',
    upstream: 'OFAC / EU / UK 制裁名单',
    zh: '制裁压力指数，直接影响跨境结算、大宗贸易与个股。',
  },
  {
    id: 'sanction-entity-lookup',
    group: 'geopolitics',
    path: '/api/sanctions/v1/lookup-sanction-entity',
    params: { query: 'Rosneft' },
    required: ['query'],
    cadence: '名单更新即刻',
    upstream: '制裁名单聚合',
    zh: '交易对手制裁筛查（合规用）。改 query 换实体名。',
  },
  {
    id: 'acled-events',
    group: 'geopolitics',
    path: '/api/conflict/v1/list-acled-events',
    cadence: '每 10 分钟缓存 / 30 天窗口',
    upstream: 'ACLED',
    zh: '武装冲突与抗议事件（带经纬度、伤亡、行为体）。',
  },
  {
    id: 'gdelt-topic-timeline',
    group: 'geopolitics',
    path: '/api/intelligence/v1/get-gdelt-topic-timeline',
    params: { topic: 'tariff' },
    cadence: '近实时',
    upstream: 'GDELT',
    zh: '任意主题的全球媒体注意力时间线。把 topic 换成 tariff / sanctions / OPEC 等。',
  },
  {
    id: 'cyber-threats',
    group: 'geopolitics',
    path: '/api/cyber/v1/list-cyber-threats',
    cadence: '每小时',
    upstream: 'abuse.ch 等 IOC 源',
    zh: '网络威胁情报，金融机构与交易所的运营风险面。',
  },
  {
    id: 'security-advisories',
    group: 'geopolitics',
    path: '/api/intelligence/v1/list-security-advisories',
    cadence: '每小时',
    upstream: '美国务院 / 英国 FCDO / 澳 DFAT + 使馆 + WHO/CDC',
    zh: '24 个官方旅行与安全警告源，主权风险的专家判断。',
  },

  // ────────────────────────── 贸易与供应链 trade ──────────────────────────
  {
    id: 'trade-restrictions',
    group: 'trade',
    path: '/api/trade/v1/get-trade-restrictions',
    cadence: '事件驱动',
    upstream: 'WTO',
    zh: '生效中的贸易限制措施，关税战跟踪的底稿。',
  },
  {
    id: 'tariff-trends',
    group: 'trade',
    path: '/api/trade/v1/get-tariff-trends',
    cadence: '月度',
    upstream: 'WTO',
    zh: '关税水平趋势，成本推动型通胀的来源之一。',
  },
  {
    id: 'trade-flows',
    group: 'trade',
    path: '/api/trade/v1/get-trade-flows',
    cadence: 'UN Comtrade 发布节奏',
    upstream: 'UN Comtrade',
    zh: '双边贸易流量，判断脱钩/转口贸易的实际进度。',
  },
  {
    id: 'chokepoint-status',
    group: 'trade',
    path: '/api/supply-chain/v1/get-chokepoint-status',
    cadence: '每日',
    upstream: 'IMF PortWatch',
    zh: '霍尔木兹、苏伊士、马六甲、巴拿马等咽喉水道通行状态——运价与油价的即时驱动。',
  },
  {
    id: 'shipping-rates',
    group: 'trade',
    path: '/api/supply-chain/v1/get-shipping-rates',
    cadence: '每日/每周',
    upstream: '集运与干散货运价指数',
    zh: '海运运价，全球贸易景气与输入型通胀的高频温度计。',
  },
  {
    id: 'shipping-stress',
    group: 'trade',
    path: '/api/supply-chain/v1/get-shipping-stress',
    cadence: '每日',
    upstream: '供应链压力合成',
    zh: '航运压力综合指数。',
  },
  {
    id: 'navigational-warnings',
    group: 'trade',
    path: '/api/maritime/v1/list-navigational-warnings',
    cadence: '近实时',
    upstream: 'NAVAREA 官方航行警告',
    zh: '航行警告（含军事演习、封锁区），红海式风险溢价的一手来源。',
  },
  {
    id: 'energy-disruptions',
    group: 'trade',
    path: '/api/supply-chain/v1/list-energy-disruptions',
    cadence: '事件驱动',
    upstream: '能源基础设施事件',
    zh: '管道、炼厂、LNG 终端中断事件。',
  },

  // ────────────────────────── 组合与推演 risk ──────────────────────────
  {
    id: 'forecasts',
    group: 'risk',
    path: '/api/forecast/v1/get-forecasts',
    cadence: '每日',
    upstream: 'WorldMonitor 预测引擎',
    zh: '带评分卡的结构化预测，可回溯校准准确率。',
  },
  {
    id: 'scenario-templates',
    group: 'risk',
    path: '/api/scenario/v1/list-scenario-templates',
    cadence: '静态 + 迭代',
    upstream: '情景引擎',
    zh: '现成情景模板（如霍尔木兹封锁、台海危机），配合 run-scenario 做冲击测算。',
  },
  {
    id: 'energy-shock',
    group: 'risk',
    path: '/api/intelligence/v1/compute-energy-shock',
    params: { country_code: 'CN' },
    required: ['country_code'],
    cadence: '按需计算',
    upstream: '能源冲击模型',
    zh: '对指定国家做能源价格冲击测算（GDP/CPI 传导）。',
  },
  {
    id: 'country-cost-shock',
    group: 'risk',
    path: '/api/supply-chain/v1/get-country-cost-shock',
    params: { country_code: 'CN' },
    required: ['country_code'],
    cadence: '按需计算',
    upstream: '供应链成本模型',
    zh: '运输/咽喉道中断对某国进口成本的冲击估计。',
  },
];

export const GROUPS = {
  markets: '市场行情',
  macro: '宏观与央行',
  energy: '能源与商品',
  geopolitics: '国际形势 / 地缘风险',
  trade: '贸易与供应链',
  risk: '推演与预测',
};

/** @param {{group?:string,only?:string[],includePremium?:boolean}} opts */
export function selectSources({ group, only, includePremium = true } = {}) {
  let list = SOURCES;
  if (group) {
    const groups = new Set(String(group).split(',').map((g) => g.trim()));
    list = list.filter((s) => groups.has(s.group));
  }
  if (only && only.length) {
    const ids = new Set(only);
    list = list.filter((s) => ids.has(s.id));
  }
  if (!includePremium) list = list.filter((s) => !s.premium);
  return list;
}
