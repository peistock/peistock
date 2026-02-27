import type { StockData, IndicatorData } from '@/types';

/**
 * 计算换手天数 DD 数组（基于股数）
 * 对每个位置 i，从 i 往前累计成交量，直到总和 >= 流通股本
 * @param volumes 成交量数组（单位：股），按时间顺序排列
 * @param capital 流通股本（单位：股）
 * @returns DD 数组
 */
export function calculateDD(volumes: number[], capital: number): number[] {
  const result: number[] = [];
  
  for (let i = 0; i < volumes.length; i++) {
    let cumVol = 0;
    let count = 0;
    
    // 从当前位置 i 往前累计成交量
    for (let j = i; j >= 0; j--) {
      cumVol += volumes[j];
      count++;
      
      if (cumVol >= capital) {
        break;
      }
    }
    
    result.push(count);
  }
  
  return result;
}

/**
 * 计算换手成本 MAHS
 */
export function calculateMAHS(closes: number[], dd: number[]): (number | null)[] {
  const result: (number | null)[] = [];
  
  for (let i = 0; i < closes.length; i++) {
    const period = dd[i];
    const actualPeriod = Math.min(period, i + 1);
    
    let sum = 0;
    for (let j = i - actualPeriod + 1; j <= i; j++) {
      sum += closes[j];
    }
    result.push(sum / actualPeriod);
  }
  
  return result;
}

/**
 * 计算指数换手成本 EMAHS
 */
export function calculateEMAHS(closes: number[], dd: number[]): (number | null)[] {
  const result: (number | null)[] = [];
  
  for (let i = 0; i < closes.length; i++) {
    const period = dd[i];
    
    if (i === 0) {
      result.push(closes[0]);
    } else {
      const prevEMA = result[i - 1]!;
      const multiplier = 2 / (period + 1);
      result.push((closes[i] - prevEMA) * multiplier + prevEMA);
    }
  }
  
  return result;
}

/**
 * 计算Yang-Zhang历史波动率（YZ Vol）
 * YZ Vol同时考虑了隔夜跳空和日内波动，比传统波动率更准确
 * 
 * 公式：
 * σ²_YZ = σ²_o + k*σ²_c + (1-k)*σ²_rs
 * 
 * 其中：
 * - σ²_o: 隔夜波动率（Open-to-Close前一天的Close）
 * - σ²_c: 日内波动率（Close-to-Open的Rogers-Satchell估计）
 * - σ²_rs: Rogers-Satchell估计量
 * - k: 权重系数，通常取0.34（YZ推荐）
 * 
 * @param opens 开盘价数组
 * @param highs 最高价数组  
 * @param lows 最低价数组
 * @param closes 收盘价数组
 * @param period 计算周期（默认20天）
 */
function calculateYZVol(
  opens: number[],
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 20
): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  
  if (n < period + 1) return result;
  
  const k = 0.34; // YZ推荐的权重系数
  
  // 计算各个组成部分
  const overnightVars: number[] = []; // 隔夜波动
  const intradayVars: number[] = [];  // 日内波动
  const rsEstimates: number[] = [];   // Rogers-Satchell估计
  
  for (let i = 1; i < n; i++) {
    const prevClose = closes[i - 1];
    const open = opens[i];
    const high = highs[i];
    const low = lows[i];
    const close = closes[i];
    
    // 隔夜对数收益率: ln(Open_t / Close_t-1)
    const overnightReturn = Math.log(open / prevClose);
    overnightVars.push(overnightReturn * overnightReturn);
    
    // 日内对数收益率: ln(Close_t / Open_t)
    const intradayReturn = Math.log(close / open);
    intradayVars.push(intradayReturn * intradayReturn);
    
    // Rogers-Satchell估计量
    // σ²_rs = ln(High/Close)*ln(High/Open) + ln(Low/Close)*ln(Low/Open)
    const logHC = Math.log(high / close);
    const logHO = Math.log(high / open);
    const logLC = Math.log(low / close);
    const logLO = Math.log(low / open);
    const rsEstimate = logHC * logHO + logLC * logLO;
    rsEstimates.push(rsEstimate);
  }
  
  // 填充第一个位置（没有前一天数据）
  overnightVars.unshift(0);
  intradayVars.unshift(0);
  rsEstimates.unshift(0);
  
  // 计算滚动平均
  for (let i = period; i < n; i++) {
    let sumOvernight = 0;
    let sumIntraday = 0;
    let sumRS = 0;
    
    for (let j = i - period + 1; j <= i; j++) {
      sumOvernight += overnightVars[j];
      sumIntraday += intradayVars[j];
      sumRS += rsEstimates[j];
    }
    
    const avgOvernight = sumOvernight / period;
    const avgIntraday = sumIntraday / period;
    const avgRS = sumRS / period;
    
    // YZ Vol = sqrt(σ²_o + k*σ²_c + (1-k)*σ²_rs) * sqrt(252) * 100
    const yzVar = avgOvernight + k * avgIntraday + (1 - k) * avgRS;
    const yzVol = Math.sqrt(Math.max(yzVar, 0)) * Math.sqrt(252) * 100;
    
    result[i] = Math.min(yzVol, 200); // 上限200
  }
  
  return result;
}

