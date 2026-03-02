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
  
  // 6. 计算CRI的历史分位数（使用全部可用历史数据）
  const criPercentile: (number | null)[] = new Array(n).fill(null);
  const firstValidCRI = cri.findIndex(v => v !== null);
  
  if (firstValidCRI >= 0) {
    for (let i = firstValidCRI + 60; i < n; i++) { // 至少60个历史数据点
      const currentCRI = cri[i];
      if (currentCRI === null) continue;
      
      // 获取从开始到当前的所有历史CRI值（不包含当前值）
      const histCRI: number[] = [];
      for (let j = firstValidCRI; j < i; j++) {
        if (cri[j] !== null) histCRI.push(cri[j]!);
      }
      
      if (histCRI.length >= 60) {
        const sorted = [...histCRI].sort((a, b) => a - b);
        const lessThan = sorted.filter(v => v < currentCRI).length;
        const equalTo = sorted.filter(v => v === currentCRI).length;
        const rank = lessThan + equalTo / 2;
        criPercentile[i] = (rank / histCRI.length) * 100;
      } else {
        criPercentile[i] = 50; // 数据不足时默认为中位数
      }
    }
  }
  
  // 7. 判断CRI状态 - 基于历史分位数
  // 高分位数(>80%) + 价格低于成本 = 极端恐慌（对该股而言）
  // 低分位数(<20%) + 价格高于成本 = 极端自满
  for (let i = firstValidCRI + 60; i < n; i++) {
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
 * 计算均线未来斜率（假设未来价格不变）
 * @param closes 收盘价序列
 * @param maPeriod 均线周期
 * @param futureDays 未来天数（默认5日）
 * @returns 斜率序列（百分比变化率）
 */
function calculateMASlope(
  closes: number[], 
  maPeriod: number, 
  futureDays: number = 5
): (number | null)[] {
  const n = closes.length;
  const slopes: (number | null)[] = new Array(n).fill(null);
  
  // 需要先计算均线
  const ma = calculateSMA(closes, maPeriod);
  
  // 需要足够的数据：当前索引 >= maPeriod + futureDays - 1
  const startIndex = maPeriod + futureDays - 1;
  
  for (let i = startIndex; i < n; i++) {
    const currentMA = ma[i];
    if (currentMA === null || currentMA === 0) continue;
    
    const currentClose = closes[i];
    
    // 计算未来第futureDays日的预期均线值
    // MA_future = (MA_now * N - sum(被剔除的价格) + futureDays * close_now) / N
    let sumToRemove = 0;
    for (let j = 0; j < futureDays; j++) {
      // 被剔除的是 i - (N-1) - j 位置的价格，即最老的N个价格中的前futureDays个
      const removeIndex = i - (maPeriod - 1) - j;
      if (removeIndex >= 0) {
        sumToRemove += closes[removeIndex];
      }
    }
    
    const futureMA = (currentMA * maPeriod - sumToRemove + futureDays * currentClose) / maPeriod;
    
    // 计算斜率：每日平均变化百分比
    const totalChange = futureMA - currentMA;
    const dailyChangePct = (totalChange / futureDays) / currentMA * 100;
    
    slopes[i] = dailyChangePct;
  }
  
  return slopes;
}

/**
 * 计算斜率历史分位数（基于负斜率的历史分布）
 * @param slopes 斜率序列
 * @param lookback 回看周期（默认120日）
 * @returns 分位数值（0-100）
 */
function calculateSlopePercentile(
  slopes: (number | null)[], 
  lookback: number = 120
): (number | null)[] {
  const n = slopes.length;
  const percentiles: (number | null)[] = new Array(n).fill(null);
  
  for (let i = lookback; i < n; i++) {
    const currentSlope = slopes[i];
    if (currentSlope === null) continue;
    
    // 收集回看周期内的斜率历史（只取负斜率，因为只关心下压）
    const historicalSlopes: number[] = [];
    for (let j = i - lookback; j < i; j++) {
      const s = slopes[j];
      if (s !== null && s < 0) {
        historicalSlopes.push(Math.abs(s)); // 取绝对值便于比较
      }
    }
    
    if (historicalSlopes.length < 10) continue; // 需要足够的历史数据
    
    historicalSlopes.sort((a, b) => a - b);
    
    // 判断是否为下压趋势（斜率<=0.05%视为下压，考虑微小误差）
    if (currentSlope <= 0.05) {
      // 当前为下压趋势，计算在历史负斜率中的分位数
      const absCurrent = Math.abs(currentSlope);
      let rank = 0;
      for (const s of historicalSlopes) {
        if (absCurrent >= s) rank++;
      }
      percentiles[i] = (rank / historicalSlopes.length) * 100;
    } else {
      // 当前为明显上升趋势，压力分为0
      percentiles[i] = 0;
    }
  }
  
  return percentiles;
}

/**
 * 计算综合斜率压力得分
 * @param slope20 MA20斜率分位数
 * @param slope60 MA60斜率分位数  
 * @param slope225 MA225斜率分位数
 * @returns 综合压力得分（0-100）和压力等级（0-3）
 */
function calculateSlopePressure(
  slope20: (number | null)[],
  slope60: (number | null)[],
  slope225: (number | null)[]
): { pressure: (number | null)[]; level: (0 | 1 | 2 | 3 | null)[] } {
  const n = slope20.length;
  const pressure: (number | null)[] = new Array(n).fill(null);
  const level: (0 | 1 | 2 | 3 | null)[] = new Array(n).fill(null);
  
  for (let i = 0; i < n; i++) {
    const s20 = slope20[i];
    const s60 = slope60[i];
    const s225 = slope225[i];
    
    if (s20 === null || s60 === null || s225 === null) continue;
    
    // 加权合成：短期0.3，中期0.3，长期0.4
    const score = s20 * 0.3 + s60 * 0.3 + s225 * 0.4;
    pressure[i] = Math.min(Math.round(score), 100);
    
    // 压力等级
    if (score >= 70) level[i] = 3;
    else if (score >= 50) level[i] = 2;
    else if (score >= 30) level[i] = 1;
    else level[i] = 0;
  }
  
  return { pressure, level };
}

/**
 * 计算趋势强度和趋势得分
 * 基于均线排列和斜率判断趋势状态
 * @returns trendStrength: 趋势强度等级, trendScore: 趋势得分 -100~+100
 */
function calculateTrendStrength(
  ma5: (number | null)[],
  ma20: (number | null)[],
  ma60: (number | null)[],
  ma225: (number | null)[],
  slope20: (number | null)[],
  slope60: (number | null)[],
  slope225: (number | null)[]
): { 
  trendStrength: ('strong_bull' | 'bull' | 'neutral' | 'bear' | 'strong_bear' | null)[];
  trendScore: (number | null)[];
} {
  const n = ma5.length;
  const trendStrength: ('strong_bull' | 'bull' | 'neutral' | 'bear' | 'strong_bear' | null)[] = new Array(n).fill(null);
  const trendScore: (number | null)[] = new Array(n).fill(null);
  
  for (let i = 0; i < n; i++) {
    const m5 = ma5[i], m20 = ma20[i], m60 = ma60[i], m225 = ma225[i];
    const s20 = slope20[i], s60 = slope60[i], s225 = slope225[i];
    
    if (m5 === null || m20 === null || m60 === null || m225 === null) {
      trendStrength[i] = null;
      trendScore[i] = null;
      continue;
    }
    
    // 均线排列判断
    const isBullAlignment = m5 > m20 && m20 > m60;
    const isStrongBullAlignment = isBullAlignment && m60 > m225;
    const isBearAlignment = m5 < m20 && m20 < m60;
    const isStrongBearAlignment = isBearAlignment && m60 < m225;
    
    // 斜率判断
    const s20Up = s20 !== null && s20 > 0;
    const s20Down = s20 !== null && s20 < 0;
    const s60Up = s60 !== null && s60 > 0;
    const s60Down = s60 !== null && s60 < 0;
    const s225Up = s225 !== null && s225 > 0;
    const s225Down = s225 !== null && s225 < 0;
    
    // 计算趋势得分 (-100 ~ +100)
    let score = 0;
    
    // 均线排列得分
    if (isStrongBullAlignment) score += 40;
    else if (isBullAlignment) score += 25;
    else if (isStrongBearAlignment) score -= 40;
    else if (isBearAlignment) score -= 25;
    
    // 斜率得分
    if (s20Up) score += 20;
    else if (s20Down) score -= 20;
    
    if (s60Up) score += 20;
    else if (s60Down) score -= 20;
    
    if (s225Up) score += 20;
    else if (s225Down) score -= 20;
    
    // 限制在 -100 ~ +100
    score = Math.max(-100, Math.min(100, score));
    trendScore[i] = score;
    
    // 趋势强度分类
    if (score >= 70) {
      trendStrength[i] = 'strong_bull';
    } else if (score >= 40) {
      trendStrength[i] = 'bull';
    } else if (score <= -70) {
      trendStrength[i] = 'strong_bear';
    } else if (score <= -40) {
      trendStrength[i] = 'bear';
    } else {
      trendStrength[i] = 'neutral';
    }
  }
  
  return { trendStrength, trendScore };
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
  
  // 5. 计算成本偏离度 (股价 - MAHS) - 与CRI使用同一成本基准
  const costDeviation = mahs.map((m, i) => {
    if (m === null) return null;
    return closes[i] - m;
  });
  
  // 6. 计算均线系统
  const ma5 = calculateSMA(closes, 5);
  const ma20 = calculateSMA(closes, 20);
  const ma60 = calculateSMA(closes, 60);
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
  
  // 11. 计算斜率因子（替代抵扣价因子）
  const slope20Raw = calculateMASlope(closes, 20, 5);  // MA20未来5日斜率
  const slope60Raw = calculateMASlope(closes, 60, 5);  // MA60未来5日斜率
  const slope225Raw = calculateMASlope(closes, 225, 5); // MA225未来5日斜率
  
  // 12. 计算斜率历史分位数
  const slope20Pct = calculateSlopePercentile(slope20Raw, 120);
  const slope60Pct = calculateSlopePercentile(slope60Raw, 120);
  const slope225Pct = calculateSlopePercentile(slope225Raw, 120);
  
  // 13. 计算综合斜率压力得分
  const slopePressureResult = calculateSlopePressure(slope20Pct, slope60Pct, slope225Pct);
  
  // 14. 计算趋势强度和趋势得分
  const { trendStrength, trendScore } = calculateTrendStrength(
    ma5, ma20, ma60, ma225, slope20Raw, slope60Raw, slope225Raw
  );
  
  // 15. 计算BIAS225历史分位数（使用全部可用历史数据）
  // 从第225天开始（确保有有效BIAS225值），使用从开始到当前的所有历史
  const bias225Percentile: (number | null)[] = new Array(stockData.length).fill(null);
  for (let i = 225; i < stockData.length; i++) {
    const currentBias = bias225[i];
    if (currentBias === null) {
      bias225Percentile[i] = null;
      continue;
    }
    // 收集从第225天到当前日期的所有历史数据（不包含当前值）
    const history = bias225.slice(225, i).filter((v): v is number => v !== null);
    if (history.length >= 30) {
      const sorted = [...history].sort((a, b) => a - b);
      // 计算有多少历史值小于当前值
      const lessThan = sorted.filter(v => v < currentBias).length;
      const equalTo = sorted.filter(v => v === currentBias).length;
      // 使用线性插值：小于的数量 + 等于数量的一半
      const rank = lessThan + equalTo / 2;
      bias225Percentile[i] = (rank / history.length) * 100;
    } else {
      bias225Percentile[i] = 50; // 数据不足时默认为中位数
    }
  }
  
  // 15. 计算成本偏离度历史分位数（使用全部可用历史数据）
  const costDeviationPercentile: (number | null)[] = new Array(stockData.length).fill(null);
  const firstValidCostDev = costDeviation.findIndex(v => v !== null);
  if (firstValidCostDev >= 0) {
    for (let i = firstValidCostDev + 30; i < stockData.length; i++) {
      const currentDev = costDeviation[i];
      if (currentDev === null) {
        costDeviationPercentile[i] = null;
        continue;
      }
      // 收集从开始到当前的所有历史数据
      const history = costDeviation.slice(firstValidCostDev, i).filter((v): v is number => v !== null);
      if (history.length >= 30) {
        const sorted = [...history].sort((a, b) => a - b);
        const lessThan = sorted.filter(v => v < currentDev).length;
        const equalTo = sorted.filter(v => v === currentDev).length;
        const rank = lessThan + equalTo / 2;
        costDeviationPercentile[i] = (rank / history.length) * 100;
      } else {
        costDeviationPercentile[i] = 50;
      }
    }
  }
  
  // 16. 计算ADX（平均趋向指数）- 14日周期
  const { adx, plusDI, minusDI, adxState } = calculateADX(stockData, 14);
  
  // 17. 计算PVT（价量趋势指标）
  const { pvt, pvtDivergence, pvtTrend } = calculatePVT(stockData);
  
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
    ma60: ma60[i],
    ma99: ma99[i],
    ma128: ma128[i],
    ma225: ma225[i],
    // 乖离率
    bias5: bias5[i],
    bias20: bias20[i],
    bias99: bias99[i],
    bias128: bias128[i],
    bias225: bias225[i],
    bias225Percentile: bias225Percentile[i],
    // 成本偏离度历史分位数
    costDeviationPercentile: costDeviationPercentile[i],
    // 斜率因子（替代抵扣价因子）
    slopePressure: slopePressureResult.pressure[i],
    slopeLevel: slopePressureResult.level[i],
    slope20: slope20Raw[i],
    slope60: slope60Raw[i],
    slope225: slope225Raw[i],
    // 趋势强度
    trendStrength: trendStrength[i],
    trendScore: trendScore[i],
    // ADX趋势强度
    adx: adx[i],
    adxState: adxState[i],
    plusDI: plusDI[i],
    minusDI: minusDI[i],
    // PVT价量趋势
    pvt: pvt[i],
    pvtDivergence: pvtDivergence[i],
    pvtTrend: pvtTrend[i],
  }));
}

