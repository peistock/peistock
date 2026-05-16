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
  
  console.log(`股票: ${symbol} (小米集团-W)`);
  console.log(`数据范围: ${klines[0][0]} 到 ${klines[n-1][0]}`);
  console.log(`最新收盘价: ${close[n-1]}`);
  
  // PVT
  const pvt: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) pvt.push(volume[i]);
    else {
      const change = close[i-1] !== 0 ? (close[i] - close[i-1]) / close[i-1] : 0;
      pvt.push(pvt[i-1] + volume[i] * change);
    }
  }
  
  // 检测所有底背离
  console.log('\n=== 所有底背离记录 ===');
  let bottomCount = 0;
  for (let i = 4; i < n; i++) {
    const priceWindow = close.slice(i-4, i+1);
    const pvtWindow = pvt.slice(i-4, i+1);
    const priceMin = Math.min(...priceWindow);
    const pvtTrendDown = pvt[i] < pvtWindow[0];
    
    if (close[i] === priceMin && !pvtTrendDown) {
      bottomCount++;
      console.log(`  ${klines[i][0]}: 收${close[i].toFixed(2)}, PVT=${pvt[i].toFixed(0)}`);
    }
  }
  console.log(`共 ${bottomCount} 个底背离日`);
  
  // 检测连续底背离段
  console.log('\n=== 底背离连续段 ===');
  let inStreak = false;
  let streakStart = -1;
  let streakCount = 0;
  
  for (let i = 4; i < n; i++) {
    const priceWindow = close.slice(i-4, i+1);
    const pvtWindow = pvt.slice(i-4, i+1);
    const priceMin = Math.min(...priceWindow);
    const pvtTrendDown = pvt[i] < pvtWindow[0];
    const isBottom = close[i] === priceMin && !pvtTrendDown;
    
    if (isBottom) {
      if (!inStreak) {
        streakStart = i;
        streakCount = 1;
        inStreak = true;
      } else {
        streakCount++;
      }
    } else {
      if (inStreak && streakCount >= 2) {
        console.log(`  连续${streakCount}天: ${klines[streakStart][0]} 到 ${klines[i-1][0]}`);
      }
      inStreak = false;
      streakCount = 0;
    }
  }
  
  // 计算详细的CRI
  console.log('\n=== CRI计算 ===');
  for (let idx of [n-5, n-4, n-3, n-2, n-1]) {
    if (idx < 20) continue;
    const ma20 = close.slice(idx-20, idx+1).reduce((a, b) => a + b, 0) / 20;
    const price = close[idx];
    const deviation = ((price - ma20) / ma20) * 100;
    const criBasis = Math.max(0, -deviation);
    console.log(`  ${klines[idx][0]}: CRI=${criBasis.toFixed(2)}`);
  }
}

debug01810();
