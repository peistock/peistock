/**
 * 股票信号扫描工具
 * 读取Excel中的股票代码，批量计算S/B信号，输出结果
 * 
 * 使用方法:
 * npx tsx scripts/scan-signals.ts <输入Excel路径> [输出Excel路径]
 * 
 * Excel格式要求:
 * - 第一列: 股票代码 (如: 600519, 000001, 00700)
 * - 可选第二列: 股票名称
 */

import * as fs from 'fs';
import * as path from 'path';
import XLSX from 'xlsx';

// 股票数据类型
interface StockData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}

interface IndicatorData {
  date: string;
  close: number;
  bias225Percentile: number | null;
  cri: number | null;
  costDeviation: number | null;
  costDeviationPercentile: number | null;
  greedy: number | null;
  pvtDivergence: 'none' | 'top' | 'bottom' | null;
  plusDI: number | null;
  minusDI: number | null;
  adx: number | null;
}

interface ScanResult {
  code: string;
  name: string;
  date: string;
  close: number;
  signals: string[];
  signalDetails: string;
  bias225Pct: number | null;
  cri: number | null;
  greedy: number | null;
  error?: string;
}

// ============ 工具函数 ============

function formatSymbol(symbol: string): string {
  const clean = symbol.replace(/[^0-9a-zA-Z]/g, '');
  
  if (clean.length === 5) {
    return `hk${clean}`;
  }
  
  if (clean.startsWith('6') || clean.startsWith('5')) {
    return `sh${clean}`;
  }
  return `sz${clean}`;
}

function cleanSymbol(symbol: string): string {
  return symbol.replace(/[^0-9]/g, '');
}

// ============ API 函数 ============

async function getKlines(symbol: string, count: number = 300): Promise<StockData[]> {
  const tencentSymbol = formatSymbol(symbol);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentSymbol},day,,,${count},qfq`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Referer': 'https://stock.qq.com',
    },
  });
  
  if (!response.ok) {
    throw new Error(`API请求失败: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (result.code !== 0 || !result.data || !result.data[tencentSymbol]) {
    throw new Error('无数据返回');
  }
  
  const stockData = result.data[tencentSymbol];
  const klines = stockData.qfqday || stockData.day || [];
  
  if (!klines || klines.length === 0) {
    throw new Error('该股票暂无K线数据');
  }
  
  return klines.map((item: any) => ({
    date: item[0],
    open: parseFloat(item[1]) || 0,
    close: parseFloat(item[2]) || 0,
    low: parseFloat(item[3]) || 0,
    high: parseFloat(item[4]) || 0,
    volume: parseInt(item[5]) || 0,
    amount: 0,
  }));
}

async function getQuote(symbol: string): Promise<{ name: string; capital: number }> {
  const tencentSymbol = formatSymbol(symbol);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentSymbol},day,,,1,qfq`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Referer': 'https://stock.qq.com',
    },
  });
  
  if (!response.ok) {
    throw new Error(`API请求失败: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (result.code !== 0 || !result.data || !result.data[tencentSymbol]) {
    throw new Error('无数据返回');
  }
  
  const qt = result.data[tencentSymbol].qt;
  const stockQt = qt?.[tencentSymbol];
  
  if (!stockQt || !Array.isArray(stockQt)) {
    throw new Error('解析行情数据失败');
  }
  
  const market = stockQt[0];
  const name = stockQt[1] || symbol;
  
  let capital = 0;
  if (market === '100') {
    capital = parseInt(stockQt[69]) || 0;
  } else {
    capital = parseInt(stockQt[72]) || 0;
  }
  
  return { name, capital };
}

// ============ 指标计算函数 ============

function calculateMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += data[j];
      }
      result.push(sum / period);
    }
  }
  return result;
}

function calculateBias(close: number[], ma: (number | null)[]): (number | null)[] {
  return close.map((c, i) => {
    const m = ma[i];
    if (m === null || m === 0) return null;
    return ((c - m) / m) * 100;
  });
}

function calculatePercentile(values: (number | null)[], currentIndex: number): number | null {
  const current = values[currentIndex];
  if (current === null) return null;
  
  const history = values.slice(0, currentIndex).filter((v): v is number => v !== null);
  if (history.length < 30) return 50;
  
  const sorted = [...history].sort((a, b) => a - b);
  const lessThan = sorted.filter(v => v < current).length;
  const equalTo = sorted.filter(v => v === current).length;
  const rank = lessThan + equalTo / 2;
  
  return (rank / history.length) * 100;
}

