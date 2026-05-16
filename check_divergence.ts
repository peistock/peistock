import { calculateAllIndicators } from './src/utils/indicators';

async function getKlines(symbol: string, market: string) {
  const tencentSymbol = market === 'HK' ? `hk${symbol}` : (symbol.startsWith('6') ? `sh${symbol}` : `sz${symbol}`);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentSymbol},day,,,300,qfq`;
  const response = await fetch(url, { headers: { 'Referer': 'https://stock.qq.com' }});
  const result = await response.json();
  const klines = result.data?.[tencentSymbol]?.qfqday || [];
  return klines.map((k: string[]) => ({
    date: k[0], open: parseFloat(k[1]), close: parseFloat(k[2]),
    low: parseFloat(k[3]), high: parseFloat(k[4]), volume: parseInt(k[5]), amount: 0
  }));
}

async function check() {
  const stocks = [
    { code: '601117', market: 'SH', name: '中国化学' },
    { code: '603986', market: 'SH', name: '兆易创新' },
    { code: '600989', market: 'SH', name: '宝丰能源' },
  ];
  
  for (const s of stocks) {
    try {
      const data = await getKlines(s.code, s.market);
      if (data.length < 225) continue;
      const indicators = calculateAllIndicators(data, 1e9, 'shares');
      const last5 = indicators.slice(-5);
      
      console.log(`\n${s.name}:`);
      console.log('  日期      价格    PVT背离      BIAS    成本偏离  CRI');
      last5.forEach(i => {
        console.log(`  ${i.date} ${i.close.toFixed(2).padStart(7)} ${(i.pvtDivergence||'none').padStart(10)} ${(i.bias225Percentile?.toFixed(1)+'%').padStart(7)} ${(i.costDeviationPercentile?.toFixed(1)+'%').padStart(8)} ${i.cri?.toFixed(1)}`);
      });
      
      const topDiv = last5.filter(i => i.pvtDivergence === 'top').length;
      console.log(`  顶背离天数: ${topDiv}`);
    } catch (e) {
      console.log(`${s.name}: 错误`);
    }
  }
}
check();
