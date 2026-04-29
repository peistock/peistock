import type { IndicatorData } from '@/types';

/**
 * 股票信号检测 - 共享模块
 * 与前端K线图B/S标记口径保持一致
 *
 * 修改历史：
 * - 2026-03-16: 初始版本，提取自 StockChart.tsx
 * - 2026-03-17: 修改为雪球大V同款逻辑（PVT背离+严格条件）
 * - 2026-04-30: 底背离成本偏离阈值收紧到<15%，删除S(高估)，与前端K线图标记一致
 */

export interface SignalThresholds {
  // 买入阈值
  buyCostDev: number;  // 成本偏离度百分位
  buyBias: number;     // BIAS225百分位
  buyCRI: number;      // CRI阈值
  // 卖出阈值
  sellGreedy: number;  // 贪婪指数百分位
  sellBias: number;    // BIAS225百分位
  sellCostDev: number; // 成本偏离度百分位
}

// 雪球大V同款阈值（严格版）
export const XUEQIU_THRESHOLDS: SignalThresholds = {
  buyCostDev: 5,    // B(恐慌): 成本偏离<5%
  buyBias: 5,       // B(恐慌): BIAS<5%
  buyCRI: 90,       // B(恐慌): CRI>90
  sellGreedy: 95,   // S(贪婪): 贪婪>95%
  sellBias: 90,     // S(贪婪): BIAS>90%
  sellCostDev: 95,  // S(高估): 成本偏离>95%
};

// B(底背离)阈值（与前端K线图一致）
export const DIVERGENCE_BUY = {
  criMin: 60,           // CRI≥60
  costDevMax: 15,       // 成本偏离<15%（与前端K线图一致）
  consecutiveDays: 2,   // 连续≥2天底背离
};

// S(顶背离)阈值
export const DIVERGENCE_SELL = {
  biasMin: 50,          // BIAS>50%
  consecutiveDays: 2,   // 连续≥2天顶背离
};

export interface SignalData {
  costDeviationPercentile: number | null;
  bias225Percentile: number | null;
  cri: number | null;
  greedyPercentile: number | null;
  pvtDivergence?: ('none' | 'top' | 'bottom' | null);  // 当前PVT背离
}

export interface ExtendedSignalData extends SignalData {
  // 最近几天的历史数据（用于检测连续背离）
  recentDivergences?: ('none' | 'top' | 'bottom' | null)[];
  recentCRI?: (number | null)[];
  recentCostDev?: (number | null)[];
}

export interface SignalResult {
  signals: string[];
  signalType: 'B' | 'S' | null;
}

/**
 * 检测连续背离天数
 */