// 计算EMA
function calculateEMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const multiplier = 2 / (period + 1);
  
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(data[i]);
    } else {
      const prev = result[i - 1];
      if (prev === null) {
        result.push(null);
      } else {
        result.push(data[i] * multiplier + prev * (1 - multiplier));
      }
    }
  }
  return result;
}

// 计算DD (换手天数)
function calculateDD(volumes: number[], capital: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < volumes.length; i++) {
    let cumVol = 0;
    let count = 0;
    for (let j = i; j >= 0; j--) {
      cumVol += volumes[j];
      count++;
      if (cumVol >= capital) break;
    }
    result.push(count);
  }
  return result;
}

// 计算EMAHS (指数换手成本)
function calculateEMAHS(closes: number[], dd: number[]): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    const period = Math.min(dd[i], i + 1);
    if (period <= 0) {
      result.push(null);
      continue;
    }
    
    const multiplier = 2 / (period + 1);
    let ema = closes[i];
    for (let j = i - 1; j >= Math.max(0, i - period + 1); j--) {
      ema = closes[j] * multiplier + ema * (1 - multiplier);
    }
    result.push(ema);
  }
  return result;
}

// 计算CRI
function calculateCRI(
  close: number[],
  high: number[],
  low: number[],
  emahs: (number | null)[],
  ma20: (number | null)[]
): number[] {
  const result: number[] = [];
  
  for (let i = 0; i < close.length; i++) {
    if (i < 20) {
      result.push(0);
      continue;
    }
    
    const price = close[i];
    const ema = emahs[i];
    const ma = ma20[i];
    
    if (ema === null || ma === null) {
      result.push(0);
      continue;
    }
    
    // 成本偏离得分
    const deviation = ((price - ema) / ema) * 100;
    const basisScore = Math.max(0, -deviation);
    
    // 跳空得分
    const prevClose = close[i - 1];
    const gapDown = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    const jumpScore = gapDown < 0 ? Math.min(100, Math.abs(gapDown) * 5) : 0;
    
    // 波动率曲线得分
    let trSum = 0;
    for (let j = i - 19; j <= i; j++) {
      trSum += high[j] - low[j];
    }
    const avgTR = trSum / 20;
    const avgPrice = close.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20;
    const curveScore = avgPrice > 0 ? Math.min(100, (avgTR / avgPrice) * 100 * 10) : 0;
    
    // 是否在MA20下方
    const isBelowMA20 = price < ma;
    
    // 综合得分
    const rawScore = Math.max(
      basisScore * 0.95,
      jumpScore * 0.9,
      isBelowMA20 ? curveScore * 0.85 : curveScore * 0.4
    );
    
    result.push(Math.min(100, rawScore));
  }
  
  return result;
}

// 计算贪婪指数
function calculateGreedy(
  close: number[],
  high: number[],
  low: number[],
  volume: number[],
  emahs: (number | null)[],
  bias225: (number | null)[]
): number[] {
  const result: number[] = [];
  
  for (let i = 0; i < close.length; i++) {
    if (i < 225) {
      result.push(0);
      continue;
    }
    
    const price = close[i];
    const ema = emahs[i];
    const bias = bias225[i];
    
    if (ema === null || bias === null) {
      result.push(0);
      continue;
    }
    
    // 正向成本偏离
    const deviation = ((price - ema) / ema) * 100;
    const posBasis = Math.max(0, deviation);
    
    // 向上跳空
    const prevClose = close[i - 1];
    const gapUp = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    const upGapScore = gapUp > 0 ? Math.min(100, gapUp * 5) : 0;
    
    // 波动率
    let trSum = 0;
    for (let j = i - 4; j <= i; j++) {
      trSum += high[j] - low[j];
    }
    const avgTR = trSum / 5;
    const greedVol = Math.min(100, (avgTR / price) * 100 * 20);
    
    // BIAS极端
    const biasExtreme = Math.max(0, bias);
    
    // 成交量放大
    const avgVol = volume.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20;
    const volumeSurge = avgVol > 0 ? Math.min(100, (volume[i] / avgVol) * 30) : 0;
    
    const rawScore = posBasis * 3 + upGapScore * 0.8 + greedVol * 0.6 + biasExtreme * 0.8 + volumeSurge * 0.3;
    result.push(Math.min(100, rawScore));
  }
  
  return result;
}