/**
 * 计算ADX（平均趋向指数）
 * @param stockData K线数据
 * @param period 周期（默认14）
 * @returns ADX, +DI, -DI, ADX状态
 */
function calculateADX(
  stockData: StockData[],
  period: number = 14
): {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
  adxState: ('rising' | 'falling' | 'flat' | null)[];
} {
  const n = stockData.length;
  const adx: (number | null)[] = new Array(n).fill(null);
  const plusDI: (number | null)[] = new Array(n).fill(null);
  const minusDI: (number | null)[] = new Array(n).fill(null);
  const adxState: ('rising' | 'falling' | 'flat' | null)[] = new Array(n).fill(null);
  
  if (n < period + 1) return { adx, plusDI, minusDI, adxState };
  
  // 计算+DM, -DM, TR
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];
  
  for (let i = 1; i < n; i++) {
    const current = stockData[i];
    const prev = stockData[i - 1];
    
    const upMove = current.high - prev.high;
    const downMove = prev.low - current.low;
    
    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }
    
    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
    
    // TR = max(high-low, |high-prevClose|, |low-prevClose|)
    const tr1 = current.high - current.low;
    const tr2 = Math.abs(current.high - prev.close);
    const tr3 = Math.abs(current.low - prev.close);
    tr.push(Math.max(tr1, tr2, tr3));
  }
  
  // 使用Wilder平滑计算
  const smoothPlusDM = wilderSmooth(plusDM, period);
  const smoothMinusDM = wilderSmooth(minusDM, period);
  const smoothTR = wilderSmooth(tr, period);
  
  // 计算+DI和-DI
  for (let i = period; i < n; i++) {
    const idx = i - period;
    if (smoothTR[idx] > 0) {
      plusDI[i] = 100 * smoothPlusDM[idx] / smoothTR[idx];
      minusDI[i] = 100 * smoothMinusDM[idx] / smoothTR[idx];
      
      // 计算DX
      const currentPlusDI = plusDI[i];
      const currentMinusDI = minusDI[i];
      if (currentPlusDI === null || currentMinusDI === null) continue;
      
      const diDiff = Math.abs(currentPlusDI - currentMinusDI);
      const diSum = currentPlusDI + currentMinusDI;
      if (diSum > 0) {
        const dx = 100 * diDiff / diSum;
        
        // 计算ADX（DX的Wilder平滑）
        if (i === period) {
          adx[i] = dx;
        } else {
          const prevADX = adx[i - 1] ?? dx;
          adx[i] = (prevADX * (period - 1) + dx) / period;
        }
        
        // 判断ADX状态（与3天前比较）
        if (i >= period + 3) {
          const currentADX = adx[i];
          const adx3DaysAgoVal = adx[i - 3];
          if (currentADX !== null && adx3DaysAgoVal !== null) {
            const diff = currentADX - adx3DaysAgoVal;
            if (diff > 1) {
              adxState[i] = 'rising';
            } else if (diff < -1) {
              adxState[i] = 'falling';
            } else {
              adxState[i] = 'flat';
            }
          }
        }
      }
    }
  }
  
  return { adx, plusDI, minusDI, adxState };
}