/**
 * 计算CRI综合风险指标（Composite Risk Indicator）v2.1 - 恐慌专用版
 * 
 * 重大修正：从"对称波动指标"改为"单向恐慌指标"
 * 
 * 核心变化：
 * 1. 成本偏离：只惩罚负偏离（价格<MAHS），正偏离不再贡献恐慌分
 * 2. 跳跃风险：只惩罚向下跳空（低开），向上跳空不算恐慌
 * 3. 波动曲线：结合价格趋势，只有在下跌趋势中的波动放大才算恐慌
 * 
 * 适用场景：识别"当前是否处于恐慌状态"用于逆向抄底，而非泛泛的风险度量
 */
function calculateCRI(
  stockData: StockData[],
  mahs: (number | null)[]
): { 
  cri: (number | null)[]; 
  criPercentile: (number | null)[];
  components: { 
    basis: (number | null)[]; 
    jump: (number | null)[]; 
    curve: (number | null)[]; 
    percentile: (number | null)[]; 
  };
  criState: ('panic' | 'complacent' | 'normal' | null)[];
  volumeState: ('extreme-shrink' | 'shrink' | 'normal' | 'expand' | 'extreme-expand' | null)[];
  vr: (number | null)[];
} {
  const n = stockData.length;
  const cri: (number | null)[] = new Array(n).fill(null);
  const basisScores: (number | null)[] = new Array(n).fill(null);
  const jumpScores: (number | null)[] = new Array(n).fill(null);
  const curveScores: (number | null)[] = new Array(n).fill(null);
  const percentileScores: (number | null)[] = new Array(n).fill(null);
  const criState: ('panic' | 'complacent' | 'normal' | null)[] = new Array(n).fill(null);
  const volumeState: ('extreme-shrink' | 'shrink' | 'normal' | 'expand' | 'extreme-expand' | null)[] = new Array(n).fill(null);
  const vr: (number | null)[] = new Array(n).fill(null);
  
  if (n < 60) return { 
    cri, 
    criPercentile: new Array(n).fill(null), 
    components: { basis: basisScores, jump: jumpScores, curve: curveScores, percentile: percentileScores }, 
    criState,
    volumeState,
    vr
  };
  
  const opens = stockData.map(d => d.open);
  const highs = stockData.map(d => d.high);
  const lows = stockData.map(d => d.low);
  const closes = stockData.map(d => d.close);
  const volumes = stockData.map(d => d.volume);
  
  // 计算不同周期的YZ Vol
  const yzVol5 = calculateYZVol(opens, highs, lows, closes, 5);   // 短期
  const yzVol20 = calculateYZVol(opens, highs, lows, closes, 20); // 中期（用于百分位计算）
  const yzVol60 = calculateYZVol(opens, highs, lows, closes, 60); // 长期
  
  // 计算向下跳空（只关注低开，这是恐慌的表现）
  const downGaps: number[] = [0];
  for (let i = 1; i < n; i++) {
    // 向下跳空 = max(0, ln(前收盘/开盘))，只有低开才算
    const gap = Math.max(0, Math.log(closes[i - 1] / opens[i]));
    downGaps.push(gap);
  }
  
  // 计算20日平均向下跳空和标准差
  const avgDownGap20: (number | null)[] = new Array(n).fill(null);
  const stdDownGap20: (number | null)[] = new Array(n).fill(null);
  for (let i = 20; i < n; i++) {
    let sum = 0;
    for (let j = i - 19; j <= i; j++) {
      sum += downGaps[j];
    }
    const avg = sum / 20;
    avgDownGap20[i] = avg;
    
    // 计算标准差
    let sumSq = 0;
    for (let j = i - 19; j <= i; j++) {
      sumSq += Math.pow(downGaps[j] - avg, 2);
    }
    stdDownGap20[i] = Math.sqrt(sumSq / 20);
  }
  
  // 计算MA20用于趋势判断
  const ma20: (number | null)[] = new Array(n).fill(null);
  for (let i = 19; i < n; i++) {
    let sum = 0;
    for (let j = i - 19; j <= i; j++) {
      sum += closes[j];
    }
    ma20[i] = sum / 20;
  }
  
  // 计算20日均量用于成交量状态判断
  const volMA20: (number | null)[] = new Array(n).fill(null);
  for (let i = 19; i < n; i++) {
    let sum = 0;
    for (let j = i - 19; j <= i; j++) {
      sum += volumes[j];
    }
    volMA20[i] = sum / 20;
  }
  
  // 从第60天开始计算CRI
  for (let i = 60; i < n; i++) {
    const volShort = yzVol5[i];
    const volMid = yzVol20[i];
    const volLong = yzVol60[i];
    const mahsValue = mahs[i];
    const close = closes[i];
    const ma20Value = ma20[i];
    
    if (volShort === null || volMid === null || volLong === null || mahsValue === null || ma20Value === null) continue;
    
    // 价格趋势：负值表示在MAHS下方（下跌趋势中）
    const priceTrend = (close - mahsValue) / mahsValue;
    const isBelowMAHS = priceTrend < 0;
    const isBelowMA20 = close < ma20Value;
    
    // 1. 成本偏离 - 只惩罚负偏离（恐慌专用）
    // 使用历史分位数映射替代固定系数
    let basisScore = 0;
    if (isBelowMAHS) {
      // 计算负向偏离的绝对值（百分比）
      const negBasisRaw = Math.abs(priceTrend) * 100;
      
      // 获取过去120日负向偏离的历史数据（只取负偏离的绝对值）
      const negBasisHistory: number[] = [];
      for (let j = i - 119; j <= i; j++) {
        if (mahs[j] !== null && closes[j] < mahs[j]!) {
          negBasisHistory.push(Math.abs((closes[j] - mahs[j]!) / mahs[j]! * 100));
        }
      }
      
      // 使用历史分位数映射：60%分位开始得分，90%分位得100分
      if (negBasisHistory.length >= 30) {
        const basisThreshold60 = calculatePercentile(negBasisHistory, 60);
        const basisThreshold90 = calculatePercentile(negBasisHistory, 90);
        
        if (negBasisRaw <= basisThreshold60) {
          basisScore = 0;
        } else if (negBasisRaw >= basisThreshold90) {
          basisScore = 100;
        } else {
          // 使用S型曲线映射，使极端值更容易达到高分
          const normalized = (negBasisRaw - basisThreshold60) / (basisThreshold90 - basisThreshold60);
          basisScore = Math.pow(normalized, 0.8) * 100;
        }
      } else {
        // 数据不足时回退到简单线性映射
        basisScore = Math.min(negBasisRaw * 3, 100);
      }
    }
    // 价格上涨时 basisScore = 0，不贡献恐慌分
    basisScores[i] = Math.min(Math.max(basisScore, 0), 100);
    
    // 2. 跳跃风险 - 只惩罚向下跳空
    const currentDownGap = downGaps[i];
    const avgDownGap = avgDownGap20[i];
    const stdDownGap = stdDownGap20[i];
    let jumpScore = 0;
    if (avgDownGap !== null && stdDownGap !== null && stdDownGap > 0) {
      // 计算Z-score：(当前跳空 - 平均) / 标准差
      const jumpZ = (currentDownGap - avgDownGap) / stdDownGap;
      // 只关注超过平均的跳空（恐慌信号），负值截断为0
      // Z=0时得0分，Z=1时约30分，Z=2时约60分，Z>=3.3时100分
      if (jumpZ > 0) {
        jumpScore = Math.min(jumpZ * 30, 100);
      } else {
        jumpScore = 0;
      }
    }
    jumpScores[i] = jumpScore;
    
    // 3. 波动曲线 - 结合趋势方向
    // 关键修正：只有在下跌趋势中（价格低于MA20）的波动放大才算恐慌
    // 使用动态下限：长期波动率历史均值的20%或0.5%中的较大值
    const volLongHistory = yzVol60.slice(Math.max(0, i - 59), i + 1).filter(v => v !== null) as number[];
    const volLongMean = volLongHistory.length > 0 
      ? volLongHistory.reduce((a, b) => a + b, 0) / volLongHistory.length 
      : 10;
    const safeVolLong = Math.max(volLong, volLongMean * 0.2, 0.5);
    const curveSlope = (volShort - volLong) / safeVolLong;
    let curveScore = 0;
    
    if (isBelowMA20 && curveSlope > 0) {
      // 下跌趋势 + 波动放大 = 恐慌确认
      // 斜率越大恐慌越严重
      curveScore = Math.min(curveSlope * 60, 100);
    } else if (!isBelowMA20 && curveSlope > 0) {
      // 上涨趋势 + 波动放大 = 可能是健康上涨，恐慌分降低
      curveScore = Math.min(curveSlope * 20, 40);
    } else if (curveSlope < -0.2) {
      // 波动收敛，无论趋势如何，恐慌分都很低
      curveScore = Math.max(curveSlope * 10 + 20, 0);
    } else {
      curveScore = 20 + curveSlope * 30;
    }
    curveScores[i] = curveScore;
    
    // 4. 波动率百分位 - 结合趋势权重调整
    let volPctScore = 50;
    if (i >= 120) {
      const currentVol = volMid;
      const histVols = yzVol20.slice(i - 119, i + 1).filter(v => v !== null) as number[];
      if (histVols.length > 0) {
        const sorted = [...histVols].sort((a, b) => a - b);
        const rank = sorted.findIndex(v => v >= currentVol);
        volPctScore = rank >= 0 ? (rank / sorted.length) * 100 : 100;
      }
    }
    // 波动百分位在下跌趋势中权重更高
    const trendAdjustedPct = isBelowMA20 ? volPctScore : volPctScore * 0.5;
    percentileScores[i] = trendAdjustedPct;
    
    // 5. 合成CRI - 恐慌专用权重
    // 提高basis和jump权重（它们是单向的恐慌指标）
    // curve和percentile在下跌趋势中才充分发挥作用
    const criRaw = Math.max(
      basisScore * 0.95,       // 成本偏离权重最高（恐慌核心）
      jumpScore * 0.9,         // 向下跳空（恐慌确认）
      isBelowMA20 ? curveScore * 0.85 : curveScore * 0.4  // 波动曲线在下跌中权重更高
    ) + trendAdjustedPct * 0.1;
    
    cri[i] = Math.min(Math.max(criRaw, 0), 100);
    
    // 计算成交量状态 VR = VOL / MA(VOL, 20)
    const currentVolume = volumes[i];
    const currentVolMA20 = volMA20[i];
    if (currentVolMA20 !== null && currentVolMA20 > 0) {
      const currentVR = currentVolume / currentVolMA20;
      vr[i] = currentVR;
      
      // 判断成交量状态
      if (currentVR < 0.5) {
        volumeState[i] = 'extreme-shrink'; // 极度缩量
      } else if (currentVR < 0.8) {
        volumeState[i] = 'shrink'; // 缩量
      } else if (currentVR <= 1.2) {
        volumeState[i] = 'normal'; // 正常
      } else if (currentVR <= 2.0) {
        volumeState[i] = 'expand'; // 放量
      } else {
        volumeState[i] = 'extreme-expand'; // 极度放量
      }
    }
  }
  
  // 6. 计算CRI的历史分位数（120日滚动）
  // 使用分位数来设定动态阈值，适应不同个股的波动特性
  const criPercentile: (number | null)[] = new Array(n).fill(null);
  const lookbackPeriod = 120; // 120日历史回看
  
  for (let i = lookbackPeriod; i < n; i++) {
    const currentCRI = cri[i];
    if (currentCRI === null) continue;
    
    // 获取历史CRI值（不包含当前值）
    const histCRI: number[] = [];
    for (let j = i - lookbackPeriod; j < i; j++) {
      if (cri[j] !== null) histCRI.push(cri[j]!);
    }
    
    if (histCRI.length >= 60) { // 至少需要60个有效值
      const sorted = [...histCRI].sort((a, b) => a - b);
      const rank = sorted.findIndex(v => v >= currentCRI);
      criPercentile[i] = rank >= 0 ? (rank / sorted.length) * 100 : 100;
    } else {
      criPercentile[i] = 50; // 数据不足时默认为中位数
    }
  }
  
  // 7. 判断CRI状态 - 基于历史分位数
  // 高分位数(>80%) + 价格低于成本 = 极端恐慌（对该股而言）
  // 低分位数(<20%) + 价格高于成本 = 极端自满
  for (let i = lookbackPeriod; i < n; i++) {
    const currentCRI = cri[i];
    const currentPct = criPercentile[i];
    const mahsValue = mahs[i];
    const close = closes[i];
    
    if (currentCRI === null || currentPct === null || mahsValue === null) {
      criState[i] = null;
      continue;
    }
    
    const isBelowMAHS = close < mahsValue;
    
    // 基于分位数的动态阈值判断
    if (currentPct >= 80 && isBelowMAHS) {
      criState[i] = 'panic';      // 历史极端高位 + 负成本偏离 = 恐慌
    } else if (currentPct >= 60 && isBelowMAHS) {
      criState[i] = 'normal';     // 偏高但不算极端
    } else if (currentPct <= 20 && !isBelowMAHS) {
      criState[i] = 'complacent'; // 历史极端低位 + 正成本偏离 = 自满
    } else {
      criState[i] = 'normal';
    }
  }
  
  return {
    cri,
    criPercentile,
    components: {
      basis: basisScores,
      jump: jumpScores,
      curve: curveScores,
      percentile: percentileScores,
    },
    criState,
    volumeState,
    vr,
  };
}

