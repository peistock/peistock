// test_adx_falling_buy.ts
// 测试 ADX 衰竭方案在大秦铁路下跌区间的 B 信号表现

import { calculateAllIndicators } from './src/utils/indicators';
import type { StockData, IndicatorData } from './src/types';

// 模拟大秦铁路的下跌区间数据（2024-2025年）
// 这里用简化数据模拟实际走势
const mockData: StockData[] = [
  // 下跌前的高点区域
  { date: '2024-01-15', open: 7.80, high: 7.85, low: 7.75, close: 7.82, volume: 250000000 },
  { date: '2024-01-16', open: 7.82, high: 7.83, low: 7.70, close: 7.72, volume: 280000000 },
  { date: '2024-01-17', open: 7.72, high: 7.75, low: 7.60, close: 7.62, volume: 320000000 },
  { date: '2024-01-18', open: 7.62, high: 7.65, low: 7.55, close: 7.58, volume: 350000000 },
  { date: '2024-01-19', open: 7.58, high: 7.62, low: 7.48, close: 7.52, volume: 380000000 },
  // 主跌浪开始（ADX rising）
  { date: '2024-01-22', open: 7.52, high: 7.55, low: 7.40, close: 7.42, volume: 420000000 },
  { date: '2024-01-23', open: 7.42, high: 7.45, low: 7.35, close: 7.38, volume: 450000000 },
  { date: '2024-01-24', open: 7.38, high: 7.40, low: 7.28, close: 7.30, volume: 480000000 },
  { date: '2024-01-25', open: 7.30, high: 7.35, low: 7.22, close: 7.28, volume: 460000000 },
  { date: '2024-01-26', open: 7.28, high: 7.32, low: 7.18, close: 7.20, volume: 500000000 },
  // 继续下跌（ADX 高位）
  { date: '2024-01-29', open: 7.20, high: 7.25, low: 7.10, close: 7.12, volume: 520000000 },
  { date: '2024-01-30', open: 7.12, high: 7.18, low: 7.05, close: 7.08, volume: 510000000 },
  { date: '2024-01-31', open: 7.08, high: 7.12, low: 6.98, close: 7.02, volume: 530000000 },
  { date: '2024-02-01', open: 7.02, high: 7.05, low: 6.92, close: 6.95, volume: 550000000 },
  { date: '2024-02-02', open: 6.95, high: 6.98, low: 6.85, close: 6.88, volume: 580000000 },
  // 下跌中段（ADX 开始回落 - 这是关键！）
  { date: '2024-02-05', open: 6.88, high: 6.90, low: 6.78, close: 6.82, volume: 600000000 },
  { date: '2024-02-06', open: 6.82, high: 6.85, low: 6.72, close: 6.78, volume: 620000000 },
  { date: '2024-02-07', open: 6.78, high: 6.80, low: 6.68, close: 6.72, volume: 590000000 },
  { date: '2024-02-08', open: 6.72, high: 6.75, low: 6.65, close: 6.70, volume: 570000000 },
  { date: '2024-02-19', open: 6.70, high: 6.72, low: 6.60, close: 6.62, volume: 610000000 },
  // 加速下跌末端（ADX 再次上升，然后回落）
  { date: '2024-02-20', open: 6.62, high: 6.65, low: 6.52, close: 6.55, volume: 650000000 },
  { date: '2024-02-21', open: 6.55, high: 6.58, low: 6.45, close: 6.48, volume: 680000000 },
  { date: '2024-02-22', open: 6.48, high: 6.50, low: 6.38, close: 6.42, volume: 700000000 },
  { date: '2024-02-23', open: 6.42, high: 6.45, low: 6.32, close: 6.38, volume: 720000000 },
  { date: '2024-02-26', open: 6.38, high: 6.40, low: 6.28, close: 6.30, volume: 750000000 },
  // 止跌区域（ADX falling from high）
  { date: '2024-02-27', open: 6.30, high: 6.32, low: 6.20, close: 6.25, volume: 700000000 },
  { date: '2024-02-28', open: 6.25, high: 6.28, low: 6.18, close: 6.22, volume: 680000000 },
  { date: '2024-02-29', open: 6.22, high: 6.25, low: 6.15, close: 6.20, volume: 650000000 },
  { date: '2024-03-01', open: 6.20, high: 6.22, low: 6.12, close: 6.18, volume: 620000000 },
  { date: '2024-03-04', open: 6.18, high: 6.20, low: 6.10, close: 6.15, volume: 600000000 },
  // 最低点
  { date: '2024-03-05', open: 6.15, high: 6.16, low: 6.08, close: 6.10, volume: 580000000 },
  // 反弹开始
  { date: '2024-03-06', open: 6.10, high: 6.18, low: 6.08, close: 6.15, volume: 620000000 },
  { date: '2024-03-07', open: 6.15, high: 6.22, low: 6.12, close: 6.20, volume: 650000000 },
  { date: '2024-03-08', open: 6.20, high: 6.28, low: 6.18, close: 6.25, volume: 680000000 },
];

// 大秦铁路流通股本（约 148 亿股 = 14800000000 股）
const CAPITAL = 14800000000;

// 计算指标
const indicators = calculateAllIndicators(mockData, CAPITAL, 'shares');

// 原逻辑：高频 B 信号条件
const originalBuyCondition = (i: number): boolean => {
  const ind = indicators[i];
  const costDev = ind.costDeviationPercentile;
  const bias = ind.bias225Percentile;
  const cri = ind.cri;
  
  // 高频条件：costDev < 10% OR bias < 10% OR (cri > 83 && costDev < 30%)
  const isCostDevLow = costDev !== null && costDev < 10;
  const isBiasLow = bias !== null && bias < 10;
  const isCRIWithPrice = cri !== null && cri > 83 && costDev !== null && costDev < 30;
  
  return isCostDevLow || isBiasLow || isCRIWithPrice;
};

