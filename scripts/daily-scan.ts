/**
 * 每日股票信号定时扫描脚本
 * 扫描关注列表中的股票，只输出有B/S信号的股票
 * 
 * 使用方法:
 * npx tsx scripts/daily-scan.ts
 * 
 * 环境变量:
 * - EMAIL_TO: 接收信号的邮箱地址
 * - SIGNAL_VERSION: 信号版本 (strict/loose)，默认 strict
 */

import * as fs from 'fs';
import * as path from 'path';
import XLSX from 'xlsx';
import nodemailer from 'nodemailer';
import { WATCHLIST, getUniqueWatchlist } from '../src/data/watchlist';

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
  greedy: number | null;
  pvtDivergence: 'none' | 'top' | 'bottom' | null;
}

interface ScanResult {
  code: string;
  name: string;
  market: string;
  date: string;
  close: number;
  signals: string[];
  signalType: 'B' | 'S' | null;
  bias225Pct: number | null;
  cri: number | null;
  greedy: number | null;
  error?: string;
  star?: boolean;
}

// ============ 工具函数 ============

function formatSymbol(symbol: string, market: string): string {
  const clean = symbol.replace(/[^0-9a-zA-Z]/g, '');
  
  if (market === 'HK') {
    return `hk${clean}`;
  }
  if (market === 'US') {
    return clean;  // 美股直接使用代码
  }
  if (market === 'SH' || clean.startsWith('6') || clean.startsWith('5')) {
    return `sh${clean}`;
  }
  return `sz${clean}`;
}

// ============ API 函数 ============

async function getKlines(symbol: string, market: string, count: number = 300): Promise<StockData[]> {
  // 美股使用雅虎财经API
  if (market === 'US') {
    return getUSKlines(symbol, count);
  }
  
  // A股和港股使用腾讯API
  const tencentSymbol = formatSymbol(symbol, market);
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
    throw new Error('无K线数据');
  }
  
  return klines.map((k: string[]) => ({
    date: k[0],
    open: parseFloat(k[1]),
    close: parseFloat(k[2]),
    low: parseFloat(k[3]),
    high: parseFloat(k[4]),
    volume: parseInt(k[5]),
    amount: parseFloat(k[6]) || 0,
  }));
}

