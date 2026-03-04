import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { StockData, IndicatorData } from '@/types';

interface StockChartProps {
  stockData: StockData[];
  indicators: IndicatorData[];
  showMAHS: boolean;
  showEMAHS: boolean;
  showMA: boolean;
  title?: string;
  compact?: boolean;
  timeframe?: 'daily' | 'weekly' | 'min15';
  version?: 'strict' | 'loose'; // 严格版/宽松版
}

const StockChart = ({ stockData, indicators, showMAHS, showEMAHS, showMA, title, compact, timeframe, version = 'strict' }: StockChartProps) => {
  // 低频BS阈值（固定）
  const LOW_FREQ_BUY = { costDev: 5, bias: 5, cri: 90 };
  const LOW_FREQ_SELL = { greedy: 95, bias: 90 };
  
  // 高频BS阈值
  const HIGH_FREQ_BUY = { costDev: 10, bias: 10, cri: 83 };
  
  // 根据版本设置阈值参数
  const thresholds: {
    buyCostDev: number;
    buyBias: number;
    buyCRI: number;
    sellGreedy: number;
    sellBias: number;
    sellCostDev: number;
    labelB: string;
    labelS: string;
    useAndLogic: boolean;
  } = version === 'strict' 
    ? {
        // 低频BS: 需同时满足所有条件（AND逻辑）
        buyCostDev: LOW_FREQ_BUY.costDev,
        buyBias: LOW_FREQ_BUY.bias,
        buyCRI: LOW_FREQ_BUY.cri,
        sellGreedy: LOW_FREQ_SELL.greedy,
        sellBias: LOW_FREQ_SELL.bias,
        sellCostDev: 95,
        labelB: 'B:低频(costDev<5%&bias<5%&CRI>90)',
        labelS: 'S:低频(greedy>95%&bias>90%)',
        useAndLogic: true,
      }
    : {
        // 高频BS: 低频条件 OR 高频扩展条件（OR逻辑）
        // 但CRI不能单独触发，需结合价位（costDev < 30%）避免顶部买入
        buyCostDev: HIGH_FREQ_BUY.costDev,
        buyBias: HIGH_FREQ_BUY.bias,
        buyCRI: HIGH_FREQ_BUY.cri,
        sellGreedy: LOW_FREQ_SELL.greedy,  // 卖出用低频阈值
        sellBias: LOW_FREQ_SELL.bias,
        sellCostDev: 95,
        labelB: 'B:高频(低频条件ORcostDev<10%ORbias<10%OR(CRI>83&costDev<30%))',
        labelS: 'S:高频(低频条件ORgreedy>95%ORbias>95%)',
        useAndLogic: false,
      };
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chartRef.current || stockData.length === 0) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, 'dark');
    }

    const dates = stockData.map(d => d.date);
    const klineData = stockData.map(d => [d.open, d.close, d.low, d.high]);
    const volumes = stockData.map(d => d.volume);

    const ma5Data = indicators.map(d => d.ma5);
    const ma20Data = indicators.map(d => d.ma20);
    const ma99Data = indicators.map(d => d.ma99);
    const ma128Data = indicators.map(d => d.ma128);
    const ma225Data = indicators.map(d => d.ma225);
    const mahsData = indicators.map(d => d.mahs);
    const emahsData = indicators.map(d => d.emahs);
    const criData = indicators.map(d => d.cri);
    const greedyData = indicators.map(d => d.greedy);
    const greedyPercentileData = indicators.map(d => d.greedyPercentile);
    // 情绪指数暂时隐藏，避免副图线条过多
    // const sentimentData = indicators.map(d => d.sentiment);
    const costDeviationData = indicators.map(d => d.costDeviation);
    const costDeviationPercentileData = indicators.map(d => d.costDeviationPercentile);
    const bias225PercentileData = indicators.map(d => d.bias225Percentile);
    const pvtDivergenceData = indicators.map(d => d.pvtDivergence);

    // 计算抵扣价标注数据
    const lastIndex = indicators.length - 1;
    const ma20DeductIndex = lastIndex >= 19 ? lastIndex - 19 : -1;
    const ma60DeductIndex = lastIndex >= 59 ? lastIndex - 59 : -1;
    const ma225DeductIndex = lastIndex >= 224 ? lastIndex - 224 : -1;
    
    // ========== B/S信号间隔过滤规则 ==========
    // 规则1: B信号后，5日内跌幅<5%不出现第二个B；6-10日内跌幅<10%不出现B；>10日不受限制
    // 规则2: S信号后，5日内涨幅<5%不出现第二个S；6-10日内涨幅<10%不出现S；>10日不受限制
    // 规则3: S信号后，5日内跌幅<5%不出现B；6-10日内跌幅<10%不出现B
    
    type SignalRecord = { index: number; price: number; type: 'B' | 'S' };
    const signalRecords: SignalRecord[] = [];
    
    // 检查是否可以添加B信号
    const canAddBuySignal = (currentIdx: number, currentPrice: number): boolean => {
      for (const sig of signalRecords) {
        const daysDiff = currentIdx - sig.index;
        if (daysDiff <= 0) continue;
        
        if (sig.type === 'B') {
          // 规则1: B之后检查B
          if (daysDiff <= 5) {
            const dropPct = (sig.price - currentPrice) / sig.price * 100;
            if (dropPct < 5) return false;
          } else if (daysDiff <= 10) {
            const dropPct = (sig.price - currentPrice) / sig.price * 100;
            if (dropPct < 10) return false;
          }
        } else if (sig.type === 'S') {
          // 规则3: S之后检查B
          if (daysDiff <= 5) {
            const dropPct = (sig.price - currentPrice) / sig.price * 100;
            if (dropPct < 5) return false;
          } else if (daysDiff <= 10) {
            const dropPct = (sig.price - currentPrice) / sig.price * 100;
            if (dropPct < 10) return false;
          }
        }
      }
      return true;
    };
    
    // 检查是否可以添加S信号
    const canAddSellSignal = (currentIdx: number, currentPrice: number): boolean => {
      for (const sig of signalRecords) {
        const daysDiff = currentIdx - sig.index;
        if (daysDiff <= 0) continue;
        
        if (sig.type === 'S') {
          // 规则2: S之后检查S
          if (daysDiff <= 5) {
            const risePct = (currentPrice - sig.price) / sig.price * 100;
            if (risePct < 5) return false;
          } else if (daysDiff <= 10) {
            const risePct = (currentPrice - sig.price) / sig.price * 100;
            if (risePct < 10) return false;
          }
        }
        // S信号后不影响另一个S（已在上面处理）
      }
      return true;
    };
    
    // 添加信号到记录
    const addSignalRecord = (index: number, price: number, type: 'B' | 'S') => {
      signalRecords.push({ index, price, type });
      // 保持记录按时间排序
      signalRecords.sort((a, b) => a.index - b.index);
    };
    
    // 构建PVT背离标记点数据（平衡版阈值，收紧5pct）：
    // 顶背离(S)：连续2天及以上 + BIAS>50%（标注第一天，绿色S）
    // 底背离(B)：连续2天及以上 + 两天CRI>=60 + 两天成本偏离度分位数<15%（标注最后一天，红色B）
    // 极端恐惧买入(B)：costDev<15% | bias<15% | CRI>75，在连续段落中只标记DI拐点（紫色B）
    // 极端贪婪卖出(S)：greedy>90% | bias>90% | costDev>90%，在连续段落中只标记DI拐点（橙色S）
    // 成本低位B：costDev < 15%（蓝色B）
    // BIAS低位B：bias225 < 15%（青色B）
    const pvtDivergenceMarks: echarts.MarkPointComponentOption['data'] = [];
    
    // 先计算连续背离天数和连续段信息
    const consecutiveCount: number[] = new Array(pvtDivergenceData.length).fill(0);
    const consecutiveStart: number[] = new Array(pvtDivergenceData.length).fill(-1); // 记录每个连续段的起始位置
    let currentStreak = 0;
    let currentType: 'top' | 'bottom' | null = null;
    let currentStart = -1;
    
    for (let i = 0; i < pvtDivergenceData.length; i++) {
      const div = pvtDivergenceData[i];
      if (div === 'top' || div === 'bottom') {
        if (div === currentType) {
          currentStreak++;
        } else {
          currentStreak = 1;
          currentType = div;
          currentStart = i;
        }
        consecutiveCount[i] = currentStreak;
        consecutiveStart[i] = currentStart;
      } else {
        currentStreak = 0;
        currentType = null;
        currentStart = -1;
        consecutiveCount[i] = 0;
        consecutiveStart[i] = -1;
      }
    }
    
    // 反向遍历标记连续天数（确保每个连续段的所有点都知道自己是连续的）
    for (let i = pvtDivergenceData.length - 2; i >= 0; i--) {
      if (consecutiveCount[i] > 0 && consecutiveCount[i + 1] > 0) {
        consecutiveCount[i] = consecutiveCount[i + 1];
        consecutiveStart[i] = consecutiveStart[i + 1];
      }
    }
    
    // 帮助函数：检查底背离连续段中是否有任意两天CRI>=60（放宽版阈值）
    const hasHighCRIInStreak = (startIdx: number, count: number): boolean => {
      let highCount = 0;
      for (let i = startIdx; i < startIdx + count && i < criData.length; i++) {
        const cri = criData[i];
        if (cri !== null && cri >= 60) highCount++;
        if (highCount >= 2) return true;
      }
      return false;
    };
    
    // 帮助函数：检查底背离连续段中是否有任意两天成本偏离度历史分位数<15%（平衡版）
    const hasLowCostDevPercentileInStreak = (startIdx: number, count: number): boolean => {
      let lowCount = 0;
      for (let i = startIdx; i < startIdx + count && i < costDeviationPercentileData.length; i++) {
        const pct = costDeviationPercentileData[i];
        if (pct !== null && pct < 15) lowCount++; // 收紧到15%
        if (lowCount >= 2) return true;
      }
      return false;
    };
    
    // 顶背离：连续2天及以上+BIAS>50%（第一天）；底背离：连续3天及以上+两天CRI>=70+两天成本偏离度分位数<50%（最后一天）
    pvtDivergenceData.forEach((div, index) => {
      if (div === 'top') {
        // 顶背离：>=2天（第一天）+ BIAS>50%
        const count = consecutiveCount[index];
        const startIdx = consecutiveStart[index];
        const biasPct = bias225PercentileData[index];
        if (count >= 2 && index === startIdx && biasPct !== null && biasPct > 50) {
          const price = stockData[index]?.low;
          if (price !== undefined) {
            pvtDivergenceMarks.push({
              name: '顶背离',
              coord: [index, price],
              value: 'S',
              symbol: 'rect',
              symbolSize: [14, 14],
              itemStyle: { color: 'transparent' },
              label: {
                show: true,
                formatter: 'S',
                fontSize: 11,
                fontWeight: 'bold',
                color: '#03B172',
                backgroundColor: 'rgba(22,27,34,0.85)',
                padding: [1, 3],
                borderRadius: 2,
              },
            });
          }
        }
      } else if (div === 'bottom') {
        // 底背离：>=3天+两天CRI>=80+两天成本偏离度分位数<30%，只标注最后一天
        const count = consecutiveCount[index];
        const startIdx = consecutiveStart[index];
        const endIdx = startIdx + count - 1;
        if (count >= 2 && index === endIdx &&
            hasHighCRIInStreak(startIdx, count) && 
            hasLowCostDevPercentileInStreak(startIdx, count)) {
          const price = stockData[index]?.low;
          if (price !== undefined) {
            pvtDivergenceMarks.push({
              name: '底背离',
              coord: [index, price],
              value: 'B',
              symbol: 'rect',
              symbolSize: [14, 14],
              itemStyle: { color: 'transparent' },
              label: {
                show: true,
                formatter: 'B',
                fontSize: 11,
                fontWeight: 'bold',
                color: '#FF3435',
                backgroundColor: 'rgba(22,27,34,0.85)',
                padding: [1, 3],
                borderRadius: 2,
              },
            });
          }
        }
      }
    });
    
    // 构建极端恐惧买入标记
    // 条件1（紫色B-极端恐惧）：costDev < buyCostDev% & bias < buyBias% & CRI > buyCRI
    // 条件2（蓝色B-成本低位）：costDev < buyCostDev%
    // 条件3（青色B-BIAS低位）：bias225 < buyBias%
    
    // ========== 高频BS：分别计算低频和高频信号，确保低频信号不被合并 ==========
    
    // 第一步A：找出低频BS满足的日子
    const lowFreqDays: number[] = [];
    stockData.forEach((_, index) => {
      const costDevPct = costDeviationPercentileData[index];
      const bias225Pct = bias225PercentileData[index];
      const cri = criData[index];
      
      const isCostDevLowFreq = costDevPct !== null && costDevPct < LOW_FREQ_BUY.costDev; // <5%
      const isBiasLowFreq = bias225Pct !== null && bias225Pct < LOW_FREQ_BUY.bias; // <5%
      const isCRILowFreq = cri !== null && cri > LOW_FREQ_BUY.cri; // >90
      
      if (isCostDevLowFreq && isBiasLowFreq && isCRILowFreq) {
        lowFreqDays.push(index);
      }
    });
    
    // 第二步A：处理低频信号的连续段和拐点（高频模式下也要独立处理低频信号）
    type StreakType = { start: number; end: number; days: number[] };
    const processStreaks = (days: number[]): StreakType[] => {
      const streaks: StreakType[] = [];
      let currentStreak: number[] = [];
      
      for (let i = 0; i < days.length; i++) {
        const day = days[i];
        const prevDay = days[i - 1];
        
        if (i === 0 || day === prevDay + 1) {
          currentStreak.push(day);
        } else {
          if (currentStreak.length > 0) {
            streaks.push({
              start: currentStreak[0],
              end: currentStreak[currentStreak.length - 1],
              days: [...currentStreak]
            });
          }
          currentStreak = [day];
        }
      }
      if (currentStreak.length > 0) {
        streaks.push({
          start: currentStreak[0],
          end: currentStreak[currentStreak.length - 1],
          days: [...currentStreak]
        });
      }
      return streaks;
    };
    
    // 处理低频信号连续段
    const lowFreqStreaks = processStreaks(lowFreqDays);
    
    // 处理低频拐点
    const lowFreqPivots: number[] = [];
    lowFreqStreaks.forEach(streak => {
      let pivotIdx = -1;
      for (let i = streak.start + 1; i <= streak.end && i < stockData.length - 1; i++) {
        const prevMinusDI = indicators[i - 1].minusDI;
        const currMinusDI = indicators[i].minusDI;
        const nextMinusDI = indicators[i + 1]?.minusDI;
        if (prevMinusDI !== null && currMinusDI !== null && nextMinusDI !== null) {
          if (currMinusDI > prevMinusDI && currMinusDI > nextMinusDI) {
            pivotIdx = i;
            break;
          }
        }
      }
      if (pivotIdx === -1) {
        for (let i = streak.start + 1; i <= streak.end && i < stockData.length - 1; i++) {
          const prevPlusDI = indicators[i - 1].plusDI;
          const currPlusDI = indicators[i].plusDI;
          const nextPlusDI = indicators[i + 1]?.plusDI;
          if (prevPlusDI !== null && currPlusDI !== null && nextPlusDI !== null) {
            if (currPlusDI < prevPlusDI && currPlusDI < nextPlusDI) {
              pivotIdx = i;
              break;
            }
          }
        }
      }
      if (pivotIdx === -1) pivotIdx = streak.end;
      lowFreqPivots.push(pivotIdx);
    });
    
    // 如果是低频模式，直接用低频拐点；高频模式需要额外处理
    if (thresholds.useAndLogic) {
      // 低频模式：只显示低频信号
      lowFreqPivots.forEach(pivotIdx => {
        const hasBottomMark = pvtDivergenceMarks.some(mark => {
          const coord = mark.coord as [number, number];
          return coord[0] === pivotIdx;
        });
        if (!hasBottomMark) {
          const price = stockData[pivotIdx]?.low;
          if (price !== undefined) {
            // 检查信号间隔规则
            if (canAddBuySignal(pivotIdx, price)) {
              pvtDivergenceMarks.push({
                name: '极端恐惧买入',
                coord: [pivotIdx, price],
                value: 'B',
                symbol: 'rect',
                symbolSize: [14, 14],
                itemStyle: { color: 'transparent' },
                label: {
                  show: true,
                  formatter: 'B',
                  fontSize: 11,
                  fontWeight: 'bold',
                  color: '#D946EF',
                  backgroundColor: 'rgba(22,27,34,0.85)',
                  padding: [1, 3],
                  borderRadius: 2,
                },
              });
              // 记录信号用于后续过滤
              addSignalRecord(pivotIdx, price, 'B');
            }
          }
        }
      });
    } else {
      // 高频模式：低频信号 + 高频扩展信号
      // 第一步B：找出高频扩展满足的日子（不包括低频已满足的）
      const highFreqExtDays: number[] = [];
      stockData.forEach((_, index) => {
        // 跳过已经是低频信号的日子
        if (lowFreqDays.includes(index)) return;
        
        const costDevPct = costDeviationPercentileData[index];
        const bias225Pct = bias225PercentileData[index];
        const cri = criData[index];
        
        const isCostDevRelaxed = costDevPct !== null && costDevPct < HIGH_FREQ_BUY.costDev; // <10%
        const isBiasRelaxed = bias225Pct !== null && bias225Pct < HIGH_FREQ_BUY.bias; // <10%
        const isCostDevMedium = costDevPct !== null && costDevPct < 30;
        const isCRIHigh = cri !== null && cri > HIGH_FREQ_BUY.cri; // >83
        const criWithPrice = isCRIHigh && isCostDevMedium;
        
        if (isCostDevRelaxed || isBiasRelaxed || criWithPrice) {
          highFreqExtDays.push(index);
        }
      });
      
      // 第二步B：处理高频扩展信号的连续段
      const highFreqStreaks = processStreaks(highFreqExtDays);
      
      // 处理高频扩展拐点
      const highFreqPivots: number[] = [];
      highFreqStreaks.forEach(streak => {
        let pivotIdx = -1;
        for (let i = streak.start + 1; i <= streak.end && i < stockData.length - 1; i++) {
          const prevMinusDI = indicators[i - 1].minusDI;
          const currMinusDI = indicators[i].minusDI;
          const nextMinusDI = indicators[i + 1]?.minusDI;
          if (prevMinusDI !== null && currMinusDI !== null && nextMinusDI !== null) {
            if (currMinusDI > prevMinusDI && currMinusDI > nextMinusDI) {
              pivotIdx = i;
              break;
            }
          }
        }
        if (pivotIdx === -1) {
          for (let i = streak.start + 1; i <= streak.end && i < stockData.length - 1; i++) {
            const prevPlusDI = indicators[i - 1].plusDI;
            const currPlusDI = indicators[i].plusDI;
            const nextPlusDI = indicators[i + 1]?.plusDI;
            if (prevPlusDI !== null && currPlusDI !== null && nextPlusDI !== null) {
              if (currPlusDI < prevPlusDI && currPlusDI < nextPlusDI) {
                pivotIdx = i;
                break;
              }
            }
          }
        }
        if (pivotIdx === -1) pivotIdx = streak.end;
        highFreqPivots.push(pivotIdx);
      });
      
      // 合并低频和高频拐点（去重）
      const allPivots = [...new Set([...lowFreqPivots, ...highFreqPivots])].sort((a, b) => a - b);
      
      allPivots.forEach(pivotIdx => {
        const hasBottomMark = pvtDivergenceMarks.some(mark => {
          const coord = mark.coord as [number, number];
          return coord[0] === pivotIdx;
        });
        if (!hasBottomMark) {
          const price = stockData[pivotIdx]?.low;
          if (price !== undefined) {
            // 检查信号间隔规则
            if (canAddBuySignal(pivotIdx, price)) {
              pvtDivergenceMarks.push({
                name: '极端恐惧买入',
                coord: [pivotIdx, price],
                value: 'B',
                symbol: 'rect',
                symbolSize: [14, 14],
                itemStyle: { color: 'transparent' },
                label: {
                  show: true,
                  formatter: 'B',
                  fontSize: 11,
                  fontWeight: 'bold',
                  color: '#D946EF',
                  backgroundColor: 'rgba(22,27,34,0.85)',
                  padding: [1, 3],
                  borderRadius: 2,
                },
              });
              // 记录信号用于后续过滤
              addSignalRecord(pivotIdx, price, 'B');
            }
          }
        }
      });
    }
    
    // 构建极端贪婪卖出标记
    // ========== 分别计算低频和高频卖出信号 ==========
    
    // 第一步A：找出低频卖出满足的日子
    const lowFreqSellDays: number[] = [];
    stockData.forEach((_, index) => {
      const greedyPct = greedyPercentileData[index];
      const bias225Pct = bias225PercentileData[index];
      const isGreedyLowFreq = greedyPct !== null && greedyPct > LOW_FREQ_SELL.greedy; // >95%
      const isBiasLowFreq = bias225Pct !== null && bias225Pct > LOW_FREQ_SELL.bias; // >90%
      if (isGreedyLowFreq && isBiasLowFreq) {
        lowFreqSellDays.push(index);
      }
    });
    
    // 处理低频卖出连续段
    const lowFreqSellStreaks = processStreaks(lowFreqSellDays);
    const lowFreqSellPivots: number[] = [];
    lowFreqSellStreaks.forEach(streak => {
      let pivotIdx = -1;
      for (let i = streak.start + 1; i <= streak.end && i < stockData.length - 1; i++) {
        const prevPlusDI = indicators[i - 1].plusDI;
        const currPlusDI = indicators[i].plusDI;
        const nextPlusDI = indicators[i + 1]?.plusDI;
        if (prevPlusDI !== null && currPlusDI !== null && nextPlusDI !== null) {
          if (currPlusDI > prevPlusDI && currPlusDI > nextPlusDI) {
            pivotIdx = i;
            break;
          }
        }
      }
      if (pivotIdx === -1) pivotIdx = streak.end;
      lowFreqSellPivots.push(pivotIdx);
    });
    
    if (thresholds.useAndLogic) {
      // 低频模式：只显示低频卖出信号
      lowFreqSellPivots.forEach(pivotIdx => {
        const hasTopMark = pvtDivergenceMarks.some(mark => {
          const coord = mark.coord as [number, number];
          return coord[0] === pivotIdx;
        });
        if (!hasTopMark) {
          const price = stockData[pivotIdx]?.high;
          if (price !== undefined) {
            // 检查信号间隔规则
            if (canAddSellSignal(pivotIdx, price)) {
              pvtDivergenceMarks.push({
                name: '极端贪婪卖出',
                coord: [pivotIdx, price],
                value: 'S',
                symbol: 'rect',
                symbolSize: [14, 14],
                itemStyle: { color: 'transparent' },
                label: {
                  show: true,
                  formatter: 'S',
                  fontSize: 11,
                  fontWeight: 'bold',
                  color: '#F97316',
                  backgroundColor: 'rgba(22,27,34,0.85)',
                  padding: [1, 3],
                  borderRadius: 2,
                },
              });
              // 记录信号用于后续过滤
              addSignalRecord(pivotIdx, price, 'S');
            }
          }
        }
      });
    } else {
      // 高频模式：低频卖出 + 高频扩展卖出
      const highFreqSellExtDays: number[] = [];
      stockData.forEach((_, index) => {
        if (lowFreqSellDays.includes(index)) return;
        const greedyPct = greedyPercentileData[index];
        const bias225Pct = bias225PercentileData[index];
        const isGreedyHigh = greedyPct !== null && greedyPct > LOW_FREQ_SELL.greedy; // >95%
        const isBiasHigh = bias225Pct !== null && bias225Pct > LOW_FREQ_SELL.bias; // >90%
        if (isGreedyHigh || isBiasHigh) {
          highFreqSellExtDays.push(index);
        }
      });
      
      const highFreqSellStreaks = processStreaks(highFreqSellExtDays);
      const highFreqSellPivots: number[] = [];
      highFreqSellStreaks.forEach(streak => {
        let pivotIdx = -1;
        for (let i = streak.start + 1; i <= streak.end && i < stockData.length - 1; i++) {
          const prevPlusDI = indicators[i - 1].plusDI;
          const currPlusDI = indicators[i].plusDI;
          const nextPlusDI = indicators[i + 1]?.plusDI;
          if (prevPlusDI !== null && currPlusDI !== null && nextPlusDI !== null) {
            if (currPlusDI > prevPlusDI && currPlusDI > nextPlusDI) {
              pivotIdx = i;
              break;
            }
          }
        }
        if (pivotIdx === -1) pivotIdx = streak.end;
        highFreqSellPivots.push(pivotIdx);
      });
      
      // 合并低频和高频卖出拐点
      const allSellPivots = [...new Set([...lowFreqSellPivots, ...highFreqSellPivots])].sort((a, b) => a - b);
      
      allSellPivots.forEach(pivotIdx => {
        const hasTopMark = pvtDivergenceMarks.some(mark => {
          const coord = mark.coord as [number, number];
          return coord[0] === pivotIdx;
        });
        if (!hasTopMark) {
          const price = stockData[pivotIdx]?.high;
          if (price !== undefined) {
            // 检查信号间隔规则
            if (canAddSellSignal(pivotIdx, price)) {
              pvtDivergenceMarks.push({
                name: '极端贪婪卖出',
                coord: [pivotIdx, price],
                value: 'S',
                symbol: 'rect',
                symbolSize: [14, 14],
                itemStyle: { color: 'transparent' },
                label: {
                  show: true,
                  formatter: 'S',
                  fontSize: 11,
                  fontWeight: 'bold',
                  color: '#F97316',
                  backgroundColor: 'rgba(22,27,34,0.85)',
                  padding: [1, 3],
                  borderRadius: 2,
                },
              });
              // 记录信号用于后续过滤
              addSignalRecord(pivotIdx, price, 'S');
            }
          }
        }
      });
    }
    
    // 构建抵扣价markPoint数据
    const deductMarkPoints: echarts.MarkPointComponentOption['data'] = [];
    
    if (ma20DeductIndex >= 0) {
      const price = stockData[ma20DeductIndex]?.close;
      if (price !== undefined) {
        deductMarkPoints.push({
          name: `MA20\n${price.toFixed(1)}`,
          coord: [ma20DeductIndex, price],
          value: price,
          symbol: 'rect',
          symbolSize: [1, 4],
          itemStyle: { color: '#E3B341' },
          label: {
            show: true,
            position: 'top',
            distance: 3,
            fontSize: 7,
            color: '#E3B341',
            backgroundColor: 'rgba(13,17,23,0.85)',
            padding: [0, 2],
            borderRadius: 1,
            borderWidth: 0,
          },
        });
      }
    }
    
    if (ma60DeductIndex >= 0) {
      const price = stockData[ma60DeductIndex]?.close;
      if (price !== undefined) {
        deductMarkPoints.push({
          name: `MA60\n${price.toFixed(1)}`,
          coord: [ma60DeductIndex, price],
          value: price,
          symbol: 'rect',
          symbolSize: [1, 4],
          itemStyle: { color: '#D2A8FF' },
          label: {
            show: true,
            position: 'top',
            distance: 3,
            fontSize: 7,
            color: '#D2A8FF',
            backgroundColor: 'rgba(13,17,23,0.85)',
            padding: [0, 2],
            borderRadius: 1,
            borderWidth: 0,
          },
        });
      }
    }
    
    if (ma225DeductIndex >= 0) {
      const price = stockData[ma225DeductIndex]?.close;
      if (price !== undefined) {
        deductMarkPoints.push({
          name: `MA225\n${price.toFixed(1)}`,
          coord: [ma225DeductIndex, price],
          value: price,
          symbol: 'rect',
          symbolSize: [1, 4],
          itemStyle: { color: '#FF3435' },
          label: {
            show: true,
            position: 'top',
            distance: 3,
            fontSize: 7,
            color: '#FF3435',
            backgroundColor: 'rgba(13,17,23,0.85)',
            padding: [0, 2],
            borderRadius: 1,
            borderWidth: 0,
          },
        });
      }
    }

    const series: echarts.SeriesOption[] = [
      {
        name: 'K线',
        type: 'candlestick',
        data: klineData,
        itemStyle: {
          color: '#FF3435',
          color0: '#03B172',
          borderColor: '#FF3435',
          borderColor0: '#03B172',
        },
        markPoint: {
          symbol: 'rect',
          symbolSize: [1, 4],
          silent: true,
          data: [...deductMarkPoints, ...pvtDivergenceMarks],
        },
      },
    ];

    // 添加成交量到主图（用折线图简化显示，不干扰K线）
    if (timeframe === 'daily') {
      // 计算成交量的移动平均来平滑显示
      const volMA5 = volumes.map((_, i) => {
        if (i < 4) return null;
        let sum = 0;
        for (let j = i - 4; j <= i; j++) sum += volumes[j];
        return sum / 5;
      });
      
      series.push({
        name: '成交量趋势',
        type: 'line',
        data: volMA5,
        smooth: true,
        lineStyle: { width: 1, color: '#8B949E', opacity: 0.6 },
        symbol: 'none',
        yAxisIndex: 1,
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(139, 148, 158, 0.2)' },
              { offset: 1, color: 'rgba(139, 148, 158, 0.02)' }
            ]
          }
        }
      });
    }

    if (showMA) {
      series.push(
        { name: 'MA5', type: 'line', data: ma5Data, smooth: true, lineStyle: { width: 1, color: '#FFFFFF' }, symbol: 'none' },
        { name: 'MA20', type: 'line', data: ma20Data, smooth: true, lineStyle: { width: 1, color: '#E3B341' }, symbol: 'none' },
        { name: 'MA99', type: 'line', data: ma99Data, smooth: true, lineStyle: { width: 1, color: '#D2A8FF' }, symbol: 'none' },
        { name: 'MA128', type: 'line', data: ma128Data, smooth: true, lineStyle: { width: 1, color: '#03B172' }, symbol: 'none' },
        { name: 'MA225', type: 'line', data: ma225Data, smooth: true, lineStyle: { width: 1, color: '#FF3435' }, symbol: 'none' },
      );
    }

    if (showMAHS) {
      series.push({ name: 'MAHS', type: 'line', data: mahsData, smooth: true, lineStyle: { width: 2, color: '#FF3435', type: 'dashed' }, symbol: 'none' });
    }
    if (showEMAHS) {
      series.push({ name: 'EMAHS', type: 'line', data: emahsData, smooth: true, lineStyle: { width: 2, color: '#03B172', type: 'dashed' }, symbol: 'none' });
    }
    
    // 添加CRI（恐慌）、贪婪得分和综合情绪指数到副图 - 所有时间周期都显示
    // 恐慌指标（CRI）- 红色
    series.push({ 
      name: '恐慌指数', 
      type: 'line', 
      data: criData, 
      smooth: true, 
      lineStyle: { width: 2, color: '#FF6B6B', type: 'solid' }, 
      symbol: 'none',
      xAxisIndex: 1,
      yAxisIndex: 2,
    });
    
    // 贪婪指标 - 绿色 (与EMAHS同色)
    series.push({ 
      name: '贪婪指数', 
      type: 'line', 
      data: greedyData, 
      smooth: true, 
      lineStyle: { width: 2, color: '#03B172', type: 'solid' }, 
      symbol: 'none',
      xAxisIndex: 1,
      yAxisIndex: 2,
    });
    
    // 情绪指数 - 暂时隐藏，避免副图线条过多
    // series.push({ 
    //   name: '情绪指数', 
    //   type: 'line', 
    //   data: sentimentData, 
    //   smooth: true, 
    //   lineStyle: { width: 1.5, color: '#D2A8FF', type: 'dashed' }, 
    //   symbol: 'none',
    //   xAxisIndex: 1,
    //   yAxisIndex: 3,
    // });
    
    // 成本偏离度 - 黄色 (与MA20同色)
    series.push({ 
      name: '成本偏离度', 
      type: 'line', 
      data: costDeviationData, 
      smooth: true, 
      lineStyle: { width: 1.5, color: '#E3B341', type: 'solid' }, 
      symbol: 'none',
      xAxisIndex: 1,
      yAxisIndex: 4,
    });

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      animation: true,
      title: title ? {
        text: title,
        left: 'center',
        top: 5,
        textStyle: {
          color: '#8B949E',
          fontSize: compact ? 12 : 14,
          fontFamily: 'JetBrains Mono',
        },
      } : undefined,
      legend: {
        data: timeframe === 'daily' 
          ? [
              { name: 'MA5', icon: 'rect', itemStyle: { color: '#FFFFFF' } },
              { name: 'MA20', icon: 'rect', itemStyle: { color: '#E3B341' } },
              { name: 'MA99', icon: 'rect', itemStyle: { color: '#D2A8FF' } },
              { name: 'MA128', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: 'MA225', icon: 'rect', itemStyle: { color: '#FF3435' } },
              { name: 'MAHS', icon: 'rect', itemStyle: { color: '#FF3435' } },
              { name: 'EMAHS', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: '成交量趋势', icon: 'rect', itemStyle: { color: '#8B949E' } },
              { name: '恐慌指数', icon: 'rect', itemStyle: { color: '#FF6B6B' } },
              { name: '贪婪指数', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: '成本偏离度', icon: 'rect', itemStyle: { color: '#E3B341' } },
              { name: 'S顶背离:≥2天+BIAS>50%', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: thresholds.labelS, icon: 'rect', itemStyle: { color: '#F97316' } },
              { name: 'B底背离:≥2天+CRI≥60+成本<15%', icon: 'rect', itemStyle: { color: '#FF3435' } },
              { name: thresholds.labelB, icon: 'rect', itemStyle: { color: '#D946EF' } },
            ]
          : [
              { name: 'MA5', icon: 'rect', itemStyle: { color: '#FFFFFF' } },
              { name: 'MA20', icon: 'rect', itemStyle: { color: '#E3B341' } },
              { name: 'MA99', icon: 'rect', itemStyle: { color: '#D2A8FF' } },
              { name: 'MA128', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: 'MA225', icon: 'rect', itemStyle: { color: '#FF3435' } },
              { name: 'MAHS', icon: 'rect', itemStyle: { color: '#FF3435' } },
              { name: 'EMAHS', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: '恐慌指数', icon: 'rect', itemStyle: { color: '#FF6B6B' } },
              { name: '贪婪指数', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: '成本偏离度', icon: 'rect', itemStyle: { color: '#E3B341' } },
              { name: 'S(顶背离)', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: version === 'strict' ? 'S(严格)' : 'S(宽松)', icon: 'rect', itemStyle: { color: '#F97316' } },
              { name: 'B(底背离)', icon: 'rect', itemStyle: { color: '#FF3435' } },
              { name: version === 'strict' ? 'B(严格)' : 'B(宽松)', icon: 'rect', itemStyle: { color: '#D946EF' } },
            ],
        textStyle: { color: '#8B949E', fontSize: compact ? 7 : 8 },
        top: 32,
        itemWidth: 10,
        itemHeight: 2,
        itemGap: 4,
        width: '96%',
        left: 'center',
        type: 'scroll',
        pageIconSize: 10,
        pageTextStyle: { fontSize: 8 }
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: 'rgba(22, 27, 34, 0.95)',
        borderColor: '#30363D',
        textStyle: { color: '#C9D1D9' },
        formatter: (params: any) => {
          if (!params || params.length === 0) return '';
          const dataIndex = params[0].dataIndex;
          const stock = stockData[dataIndex];
          const ind = indicators[dataIndex];
          
          let html = `<div style="font-family: JetBrains Mono; font-size: 12px;">`;
          html += `<div style="color: #8B949E; margin-bottom: 4px;">${stock.date}</div>`;
          html += `<div style="display: grid; grid-template-columns: auto auto; gap: 8px 16px;">`;
          html += `<span>开盘:</span><span style="color: ${stock.open > stock.close ? '#03B172' : '#FF3435'}">${stock.open.toFixed(2)}</span>`;
          html += `<span>最高:</span><span style="color: #FF3435">${stock.high.toFixed(2)}</span>`;
          html += `<span>最低:</span><span style="color: #03B172">${stock.low.toFixed(2)}</span>`;
          html += `<span>收盘:</span><span style="color: ${stock.close >= stock.open ? '#FF3435' : '#03B172'}">${stock.close.toFixed(2)}</span>`;
          html += `<span>成交量:</span><span>${(stock.volume / 10000).toFixed(2)}万</span>`;
          if (ind.mahs !== null && ind.mahs !== undefined) html += `<span>MAHS:</span><span style="color: #FF3435">${ind.mahs.toFixed(2)}</span>`;
          if (ind.emahs !== null && ind.emahs !== undefined) html += `<span>EMAHS:</span><span style="color: #03B172">${ind.emahs.toFixed(2)}</span>`;
          if (ind.costDiff !== null && ind.costDiff !== undefined) html += `<span>成本差:</span><span style="color: ${ind.costDiff >= 0 ? '#FF3435' : '#03B172'}">${ind.costDiff.toFixed(2)}</span>`;
          if (ind.cri !== null && ind.cri !== undefined) html += `<span>恐慌指数:</span><span style="color: #FF6B6B">${ind.cri.toFixed(1)}</span>`;
          if (ind.greedy !== null && ind.greedy !== undefined) html += `<span>贪婪指数:</span><span style="color: #03B172">${ind.greedy.toFixed(1)}</span>`;
          // 情绪指数暂时隐藏
          // if (ind.sentiment !== null && ind.sentiment !== undefined) {
          //   const sentimentColor = ind.sentiment > 0 ? '#03B172' : (ind.sentiment < 0 ? '#FF6B6B' : '#8B949E');
          //   html += `<span>情绪指数:</span><span style="color: ${sentimentColor}">${ind.sentiment > 0 ? '+' : ''}${ind.sentiment.toFixed(1)}</span>`;
          // }
          if (ind.costDeviation !== null && ind.costDeviation !== undefined) html += `<span>成本偏离度:</span><span style="color: #E3B341">${ind.costDeviation.toFixed(2)}</span>`;
          if (ind.pvtDivergence && ind.pvtDivergence !== 'none') {
            const divColor = ind.pvtDivergence === 'top' ? '#03B172' : '#FF3435';
            const divText = ind.pvtDivergence === 'top' ? '顶背离' : '底背离';
            html += `<span>PVT背离:</span><span style="color: ${divColor}">${divText}</span>`;
          }
          html += `</div></div>`;
          return html;
        },
      },
      grid: [
        { left: '50', right: '50', top: '55', bottom: '110', height: '58%' },  // 主图
        { left: '50', right: '50', top: '76%', bottom: '40', height: '16%' },  // 副图下移，避免与主图重叠
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#30363D' } },
          axisLabel: { color: '#8B949E' },
          splitLine: { show: false },
          min: 'dataMin',
          max: 'dataMax',
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#30363D' } },
          axisLabel: { show: false },
          splitLine: { show: false },
          min: 'dataMin',
          max: 'dataMax',
        },
      ],
      yAxis: [
        {
          scale: true,
          splitArea: { show: false },
          axisLine: { lineStyle: { color: '#30363D' } },
          axisLabel: { color: '#8B949E' },
          splitLine: { lineStyle: { color: '#21262D' } },
        },
        {
          type: 'value',
          position: 'right',
          min: 0,
          axisLabel: { show: false },
          axisLine: { show: false },
          splitLine: { show: false },
        },
        {
          type: 'value',
          gridIndex: 1,
          position: 'left',
          min: 0,
          max: 100,
          splitNumber: 2,
          axisLabel: { 
            show: false,  // 隐藏坐标轴数值
            color: '#FF6B6B', 
            fontSize: 10,
            formatter: '{value}',
          },
          axisLine: { lineStyle: { color: '#FF6B6B' } },
          splitLine: { show: false },
        },
        {
          type: 'value',
          gridIndex: 1,
          position: 'right',
          min: -100,
          max: 100,
          splitNumber: 2,
          axisLabel: { 
            show: false,  // 隐藏坐标轴数值
            color: '#D2A8FF', 
            fontSize: 10,
            formatter: function(value: number): string {
              return value > 0 ? '+' + value : String(value);
            }
          },
          axisLine: { lineStyle: { color: '#D2A8FF' } },
          splitLine: { 
            show: timeframe === 'min15',
            lineStyle: { color: '#30363D', type: 'dashed' }
          },
        },
        {
          type: 'value',
          gridIndex: 1,
          position: 'right',
          offset: 50,
          axisLabel: { 
            show: false,  // 隐藏坐标轴数值
            color: '#E3B341', 
            fontSize: 10,
          },
          axisLine: { lineStyle: { color: '#E3B341' } },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: 70, end: 100 },
        { 
          type: 'slider', 
          xAxisIndex: [0, 1], 
          start: 70, 
          end: 100, 
          bottom: 10, 
          height: 20,
          borderColor: '#30363D',
          fillerColor: 'rgba(255, 52, 53, 0.2)',
          handleStyle: {
            color: '#FF3435',
            borderColor: '#FF3435'
          },
          textStyle: {
            color: '#8B949E'
          },
          showDetail: true,
          showDataShadow: true
        },
      ],
      series,
    };

    chartInstance.current.setOption(option, true);
    setLoading(false);

    const handleResize = () => {
      chartInstance.current?.resize();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [stockData, indicators, showMAHS, showEMAHS, showMA, title, compact, timeframe, version]);

  return (
    <div className={`relative w-full bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden ${compact ? 'h-full' : 'h-[600px]'}`}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#161B22]">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-[#30363D] border-t-[#FF3435] rounded-full animate-spin" />
            <span className="text-[#8B949E]">加载图表...</span>
          </div>
        </div>
      )}
      <div ref={chartRef} className="w-full h-full" />
    </div>
  );
};

export default StockChart;
