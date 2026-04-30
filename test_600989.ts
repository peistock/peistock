import { calculateAllIndicators } from './src/utils/indicators';
import { detectSignalsFrontend, detectSignals } from './src/utils/signals';

async function getKlines(symbol: string, market: string) {
  const clean = symbol.replace(/[^0-9a-zA-Z]/g, '');
  let tencentSymbol = clean;
  if (market === 'HK') tencentSymbol = `hk${clean}`;
  else if (market === 'SH' || clean.startsWith('6') || clean.startsWith('5')) tencentSymbol = `sh${clean}`;
  else tencentSymbol = `sz${clean}`;
  
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentSymbol},day,,,500,qfq`;
  const response = await fetch(url, { headers: { 'Accept': 'application/json', 'Referer': 'https://stock.qq.com' } });
  const result = await response.json();
  const klines = result.data?.[tencentSymbol]?.qfqday || result.data?.[tencentSymbol]?.day || [];
  return klines.map((k: string[]) => ({
    date: k[0], open: parseFloat(k[1]), close: parseFloat(k[2]),
    low: parseFloat(k[3]), high: parseFloat(k[4]), volume: parseInt(k[5]), amount: parseFloat(k[6]) || 0,
  }));
}

async function test() {
  const data = await getKlines('600989', 'SH');
  if (!data || data.length === 0) { console.log('No data'); return; }
  const indicators = calculateAllIndicators(data, 1, 'shares');
  const last = indicators[indicators.length - 1];
  const prev = indicators[indicators.length - 2];
  
  console.log('=== 600989 宝丰能源 ===');
  console.log('日期:', last.date, '收盘价:', last.close);
  console.log('成本偏离度分位:', last.costDeviationPercentile?.toFixed(2));
  console.log('BIAS225分位:', last.bias225Percentile?.toFixed(2));
  console.log('CRI:', last.cri?.toFixed(2));
  console.log('贪婪分位:', last.greedyPercentile?.toFixed(2));
  console.log('PVT背离:', last.pvtDivergence);
  console.log('');

  const recentDivergences = indicators.slice(-10).map(i => i.pvtDivergence);
  console.log('最近10天背离:', recentDivergences);
  console.log('');

  const strict = detectSignals({
    costDeviationPercentile: last.costDeviationPercentile,
    bias225Percentile: last.bias225Percentile,
    cri: last.cri,
    greedyPercentile: last.greedyPercentile,
    pvtDivergence: last.pvtDivergence,
    recentDivergences,
    recentCRI: indicators.slice(-10).map(i => i.cri),
    recentCostDev: indicators.slice(-10).map(i => i.costDeviationPercentile),
  }, true);
  console.log('严格信号:', strict);
  console.log('');

  const frontend = detectSignalsFrontend(last, prev);
  console.log('前端 buySignals:', frontend.buySignals);
  console.log('前端 sellSignals:', frontend.sellSignals);
}
test();