async function getUSKlines(symbol: string, count: number = 300): Promise<StockData[]> {
  // 使用雅虎财经API获取美股数据
  const endDate = Math.floor(Date.now() / 1000);
  const startDate = endDate - count * 86400;
  
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${startDate}&period2=${endDate}&interval=1d`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Yahoo API请求失败: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (!result.chart || !result.chart.result || result.chart.result.length === 0) {
    throw new Error('无美股数据返回');
  }
  
  const data = result.chart.result[0];
  const timestamps = data.timestamp;
  const quote = data.indicators.quote[0];
  
  const klines: StockData[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.close[i] !== null) {
      klines.push({
        date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
        open: quote.open[i] || quote.close[i],
        high: quote.high[i] || quote.close[i],
        low: quote.low[i] || quote.close[i],
        close: quote.close[i],
        volume: quote.volume[i] || 0,
        amount: 0,
      });
    }
  }
  
  return klines;
}

// ============ 指标计算 ============

function calculateBias225(data: StockData[]): { value: number; percentile: number } | null {
  if (data.length < 225) return null;
  
  const closes = data.map(d => d.close);
  const ma225 = closes.slice(-225).reduce((a, b) => a + b, 0) / 225;
  const currentClose = closes[closes.length - 1];
  const bias225 = ((currentClose - ma225) / ma225) * 100;
  
  // 计算历史分位数（使用最近200天）
  const historyBias: number[] = [];
  for (let i = data.length - 200; i < data.length; i++) {
    if (i >= 225) {
      const periodMa225 = closes.slice(i - 225, i).reduce((a, b) => a + b, 0) / 225;
      const periodBias = ((closes[i] - periodMa225) / periodMa225) * 100;
      historyBias.push(periodBias);
    }
  }
  
  const sorted = [...historyBias].sort((a, b) => a - b);
  const rank = sorted.findIndex(v => v >= bias225);
  const percentile = rank === -1 ? 100 : (rank / sorted.length) * 100;
  
  return { value: bias225, percentile };
}

function calculateCRI(data: StockData[]): number | null {
  if (data.length < 20) return null;
  
  const closes = data.map(d => d.close);
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentClose = closes[closes.length - 1];
  
  const deviation = ((currentClose - ma20) / ma20) * 100;
  const criScore = Math.max(0, -deviation);
  
  return Math.min(100, criScore * 5);
}

function calculateGreedy(data: StockData[]): { value: number; percentile: number } | null {
  if (data.length < 225) return null;
  
  const closes = data.map(d => d.close);
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentClose = closes[closes.length - 1];
  
  const deviation = ((currentClose - ma20) / ma20) * 100;
  const greedyScore = Math.max(0, deviation);
  const greedyValue = Math.min(100, greedyScore * 5);
  
  // 计算历史分位数
  const historyGreedy: number[] = [];
  for (let i = data.length - 200; i < data.length; i++) {
    if (i >= 20) {
      const periodMa20 = closes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
      const periodDeviation = ((closes[i] - periodMa20) / periodMa20) * 100;
      historyGreedy.push(Math.min(100, Math.max(0, periodDeviation) * 5));
    }
  }
  
  const sorted = [...historyGreedy].sort((a, b) => a - b);
  const rank = sorted.findIndex(v => v >= greedyValue);
  const percentile = rank === -1 ? 100 : (rank / sorted.length) * 100;
  
  return { value: greedyValue, percentile };
}

// ============ 信号检测 ============

function detectSignals(
  data: StockData[],
  signalVersion: 'strict' | 'loose' = 'strict'
): { signals: string[]; signalType: 'B' | 'S' | null; indicators: IndicatorData } {
  const bias225 = calculateBias225(data);
  const cri = calculateCRI(data);
  const greedy = calculateGreedy(data);
  
  const currentData = data[data.length - 1];
  const signals: string[] = [];
  let signalType: 'B' | 'S' | null = null;
  
  // 买入信号
  if (bias225) {
    if (bias225.percentile < 10) {
      signals.push('B(低估)');
      signalType = 'B';
    }
    if (bias225.percentile < 5 && cri && cri > 50) {
      signals.push('B(恐慌)');
      signalType = 'B';
    }
  }
  
  // 卖出信号
  if (bias225 && bias225.percentile > 90) {
    signals.push('S(高估)');
    signalType = 'S';
  }
  
  if (greedy && bias225) {
    if (greedy.percentile > 90 && bias225.percentile > 80) {
      signals.push('S(贪婪)');
      signalType = 'S';
    }
  }
  
  return {
    signals,
    signalType,
    indicators: {
      date: currentData.date,
      close: currentData.close,
      bias225Percentile: bias225?.percentile ?? null,
      cri: cri,
      greedy: greedy?.value ?? null,
      pvtDivergence: null,
    },
  };
}

// ============ 主扫描函数 ============

async function scanStock(stock: typeof WATCHLIST[0], signalVersion: 'strict' | 'loose'): Promise<ScanResult> {
  try {
    const data = await getKlines(stock.code, stock.market, 300);
    
    if (data.length < 225) {
      return {
        code: stock.code,
        name: stock.name,
        market: stock.market,
        date: '',
        close: 0,
        signals: [],
        signalType: null,
        bias225Pct: null,
        cri: null,
        greedy: null,
        star: stock.star,
        error: '数据不足(需225天以上)',
      };
    }
    
    const result = detectSignals(data, signalVersion);
    const currentData = data[data.length - 1];
    
    return {
      code: stock.code,
      name: stock.name,
      market: stock.market,
      date: currentData.date,
      close: currentData.close,
      signals: result.signals,
      signalType: result.signalType,
      bias225Pct: result.indicators.bias225Percentile,
      cri: result.indicators.cri,
      greedy: result.indicators.greedy,
      star: stock.star,
    };
  } catch (error) {
    return {
      code: stock.code,
      name: stock.name,
      market: stock.market,
      date: '',
      close: 0,
      signals: [],
      signalType: null,
      bias225Pct: null,
      cri: null,
      greedy: null,
      star: stock.star,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

async function scanAllStocks(): Promise<ScanResult[]> {
  const stocks = getUniqueWatchlist();
  const signalVersion = (process.env.SIGNAL_VERSION as 'strict' | 'loose') || 'strict';
  
  console.log(`开始扫描 ${stocks.length} 只股票...`);
  console.log(`信号版本: ${signalVersion}`);
  console.log('');
  
  const results: ScanResult[] = [];
  const batchSize = 5;  // 每批5只，避免请求过快
  
  for (let i = 0; i < stocks.length; i += batchSize) {
    const batch = stocks.slice(i, i + batchSize);
    const batchPromises = batch.map(stock => scanStock(stock, signalVersion));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // 显示进度
    const progress = Math.min(i + batchSize, stocks.length);
    console.log(`进度: ${progress}/${stocks.length}`);
    
    // 延迟避免请求过快
    if (i + batchSize < stocks.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return results;
}

// ============ 邮件发送 ============

async function sendEmail(results: ScanResult[]) {
  const emailTo = process.env.EMAIL_TO;
  
  if (!emailTo) {
    console.log('未设置 EMAIL_TO 环境变量，跳过邮件发送');
    return;
  }
  
  // 只过滤有信号的股票
  const signalStocks = results.filter(r => r.signals.length > 0);
  
  if (signalStocks.length === 0) {
    console.log('今日无信号股票，不发送邮件');
    return;
  }
  
  // 按信号类型分组
  const bSignals = signalStocks.filter(r => r.signalType === 'B');
  const sSignals = signalStocks.filter(r => r.signalType === 'S');
  
  const today = new Date().toISOString().split('T')[0];
  
  let htmlContent = `
    <h2>📊 每日股票信号报告 - ${today}</h2>
    <p>共扫描 ${results.length} 只股票，发现 <strong>${signalStocks.length}</strong> 只信号股</p>
    <hr>
  `;
  
  if (bSignals.length > 0) {
    htmlContent += `
      <h3>🟢 买入信号 (${bSignals.length}只)</h3>
      <table border="1" cellpadding="8" style="border-collapse: collapse;">
        <tr style="background-color: #e8f5e9;">
          <th>代码</th>
          <th>名称</th>
          <th>市场</th>
          <th>最新价</th>
          <th>信号</th>
          <th>BIAS225分位</th>
          <th>CRI</th>
        </tr>
    `;
    for (const r of bSignals) {
      const starMark = r.star ? ' ⭐' : '';
      htmlContent += `
        <tr>
          <td>${r.code}</td>
          <td><strong>${r.name}${starMark}</strong></td>
          <td>${r.market}</td>
          <td>¥${r.close.toFixed(2)}</td>
          <td style="color: green; font-weight: bold;">${r.signals.join(', ')}</td>
          <td>${r.bias225Pct?.toFixed(1) ?? '-'}%</td>
          <td>${r.cri?.toFixed(1) ?? '-'}</td>
        </tr>
      `;
    }
    htmlContent += '</table><br>';
  }
  
  if (sSignals.length > 0) {
    htmlContent += `
      <h3>🔴 卖出信号 (${sSignals.length}只)</h3>
      <table border="1" cellpadding="8" style="border-collapse: collapse;">
        <tr style="background-color: #ffebee;">
          <th>代码</th>
          <th>名称</th>
          <th>市场</th>
          <th>最新价</th>
          <th>信号</th>
          <th>BIAS225分位</th>
          <th>贪婪指数</th>
        </tr>
    `;
    for (const r of sSignals) {
      const starMark = r.star ? ' ⭐' : '';
      htmlContent += `
        <tr>
          <td>${r.code}</td>
          <td><strong>${r.name}${starMark}</strong></td>
          <td>${r.market}</td>
          <td>¥${r.close.toFixed(2)}</td>
          <td style="color: red; font-weight: bold;">${r.signals.join(', ')}</td>
          <td>${r.bias225Pct?.toFixed(1) ?? '-'}%</td>
          <td>${r.greedy?.toFixed(1) ?? '-'}</td>
        </tr>
      `;
    }
    htmlContent += '</table><br>';
  }
  
  htmlContent += `
    <hr>
    <p style="color: #666; font-size: 12px;">
      扫描时间: ${new Date().toLocaleString('zh-CN')}<br>
      信号说明: B(低估)=BIAS225分位数<10%, B(恐慌)=BIAS<5%且CRI>50<br>
      S(高估)=BIAS225分位数>90%, S(贪婪)=贪婪分位数>90%且BIAS>80%
    </p>
  `;
  
  // 创建邮件传输器
  const transporter = nodemailer.createTransporter({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  
  try {
    await transporter.sendMail({
      from: `"股票信号扫描" <${process.env.SMTP_USER}>`,
      to: emailTo,
      subject: `📊 股票信号报告 ${today} - ${signalStocks.length}只信号股`,
      html: htmlContent,
    });
    console.log(`邮件已发送至: ${emailTo}`);
  } catch (error) {
    console.error('邮件发送失败:', error);
  }
}

// ============ 主程序 ============

async function main() {
  console.log('========================================');
  console.log('     每日股票信号扫描 - Daily Scan');
  console.log('========================================');
  console.log('');
  
  const startTime = Date.now();
  
  // 执行扫描
  const results = await scanAllStocks();
  
  // 只显示有信号的股票
  const signalStocks = results.filter(r => r.signals.length > 0);
  
  console.log('');
  console.log('========================================');
  console.log(`扫描完成！共 ${results.length} 只股票`);
  console.log(`发现信号股: ${signalStocks.length} 只`);
  console.log('========================================');
  
  if (signalStocks.length > 0) {
    console.log('');
    console.log('🎯 信号股票列表:');
    console.log('');
    
    // 按信号类型分组显示
    const bSignals = signalStocks.filter(r => r.signalType === 'B');
    const sSignals = signalStocks.filter(r => r.signalType === 'S');
    
    if (bSignals.length > 0) {
      console.log('🟢 买入信号:');
      for (const r of bSignals) {
        const starMark = r.star ? ' ⭐' : '';
        console.log(`  ${r.code} ${r.name}${starMark} [${r.market}] ¥${r.close.toFixed(2)} | ${r.signals.join(', ')} | BIAS:${r.bias225Pct?.toFixed(1) ?? '-'}%`);
      }
      console.log('');
    }
    
    if (sSignals.length > 0) {
      console.log('🔴 卖出信号:');
      for (const r of sSignals) {
        const starMark = r.star ? ' ⭐' : '';
        console.log(`  ${r.code} ${r.name}${starMark} [${r.market}] ¥${r.close.toFixed(2)} | ${r.signals.join(', ')} | BIAS:${r.bias225Pct?.toFixed(1) ?? '-'}%`);
      }
    }
  } else {
    console.log('');
    console.log('📭 今日无信号股票');
  }
  
  // 显示错误
  const errorStocks = results.filter(r => r.error);
  if (errorStocks.length > 0) {
    console.log('');
    console.log(`⚠️ 扫描失败 (${errorStocks.length}只):`);
    for (const r of errorStocks.slice(0, 5)) {
      console.log(`  ${r.code} ${r.name}: ${r.error}`);
    }
    if (errorStocks.length > 5) {
      console.log(`  ... 还有 ${errorStocks.length - 5} 只`);
    }
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(`⏱️ 耗时: ${duration}秒`);
  
  // 发送邮件（如果有信号）
  await sendEmail(results);
  
  // 保存结果到Excel
  const outputDir = path.join(__dirname, '../scan-results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const today = new Date().toISOString().split('T')[0];
  const outputPath = path.join(outputDir, `daily_signals_${today}.xlsx`);
  
  const worksheetData = [
    ['代码', '名称', '市场', '日期', '最新价', '信号', '信号类型', 'BIAS225分位', 'CRI', '贪婪指数', '星标', '错误'],
    ...results.map(r => [
      r.code,
      r.name,
      r.market,
      r.date,
      r.close,
      r.signals.join(', '),
      r.signalType || '',
      r.bias225Pct,
      r.cri,
      r.greedy,
      r.star ? '★' : '',
      r.error || '',
    ]),
  ];
  
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Signals');
  XLSX.writeFile(workbook, outputPath);
  
  console.log(`📁 结果已保存: ${outputPath}`);
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { scanAllStocks, sendEmail };