// 新逻辑：ADX 衰竭 + 原条件
const adxFallingBuyCondition = (i: number): boolean => {
  const ind = indicators[i];
  
  // 原条件
  const costDev = ind.costDeviationPercentile;
  const bias = ind.bias225Percentile;
  const cri = ind.cri;
  
  const isCostDevLow = costDev !== null && costDev < 10;
  const isBiasLow = bias !== null && bias < 10;
  const isCRIWithPrice = cri !== null && cri > 83 && costDev !== null && costDev < 30;
  
  const originalCondition = isCostDevLow || isBiasLow || isCRIWithPrice;
  
  if (!originalCondition) return false;
  
  // ADX 衰竭条件：ADX 从高位回落
  // 需要往前看几天判断 ADX 趋势
  const adx = ind.adx;
  const adxState = ind.adxState;
  
  // ADX 衰竭：当前 ADX > 30 且状态为 falling（从高位回落）
  // 或者 ADX < 20（震荡市，不做限制）
  const adxFallingFromHigh = adx !== null && adx > 30 && adxState === 'falling';
  const adxLow = adx !== null && adx < 20;
  
  // 只在 ADX 衰竭或低位时允许买入
  // 如果 ADX > 30 且 rising，说明趋势正在加强，禁止买入
  const adxRisingHigh = adx !== null && adx > 30 && adxState === 'rising';
  
  return (adxFallingFromHigh || adxLow) && !adxRisingHigh;
};

// 打印对比结果
console.log('=== 大秦铁路下跌区间 B 信号对比 ===\n');
console.log('日期\t\t\t收盘价\tADX\tADX状态\t原逻辑B信号\tADX衰竭B信号\t备注');
console.log('='.repeat(120));

let originalSignals = 0;
let adxSignals = 0;

for (let i = 20; i < mockData.length; i++) {  // 从20开始确保有足够数据计算ADX
  const date = mockData[i].date;
  const close = mockData[i].close.toFixed(2);
  const adx = indicators[i].adx?.toFixed(1) ?? '-';
  const adxState = indicators[i].adxState ?? '-';
  
  const origSignal = originalBuyCondition(i) ? '🟢 B' : '-';
  const adxSignal = adxFallingBuyCondition(i) ? '🟣 B' : '-';
  
  if (originalBuyCondition(i)) originalSignals++;
  if (adxFallingBuyCondition(i)) adxSignals++;
  
  // 标记关键区域
  let remark = '';
  if (i >= 5 && i <= 15) remark = '【主跌浪】';
  if (i >= 20 && i <= 25) remark = '【下跌中段】';
  if (i >= 26 && i <= 30) remark = '【止跌区域】';
  if (i === 31) remark = '【最低点】';
  if (i >= 32) remark = '【反弹】';
  
  console.log(`${date}\t${close}\t${adx}\t${adxState.padEnd(8)}${origSignal.padEnd(12)}${adxSignal.padEnd(12)}${remark}`);
}

console.log('\n' + '='.repeat(120));
console.log(`\n统计结果：`);
console.log(`- 原逻辑触发 B 信号次数: ${originalSignals}`);
console.log(`- ADX 衰竭逻辑触发 B 信号次数: ${adxSignals}`);
console.log(`- 过滤掉的假信号: ${originalSignals - adxSignals}`);

if (adxSignals > 0) {
  console.log(`\n✅ ADX 衰竭方案保留了 ${adxSignals} 个信号，这些信号更可能出现在止跌/反弹阶段。`);
} else {
  console.log(`\n⚠️ 在这个模拟数据中，ADX 衰竭方案没有触发信号，可能需要调整阈值。`);
}

// 详细分析每个被过滤的信号
console.log('\n=== 被过滤的信号分析 ===');
for (let i = 20; i < mockData.length; i++) {
  if (originalBuyCondition(i) && !adxFallingBuyCondition(i)) {
    const ind = indicators[i];
    console.log(`\n📍 ${mockData[i].date} (收盘价 ${mockData[i].close})`);
    console.log(`   原条件满足: costDev=${ind.costDeviationPercentile?.toFixed(1)}%, bias=${ind.bias225Percentile?.toFixed(1)}%, cri=${ind.cri?.toFixed(1)}`);
    console.log(`   ADX 状态: ${ind.adx?.toFixed(1)} (${ind.adxState})`);
    console.log(`   → 被过滤原因: ADX 在高位上升，趋势动能加强，不是买入时机`);
  }
}

console.log('\n=== 保留的信号分析 ===');
for (let i = 20; i < mockData.length; i++) {
  if (adxFallingBuyCondition(i)) {
    const ind = indicators[i];
    console.log(`\n✅ ${mockData[i].date} (收盘价 ${mockData[i].close})`);
    console.log(`   条件满足: costDev=${ind.costDeviationPercentile?.toFixed(1)}%, bias=${ind.bias225Percentile?.toFixed(1)}%, cri=${ind.cri?.toFixed(1)}`);
    console.log(`   ADX 状态: ${ind.adx?.toFixed(1)} (${ind.adxState})`);
    if (ind.adxState === 'falling' && ind.adx! > 30) {
      console.log(`   → 触发原因: ADX 从高位回落，空头动能衰竭`);
    } else if (ind.adx! < 20) {
      console.log(`   → 触发原因: ADX 低位，震荡市，正常买入`);
    }
  }
}
