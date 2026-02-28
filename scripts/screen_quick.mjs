import fetch from 'node-fetch';

const STOCKS = [
  { symbol: '600519', name: '贵州茅台' },
  { symbol: '000858', name: '五粮液' },
  { symbol: '600900', name: '长江电力' },
  { symbol: '601012', name: '隆基绿能' },
  { symbol: '002460', name: '赣锋锂业' },
  { symbol: '300750', name: '宁德时代' },
  { symbol: '601398', name: '工商银行' },
  { symbol: '000001', name: '平安银行' },
  { symbol: '601318', name: '中国平安' },
  { symbol: '600036', name: '招商银行' },
  { symbol: '000002', name: '万科A' },
  { symbol: '600048', name: '保利发展' },
  { symbol: '601888', name: '中国中免' },
  { symbol: '000568', name: '泸州老窖' },
  { symbol: '600809', name: '山西汾酒' },
];

async function getData(symbol) {
  const isSh = symbol.startsWith('6');
  const secid = isSh ? `1.${symbol}` : `0.${symbol}`;
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&lmt=252&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.data?.klines) return null;
    
    const klines = data.data.klines.map(l => {
      const p = l.split(',');
      return { close: +p[2], open: +p[1], high: +p[4], low: +p[3] };
    });
    
    // 计算MA99
    const ma99 = klines.map((_, i) => {
      if (i < 98) return null;
      let sum = 0;
      for (let j = 0; j < 99; j++) sum += klines[i-j].close;
      return sum / 99;
    });
    
    const last = klines[klines.length - 1];
    const lastMA = ma99[ma99.length - 1];
    const costDev = last.close - (lastMA || last.close);
    
    // 成本偏离度历史百分位
    const validDev = ma99.map((ma, i) => ma ? klines[i].close - ma : null).filter(v => v !== null);
    const sorted = [...validDev].sort((a, b) => a - b);
    const rank = sorted.filter(v => v <= costDev).length;
    const percentile = (rank / sorted.length) * 100;
    
    // 简化CRI
    let cri = 0;
    if (costDev < 0) cri += Math.min(Math.abs(costDev) / (lastMA || 1) * 200, 40);
    const volatility = (last.high - last.low) / last.low * 100;
    cri += Math.min(volatility * 3, 30);
    const gap = (last.open - klines[klines.length-2].close) / klines[klines.length-2].close * 100;
    if (gap < -2) cri += 20;
    cri = Math.min(cri, 100);
    
    return { cri, costDevPercentile: percentile, price: last.close };
  } catch (e) {
    return null;
  }
}

console.log('A股筛选：成本偏离度≥80%分位 且 CRI≥90\n');
console.log('='.repeat(60));

const results = [];
for (const s of STOCKS) {
  const data = await getData(s.symbol);
  await new Promise(r => setTimeout(r, 300));
  
  if (!data) {
    console.log(`${s.symbol} ${s.name} - 数据获取失败`);
    continue;
  }
  
  const c1 = data.costDevPercentile >= 80 ? '✓' : '✗';
  const c2 = data.cri >= 90 ? '✓' : '✗';
  const both = data.costDevPercentile >= 80 && data.cri >= 90 ? '✓✓ 满足!' : '';
  
  console.log(`${s.symbol} ${s.name.padEnd(8)} CRI:${data.cri.toFixed(1).padStart(5)} 偏离分位:${data.costDevPercentile.toFixed(1).padStart(5)}% 条件1:${c1} 条件2:${c2} ${both}`);
  
  if (data.costDevPercentile >= 80 && data.cri >= 90) {
    results.push({ 代码: s.symbol, 名称: s.name, CRI: data.cri.toFixed(1), 成本偏离分位: data.costDevPercentile.toFixed(1)+'%', 价格: data.price.toFixed(2) });
  }
}

console.log('='.repeat(60));
console.log(`\n满足条件的股票: ${results.length}只`);
if (results.length > 0) {
  console.table(results);
} else {
  console.log('\n当前市场没有股票同时满足两个极端条件。');
}