function countConsecutiveDivergences(
  divergences: ('none' | 'top' | 'bottom' | null)[],
  type: 'top' | 'bottom'
): number {
  let count = 0;
  for (let i = divergences.length - 1; i >= 0; i--) {
    if (divergences[i] === type) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * 统计最近N天中满足条件的数量
 */
function countRecentMeetings(
  values: (number | null)[],
  predicate: (v: number) => boolean
): number {
  return values.filter((v): v is number => v !== null && predicate(v)).length;
}

/**
 * 检测买卖信号 - 与前端K线图B/S标记口径一致
 *
 * B(底背离): 连续≥2天底背离 + CRI≥60有2天 + 成本偏离<15%有2天
 * B(恐慌): 成本偏离<5% + BIAS<5% + CRI>90
 * S(顶背离): 连续≥2天顶背离 + BIAS>50%
 * S(贪婪): 贪婪>95% + BIAS>90%
 */
export function detectSignals(
  data: ExtendedSignalData,
  useDivergence: boolean = true  // 是否使用背离检测（雪球模式）
): SignalResult {
  const signals: string[] = [];
  let signalType: 'B' | 'S' | null = null;

  const {
    costDeviationPercentile: costDev,
    bias225Percentile: bias,
    cri,
    greedyPercentile: greedy,
    recentDivergences = [],
    recentCRI = [],
    recentCostDev = [],
  } = data;

  const t = XUEQIU_THRESHOLDS;

  // ===== 买入信号 =====

  // B(底背离): 连续≥2天底背离 + CRI≥60有2天 + 成本偏离<50%有2天
  if (useDivergence && recentDivergences.length > 0) {
    const bottomDivCount = countConsecutiveDivergences(recentDivergences, 'bottom');
    
    if (bottomDivCount >= DIVERGENCE_BUY.consecutiveDays) {
      // 检查最近N天中CRI≥60的天数
      const recentDays = Math.min(bottomDivCount, recentCRI.length);
      const recentCRISlice = recentCRI.slice(-recentDays);
      const criMeetingCount = countRecentMeetings(recentCRISlice, v => v >= DIVERGENCE_BUY.criMin);
      
      // 检查最近N天中成本偏离<50%的天数
      const recentCostDevSlice = recentCostDev.slice(-recentDays);
      const costDevMeetingCount = countRecentMeetings(recentCostDevSlice, v => v < DIVERGENCE_BUY.costDevMax);
      
      if (criMeetingCount >= 2 && costDevMeetingCount >= 2) {
        signals.push(`B(底背离${bottomDivCount}天)`);
        signalType = 'B';
      }
    }
  }

  // B(恐慌): 成本偏离<5% + BIAS<5% + CRI>90
  const isCostDevPanic = costDev !== null && costDev < t.buyCostDev;
  const isBiasPanic = bias !== null && bias < t.buyBias;
  const isCRIPanic = cri !== null && cri > t.buyCRI;

  if (isCostDevPanic && isBiasPanic && isCRIPanic) {
    signals.push('B(恐慌)');
    signalType = 'B';
  }

  // ===== 卖出信号 =====

  // S(顶背离): 连续≥2天顶背离 + BIAS>50%
  if (useDivergence && recentDivergences.length > 0) {
    const topDivCount = countConsecutiveDivergences(recentDivergences, 'top');
    const isBiasHigh = bias !== null && bias > DIVERGENCE_SELL.biasMin;
    
    if (topDivCount >= DIVERGENCE_SELL.consecutiveDays && isBiasHigh) {
      signals.push(`S(顶背离${topDivCount}天)`);
      signalType = 'S';
    }
  }

  // S(贪婪): 贪婪>95% + BIAS>90%
  const isGreedyHigh = greedy !== null && greedy > t.sellGreedy;
  const isBiasSellHigh = bias !== null && bias > t.sellBias;

  if (isGreedyHigh && isBiasSellHigh) {
    signals.push('S(贪婪)');
    signalType = 'S';
  }

  return { signals, signalType };
}

/**
 * 简化版信号检测（兼容旧版，用于快速扫描）
 * 只检测 B(恐慌) 和 S(贪婪)/S(高估)
 */
export function detectSignalsSimple(
  bias225Pct: number | null,
  cri: number | null,
  greedyPct: number | null,
  costDevPct?: number | null
): SignalResult {
  const signals: string[] = [];
  let signalType: 'B' | 'S' | null = null;

  const t = XUEQIU_THRESHOLDS;

  // B(恐慌): 成本偏离<5% + BIAS<5% + CRI>90
  if (costDevPct != null && bias225Pct != null && cri != null) {
    if (costDevPct < t.buyCostDev && bias225Pct < t.buyBias && cri > t.buyCRI) {
      signals.push('B(恐慌)');
      signalType = 'B';
    }
  }

  // S(贪婪): 贪婪>95% + BIAS>90%
  if (greedyPct !== null && greedyPct > t.sellGreedy && bias225Pct !== null && bias225Pct > t.sellBias) {
    signals.push('S(贪婪)');
    signalType = 'S';
  }

  return { signals, signalType };
}

/**
 * 版本信息
 */
export const SIGNAL_MODULE_VERSION = '2.0.0';
export const SIGNAL_MODULE_DATE = '2026-03-17';
export const SIGNAL_MODULE_SOURCE = '雪球大V同款逻辑 (xueqiu_tracker)';

// ========== 前端同款信号逻辑（扫描脚本同步用）==========

export interface FrontendSignalResult {
  buySignals: string[];
  sellSignals: string[];
  displayBuySignals: string[];
  displaySellSignals: string[];
  marketState: 'panic' | 'trend_down' | 'overbought' | 'normal';
  stateTitle: string;
  stateColor: string;
  stateDesc: string;
}

export function detectSignalsFrontend(
  last: IndicatorData,
  prev?: IndicatorData
): FrontendSignalResult {
  const buySignals: string[] = [];
  const sellSignals: string[] = [];

  // 趋势强度分析（统一使用ADX作为标准）
  const trendStrength = last.trendStrength;

  // ADX趋势强度分析
  const adx = last.adx;
  const adxState = last.adxState;
  const pvtDivergence = last.pvtDivergence;

  // PVT背离风险判定（提前声明供后续使用）
  const hasPVTTopDivergence = pvtDivergence === 'top';
  // 底背离需要过滤高位区域（使用BIAS225判断）
  const bias225 = last.bias225;
  const isPriceHigh = bias225 !== null && bias225 > 10; // BIAS>10%视为高位
  // 只有不在高位时才视为有效底背离
  const hasPVTBottomDivergence = pvtDivergence === 'bottom' && !isPriceHigh;

  // 根据ADX判断趋势强度等级
  const isADXStrongTrend = adx !== null && adx >= 40 && adxState === 'rising';
  const isADXWeakening = adx !== null && adx >= 40 && adxState === 'falling';

  // 统一趋势级别判断（供多处使用）
  const getTrendLevel = () => {
    if (adx === null) return 'weak';
    if (hasPVTTopDivergence && adxState === 'falling') return 'weak'; // 顶背离+ADX回落=趋势转弱
    if (hasPVTTopDivergence) return 'medium'; // 有顶背离时最高算中等
    if (adx >= 40) return 'strong';
    if (adx >= 20) return 'medium';
    return 'weak';
  };

  const trendLevel = getTrendLevel();
  const isStrongTrend = trendLevel === 'strong';
  const isMediumTrend = trendLevel === 'medium';

  // 动态超买阈值计算（结合趋势强度和ADX）
  let overboughtThreshold = 80;
  let extremeOverboughtThreshold = 95;

  if (isStrongTrend && isADXStrongTrend) {
    overboughtThreshold = 99; // 强趋势+ADX上升，极高容忍度
    extremeOverboughtThreshold = 99;
  } else if (isStrongTrend || isADXStrongTrend) {
    overboughtThreshold = 95; // 强趋势或ADX强
    extremeOverboughtThreshold = 99;
  } else if (isMediumTrend) {
    overboughtThreshold = 87;
    extremeOverboughtThreshold = 95;
  } else if (isADXWeakening) {
    overboughtThreshold = 87; // ADX从高位回落，降低容忍度
    extremeOverboughtThreshold = 95;
  }

  // 高位风险判定
  const bias225Pct = last.bias225Percentile;
  const costDevPct = last.costDeviationPercentile;

  // 固定阈值（用于机会信号否决）- 无论趋势如何，80%分位即视为高位
  const isPriceHighFixed = (bias225Pct !== null && bias225Pct >= 80) ||
                           (costDevPct !== null && costDevPct >= 80);

  // 动态阈值（用于风险信号分级）
  const isPriceExtremeOverbought = (bias225Pct !== null && bias225Pct >= extremeOverboughtThreshold) ||
                                   (costDevPct !== null && costDevPct >= extremeOverboughtThreshold);
  const isPriceOverbought = (bias225Pct !== null && bias225Pct >= overboughtThreshold) ||
                            (costDevPct !== null && costDevPct >= overboughtThreshold);

  // 高位钝化判断（使用统一的趋势标准）
  // 强趋势或中等趋势（无顶背离）+ 乖离率高但未达超买阈值
  const isHighBiasWithStrongTrend =
    (isStrongTrend || (isMediumTrend && !hasPVTTopDivergence)) &&
    ((bias225Pct !== null && bias225Pct >= 80 && bias225Pct < overboughtThreshold) ||
     (costDevPct !== null && costDevPct >= 80 && costDevPct < overboughtThreshold));

  // ========== BIAS225历史分位数信号 ==========
  // 当已触发高位超买时，跳过单独的BIAS信号避免重复
  if (bias225Pct !== null && !isPriceOverbought) {
    if (bias225Pct <= 10) {
      buySignals.push(`BIAS225历史极端低位 (${bias225Pct.toFixed(1)}%分位)`);
    } else if (bias225Pct <= 20) {
      buySignals.push(`BIAS225低于历史80%水平 (${bias225Pct.toFixed(1)}%分位)`);
    }

    if (bias225Pct >= 90) {
      sellSignals.push(`BIAS225历史极端高位 (${bias225Pct.toFixed(1)}%分位)`);
    } else if (bias225Pct >= 80) {
      sellSignals.push(`BIAS225高于历史80%水平 (${bias225Pct.toFixed(1)}%分位)`);
    }
  }

  // 成本差穿越零轴信号
  if (prev !== undefined && last.costDiff !== null && prev.costDiff !== null) {
    if (last.costDiff > 0 && prev.costDiff <= 0) {
      buySignals.push('成本差上穿零轴 - 短期转强');
    }
    if (last.costDiff < 0 && prev.costDiff >= 0) {
      sellSignals.push('成本差下穿零轴 - 短期转弱');
    }
  }

  // ========== 成本偏离度历史分位数信号 ==========
  // 当已触发高位超买时，跳过单独的成本偏离度信号避免重复
  if (costDevPct !== null && !isPriceOverbought) {
    if (costDevPct <= 5) {
      buySignals.push(`成本偏离度历史极端低位 (${costDevPct.toFixed(1)}%分位)`);
    } else if (costDevPct <= 15) {
      buySignals.push(`成本偏离度低于历史85%水平 (${costDevPct.toFixed(1)}%分位)`);
    }

    if (costDevPct >= 95) {
      sellSignals.push(`成本偏离度历史极端高位 (${costDevPct.toFixed(1)}%分位)`);
    } else if (costDevPct >= 85) {
      sellSignals.push(`成本偏离度高于历史85%水平 (${costDevPct.toFixed(1)}%分位)`);
    }
  }

  // ========== CRI独立风险信号（最高优先级）==========
  const criValue = last.cri;
  const criPct = last.criPercentile;
  const criState = last.criState;
  const volState = last.volumeState;
  const slopeLvl = last.slopeLevel || 0;
  const slopePct = last.slopePressure || 0;

  // CRI风险信号：结合绝对值和历史分位数
  if (criValue !== null && criPct !== null) {
    // 极高CRI（绝对值≥70）：直接触发
    if (criValue >= 90) {
      sellSignals.push(`极度恐慌 (CRI:${criValue.toFixed(1)})`);
    } else if (criValue >= 80) {
      sellSignals.push(`高度恐慌 (CRI:${criValue.toFixed(1)})`);
    } else if (criValue >= 70) {
      sellSignals.push(`中度恐慌 (CRI:${criValue.toFixed(1)})`);
    }

    // CRI历史极端高位（但绝对值<70时不触发恐慌信号，仅提示）
    if (criPct >= 95 && criValue >= 50) {
      sellSignals.push(`CRI历史极端高位 (${criPct.toFixed(0)}%分位)`);
    } else if (criPct >= 90 && criValue >= 50) {
      sellSignals.push(`CRI高于历史90% (${criPct.toFixed(0)}%分位)`);
    }
  }

  // ========== 斜率因子三维决策矩阵 ==========
  // 高斜率压力预警
  if (slopeLvl >= 3) {
    sellSignals.push(`趋势下压·强 (${slopePct.toFixed(0)}分)`);
  } else if (slopeLvl >= 2) {
    sellSignals.push(`趋势下压·中 (${slopePct.toFixed(0)}分)`);
  }

  // ========== PVT背离信号（量价背离）==========
  // PVT顶背离：价格新高但PVT未新高，提示量价背离风险
  if (hasPVTTopDivergence) {
    // ADX回落时顶背离风险更高
    if (isADXWeakening) {
      sellSignals.push('⚠️ 价量顶背离：ADX回落，建议减仓');
    } else {
      sellSignals.push('⚠️ 价量顶背离：价格与量能背离，建议减仓');
    }
  }
  // PVT底背离：价格新低但PVT未新低，增强反弹预期
  // 条件：底背离 + 非高位 + (恐慌解除 或 ADX上升)
  if (hasPVTBottomDivergence && !isPriceHighFixed) {
    const panicRelieved = criState !== 'panic' || (criValue !== null && criValue < 60);
    const adxRising = adxState === 'rising';

    if (panicRelieved && adxRising) {
      buySignals.push('✅ 价量底背离：ADX上升，可左侧试探');
    } else if (panicRelieved) {
      buySignals.push('✅ 价量底背离：恐慌解除，关注反弹');
    }
  }

  // CRI极端高位（恐慌分位数高）
  const isCRIExtremeHigh = criPct !== null && criPct >= 95;
  const isCRIHigh = criPct !== null && criPct >= 80;

  // 三维组合判断（CRI≥70才视为有效恐慌）
  const isRealPanic = criState === 'panic' && criValue !== null && criValue >= 70;
  const isNormalState = criState !== 'panic' || (criValue !== null && criValue < 70);

  if (isRealPanic && slopeLvl >= 2) {
    sellSignals.push('恐慌+下压：建议清仓');
  } else if (isRealPanic && volState === 'extreme-shrink') {
    buySignals.push('恐慌·缩量：可能洗盘，观望');
  } else if (slopeLvl >= 2 && volState === 'expand') {
    sellSignals.push('下压·放量：下跌趋势确认');
  } else if (isNormalState && slopeLvl === 0 && volState === 'shrink' && !isPriceHighFixed) {
    // 机会信号否决条件：使用固定阈值80%，无论趋势如何
    buySignals.push('正常·无压·缩量：关注反弹');
  } else if (isNormalState && slopeLvl === 0 && volState === 'shrink' && isPriceHighFixed) {
    // 价格高位（>80%分位）时抑制机会信号，改为风险提示
    if (trendStrength === 'strong_bull' || trendStrength === 'bull') {
      sellSignals.push('高位钝化·缩量：趋势中回调，追高谨慎');
    } else {
      sellSignals.push('高位超买·缩量：警惕回调风险');
    }
  }

  // ========== 趋势回调买入信号 ==========
  // 在强趋势背景下，价格回调至关键均线附近的机会
  if ((trendStrength === 'strong_bull' || trendStrength === 'bull') &&
      last.ma20 !== null && last.ma60 !== null) {

    const close = last.close;
    const ma20 = last.ma20;
    const ma60 = last.ma60;

    // 条件1：价格回踩MA20或MA60且获得支撑（未跌破）
    const nearMA20 = close >= ma20 * 0.98 && close <= ma20 * 1.02; // 在MA20 ±2%范围内
    const nearMA60 = close >= ma60 * 0.98 && close <= ma60 * 1.02; // 在MA60 ±2%范围内

    // 条件2：CRI未进入极端恐慌（分位<70%）
    const criNotExtreme = criPct !== null && criPct < 70;

    // 条件3：成交量萎缩（VR<0.8）
    const volumeShrinking = volState === 'extreme-shrink' || volState === 'shrink';

    if ((nearMA20 || nearMA60) && criNotExtreme && volumeShrinking) {
      const maLabel = nearMA20 ? 'MA20' : 'MA60';
      buySignals.push(`趋势回调·${maLabel}支撑 (BIAS:${bias225Pct?.toFixed(0)}%分位) - 关注买入`);
    }
  }

  // 高位钝化提示（等级1警告）：乖离率高但趋势强劲
  if (isHighBiasWithStrongTrend) {
    const trendLabel = isStrongTrend ? '强趋势' : '多头';
    const adxLabel = adx !== null ? `ADX:${adx.toFixed(0)}` : '';
    sellSignals.push(`高位钝化·${trendLabel} (${adxLabel}) - 追高谨慎`);
  }

  // 高位超买独立风险信号（等级2警告）：真正的超买
  if (isPriceExtremeOverbought) {
    const thresholdLabel = extremeOverboughtThreshold === 99 ? '99%' : '95%';
    sellSignals.push(`极端超买·${thresholdLabel}阈值 (BIAS:${bias225Pct?.toFixed(0)}%·成本:${costDevPct?.toFixed(0)}%) - 建议减仓`);
  } else if (isPriceOverbought) {
    const thresholdLabel = overboughtThreshold === 95 ? '95%' : (overboughtThreshold === 87 ? '87%' : '80%');
    sellSignals.push(`高位超买·${thresholdLabel}阈值 (BIAS:${bias225Pct?.toFixed(0)}%·成本:${costDevPct?.toFixed(0)}%) - 注意风险`);
  }

  // CRI高位独立风险信号（与价格超买区分）
  if (isCRIExtremeHigh) {
    sellSignals.push(`CRI极端高位 (${criPct?.toFixed(0)}%分位)`);
  } else if (isCRIHigh) {
    sellSignals.push(`CRI高位 (${criPct?.toFixed(0)}%分位)`);
  }

  // ========== 市场状态决策树（按权重优先级）==========
  // 权重：CRI(最高) > 极端位置(双90%+/95%+/100%) > 趋势(斜率+ADX) > PVT背离 > 一般位置
  type MarketState = 'panic' | 'trend_down' | 'overbought' | 'normal';
  let marketState: MarketState = 'normal';
  let stateTitle = '';
  let stateColor = '';
  let stateDesc = '';

  // 辅助判断
  const hasSlopePressure = slopeLvl >= 2;
  const adxRising = adxState === 'rising';
  const adxFalling = adxState === 'falling';

  // 极端位置判断（BIAS和成本偏离同时≥90%视为极端危险）
  const isDualExtremeHigh = (bias225Pct !== null && bias225Pct >= 90) &&
                            (costDevPct !== null && costDevPct >= 90);
  const isSingleExtremeHigh = (bias225Pct !== null && bias225Pct >= 95) ||
                              (costDevPct !== null && costDevPct >= 95);
  const isHistoricalExtreme = (bias225Pct !== null && bias225Pct >= 99) ||
                              (costDevPct !== null && costDevPct >= 99);

  // ===== 第一层：CRI极端风险（权重最高）=====
  if ((criValue !== null && criValue >= 80) || isCRIExtremeHigh) {
    marketState = 'panic';
    stateTitle = '恐慌状态';
    stateColor = '#FF3435';
    stateDesc = 'CRI极端风险，情绪极度悲观，暂停左侧交易，等待风险释放';
  }
  // ===== 第二层：极端位置风险（双90%+或95%+，权重第二）=====
  else if (isHistoricalExtreme) {
    marketState = 'overbought';
    if (isStrongTrend) {
      stateTitle = '历史极值·ADX强';
      stateColor = '#D2A8FF';
      stateDesc = '股价创历史新高极值(99%+)，即使ADX强也需警惕，建议减仓';
    } else {
      stateTitle = '历史极值·高风险';
      stateColor = '#FF3435';
      stateDesc = '股价创历史新高极值(99%+)，强烈建议减仓';
    }
  } else if (isDualExtremeHigh) {
    marketState = 'overbought';
    if (hasPVTTopDivergence) {
      stateTitle = '双指标极端·顶背离';
      stateColor = '#FF3435';
      stateDesc = 'BIAS和成本偏离均超90%且顶背离，危险信号，必须减仓';
    } else if (isStrongTrend) {
      stateTitle = '双指标极端·ADX强';
      stateColor = '#FF3435';
      stateDesc = 'BIAS和成本偏离均超90%，即使ADX强也需警惕，建议减仓';
    } else {
      stateTitle = '双指标极端·高风险';
      stateColor = '#FF3435';
      stateDesc = 'BIAS和成本偏离均超90%，强烈建议减仓';
    }
  } else if (isSingleExtremeHigh) {
    marketState = 'overbought';
    if (hasPVTTopDivergence) {
      stateTitle = '单指标极端·顶背离';
      stateColor = '#FF3435';
      stateDesc = '单一指标超95%且顶背离，高风险，建议减仓';
    } else if (isStrongTrend) {
      stateTitle = '单指标极端·ADX强';
      stateColor = '#E3B341';
      stateDesc = '单一指标超95%，ADX强趋势支撑，密切关注';
    } else {
      stateTitle = '单指标极端';
      stateColor = '#E3B341';
      stateDesc = '单一指标超95%，建议减仓';
    }
  }
  // ===== 第三层：趋势因子（斜率压制）=====
  else if (hasSlopePressure) {
    marketState = 'trend_down';
    if (hasPVTTopDivergence) {
      stateTitle = '斜率压制·顶背离';
      stateColor = '#FF3435';
      stateDesc = '中长期斜率压制+PVT顶背离，下跌趋势确认，建议减仓';
    } else if (isStrongTrend) {
      stateTitle = '斜率压制·ADX强';
      stateColor = '#E3B341';
      stateDesc = '斜率压制但ADX强，短期有反弹，中长期仍承压';
    } else {
      stateTitle = '斜率压制';
      stateColor = '#E3B341';
      stateDesc = '中长期趋势承压，不轻易抄底，等待趋势企稳';
    }
  }
  // ===== 第四层：ADX趋势反转（顶背离修正）=====
  else if (hasPVTTopDivergence && adxFalling) {
    marketState = 'overbought';
    stateTitle = '顶背离·ADX回落';
    stateColor = '#FF3435';
    stateDesc = 'PVT顶背离+ADX回落，趋势转弱，警惕回调，建议减仓';
  } else if (hasPVTTopDivergence && isStrongTrend) {
    marketState = 'overbought';
    stateTitle = '顶背离·ADX强';
    stateColor = '#E3B341';
    stateDesc = 'PVT顶背离但ADX仍强，趋势可能延续，密切关注';
  } else if (hasPVTTopDivergence) {
    marketState = 'overbought';
    stateTitle = '顶背离·ADX弱';
    stateColor = '#E3B341';
    stateDesc = 'PVT顶背离+ADX弱，趋势不明，谨慎观望';
  }
  // ===== 第五层：ADX趋势状态（核心趋势）=====
  else if (isStrongTrend && adxRising) {
    marketState = 'normal';
    stateTitle = 'ADX强趋势·上升';
    stateColor = '#03B172';
    stateDesc = 'ADX强且上升，趋势强劲，可持股待涨';
  } else if (isStrongTrend) {
    marketState = 'normal';
    stateTitle = 'ADX强趋势';
    stateColor = '#03B172';
    stateDesc = 'ADX强趋势，可持股待涨，关注回调买入';
  } else if (isMediumTrend && adxRising) {
    marketState = 'normal';
    stateTitle = 'ADX多头·上升';
    stateColor = '#58A6FF';
    stateDesc = 'ADX中等且上升，趋势转强，可积极操作';
  } else if (isMediumTrend && adxFalling) {
    marketState = 'normal';
    stateTitle = 'ADX多头·回落';
    stateColor = '#E3B341';
    stateDesc = 'ADX中等但回落，趋势减弱，谨慎追高';
  } else if (isMediumTrend) {
    marketState = 'normal';
    stateTitle = 'ADX多头';
    stateColor = '#58A6FF';
    stateDesc = 'ADX中等趋势，可积极操作';
  }
  // ===== 第六层：底背离机会（领先指标）=====
  else if (hasPVTBottomDivergence && adxRising) {
    marketState = 'normal';
    stateTitle = '底背离·ADX上升';
    stateColor = '#03B172';
    stateDesc = 'PVT底背离+ADX上升，反弹动能增强，可左侧试探';
  } else if (hasPVTBottomDivergence) {
    marketState = 'normal';
    stateTitle = '底背离·观察';
    stateColor = '#58A6FF';
    stateDesc = 'PVT底背离，关注反弹机会';
  }
  // ===== 第七层：一般位置指标（80-90%，权重最低）=====
  else if (isPriceExtremeOverbought) {
    marketState = 'overbought';
    if (isStrongTrend) {
      stateTitle = '超买·ADX强';
      stateColor = '#D2A8FF';
      stateDesc = `股价较高(${extremeOverboughtThreshold}%)，ADX强支撑，暂观望`;
    } else {
      stateTitle = '超买';
      stateColor = '#E3B341';
      stateDesc = '股价较高，建议减仓';
    }
  } else if (isPriceOverbought) {
    marketState = 'overbought';
    if (isStrongTrend) {
      stateTitle = '偏高·ADX强';
      stateColor = '#E3B341';
      stateDesc = `股价偏高(${overboughtThreshold}%)，ADX强支撑，暂不强制减仓`;
    } else {
      stateTitle = '偏高';
      stateColor = '#E3B341';
      stateDesc = '股价偏高，谨慎追高';
    }
  } else if (isPriceHighFixed) {
    marketState = 'overbought';
    if (isStrongTrend) {
      stateTitle = '高位·ADX强';
      stateColor = '#58A6FF';
      stateDesc = `股价高位(${bias225Pct?.toFixed(0)}%)，ADX支撑，追高谨慎`;
    } else {
      stateTitle = '高位';
      stateColor = '#E3B341';
      stateDesc = '股价高位，建议减仓';
    }
  }
  // ===== 第七层：震荡/弱趋势（ADX<20）=====
  else {
    marketState = 'normal';
    stateTitle = '震荡整理';
    stateColor = '#8B949E';
    stateDesc = 'ADX弱趋势，震荡行情，区间操作或观望';
  }

  // 根据状态调整信号显示
  let displayBuySignals = [...buySignals];
  let displaySellSignals = [...sellSignals];

  if (marketState === 'panic') {
    // 恐慌状态：机会信号降级，添加警告
    if (displayBuySignals.length > 0) {
      displayBuySignals = displayBuySignals.map(s => `⚠️ ${s}`);
      displayBuySignals.unshift('【左侧信号暂停】');
    }
  } else if (marketState === 'trend_down') {
    // 趋势下压状态：左侧信号权重降低
    if (displayBuySignals.length > 0) {
      displayBuySignals = displayBuySignals.map(s => `△ ${s}`);
      displayBuySignals.unshift('【等待趋势企稳】');
    }
  } else if (marketState === 'overbought') {
    // 高位超买状态：机会信号被抑制
    if (displayBuySignals.length > 0) {
      displayBuySignals = displayBuySignals.map(s => `❌ ${s}`);
      displayBuySignals.unshift('【高位超买，机会信号关闭】');
    }
  }

  return {
    buySignals,
    sellSignals,
    displayBuySignals,
    displaySellSignals,
    marketState,
    stateTitle,
    stateColor,
    stateDesc,
  };
}
