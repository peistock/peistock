export interface StockData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;    // 成交量（股）
  amount: number;    // 成交额（元）
}

export interface IndicatorData {
  date: string;
  close: number;
  // 换手成本指标
  dd: number;                  // 换手天数
  mahs: number | null;         // 换手成本 MA
  emahs: number | null;        // 指数换手成本 EMA
  costDiff: number | null;     // 成本差
  costDeviation: number | null; // 成本偏离度 (股价 - EMAHS)
  // CRI综合风险指标（基于历史数据，非前瞻性）- 恐慌专用
  cri: number | null;          // Composite Risk Indicator (0-100)
  criPercentile: number | null; // CRI历史分位数 (0-100)
  criComponents: {             // CRI成分分解
    basis: number;        // 成本偏离风险（负偏离=恐慌）
    jump: number;         // 向下跳空风险
    curve: number;        // 波动率曲线斜率（下跌中波动放大=恐慌）
    percentile: number;   // 波动率历史百分位
  } | null;
  criState: 'panic' | 'complacent' | 'normal' | null; // CRI状态标记
  // 成交量状态
  volumeState: 'extreme-shrink' | 'shrink' | 'normal' | 'expand' | 'extreme-expand' | null;
  vr: number | null; // 成交量比率 VR = VOL / MA(VOL,20)
  // 贪婪情绪指标 (Greed Sentiment Indicator)
  greedy: number | null;       // 贪婪总分 (0-100)
  greedyComponents: {          // 贪婪成分分解
    posBasis: number;     // 正向成本偏离（价格泡沫）
    upGap: number;        // 向上跳空强度
    greedVol: number;     // 贪婪型波动（上涨中波动放大）
    biasExtreme: number;  // 乖离率历史极端高位
    volumeSurge: number;  // 成交量激增
  } | null;
  greedyState: 'greedy' | 'normal' | null; // 贪婪状态标记
  // 综合情绪指数: sentiment = greedy - cri (-100 ~ +100)
  sentiment: number | null;
  // 均线系统
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
  ma99: number | null;
  ma128: number | null;
  ma225: number | null;
  // 乖离率
  bias5: number | null;
  bias20: number | null;
  bias99: number | null;
  bias128: number | null;
  bias225: number | null;
  bias225Percentile: number | null; // BIAS225历史分位数
  // 成本偏离度历史分位数
  costDeviationPercentile: number | null;
  // 斜率因子（替代抵扣价因子）
  slopePressure: number | null; // 综合斜率压力得分 0-100
  slopeLevel: 0 | 1 | 2 | 3 | null; // 斜率压力等级 0=无 1=短期 2=中短期 3=全面
  slope20: number | null; // MA20未来5日斜率（%）
  slope60: number | null; // MA60未来5日斜率（%）
  slope225: number | null; // MA225未来5日斜率（%）
  // 趋势强度
  trendStrength: 'strong_bull' | 'bull' | 'neutral' | 'bear' | 'strong_bear' | null;
  trendScore: number | null; // 趋势得分 -100~+100
}

export interface StockInfo {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}
