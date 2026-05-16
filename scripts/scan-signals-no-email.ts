/**
 * 股票信号扫描工具 - 完整版（与网页版逻辑一致）
 * 
 * 信号检测逻辑：
 * - S(顶背离): 连续≥2天顶背离 + BIAS>50%（第一天）
 * - S(贪婪): 贪婪>95% + BIAS>90%（DI拐点）
 * - B(底背离): 连续≥2天底背离 + 两天CRI≥60 + 两天成本偏离<50%（最后一天）
 * - B(恐慌): 成本偏离<5% + BIAS<5% + CRI>90（DI拐点）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import nodemailer from 'nodemailer';

// 加载环境变量
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim();
    }
  });
}

// ============ 类型定义 ============

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
  bias225: number | null;
  bias225Percentile: number | null;
  cri: number | null;
  costDeviation: number | null;
  costDeviationPercentile: number | null;
  greedy: number | null;
  greedyPercentile: number | null;
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
  if (clean.length === 5) return `hk${clean}`;
  if (clean.startsWith('6') || clean.startsWith('5')) return `sh${clean}`;
  return `sz${clean}`;
}

function cleanSymbol(symbol: string): string {
  return symbol.replace(/[^0-9]/g, '');
}

function parseCSV(content: string): string[][] {
  const lines = content.trim().split('\n');
  return lines.map(line => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  });
}

function extractStockCode(rawCode: string): string | null {
  const clean = rawCode.trim().toUpperCase().replace(/^\uFEFF/, '');
  const matchA = clean.match(/^(SH|SZ)(\d{6})$/);
  if (matchA) return matchA[2];
  if (/^\d{5}$/.test(clean)) return clean;
  if (/^\d{6}$/.test(clean)) return clean;
  return null;
}

// ============ 邮件配置 ============

function getEmailConfig() {
  const host = process.env.EMAIL_HOST;
  const port = process.env.EMAIL_PORT;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  
  if (!host || !user || !pass) {
    console.log('⚠️  邮件配置不完整');
    return null;
  }
  
  return {
    host,
    port: parseInt(port || '465'),
    secure: true,
    auth: { user, pass }
  };
}

// 邮件发送功能已移除（由外部脚本统一处理）

// ============ API 函数 ============

async function getKlines(symbol: string, count: number = 400): Promise<StockData[]> {
  const tencentSymbol = formatSymbol(symbol);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentSymbol},day,,,${count},qfq`;
  
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json', 'Referer': 'https://stock.qq.com' },
  });
  
  if (!response.ok) throw new Error('API请求失败');
  const result = await response.json();
  
  if (result.code !== 0 || !result.data || !result.data[tencentSymbol]) {
    throw new Error('无数据返回');
  }
  
  const stockData = result.data[tencentSymbol];
  const klines = stockData.qfqday || stockData.day || [];
  
  if (!klines || klines.length < 250) {
    throw new Error('数据不足(需要250天以上)');
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
    headers: { 'Accept': 'application/json', 'Referer': 'https://stock.qq.com' },
  });
  
  if (!response.ok) throw new Error('API请求失败');
  const result = await response.json();
  
  if (result.code !== 0 || !result.data || !result.data[tencentSymbol]) {
    throw new Error('无数据');
  }
  
  const qt = result.data[tencentSymbol].qt?.[tencentSymbol];
  const name = qt?.[1] || symbol;
  const market = qt?.[0];
  
  let capital = 0;
  if (market === '100') {
    capital = parseInt(qt[69]) || 0;
  } else {
    capital = parseInt(qt[72]) || 0;
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
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      result.push(sum / period);
    }
  }
  return result;
}

function calculateEMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);
  
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(data[i]);
    } else {
      result.push(data[i] * multiplier + result[i - 1] * (1 - multiplier));
    }
  }
  return result;
}

function calculateDD(volumes: number[], capital: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < volumes.length; i++) {
    let cumVol = 0, count = 0;
    for (let j = i; j >= 0; j--) {
      cumVol += volumes[j];
      count++;
      if (cumVol >= capital) break;
    }
    result.push(count);
  }
  return result;
}

function calculateEMAHS(closes: number[], dd: number[]): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    const period = Math.min(dd[i], i + 1);
    if (period <= 0) { result.push(null); continue; }
    
    const multiplier = 2 / (period + 1);
    let ema = closes[i];
    for (let j = i - 1; j >= Math.max(0, i - period + 1); j--) {
      ema = closes[j] * multiplier + ema * (1 - multiplier);
    }
    result.push(ema);
  }
  return result;
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

function calculateBias(close: number[], ma: (number | null)[]): (number | null)[] {
  return close.map((c, i) => {
    const m = ma[i];
    if (m === null || m === 0) return null;
    return ((c - m) / m) * 100;
  });
}

// 计算ADX和DI
function calculateADX(high: number[], low: number[], close: number[]) {
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
function calculatePVT(close: number[], volume: number[]) {
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
  
  // 检测背离
  for (let i = 10; i < n; i++) {
    const priceWindow = close.slice(i - 4, i + 1);
    const pvtWindow = pvt.slice(i - 4, i + 1);
    
    const priceMax = Math.max(...priceWindow);
    const priceMin = Math.min(...priceWindow);
    const pvtTrendUp = pvt[i] > pvtWindow[0];
    const pvtTrendDown = pvt[i] < pvtWindow[0];
    
    if (close[i] === priceMax && !pvtTrendUp) {
      divergence[i] = 'top';
    } else if (close[i] === priceMin && !pvtTrendDown) {
      divergence[i] = 'bottom';
    }
  }
  
  return { pvt, divergence };
}

// 计算CRI
function calculateCRI(close: number[], high: number[], low: number[], emahs: (number | null)[], ma20: (number | null)[]) {
  const result: number[] = [];
  
  for (let i = 0; i < close.length; i++) {
    if (i < 20) { result.push(0); continue; }
    
    const price = close[i];
    const ema = emahs[i];
    const ma = ma20[i];
    
    if (ema === null || ma === null) { result.push(0); continue; }
    
    const deviation = ((price - ema) / ema) * 100;
    const basisScore = Math.max(0, -deviation);
    
    const prevClose = close[i - 1];
    const gapDown = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    const jumpScore = gapDown < 0 ? Math.min(100, Math.abs(gapDown) * 5) : 0;
    
    let trSum = 0;
    for (let j = i - 19; j <= i; j++) trSum += high[j] - low[j];
    const avgTR = trSum / 20;
    const avgPrice = close.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20;
    const curveScore = avgPrice > 0 ? Math.min(100, (avgTR / avgPrice) * 100 * 10) : 0;
    
    const isBelowMA20 = price < ma;
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
function calculateGreedy(close: number[], high: number[], low: number[], volume: number[], emahs: (number | null)[], bias225: (number | null)[]) {
  const result: number[] = [];
  
  for (let i = 0; i < close.length; i++) {
    if (i < 225) { result.push(0); continue; }
    
    const price = close[i];
    const ema = emahs[i];
    const bias = bias225[i];
    
    if (ema === null || bias === null) { result.push(0); continue; }
    
    const deviation = ((price - ema) / ema) * 100;
    const posBasis = Math.max(0, deviation);
    
    const prevClose = close[i - 1];
    const gapUp = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    const upGapScore = gapUp > 0 ? Math.min(100, gapUp * 5) : 0;
    
    let trSum = 0;
    for (let j = i - 4; j <= i; j++) trSum += high[j] - low[j];
    const avgTR = trSum / 5;
    const greedVol = Math.min(100, (avgTR / price) * 100 * 20);
    
    const biasExtreme = Math.max(0, bias);
    
    const avgVol = volume.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20;
    const volumeSurge = avgVol > 0 ? Math.min(100, (volume[i] / avgVol) * 30) : 0;
    
    const rawScore = posBasis * 3 + upGapScore * 0.8 + greedVol * 0.6 + biasExtreme * 0.8 + volumeSurge * 0.3;
    result.push(Math.min(100, rawScore));
  }
  
  return result;
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
    const costDev = emahs[i] !== null ? ((close[i] - emahs[i]!) / emahs[i]!) * 100 : null;
    
    result.push({
      date: data[i].date,
      close: data[i].close,
      bias225: bias225[i],
      bias225Percentile: calculatePercentile(bias225, i),
      cri: cri[i],
      costDeviation: costDev,
      costDeviationPercentile: calculatePercentile(
        emahs.map((e, idx) => e !== null ? ((close[idx] - e) / e) * 100 : null), i
      ),
      greedy: greedy[i],
      greedyPercentile: calculatePercentile(greedy, i),
      pvtDivergence: pvtDivergence[i],
      plusDI: plusDI[i],
      minusDI: minusDI[i],
      adx: adx[i],
    });
  }
  
  return result;
}

// ============ 信号检测（与网页版完全一致）============

function detectSignals(indicators: IndicatorData[]): { signals: string[]; details: string } {
  const n = indicators.length;
  if (n < 2) return { signals: [], details: '' };
  
  const signals: string[] = [];
  const details: string[] = [];
  
  // 计算连续背离天数
  const consecutiveCount: number[] = new Array(n).fill(0);
  const consecutiveStart: number[] = new Array(n).fill(-1);
  let currentStreak = 0;
  let currentType: 'top' | 'bottom' | null = null;
  let currentStart = -1;
  
  for (let i = 0; i < n; i++) {
    const div = indicators[i].pvtDivergence;
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
  
  // 反向遍历确保连续段信息正确
  for (let i = n - 2; i >= 0; i--) {
    if (consecutiveCount[i] > 0 && consecutiveCount[i + 1] > 0) {
      consecutiveCount[i] = consecutiveCount[i + 1];
      consecutiveStart[i] = consecutiveStart[i + 1];
    }
  }
  
  // 当前数据（最后一天）
  const last = indicators[n - 1];
  const lastIdx = n - 1;
  
  // 辅助函数：检查底背离连续段中是否有任意两天CRI>=60
  const hasHighCRIInStreak = (startIdx: number, count: number): boolean => {
    let highCount = 0;
    for (let i = startIdx; i < startIdx + count && i < n; i++) {
      const cri = indicators[i].cri;
      if (cri !== null && cri >= 60) highCount++;
      if (highCount >= 2) return true;
    }
    return false;
  };
  
  // 辅助函数：检查底背离连续段中是否有任意两天成本偏离度<50%
  const hasLowCostDevInStreak = (startIdx: number, count: number, threshold: number = 50): boolean => {
    let lowCount = 0;
    for (let i = startIdx; i < startIdx + count && i < n; i++) {
      const pct = indicators[i].costDeviationPercentile;
      if (pct !== null && pct < threshold) lowCount++;
      if (lowCount >= 2) return true;
    }
    return false;
  };
  
  // ===== S(顶背离): 连续≥2天 + BIAS>50%（最后一天如果是连续段的第一天则标记）=====
  const div = last.pvtDivergence;
  const count = consecutiveCount[lastIdx];
  const startIdx = consecutiveStart[lastIdx];
  
  if (div === 'top' && count >= 2 && lastIdx === startIdx && last.bias225Percentile !== null && last.bias225Percentile > 50) {
    signals.push('S(顶背离)');
    details.push(`顶背离${count}天,BIAS=${last.bias225Percentile.toFixed(1)}%`);
  }
  
  // ===== B(底背离): 连续≥2天 + 两天CRI>=60 + 两天成本偏离<50%（标记最后一天）=====
  if (div === 'bottom' && count >= 2 && lastIdx === startIdx + count - 1) {
    if (hasHighCRIInStreak(startIdx, count) && hasLowCostDevInStreak(startIdx, count, 50)) {
      signals.push('B(底背离)');
      details.push(`底背离${count}天,CRI≥60满足`);
    }
  }
  
  // ===== S(贪婪): 贪婪>95% + BIAS>90% =====
  if (last.greedyPercentile !== null && last.greedyPercentile > 95 && 
      last.bias225Percentile !== null && last.bias225Percentile > 90) {
    signals.push('S(贪婪)');
    details.push(`贪婪=${last.greedy?.toFixed(1)},BIAS=${last.bias225Percentile.toFixed(1)}%`);
  }
  
  // ===== B(恐慌): 成本偏离<5% + BIAS<5% + CRI>90 =====
  if (last.costDeviationPercentile !== null && last.costDeviationPercentile < 5 &&
      last.bias225Percentile !== null && last.bias225Percentile < 5 &&
      last.cri !== null && last.cri > 90) {
    signals.push('B(恐慌)');
    details.push(`成本偏离=${last.costDeviationPercentile.toFixed(1)}%,BIAS=${last.bias225Percentile.toFixed(1)}%,CRI=${last.cri.toFixed(1)}`);
  }
  
  return { signals, details: details.join('; ') };
}

// ============ 单个股票扫描 ============

async function scanStock(code: string): Promise<ScanResult> {
  try {
    console.log(`  扫描: ${code}...`);
    
    const [klines, quote] = await Promise.all([
      getKlines(code, 400),
      getQuote(code)
    ]);
    
    const indicators = calculateIndicators(klines, quote.capital);
    const { signals, details } = detectSignals(indicators);
    
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
      error: error.message
    };
  }
}

// ============ 主程序 ============

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('使用方法: npx tsx scripts/scan-signals-full.ts <股票列表.csv> [输出.xlsx]');
    process.exit(1);
  }
  
  const inputPath = args[0];
  const outputPath = args[1] || `signals_${new Date().toISOString().split('T')[0]}.xlsx`;
  
  if (!fs.existsSync(inputPath)) {
    console.error(`错误: 找不到文件 ${inputPath}`);
    process.exit(1);
  }
  
  console.log('📊 开始扫描股票信号（完整版）...\n');
  
  // 读取CSV
  const content = fs.readFileSync(inputPath, 'utf-8');
  const rows = parseCSV(content);
  
  const codes: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i] && rows[i][2]) {
      const code = extractStockCode(String(rows[i][2]));
      if (code) codes.push(code);
    }
  }
  
  console.log(`找到 ${codes.length} 个股票代码\n`);
  
  // 扫描
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
    
    if (i < codes.length - 1) await new Promise(r => setTimeout(r, 300));
  }
  
  // 生成Excel
  const withSignals = results.filter(r => r.signals.length > 0);
  
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
    '错误': r.error || ''
  }));
  
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(outputData);
  XLSX.utils.book_append_sheet(wb, ws, 'Signals');
  XLSX.writeFile(wb, outputPath);
  
  console.log(`\n✅ 结果已保存: ${outputPath}`);
  
  // 统计
  console.log('\n=== 统计 ===');
  console.log(`总股票数: ${results.length}`);
  console.log(`有信号: ${withSignals.length}`);
  console.log(`无信号: ${results.length - withSignals.length}`);
  console.log(`错误: ${results.filter(r => r.error).length}`);
  
  if (withSignals.length > 0) {
    console.log('\n=== 信号列表 ===');
    withSignals.forEach(r => {
      console.log(`${r.code} ${r.name}: ${r.signals.join(', ')}`);
    });
  }
}

main().catch(console.error);