/**
 * 计算百分位数（Percentile）
 * 返回data中第p百分位的值（0-100）
 */
function calculatePercentile(data: number[], p: number): number {
  if (data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * 计算历史百分位排名（0-100）
 * 返回当前值在历史数据中的百分位位置
 */
function calculatePercentileRank(current: number, history: number[]): number {
  if (history.length === 0) return 50;
  const sorted = [...history].sort((a, b) => a - b);
  const rank = sorted.findIndex(v => v >= current);
  if (rank === -1) return 100;
  return (rank / sorted.length) * 100;
}

/**
 * 计算贪婪情绪指标 (Greed Sentiment Indicator)
 * 
 * 贪婪情绪通常出现在：
 * 1. 价格远高于市场平均成本（正向成本偏离度大）
 * 2. 出现连续的向上跳空缺口
 * 3. 波动率在上涨趋势中放大（追高情绪）
 * 4. 乖离率进入历史极端高位
 * 5. 成交量异常放大，换手率激增
 */
function calculateGreedyScore(
  stockData: StockData[],
  mahs: (number | null)[],
  ma20: (number | null)[],
  bias225: (number | null)[]
): {
  greedy: (number | null)[];
  components: {
    posBasis: (number | null)[];
    upGap: (number | null)[];
    greedVol: (number | null)[];
    biasExtreme: (number | null)[];
    volumeSurge: (number | null)[];
  };
  greedyState: ('greedy' | 'normal' | null)[];
} {
  const n = stockData.length;
  const greedy: (number | null)[] = new Array(n).fill(null);
  const posBasisScores: (number | null)[] = new Array(n).fill(null);
  const upGapScores: (number | null)[] = new Array(n).fill(null);
  const greedVolScores: (number | null)[] = new Array(n).fill(null);
  const biasExtremeScores: (number | null)[] = new Array(n).fill(null);
  const volumeSurgeScores: (number | null)[] = new Array(n).fill(null);
  const greedyState: ('greedy' | 'normal' | null)[] = new Array(n).fill(null);
  
  if (n < 120) return { 
    greedy, 
    components: { 
      posBasis: posBasisScores, 
      upGap: upGapScores, 
      greedVol: greedVolScores, 
      biasExtreme: biasExtremeScores, 
      volumeSurge: volumeSurgeScores 
    }, 
    greedyState 
  };
  
  const opens = stockData.map(d => d.open);
  const highs = stockData.map(d => d.high);
  const lows = stockData.map(d => d.low);
  const closes = stockData.map(d => d.close);
  const volumes = stockData.map(d => d.volume);
  
  // 计算不同周期的YZ Vol
  const yzVol5 = calculateYZVol(opens, highs, lows, closes, 5);   // 短期
  const yzVol60 = calculateYZVol(opens, highs, lows, closes, 60); // 长期
  
  // 计算向上跳空强度（仅计算高开）
  const upGaps: number[] = [0];
  for (let i = 1; i < n; i++) {
    // 向上跳空 = max(0, ln(开盘/前收盘))，只有高开才算
    const gap = Math.max(0, Math.log(opens[i] / closes[i - 1]));
    upGaps.push(gap);
  }
  
  // 计算20日平均向上跳空和标准差
  const avgUpGap20: (number | null)[] = new Array(n).fill(null);
  const stdUpGap20: (number | null)[] = new Array(n).fill(null);
  for (let i = 20; i < n; i++) {
    let sum = 0;
    for (let j = i - 19; j <= i; j++) {
      sum += upGaps[j];
    }
    const avg = sum / 20;
    avgUpGap20[i] = avg;
    
    // 计算标准差
    let sumSq = 0;
    for (let j = i - 19; j <= i; j++) {
      sumSq += Math.pow(upGaps[j] - avg, 2);
    }
    stdUpGap20[i] = Math.sqrt(sumSq / 20);
  }
  
  // 计算20日均量
  const volMA20: (number | null)[] = new Array(n).fill(null);
  for (let i = 19; i < n; i++) {
    let sum = 0;
    for (let j = i - 19; j <= i; j++) {
      sum += volumes[j];
    }
    volMA20[i] = sum / 20;
  }
  
  // 从第120天开始计算（需要足够的历史数据计算分位数）
  for (let i = 120; i < n; i++) {
    const close = closes[i];
    const mahsValue = mahs[i];
    const ma20Value = ma20[i];
    const bias225Value = bias225[i];
    const volShort = yzVol5[i];
    const volLong = yzVol60[i];
    const volume = volumes[i];
    const volMA20Value = volMA20[i];
    
    if (mahsValue === null || ma20Value === null || bias225Value === null || 
        volShort === null || volLong === null || volMA20Value === null) continue;
    
    // 价格趋势判断
    const isUpTrend = close > ma20Value;
    const isAboveMAHS = close > mahsValue;
    
    // ===== 因子1：正向成本偏离（价格泡沫）=====
    // pos_basis = max(0, (price - MAHS) / MAHS * 100)
    const posBasisRaw = Math.max(0, (close - mahsValue) / mahsValue * 100);
    
    // 获取过去120日pos_basis的历史数据
    const posBasisHistory: number[] = [];
    for (let j = i - 119; j <= i; j++) {
      if (mahs[j] !== null) {
        posBasisHistory.push(Math.max(0, (closes[j] - mahs[j]!) / mahs[j]! * 100));
      }
    }
    
    // 计算80%和95%分位数作为阈值
    const posThreshold = calculatePercentile(posBasisHistory, 80);
    const posExtreme = calculatePercentile(posBasisHistory, 95);
    
    let score1 = 0;
    if (posBasisRaw <= posThreshold) {
      score1 = 0;
    } else if (posBasisRaw >= posExtreme) {
      score1 = 100;
    } else {
      score1 = (posBasisRaw - posThreshold) / (posExtreme - posThreshold) * 100;
    }
    posBasisScores[i] = Math.min(Math.max(score1, 0), 100);
    
    // ===== 因子2：向上跳空强度 =====
    const currentUpGap = upGaps[i];
    const avgUpGap = avgUpGap20[i];
    const stdUpGap = stdUpGap20[i];
    
    let score2 = 0;
    if (avgUpGap !== null && stdUpGap !== null) {
      const safeStd = Math.max(stdUpGap, 0.0001);
      const zUp = (currentUpGap - avgUpGap) / safeStd;
      // Z-score映射到0-100，均值附近为50
      score2 = Math.min(Math.max(zUp * 15 + 50, 0), 100);
    }
    upGapScores[i] = score2;
    
    // ===== 因子3：贪婪型波动（波动率与趋势结合）=====
    let score3 = 0;
    if (isUpTrend) {
      // 上涨趋势中，波动率上升可能意味着追高情绪
      // 使用动态下限替代硬编码的1
      const volLongHistory = yzVol60.slice(Math.max(0, i - 59), i + 1).filter(v => v !== null) as number[];
      const volLongMean = volLongHistory.length > 0 
        ? volLongHistory.reduce((a, b) => a + b, 0) / volLongHistory.length 
        : 10;
      const safeVolLong = Math.max(volLong, volLongMean * 0.2, 0.5);
      const curveSlope = (volShort - volLong) / safeVolLong;
      // 温和映射：斜率越大得分越高
      score3 = Math.min(Math.max(curveSlope * 40, 0), 100);
    } else {
      // 下跌趋势中，波动放大不计入贪婪
      score3 = 0;
    }
    greedVolScores[i] = score3;
    
    // ===== 因子4：乖离率历史极端高位 =====
    // 获取过去120日bias225的历史数据
    const biasHistory: number[] = [];
    for (let j = i - 119; j <= i; j++) {
      if (bias225[j] !== null) {
        biasHistory.push(bias225[j]!);
      }
    }
    
    // 计算当前乖离率的历史百分位
    const pctBias225 = calculatePercentileRank(bias225Value, biasHistory);
    
    // 80%分位开始得分，95%以上100分
    let score4 = 0;
    if (pctBias225 > 80) {
      score4 = (pctBias225 - 80) / (95 - 80) * 100;
    }
    biasExtremeScores[i] = Math.min(Math.max(score4, 0), 100);
    
    // ===== 因子5：成交量激增（换手率异常）=====
    const volRatio = volume / volMA20Value;
    
    // 获取过去120日vol_ratio的历史数据
    const volRatioHistory: number[] = [];
    for (let j = i - 119; j <= i; j++) {
      if (volMA20[j] !== null && volMA20[j]! > 0) {
        volRatioHistory.push(volumes[j] / volMA20[j]!);
      }
    }
    
    // 计算90%分位数作为放量阈值
    const volThreshold = calculatePercentile(volRatioHistory, 90);
    
    let score5 = 0;
    if (volRatio <= 1.2) {
      // 无明显放量
      score5 = 0;
    } else if (volRatio >= volThreshold) {
      // 达到历史极端放量
      score5 = 100;
    } else {
      // 线性插值
      score5 = (volRatio - 1.2) / (volThreshold - 1.2) * 100;
    }
    volumeSurgeScores[i] = Math.min(Math.max(score5, 0), 100);
    
    // ===== 合成贪婪总分 =====
    // 权重：正向成本偏离0.30，向上跳空0.20，贪婪型波动0.15，乖离率高分位0.20，成交量激增0.15
    const greedyRaw = score1 * 0.30 + score2 * 0.20 + score3 * 0.15 + score4 * 0.20 + score5 * 0.15;
    greedy[i] = Math.min(Math.max(greedyRaw, 0), 100);
    
    // ===== 判断贪婪状态 =====
    // 贪婪状态：贪婪得分>70且价格高于成本
    if (greedy[i]! >= 70 && isAboveMAHS) {
      greedyState[i] = 'greedy';
    } else {
      greedyState[i] = 'normal';
    }
  }
  
  return {
    greedy,
    components: {
      posBasis: posBasisScores,
      upGap: upGapScores,
      greedVol: greedVolScores,
      biasExtreme: biasExtremeScores,
      volumeSurge: volumeSurgeScores,
    },
    greedyState,
  };
}

/**
 * 计算简单移动平均 SMA
 */
export function calculateSMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * 计算乖离率 BIAS
 */
export function calculateBIAS(closes: number[], ma: (number | null)[]): (number | null)[] {
  return closes.map((close, i) => {
    const maValue = ma[i];
    if (maValue === null || maValue === 0) return null;
    return ((close - maValue) / maValue) * 100;
  });
}

/**
 * 计算所有指标
 * @param stockData K线数据
 * @param capital 流通股本（股）
 */
export function calculateAllIndicators(stockData: StockData[], capital: number): IndicatorData[] {
  const closes = stockData.map(d => d.close);
  const volumes = stockData.map(d => d.volume);
  
  // 1. 计算换手天数 DD
  const dd = calculateDD(volumes, capital);
  
  // 2. 计算换手成本 MAHS
  const mahs = calculateMAHS(closes, dd);
  
  // 3. 计算指数换手成本 EMAHS
  const emahs = calculateEMAHS(closes, dd);
  
  // 4. 计算成本差
  const costDiff = mahs.map((m, i) => {
    if (m === null || emahs[i] === null) return null;
    return emahs[i]! - m;
  });
  
  // 5. 计算成本偏离度 (股价 - EMAHS)
  const costDeviation = emahs.map((e, i) => {
    if (e === null) return null;
    return closes[i] - e;
  });
  
  // 6. 计算均线系统
  const ma5 = calculateSMA(closes, 5);
  const ma20 = calculateSMA(closes, 20);
  const ma99 = calculateSMA(closes, 99);
  const ma128 = calculateSMA(closes, 128);
  const ma225 = calculateSMA(closes, 225);
  
  // 7. 计算乖离率
  const bias5 = calculateBIAS(closes, ma5);
  const bias20 = calculateBIAS(closes, ma20);
  const bias99 = calculateBIAS(closes, ma99);
  const bias128 = calculateBIAS(closes, ma128);
  const bias225 = calculateBIAS(closes, ma225);
  
  // 8. 计算CRI综合风险指标（恐慌）
  const criResult = calculateCRI(stockData, mahs);
  
  // 9. 计算贪婪情绪指标
  const greedyResult = calculateGreedyScore(stockData, mahs, ma20, bias225);
  
  // 10. 计算综合情绪指数 sentiment = greedy - cri (-100 ~ +100)
  const sentiment: (number | null)[] = new Array(stockData.length).fill(null);
  for (let i = 0; i < stockData.length; i++) {
    const criValue = criResult.cri[i];
    const greedyValue = greedyResult.greedy[i];
    if (criValue !== null && greedyValue !== null) {
      sentiment[i] = Math.min(Math.max(greedyValue - criValue, -100), 100);
    }
  }
  
  return stockData.map((d, i) => ({
    date: d.date,
    close: d.close,
    dd: dd[i],
    mahs: mahs[i],
    emahs: emahs[i],
    costDiff: costDiff[i],
    costDeviation: costDeviation[i],
    // 恐慌指标
    cri: criResult.cri[i],
    criPercentile: criResult.criPercentile[i],
    criState: criResult.criState[i],
    criComponents: criResult.components.basis[i] !== null ? {
      basis: criResult.components.basis[i]!,
      jump: criResult.components.jump[i]!,
      curve: criResult.components.curve[i]!,
      percentile: criResult.components.percentile[i]!,
    } : null,
    // 成交量状态
    volumeState: criResult.volumeState[i],
    vr: criResult.vr[i],
    // 贪婪指标
    greedy: greedyResult.greedy[i],
    greedyComponents: greedyResult.components.posBasis[i] !== null ? {
      posBasis: greedyResult.components.posBasis[i]!,
      upGap: greedyResult.components.upGap[i]!,
      greedVol: greedyResult.components.greedVol[i]!,
      biasExtreme: greedyResult.components.biasExtreme[i]!,
      volumeSurge: greedyResult.components.volumeSurge[i]!,
    } : null,
    greedyState: greedyResult.greedyState[i],
    // 综合情绪指数
    sentiment: sentiment[i],
    // 均线系统
    ma5: ma5[i],
    ma20: ma20[i],
    ma99: ma99[i],
    ma128: ma128[i],
    ma225: ma225[i],
    // 乖离率
    bias5: bias5[i],
    bias20: bias20[i],
    bias99: bias99[i],
    bias128: bias128[i],
    bias225: bias225[i],
  }));
}

/**
 * 格式化数字
 */
export function formatNumber(num: number | null, decimals: number = 2): string {
  if (num === null || num === undefined) return '-';
  return num.toFixed(decimals);
}

/**
 * 格式化成交量
 */
export function formatVolume(vol: number): string {
  if (vol >= 100000000) {
    return (vol / 100000000).toFixed(2) + '亿';
  } else if (vol >= 10000) {
    return (vol / 10000).toFixed(2) + '万';
  }
  return vol.toString();
}

/**
 * 格式化流通股本
 */
export function formatCapital(capital: number): string {
  if (capital >= 100000000) {
    return (capital / 100000000).toFixed(2) + '亿股';
  } else if (capital >= 10000) {
    return (capital / 10000).toFixed(2) + '万股';
  }
  return capital.toString() + '股';
}

/**
 * 格式化成交额
 */
export function formatAmount(amount: number): string {
  if (amount >= 100000000) {
    return (amount / 100000000).toFixed(2) + '亿';
  } else if (amount >= 10000) {
    return (amount / 10000).toFixed(2) + '万';
  }
  return amount.toString();
}
