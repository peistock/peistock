/**
 * 每日关注列表信号扫描（与前端逻辑一致版）
 * 使用完整的指标计算，确保信号与 StockChart 完全一致
 * 
 * 使用方法:
 * npx tsx scripts/daily-watchlist-scan.ts
 * 
 * 定时任务:
 * 0 12 * * 1-5 cd /path/to/app && npx tsx scripts/daily-watchlist-scan.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import XLSX from 'xlsx';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { getUniqueWatchlist } from '../src/data/watchlist';
import { calculateAllIndicators, IndicatorData } from '../src/utils/indicators';
import { getQuote as getTencentQuote } from '../src/utils/tencentApi';
import { getQuote as getEastmoneyQuote } from '../src/utils/eastmoneyApi';
import { detectSignalsFrontend, detectSignals, FrontendSignalResult } from '../src/utils/signals';

dotenv.config();

// ============ 配置 ============
const USE_OPENCLAW_QQ = process.env.USE_OPENCLAW_QQ === 'true';
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:18789';
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

const QQ_BOT_API = process.env.QQ_BOT_API || '';
const QQ_TARGET_ID = process.env.QQ_TARGET_ID || '';
const QQ_TARGET_TYPE = process.env.QQ_TARGET_TYPE || 'group';
const QQ_BOT_TYPE = process.env.QQ_BOT_TYPE || 'gocqhttp';

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

interface ScanResult {
  code: string;
  name: string;
  market: string;
  date: string;
  close: number;
  signals: string[];
  signalType: 'B' | 'S' | null;
  // 严格信号（雪球大V同款，邮件过滤用）
  strictSignals: string[];
  strictSignalType: 'B' | 'S' | null;
  // 市场状态（前端同步）
  marketState: 'panic' | 'trend_down' | 'overbought' | 'normal';
  stateTitle: string;
  stateDesc: string;
  displayBuySignals: string[];
  displaySellSignals: string[];
  // 详细指标
  bias225Pct: number | null;
  costDevPct: number | null;
  cri: number | null;
  criPercentile: number | null;
  greedy: number | null;
  greedyPercentile: number | null;
  error?: string;
  star?: boolean;
}

// ============ 工具函数 ============
function formatSymbol(symbol: string, market: string): string {
  const clean = symbol.replace(/[^0-9a-zA-Z]/g, '');
  if (market === 'HK') return `hk${clean}`;
  if (market === 'US') return clean;
  if (market === 'SH' || clean.startsWith('6') || clean.startsWith('5')) return `sh${clean}`;
  return `sz${clean}`;
}

async function getKlines(symbol: string, market: string): Promise<StockData[]> {
  const tencentSymbol = formatSymbol(symbol, market);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentSymbol},day,,,500,qfq`;
  
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json', 'Referer': 'https://stock.qq.com' },
  });
  
  if (!response.ok) throw new Error(`API失败: ${response.status}`);
  
  const result = await response.json();
  if (result.code !== 0 || !result.data?.[tencentSymbol]) {
    throw new Error('无数据');
  }
  
  const klines = result.data[tencentSymbol].qfqday || result.data[tencentSymbol].day || [];
  if (!klines.length) throw new Error('无K线');
  
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

async function getQuoteWithCapital(symbol: string, market: string): Promise<number> {
  // 尝试腾讯 API 获取流通股本
  try {
    const quote = await getTencentQuote(symbol);
    if (quote.capital > 0) return quote.capital;
  } catch (e) {
    // 腾讯失败，尝试东方财富
  }
  
  // 备用：东方财富
  try {
    const quote = await getEastmoneyQuote(symbol);
    if (quote.capital > 0) return quote.capital;
  } catch (e) {
    throw new Error('无法获取流通股本');
  }
  
  return 0;
}

// ============ 扫描股票 ============

async function scanStock(stock: any): Promise<ScanResult> {
  try {
    // 1. 获取 K 线数据
    const data = await getKlines(stock.code, stock.market);
    if (data.length < 225) {
      return {
        code: stock.code, name: stock.name, market: stock.market,
        date: '', close: 0, signals: [], signalType: null,
        strictSignals: [], strictSignalType: null,
        marketState: 'normal', stateTitle: '', stateDesc: '',
        displayBuySignals: [], displaySellSignals: [],
        bias225Pct: null, costDevPct: null, cri: null, criPercentile: null,
        greedy: null, greedyPercentile: null,
        star: stock.star, error: '数据不足(需要225天以上)'
      };
    }

    // 2. 获取流通股本
    const capital = await getQuoteWithCapital(stock.code, stock.market);
    if (!capital || capital <= 0) {
      return {
        code: stock.code, name: stock.name, market: stock.market,
        date: '', close: 0, signals: [], signalType: null,
        marketState: 'normal', stateTitle: '', stateDesc: '',
        displayBuySignals: [], displaySellSignals: [],
        bias225Pct: null, costDevPct: null, cri: null, criPercentile: null,
        greedy: null, greedyPercentile: null,
        star: stock.star, error: '无法获取流通股本'
      };
    }

    // 3. 计算完整指标（复用前端逻辑）
    const indicators = calculateAllIndicators(data, capital, 'shares');
    const current = indicators[indicators.length - 1];
    const currentData = data[data.length - 1];

    // 4. 检测信号（使用前端同款逻辑）
    const prev = indicators.length >= 2 ? indicators[indicators.length - 2] : undefined;
    const signalResult = detectSignalsFrontend(current, prev);

    // 4b. 严格信号检测（雪球大V同款，邮件过滤用）
    const recentDays = 10;
    const recentDivergences = indicators.slice(-recentDays).map(i => i.pvtDivergence);
    const recentCRI = indicators.slice(-recentDays).map(i => i.cri);
    const recentCostDev = indicators.slice(-recentDays).map(i => i.costDeviationPercentile);

    // DI 数据用于 B(恐慌)/S(贪婪) 的拐点判断（与前端 K 线一致）
    const prev2 = indicators.length >= 3 ? indicators[indicators.length - 3] : undefined;
    const next1 = current; // 当前就是"当天"

    const strictResult = detectSignals({
      costDeviationPercentile: current.costDeviationPercentile,
      bias225Percentile: current.bias225Percentile,
      cri: current.cri,
      greedyPercentile: current.greedyPercentile,
      pvtDivergence: current.pvtDivergence,
      recentDivergences,
      recentCRI,
      recentCostDev,
      plusDI: current.plusDI,
      minusDI: current.minusDI,
      prevPlusDI: prev?.plusDI ?? null,
      prevMinusDI: prev?.minusDI ?? null,
      nextPlusDI: next1.plusDI ?? null,
      nextMinusDI: next1.minusDI ?? null,
    }, true);

    // 确定 signalType（B/S）用于分类
    let signalType: 'B' | 'S' | null = null;
    if (signalResult.buySignals.length > 0 && signalResult.sellSignals.length === 0) {
      signalType = 'B';
    } else if (signalResult.sellSignals.length > 0 && signalResult.buySignals.length === 0) {
      signalType = 'S';
    } else if (signalResult.sellSignals.length > 0) {
      // 买卖信号同时存在，风险优先
      signalType = 'S';
    }

    return {
      code: stock.code,
      name: stock.name,
      market: stock.market,
      date: currentData.date,
      close: currentData.close,
      signals: [...signalResult.buySignals, ...signalResult.sellSignals],
      signalType,
      strictSignals: strictResult.signals,
      strictSignalType: strictResult.signalType,
      marketState: signalResult.marketState,
      stateTitle: signalResult.stateTitle,
      stateDesc: signalResult.stateDesc,
      displayBuySignals: signalResult.displayBuySignals,
      displaySellSignals: signalResult.displaySellSignals,
      bias225Pct: current.bias225Percentile,
      costDevPct: current.costDeviationPercentile,
      cri: current.cri,
      criPercentile: current.criPercentile,
      greedy: current.greedy,
      greedyPercentile: current.greedyPercentile,
      star: stock.star
    };
  } catch (error) {
    return {
      code: stock.code, name: stock.name, market: stock.market,
      date: '', close: 0, signals: [], signalType: null,
      strictSignals: [], strictSignalType: null,
      marketState: 'normal', stateTitle: '', stateDesc: '',
      displayBuySignals: [], displaySellSignals: [],
      bias225Pct: null, costDevPct: null, cri: null, criPercentile: null,
      greedy: null, greedyPercentile: null,
      star: stock.star, error: String(error)
    };
  }
}

// ============ 邮件发送 ============

async function sendEmail(results: ScanResult[]) {
  const emailTo = process.env.EMAIL_TO;
  if (!emailTo) {
    console.log('ℹ️  未设置 EMAIL_TO，跳过邮件');
    return;
  }

  // 只发送严格B/S信号的股票
  const signalStocks = results.filter(r => r.strictSignalType !== null);
  const today = new Date().toISOString().split('T')[0];

  let html = `
    <h2>📊 股票信号报告 ${today}</h2>
    <p>共扫描 ${results.length} 只，发现 ${signalStocks.length} 只信号股</p>
    <hr>
  `;

  const bSignals = signalStocks.filter(r => r.strictSignalType === 'B');
  const sSignals = signalStocks.filter(r => r.strictSignalType === 'S');

  if (bSignals.length > 0) {
    html += `<h3>🟢 买入信号 (${bSignals.length}只)</h3>
      <table border="1" cellpadding="6" style="border-collapse: collapse; font-size: 14px;">
        <tr style="background: #e8f5e9;"><th>代码</th><th>名称</th><th>价格</th><th>信号</th><th>BIAS</th><th>成本偏离</th><th>CRI</th></tr>`;
    for (const r of bSignals) {
      html += `<tr>
        <td>${r.code}</td>
        <td>${r.name}${r.star ? '⭐' : ''}</td>
        <td>${r.close.toFixed(2)}</td>
        <td style="color:green;">${r.strictSignals.join(' | ')}</td>
        <td>${r.bias225Pct?.toFixed(1) ?? '-'}%</td>
        <td>${r.costDevPct?.toFixed(1) ?? '-'}%</td>
        <td>${r.cri?.toFixed(1) ?? '-'}</td>
      </tr>`;
    }
    html += '</table><br>';
  }

  if (sSignals.length > 0) {
    html += `<h3>🔴 卖出信号 (${sSignals.length}只)</h3>
      <table border="1" cellpadding="6" style="border-collapse: collapse; font-size: 14px;">
        <tr style="background: #ffebee;"><th>代码</th><th>名称</th><th>价格</th><th>信号</th><th>BIAS</th><th>成本偏离</th><th>贪婪</th></tr>`;
    for (const r of sSignals) {
      html += `<tr>
        <td>${r.code}</td>
        <td>${r.name}${r.star ? '⭐' : ''}</td>
        <td>${r.close.toFixed(2)}</td>
        <td style="color:red;">${r.strictSignals.join(' | ')}</td>
        <td>${r.bias225Pct?.toFixed(1) ?? '-'}%</td>
        <td>${r.costDevPct?.toFixed(1) ?? '-'}%</td>
        <td>${r.greedy?.toFixed(1) ?? '-'}</td>
      </tr>`;
    }
    html += '</table>';
  }

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.qq.com',
    port: parseInt(process.env.EMAIL_PORT || '465'),
    secure: true,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  try {
    await transporter.sendMail({
      from: `"信号扫描" <${process.env.EMAIL_USER}>`,
      to: emailTo,
      subject: `📊 股票信号 ${today} - ${signalStocks.length}只`,
      html
    });
    console.log(`✉️  邮件已发送至: ${emailTo}`);
  } catch (e) {
    console.error('❌ 邮件发送失败:', e);
  }
}

// ============ QQ Bot 发送（简化版）============

async function sendToQQBot(results: ScanResult[]) {
  if (USE_OPENCLAW_QQ) {
    console.log('ℹ️  OpenClaw QQ 已禁用，跳过发送');
    return;
  }
  
  if (!QQ_BOT_API || !QQ_TARGET_ID) {
    console.log('ℹ️  未配置 QQ_BOT_API 或 QQ_TARGET_ID，跳过 QQ 发送');
    return;
  }
  
  // 传统 QQ Bot 逻辑（保持原样）
  console.log('ℹ️  传统 QQ Bot 未实现');
}

// ============ CSV 股票列表加载 ============

function parseStockCode(rawCode: string): { code: string; market: string } | null {
  const clean = rawCode.trim().toUpperCase();
  // A股：SHxxxxxx / SZxxxxxx / BJxxxxxx
  if (clean.startsWith('SH') || clean.startsWith('SZ') || clean.startsWith('BJ')) {
    return { code: clean.slice(2), market: clean.slice(0, 2) };
  }
  // 港股：纯数字5-6位
  if (/^\d{5,6}$/.test(clean)) {
    return { code: clean, market: 'HK' };
  }
  // 美股或其他：跳过（腾讯API不支持）
  return null;
}

function loadStocksFromCSV(csvPath: string): { code: string; name: string; market: string }[] {
  const stocks: { code: string; name: string; market: string }[] = [];
  const seen = new Set<string>();

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV文件不存在: ${csvPath}`);
    return stocks;
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');

  // 跳过表头
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // 处理CSV中的逗号（简单分割，该CSV没有引号包裹的逗号）
    const cols = line.split(',');
    if (cols.length < 4) continue;

    const rawCode = cols[2].trim();
    const name = cols[3].trim();
    const parsed = parseStockCode(rawCode);

    if (parsed && !seen.has(parsed.code)) {
      seen.add(parsed.code);
      stocks.push({ code: parsed.code, name, market: parsed.market });
    }
  }

  console.log(`📋 从CSV加载 ${stocks.length} 只股票`);
  return stocks;
}

// ============ 主程序 ============

async function main() {
  const args = process.argv.slice(2);
  let stocks: { code: string; name: string; market: string }[] = [];

  if (args.length > 0 && args[0].endsWith('.csv')) {
    const csvPath = path.resolve(args[0]);
    console.log('\n📊 每日股票信号扫描 (CSV模式)\n' + '='.repeat(40));
    console.log(`📄 数据源: ${csvPath}\n`);
    stocks = loadStocksFromCSV(csvPath);
  } else {
    console.log('\n📊 每日股票信号扫描\n' + '='.repeat(40));
    stocks = getUniqueWatchlist();
  }
  console.log(`📋 加载 ${stocks.length} 只股票\n`);
  
  const startTime = Date.now();
  const results: ScanResult[] = [];
  
  // 批量扫描（每批3只）
  for (let i = 0; i < stocks.length; i += 3) {
    const batch = stocks.slice(i, i + 3);
    const batchResults = await Promise.all(batch.map(s => scanStock(s)));
    results.push(...batchResults);
    
    const signalCount = results.filter(r => r.strictSignalType !== null).length;
    process.stdout.write(`\r⏳ 进度: ${Math.min(i + 3, stocks.length)}/${stocks.length} | 严格信号: ${signalCount}`);
    
    if (i + 3 < stocks.length) await new Promise(r => setTimeout(r, 300));
  }
  
  console.log('\n');
  
  // 显示结果（只显示严格B/S信号）
  const signalStocks = results.filter(r => r.strictSignalType !== null);
  const bSignals = signalStocks.filter(r => r.strictSignalType === 'B');
  const sSignals = signalStocks.filter(r => r.strictSignalType === 'S');
  const errorStocks = results.filter(r => r.error);

  console.log('='.repeat(40));
  console.log(`✅ 扫描完成: ${results.length} 只`);
  console.log(`🎯 信号股票: ${signalStocks.length} 只`);
  console.log(`   🟢 买入: ${bSignals.length} 只`);
  console.log(`   🔴 卖出: ${sSignals.length} 只`);
  if (errorStocks.length > 0) {
    console.log(`   ⚠️  失败: ${errorStocks.length} 只`);
  }
  console.log('='.repeat(40));

  if (signalStocks.length > 0) {
    console.log('\n📌 信号详情:\n');
    
    if (bSignals.length > 0) {
      console.log('🟢 买入信号:');
      for (const r of bSignals) {
        const starMark = r.star ? '⭐' : '';
        console.log(`   ${r.code} ${r.name}${starMark} [${r.market}] ¥${r.close.toFixed(2)} | ${r.strictSignals.join(' | ')} BIAS:${r.bias225Pct?.toFixed(1)}% 成本:${r.costDevPct?.toFixed(1)}% CRI:${r.cri?.toFixed(1)}`);
      }
    }

    if (sSignals.length > 0) {
      console.log('\n🔴 卖出信号:');
      for (const r of sSignals) {
        const starMark = r.star ? '⭐' : '';
        console.log(`   ${r.code} ${r.name}${starMark} [${r.market}] ¥${r.close.toFixed(2)} | ${r.strictSignals.join(' | ')} BIAS:${r.bias225Pct?.toFixed(1)}% 成本:${r.costDevPct?.toFixed(1)}% 贪婪:${r.greedy?.toFixed(1)}`);
      }
    }
  }

  if (errorStocks.length > 0) {
    console.log(`\n⚠️  失败 ${errorStocks.length} 只 (前5):`);
    for (const r of errorStocks.slice(0, 5)) {
      console.log(`   ${r.code} ${r.name}: ${r.error}`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⏱️  耗时: ${duration}秒`);

  // 发送通知
  await sendEmail(results);
  await sendToQQBot(results);
  
  // 保存Excel
  const outDir = path.join(process.cwd(), 'daily-results');
  fs.mkdirSync(outDir, { recursive: true });
  
  const today = new Date().toISOString().split('T')[0];
  const ws = XLSX.utils.aoa_to_sheet([
    ['代码', '名称', '市场', '日期', '最新价', '状态', '信号', '类型', 'BIAS225%', '成本偏离%', 'CRI', 'CRI分位', '贪婪', '贪婪分位', '星标'],
    ...results.filter(r => r.strictSignalType !== null).map(r => [
      r.code, r.name, r.market, r.date, r.close,
      r.stateTitle,
      [...r.displayBuySignals, ...r.displaySellSignals].join(' | ') || r.signals.join(','), r.signalType,
      r.bias225Pct, r.costDevPct, r.cri, r.criPercentile,
      r.greedy, r.greedyPercentile,
      r.star ? '★' : ''
    ])
  ]);
  
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Signals');
  XLSX.writeFile(wb, path.join(outDir, `signals_${today}.xlsx`));
  
  console.log(`📁 结果已保存: daily-results/signals_${today}.xlsx`);
}

main().catch(console.error);
