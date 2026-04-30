/**
 * 快速测试 - 扫描前10只股票
 */

import { getUniqueWatchlist } from '../src/data/watchlist';

// 指标计算函数
function calculateBias225(data: any[]) {
  if (data.length < 225) return null;
  const closes = data.map(d => d.close);
  const ma225 = closes.slice(-225).reduce((a, b) => a + b, 0) / 225;
  const bias225 = ((closes[closes.length - 1] - ma225) / ma225) * 100;
  
  const historyBias: number[] = [];
  for (let i = data.length - 200; i < data.length; i++) {
    if (i >= 225) {
      const ma = closes.slice(i - 225, i).reduce((a, b) => a + b, 0) / 225;
      historyBias.push(((closes[i] - ma) / ma) * 100);
    }
  }
  
  const sorted = [...historyBias].sort((a, b) => a - b);
  const rank = sorted.findIndex(v => v >= bias225);
  return { percentile: rank === -1 ? 100 : (rank / sorted.length) * 100 };
}

function calculateCRI(data: any[]) {
  const closes = data.map(d => d.close);
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const deviation = ((closes[closes.length - 1] - ma20) / ma20) * 100;
  return Math.min(100, Math.max(0, -deviation) * 5);
}

async function getKlines(symbol: string, market: string) {
  const clean = symbol.replace(/[^0-9a-zA-Z]/g, '');
  let tencentSymbol = clean;
  if (market === 'HK') tencentSymbol = `hk${clean}`;
  else if (market === 'SH' || clean.startsWith('6') || clean.startsWith('5')) tencentSymbol = `sh${clean}`;
  else tencentSymbol = `sz${clean}`;
  
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentSymbol},day,,,300,qfq`;
  const response = await fetch(url, { headers: { 'Accept': 'application/json', 'Referer': 'https://stock.qq.com' } });
  const result = await response.json();
  
  if (result.code !== 0 || !result.data?.[tencentSymbol]) throw new Error('无数据');
  
  const klines = result.data[tencentSymbol].qfqday || result.data[tencentSymbol].day || [];
  return klines.map((k: string[]) => ({
    date: k[0], open: parseFloat(k[1]), close: parseFloat(k[2]),
    low: parseFloat(k[3]), high: parseFloat(k[4]), volume: parseInt(k[5])
  }));
}

async function scanStock(stock: any) {
  try {
    const data = await getKlines(stock.code, stock.market);
    if (data.length < 225) return { ...stock, signals: [], error: '数据不足' };
    
    const bias225 = calculateBias225(data);
    const cri = calculateCRI(data);
    const current = data[data.length - 1];
    
    const signals: string[] = [];
    if (bias225) {
      if (bias225.percentile < 10) signals.push('B(低估)');
      if (bias225.percentile < 5 && cri > 50) signals.push('B(恐慌)');
      if (bias225.percentile > 90) signals.push('S(高估)');
    }
    
    return {
      ...stock,
      date: current.date,
      close: current.close,
      signals,
      bias225Pct: bias225?.percentile ?? null,
      cri,
      error: null
    };
  } catch (e) {
    return { ...stock, signals: [], error: String(e) };
  }
}

async function main() {
  const allStocks = getUniqueWatchlist();
  console.log(`共 ${allStocks.length} 只股票，测试前10只:\n`);
  
  for (let i = 0; i < Math.min(10, allStocks.length); i++) {
    const stock = allStocks[i];
    process.stdout.write(`扫描 ${stock.code} ${stock.name}... `);
    
    try {
      const result = await scanStock(stock);
      if (result.signals.length > 0) {
        console.log(`✅ 信号: ${result.signals.join(', ')} BIAS:${result.bias225Pct?.toFixed(1)}%`);
      } else if (result.error) {
        console.log(`❌ ${result.error}`);
      } else {
        console.log(`- 无信号 BIAS:${result.bias225Pct?.toFixed(1)}%`);
      }
    } catch (e) {
      console.log(`❌ 错误`);
    }
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log('\n测试完成!');
}

main();
