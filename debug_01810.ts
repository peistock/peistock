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
  
  // PVT和背离检测
  const pvt: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) pvt.push(volume[i]);
    else {
      const change = close[i-1] !== 0 ? (close[i] - close[i-1]) / close[i-1] : 0;
      pvt.push(pvt[i-1] + volume[i] * change);
    }
  }
  
  console.log('\n近10天PVT背离检测:');
  for (let i = n-10; i < n; i++) {
    const priceWindow = close.slice(Math.max(0, i-4), i+1);
    const pvtWindow = pvt.slice(Math.max(0, i-4), i+1);
    const priceMin = Math.min(...priceWindow);
    const priceMax = Math.max(...priceWindow);
    const pvtTrendDown = pvt[i] < pvtWindow[0];
    const pvtTrendUp = pvt[i] > pvtWindow[0];
    
    let div = '无';
    if (close[i] === priceMin && !pvtTrendDown) div = '🟢 底背离';
    if (close[i] === priceMax && !pvtTrendUp) div = '🔴 顶背离';
    
    console.log(`  ${klines[i][0]}: 收${close[i].toFixed(2)}, ${div}`);
  }
  
  // 检查连续底背离
  const divergence: ('none'|'top'|'bottom')[] = [];
  for (let i = 0; i < n; i++) {
    if (i < 4) { divergence.push('none'); continue; }
    const priceWindow = close.slice(i-4, i+1);
    const pvtWindow = pvt.slice(i-4, i+1);
    const priceMin = Math.min(...priceWindow);
    const priceMax = Math.max(...priceWindow);
    const pvtTrendDown = pvt[i] < pvtWindow[0];
    const pvtTrendUp = pvt[i] > pvtWindow[0];
    
    if (close[i] === priceMin && !pvtTrendDown) divergence.push('bottom');
    else if (close[i] === priceMax && !pvtTrendUp) divergence.push('top');
    else divergence.push('none');
  }
  
  // 计算连续底背离天数
  let bottomStreak = 0;
  for (let i = n-1; i >= 0; i--) {
    if (divergence[i] === 'bottom') bottomStreak++;
    else break;
  }
  console.log(`\n连续底背离天数: ${bottomStreak}`);
  
  // 简化CRI计算
  const ma20 = close.slice(n-20, n).reduce((a: number, b: number) => a + b, 0) / 20;
  const deviation = ((close[n-1] - ma20) / ma20) * 100;
  const criBasis = Math.max(0, -deviation);
  console.log(`\nCRI(简化): ${criBasis.toFixed(2)}`);
  
  // B(底背离)条件: 连续>=2天底背离 + 两天CRI>=60 + 两天成本偏离<50%
  console.log('\nB(底背离)条件检查:');
  console.log(`  连续底背离 >= 2天 ? ${bottomStreak}天 ${bottomStreak >= 2 ? '✅' : '❌'}`);
  console.log(`  CRI >= 60 ? ${criBasis.toFixed(2)} ${criBasis >= 60 ? '✅' : '❌'}`);
  
  // B(恐慌)条件: 成本偏离<5% + BIAS<5% + CRI>90
  console.log('\nB(恐慌)条件检查:');
  console.log(`  BIAS分位数 < 5% ? ${biasPercentile.toFixed(2)}% ${biasPercentile < 5 ? '✅' : '❌'}`);
  console.log(`  CRI > 90 ? ${criBasis.toFixed(2)} ${criBasis > 90 ? '✅' : '❌'}`);
}

debug01810();