// 计算ADX和DI
function calculateADX(high: number[], low: number[], close: number[]): {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
} {
  const n = high.length;
  const adx: (number | null)[] = new Array(n).fill(null);
  const plusDI: (number | null)[] = new Array(n).fill(null);
  const minusDI: (number | null)[] = new Array(n).fill(null);
  
  const trArr: number[] = [];
  const plusDMArr: number[] = [];
  const minusDMArr: number[] = [];
  
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      trArr.push(high[i] - low[i]);
      plusDMArr.push(0);
      minusDMArr.push(0);
    } else {
      const tr = Math.max(
        high[i] - low[i],
        Math.abs(high[i] - close[i - 1]),
        Math.abs(low[i] - close[i - 1])
      );
      trArr.push(tr);
      
      const upMove = high[i] - high[i - 1];
      const downMove = low[i - 1] - low[i];
      plusDMArr.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMArr.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
  }
  
  // Wilder smoothing
  const period = 14;
  let trSum = 0, plusDMSum = 0, minusDMSum = 0;
  
  for (let i = 0; i < n; i++) {
    if (i < period) {
      trSum += trArr[i];
      plusDMSum += plusDMArr[i];
      minusDMSum += minusDMArr[i];
    } else {
      if (i === period) {
        // First smoothed values
      }
      trSum = trSum - trSum / period + trArr[i];
      plusDMSum = plusDMSum - plusDMSum / period + plusDMArr[i];
      minusDMSum = minusDMSum - minusDMSum / period + minusDMArr[i];
      
      const pDI = trSum > 0 ? (plusDMSum / trSum) * 100 : 0;
      const mDI = trSum > 0 ? (minusDMSum / trSum) * 100 : 0;
      
      plusDI[i] = pDI;
      minusDI[i] = mDI;
      
      const dx = pDI + mDI > 0 ? (Math.abs(pDI - mDI) / (pDI + mDI)) * 100 : 0;
      
      if (i === period) {
        adx[i] = dx;
      } else if (i > period && adx[i - 1] !== null) {
        adx[i] = (adx[i - 1]! * (period - 1) + dx) / period;
      }
    }
  }
  
  return { adx, plusDI, minusDI };
}

// 计算PVT和背离
function calculatePVT(close: number[], volume: number[]): {
  pvt: number[];
  divergence: ('none' | 'top' | 'bottom')[];
} {
  const n = close.length;
  const pvt: number[] = [];
  const divergence: ('none' | 'top' | 'bottom')[] = [];
  
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      pvt.push(volume[i]);
    } else {
      const change = close[i - 1] !== 0 ? (close[i] - close[i - 1]) / close[i - 1] : 0;
      pvt.push(pvt[i - 1] + volume[i] * change);
    }
    divergence.push('none');
  }
  
  // 检测背离 (简化版：用5日窗口)
  for (let i = 10; i < n; i++) {
    const priceWindow = close.slice(i - 4, i + 1);
    const pvtWindow = pvt.slice(i - 4, i + 1);
    
    const priceMax = Math.max(...priceWindow);
    const priceMin = Math.min(...priceWindow);
    const pvtMax = Math.max(...pvtWindow);
    const pvtMin = Math.min(...pvtWindow);
    
    const priceTrendUp = close[i] > priceWindow[0];
    const priceTrendDown = close[i] < priceWindow[0];
    const pvtTrendUp = pvt[i] > pvtWindow[0];
    const pvtTrendDown = pvt[i] < pvtWindow[0];
    
    // 顶背离: 价格创新高但PVT未创新高
    if (close[i] === priceMax && !pvtTrendUp) {
      divergence[i] = 'top';
    }
    // 底背离: 价格创新低但PVT未创新低
    else if (close[i] === priceMin && !pvtTrendDown) {
      divergence[i] = 'bottom';
    }
  }
  
  return { pvt, divergence };
}

