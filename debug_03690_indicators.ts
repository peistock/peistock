async function debug03690() {
  const symbol = '03690';
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=hk${symbol},day,,,400,qfq`;
  
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json', 'Referer': 'https://stock.qq.com' },
  });
  
  const result = await response.json();
  const klines = result.data[`hk${symbol}`].day || [];
  
  const close = klines.map((k: any) => parseFloat(k[2]));
  const high = klines.map((k: any) => parseFloat(k[4]));
  const low = klines.map((k: any) => parseFloat(k[3]));
  const volume = klines.map((k: any) => parseFloat(k[5]));
  const n = close.length;
  
  console.log(`股票: ${symbol} (美团-W)`);
  console.log(`最新日期: ${klines[n-1][0]}, 收盘价: ${close[n-1]}`);
  
  // 计算MA225和BIAS225
  const ma225 = close.slice(-225).reduce((a: number, b: number) => a + b, 0) / 225;
  const bias225 = ((close[n-1] - ma225) / ma225) * 100;
  console.log(`\nMA225: ${ma225.toFixed(2)}`);
  console.log(`BIAS225: ${bias225.toFixed(2)}%`);
  
  // 计算BIAS225历史分位数
  const bias225History: number[] = [];
  for (let i = 225; i < n; i++) {
    const m = close.slice(i-225, i).reduce((a: number, b: number) => a + b, 0) / 225;
    bias225History.push(((close[i] - m) / m) * 100);
  }
  const sortedBias = [...bias225History].sort((a, b) => a - b);
  const lessThan = sortedBias.filter(v => v < bias225).length;
  const biasPercentile = (lessThan / sortedBias.length) * 100;
  console.log(`BIAS225分位数: ${biasPercentile.toFixed(2)}%`);
  
  // PVT
  const pvt: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) pvt.push(volume[i]);
    else {
      const change = close[i-1] !== 0 ? (close[i] - close[i-1]) / close[i-1] : 0;
      pvt.push(pvt[i-1] + volume[i] * change);
    }
  }
  
  // 检测最近5天的背离
  console.log('\n近5天PVT背离检测:');
  for (let i = n-5; i < n; i++) {
    const priceWindow = close.slice(Math.max(0, i-4), i+1);
    const pvtWindow = pvt.slice(Math.max(0, i-4), i+1);
    const priceMin = Math.min(...priceWindow);
    const pvtTrendDown = pvt[i] < pvtWindow[0];
    
    let div = '无';
    if (close[i] === priceMin && !pvtTrendDown) div = '🟢 底背离';
    if (close[i] === Math.max(...priceWindow) && !pvtTrendUp(pvtWindow)) div = '🔴 顶背离';
    
    console.log(`  ${klines[i][0]}: 收${close[i].toFixed(2)}, ${div}`);
  }
  
  // B(恐慌)条件检查: 成本偏离<5% + BIAS<5% + CRI>90
  console.log('\nB(恐慌)条件检查:');
  console.log(`  BIAS225分位数 < 5% ? ${biasPercentile.toFixed(2)}% ${biasPercentile < 5 ? '✅' : '❌'}`);
  
  // 简化CRI计算
  const ma20 = close.slice(n-20, n).reduce((a: number, b: number) => a + b, 0) / 20;
  const deviation = ((close[n-1] - ma20) / ma20) * 100;
  const criBasis = Math.max(0, -deviation);
  console.log(`  CRI(简化) ≈ ${criBasis.toFixed(2)}`);
  console.log(`  CRI > 90 ? ${criBasis > 90 ? '✅' : '❌'}`);
}

function pvtTrendUp(window: number[]) {
  return window[window.length - 1] > window[0];
}

debug03690();