/**
 * Wilder平滑法
 * @param data 数据数组
 * @param period 周期
 * @returns 平滑后的数组
 */
function wilderSmooth(data: number[], period: number): number[] {
  const result: number[] = [];
  if (data.length < period) return result;
  
  // 第一个值是简单平均
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  result.push(sum / period);
  
  // 后续使用Wilder公式：EMA = (prevEMA * (n-1) + current) / n
  for (let i = period; i < data.length; i++) {
    const prevEMA = result[result.length - 1];
    result.push((prevEMA * (period - 1) + data[i]) / period);
  }
  
  return result;
}

/**
 * 计算PVT（价量趋势指标）
 * @param stockData K线数据
 * @returns PVT值、背离信号、PVT趋势
 */
function calculatePVT(
  stockData: StockData[]
): {
  pvt: (number | null)[];
  pvtDivergence: ('none' | 'top' | 'bottom' | null)[];
  pvtTrend: ('rising' | 'falling' | 'flat' | null)[];
} {
  const n = stockData.length;
  const pvt: (number | null)[] = new Array(n).fill(null);
  const pvtDivergence: ('none' | 'top' | 'bottom' | null)[] = new Array(n).fill(null);
  const pvtTrend: ('rising' | 'falling' | 'flat' | null)[] = new Array(n).fill(null);
  
  if (n < 2) return { pvt, pvtDivergence, pvtTrend };
  
  // 计算PVT累积值
  pvt[0] = 0;
  for (let i = 1; i < n; i++) {
    const priceChange = (stockData[i].close - stockData[i - 1].close) / stockData[i - 1].close;
    pvt[i] = (pvt[i - 1] || 0) + stockData[i].volume * priceChange;
  }
  
  // 计算PVT趋势（与5天前比较）
  for (let i = 5; i < n; i++) {
    const diff = (pvt[i] || 0) - (pvt[i - 5] || 0);
    if (diff > 0) {
      pvtTrend[i] = 'rising';
    } else if (diff < 0) {
      pvtTrend[i] = 'falling';
    } else {
      pvtTrend[i] = 'flat';
    }
  }
  
  // 检测背离（使用20天窗口找极值）
  const window = 20;
  for (let i = window; i < n; i++) {
    const priceWindow = stockData.slice(i - window, i + 1).map(d => d.close);
    const pvtWindow = pvt.slice(i - window, i + 1).filter((v): v is number => v !== null);
    
    if (pvtWindow.length < window) continue;
    
    const currentPrice = stockData[i].close;
    const currentPVT = pvt[i] || 0;
    
    const maxPrice = Math.max(...priceWindow);
    const minPrice = Math.min(...priceWindow);
    const maxPVT = Math.max(...pvtWindow);
    const minPVT = Math.min(...pvtWindow);
    
    // 顶背离：价格新高，PVT未新高
    if (currentPrice >= maxPrice * 0.99 && currentPVT < maxPVT * 0.95) {
      pvtDivergence[i] = 'top';
    }
    // 底背离：价格新低，PVT未新低
    else if (currentPrice <= minPrice * 1.01 && currentPVT > minPVT * 1.05) {
      pvtDivergence[i] = 'bottom';
    }
    else {
      pvtDivergence[i] = 'none';
    }
  }
  
  return { pvt, pvtDivergence, pvtTrend };
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