// 计算所有指标
function calculateIndicators(data: StockData[], capital: number): IndicatorData[] {
  const n = data.length;
  const close = data.map(d => d.close);
  const high = data.map(d => d.high);
  const low = data.map(d => d.low);
  const volume = data.map(d => d.volume);
  
  // 均线
  const ma20 = calculateMA(close, 20);
  const ma225 = calculateMA(close, 225);
  
  // 乖离率
  const bias225 = calculateBias(close, ma225);
  
  // 换手成本
  const dd = calculateDD(volume, capital);
  const emahs = calculateEMAHS(close, dd);
  
  // CRI
  const cri = calculateCRI(close, high, low, emahs, ma20);
  
  // 贪婪指数
  const greedy = calculateGreedy(close, high, low, volume, emahs, bias225);
  
  // ADX
  const { adx, plusDI, minusDI } = calculateADX(high, low, close);
  
  // PVT
  const { divergence: pvtDivergence } = calculatePVT(close, volume);
  
  // 组装结果
  const result: IndicatorData[] = [];
  for (let i = 0; i < n; i++) {
    result.push({
      date: data[i].date,
      close: data[i].close,
      bias225Percentile: calculatePercentile(bias225, i),
      cri: cri[i],
      costDeviation: emahs[i] !== null ? ((close[i] - emahs[i]!) / emahs[i]!) * 100 : null,
      costDeviationPercentile: calculatePercentile(
        emahs.map((e, idx) => e !== null ? ((close[idx] - e) / e) * 100 : null),
        i
      ),
      greedy: greedy[i],
      pvtDivergence: pvtDivergence[i],
      plusDI: plusDI[i],
      minusDI: minusDI[i],
      adx: adx[i],
    });
  }
  
  return result;
}

// ============ 信号检测 ============

function detectSignals(indicators: IndicatorData[], data: StockData[]): {
  signals: string[];
  details: string;
} {
  const n = indicators.length;
  if (n < 2) return { signals: [], details: '' };
  
  const last = indicators[n - 1];
  const prev = indicators[n - 2];
  const signals: string[] = [];
  const details: string[] = [];
  
  // 检测连续背离
  let topDivCount = 0;
  let bottomDivCount = 0;
  let topDivStart = -1;
  let bottomDivStart = -1;
  
  for (let i = n - 1; i >= 0; i--) {
    if (indicators[i].pvtDivergence === 'top') {
      if (topDivCount === 0) topDivStart = i;
      topDivCount++;
    } else if (topDivCount > 0) break;
  }
  
  for (let i = n - 1; i >= 0; i--) {
    if (indicators[i].pvtDivergence === 'bottom') {
      if (bottomDivCount === 0) bottomDivStart = i;
      bottomDivCount++;
    } else if (bottomDivCount > 0) break;
  }
  
  // S 顶背离: 连续≥2天 + BIAS>50% (第一天标记，这里简化检测最后一天是否满足)
  if (topDivCount >= 2 && last.bias225Percentile !== null && last.bias225Percentile > 50) {
    signals.push('S(顶背离)');
    details.push(`顶背离${topDivCount}天,BIAS=${last.bias225Percentile?.toFixed(1)}%`);
  }
  
  // S 贪婪卖出: 贪婪>95% + BIAS>90%
  if (last.greedy !== null && last.greedy > 95 && 
      last.bias225Percentile !== null && last.bias225Percentile > 90) {
    signals.push('S(贪婪)');
    details.push(`贪婪=${last.greedy.toFixed(1)},BIAS=${last.bias225Percentile?.toFixed(1)}%`);
  }
  
  // B 底背离: 连续≥2天 + 2×CRI≥60 + 2×成本偏离<50%
  let criInStreak = 0;
  let lowCostDevInStreak = 0;
  if (bottomDivCount >= 2) {
    for (let i = n - bottomDivCount; i < n; i++) {
      if (indicators[i].cri !== null && indicators[i].cri! >= 60) criInStreak++;
      if (indicators[i].costDeviationPercentile !== null && indicators[i].costDeviationPercentile! < 50) {
        lowCostDevInStreak++;
      }
    }
  }
  
  if (bottomDivCount >= 2 && criInStreak >= 2 && lowCostDevInStreak >= 2) {
    signals.push('B(底背离)');
    details.push(`底背离${bottomDivCount}天,CRI≥60有${criInStreak}天`);
  }
  
  // B 恐慌买入: 成本偏离<5% + BIAS<5% + CRI>90
  if (last.costDeviationPercentile !== null && last.costDeviationPercentile < 5 &&
      last.bias225Percentile !== null && last.bias225Percentile < 5 &&
      last.cri !== null && last.cri > 90) {
    signals.push('B(恐慌)');
    details.push(`成本偏离=${last.costDeviationPercentile?.toFixed(1)}%,BIAS=${last.bias225Percentile?.toFixed(1)}%,CRI=${last.cri?.toFixed(1)}`);
  }
  
  return { signals, details: details.join('; ') };
}

// ============ 主程序 ============

