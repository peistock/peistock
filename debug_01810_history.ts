async function debug01810() {
  const symbol = '01810';
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
  
  // PVT
  const pvt: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) pvt.push(volume[i]);
    else {
      const change = close[i-1] !== 0 ? (close[i] - close[i-1]) / close[i-1] : 0;
      pvt.push(pvt[i-1] + volume[i] * change);
    }
  }
  
  // 计算每天的分位数
  function getBiasPercentile(idx: number) {
    if (idx < 225) return null;
    const bias225History: number[] = [];
    for (let i = 225; i <= idx; i++) {
      const m = close.slice(i-225, i).reduce((a, b) => a + b, 0) / 225;
      bias225History.push(((close[i] - m) / m) * 100);
    }
    const currentBias = bias225History[bias225History.length-1];
    const sorted = [...bias225History].sort((a, b) => a - b);
    const lessThan = sorted.filter(v => v < currentBias).length;
    return (lessThan / sorted.length) * 100;
  }
  
  // 检查历史底背离日的指标
  const bottomDays = [
    { date: '2024-07-25', idx: -1 },
    { date: '2024-09-04', idx: -1 },
    { date: '2024-11-14', idx: -1 },
    { date: '2025-04-29', idx: -1 },
    { date: '2025-10-08', idx: -1 },
    { date: '2025-11-14', idx: -1 },
  ];
  
  for (let d of bottomDays) {
    d.idx = klines.findIndex((k: any) => k[0] === d.date);
  }
  
  console.log('历史底背离日指标检查:');
  console.log('日期        | 收盘价 | BIAS225 | 分位数 | CRI估算');
  console.log('-----------|--------|---------|--------|--------');
  
  for (let d of bottomDays) {
    if (d.idx < 0 || d.idx < 225) continue;
    
    const price = close[d.idx];
    const ma225 = close.slice(d.idx-225, d.idx).reduce((a, b) => a + b, 0) / 225;
    const bias = ((price - ma225) / ma225) * 100;
    const biasPct = getBiasPercentile(d.idx);
    
    const ma20 = close.slice(d.idx-20, d.idx).reduce((a, b) => a + b, 0) / 20;
    const deviation = ((price - ma20) / ma20) * 100;
    const cri = Math.max(0, -deviation);
    
    console.log(`${d.date} | ${price.toFixed(2).padStart(6)} | ${bias.toFixed(1).padStart(7)}% | ${biasPct?.toFixed(1).padStart(6)}% | ${cri.toFixed(1)}`);
  }
  
  // 最新的情况
  console.log('\n最新日期指标:');
  const lastIdx = n - 1;
  const lastPrice = close[lastIdx];
  const lastMA225 = close.slice(lastIdx-225, lastIdx).reduce((a, b) => a + b, 0) / 225;
  const lastBias = ((lastPrice - lastMA225) / lastMA225) * 100;
  const lastBiasPct = getBiasPercentile(lastIdx);
  
  const lastMA20 = close.slice(lastIdx-20, lastIdx).reduce((a, b) => a + b, 0) / 20;
  const lastDeviation = ((lastPrice - lastMA20) / lastMA20) * 100;
  const lastCri = Math.max(0, -lastDeviation);
  
  console.log(`${klines[lastIdx][0]} | ${lastPrice.toFixed(2).padStart(6)} | ${lastBias.toFixed(1).padStart(7)}% | ${lastBiasPct?.toFixed(1).padStart(6)}% | ${lastCri.toFixed(1)}`);
  
  console.log('\nB(恐慌)需要: BIAS分位<5% + CRI>90');
  console.log(`当前: BIAS分位=${lastBiasPct?.toFixed(1)}% ${lastBiasPct && lastBiasPct < 5 ? '✅' : '❌'}, CRI=${lastCri.toFixed(1)} ${lastCri > 90 ? '✅' : '❌'}`);
}

debug01810();