async function scanStock(code: string): Promise<ScanResult> {
  try {
    console.log(`  扫描: ${code}...`);
    
    // 获取数据
    const [klines, quote] = await Promise.all([
      getKlines(code, 300),
      getQuote(code)
    ]);
    
    if (klines.length < 250) {
      return {
        code: cleanSymbol(code),
        name: quote.name,
        date: '',
        close: 0,
        signals: [],
        signalDetails: '',
        bias225Pct: null,
        cri: null,
        greedy: null,
        error: '数据不足(需要250天以上)'
      };
    }
    
    // 计算指标
    const indicators = calculateIndicators(klines, quote.capital);
    
    // 检测信号
    const { signals, details } = detectSignals(indicators, klines);
    
    const last = indicators[indicators.length - 1];
    
    return {
      code: cleanSymbol(code),
      name: quote.name,
      date: last.date,
      close: last.close,
      signals,
      signalDetails: details,
      bias225Pct: last.bias225Percentile,
      cri: last.cri,
      greedy: last.greedy,
    };
  } catch (error: any) {
    return {
      code: cleanSymbol(code),
      name: '',
      date: '',
      close: 0,
      signals: [],
      signalDetails: '',
      bias225Pct: null,
      cri: null,
      greedy: null,
      error: error.message || '未知错误'
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('使用方法: npx tsx scripts/scan-signals.ts <输入Excel路径> [输出Excel路径]');
    console.log('');
    console.log('Excel格式:');
    console.log('  - 第一列: 股票代码 (如: 600519, 000001, 00700)');
    console.log('  - 可选第二列: 股票名称');
    console.log('');
    console.log('示例:');
    console.log('  npx tsx scripts/scan-signals.ts stocks.xlsx');
    console.log('  npx tsx scripts/scan-signals.ts stocks.xlsx results.xlsx');
    process.exit(1);
  }
  
  const inputPath = args[0];
  const outputPath = args[1] || `signals_${new Date().toISOString().split('T')[0]}.xlsx`;
  
  // 检查输入文件
  if (!fs.existsSync(inputPath)) {
    console.error(`错误: 找不到文件 ${inputPath}`);
    process.exit(1);
  }
  
  console.log(`读取股票列表: ${inputPath}`);
  
  // 读取Excel
  const workbook = XLSX.readFile(inputPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
  
  // 提取股票代码 (跳过表头)
  const codes: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row && row[0]) {
      const code = String(row[0]).trim();
      if (/^\d{5,6}$/.test(code)) {
        codes.push(code);
      }
    }
  }
  
  console.log(`找到 ${codes.length} 个股票代码`);
  console.log('');
  
  // 逐个扫描
  const results: ScanResult[] = [];
  for (let i = 0; i < codes.length; i++) {
    console.log(`[${i + 1}/${codes.length}]`);
    const result = await scanStock(codes[i]);
    results.push(result);
    
    if (result.signals.length > 0) {
      console.log(`  ✅ 信号: ${result.signals.join(', ')}`);
    } else if (result.error) {
      console.log(`  ❌ ${result.error}`);
    } else {
      console.log(`  ⏹️  无信号`);
    }
    
    // 延迟避免请求过快
    if (i < codes.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log('');
  console.log('扫描完成，生成报告...');
  
  // 生成Excel输出
  const outputData = results.map(r => ({
    '股票代码': r.code,
    '股票名称': r.name,
    '日期': r.date,
    '收盘价': r.close,
    '信号': r.signals.join(', ') || '无',
    '信号详情': r.signalDetails,
    'BIAS225分位': r.bias225Pct?.toFixed(2) || '',
    'CRI': r.cri?.toFixed(2) || '',
    '贪婪指数': r.greedy?.toFixed(2) || '',
    '错误信息': r.error || ''
  }));
  
  const outputWB = XLSX.utils.book_new();
  const outputSheet = XLSX.utils.json_to_sheet(outputData);
  XLSX.utils.book_append_sheet(outputWB, outputSheet, 'Signals');
  XLSX.writeFile(outputWB, outputPath);
  
  console.log(`结果已保存: ${outputPath}`);
  
  // 统计
  const withSignals = results.filter(r => r.signals.length > 0);
  console.log('');
  console.log('=== 统计 ===');
  console.log(`总股票数: ${results.length}`);
  console.log(`有信号: ${withSignals.length}`);
  console.log(`无信号: ${results.length - withSignals.length}`);
  console.log(`错误: ${results.filter(r => r.error).length}`);
  
  if (withSignals.length > 0) {
    console.log('');
    console.log('=== 信号列表 ===');
    withSignals.forEach(r => {
      console.log(`${r.code} ${r.name}: ${r.signals.join(', ')}`);
    });
  }
}

main().catch(console.error);
