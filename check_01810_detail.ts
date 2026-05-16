// 详细检查01810的所有指标
async function check01810() {
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
  
  console.log('=== 01810 详细指标检查 ===\n');
  
  // 1. BIAS225
  const ma225 = close.slice(-225).reduce((a, b) => a + b, 0) / 225;
  const bias225 = ((close[n-1] - ma225) / ma225) * 100;
  
  // 分位数
  const biasHist: number[] = [];
  for (let i = 225; i < n; i++) {
    const m = close.slice(i-225, i).reduce((a, b) => a + b, 0) / 225;
    biasHist.push(((close[i] - m) / m) * 100);
  }
  const sortedBias = [...biasHist].sort((a, b) => a - b);
  const lessThanBias = sortedBias.filter(v => v < bias225).length;
  const biasPct = (lessThanBias / sortedBias.length) * 100;
  
  console.log('1. BIAS225指标:');
  console.log(`   当前值: ${bias225.toFixed(2)}%`);
  console.log(`   历史分位: ${biasPct.toFixed(2)}%`);
  console.log(`   条件<5%: ${biasPct < 5 ? '✅' : '❌'}`);
  
  // 2. 成本偏离度
  // 简化计算：使用MA20代替EMAHS
  const ma20 = close.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const costDev = ((close[n-1] - ma20) / ma20) * 100;
  
  // 成本偏离度历史分位数
  const costDevHist: number[] = [];
  for (let i = 20; i < n; i++) {
    const m = close.slice(i-20, i).reduce((a, b) => a + b, 0) / 20;
    costDevHist.push(((close[i] - m) / m) * 100);
  }
  const sortedCostDev = [...costDevHist].sort((a, b) => a - b);
  const lessThanCostDev = sortedCostDev.filter(v => v < costDev).length;
  const costDevPct = (lessThanCostDev / sortedCostDev.length) * 100;
  
  console.log('\n2. 成本偏离度(MA20简化):');
  console.log(`   当前值: ${costDev.toFixed(2)}%`);
  console.log(`   历史分位: ${costDevPct.toFixed(2)}%`);
  console.log(`   条件<5%: ${costDevPct < 5 ? '✅' : '❌'}`);
  
  // 3. CRI (简化)
  const cri = Math.max(0, -costDev);
  console.log('\n3. CRI(简化):');
  console.log(`   当前值: ${cri.toFixed(2)}`);
  console.log(`   条件>90: ${cri > 90 ? '✅' : '❌'}`);
  
  // 4. 检查是否有连续底背离
  const pvt: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) pvt.push(volume[i]);
    else {
      const change = close[i-1] !== 0 ? (close[i] - close[i-1]) / close[i-1] : 0;
      pvt.push(pvt[i-1] + volume[i] * change);
    }
  }
  
  // 检测底背离
  const divergence: ('none'|'top'|'bottom')[] = [];
  for (let i = 4; i < n; i++) {
    const priceWindow = close.slice(i-4, i+1);
    const pvtWindow = pvt.slice(i-4, i+1);
    const priceMin = Math.min(...priceWindow);
    const pvtTrendDown = pvt[i] < pvtWindow[0];
    
    if (close[i] === priceMin && !pvtTrendDown) divergence.push('bottom');
    else if (close[i] === Math.max(...priceWindow) && pvt[i] > pvtWindow[0]) divergence.push('top');
    else divergence.push('none');
  }
  divergence.unshift('none', 'none', 'none', 'none'); // 补齐前4天
  
  // 检查连续底背离
  let bottomStreak = 0;
  for (let i = n-1; i >= 0; i--) {
    if (divergence[i] === 'bottom') bottomStreak++;
    else break;
  }
  
  console.log('\n4. PVT底背离:');
  console.log(`   最新日期是否底背离: ${divergence[n-1] === 'bottom' ? '✅' : '❌'}`);
  console.log(`   连续底背离天数: ${bottomStreak}`);
  console.log(`   条件≥2天: ${bottomStreak >= 2 ? '✅' : '❌'}`);
  
  // 5. 总结
  console.log('\n=== B信号条件总结 ===');
  console.log('B(恐慌): 成本偏离<5% + BIAS<5% + CRI>90');
  console.log(`   成本偏离<5%: ${costDevPct < 5 ? '✅' : '❌'} (${costDevPct.toFixed(1)}%)`);
  console.log(`   BIAS<5%: ${biasPct < 5 ? '✅' : '❌'} (${biasPct.toFixed(1)}%)`);
  console.log(`   CRI>90: ${cri > 90 ? '✅' : '❌'} (${cri.toFixed(1)})`);
  console.log(`   结果: ${(costDevPct < 5 && biasPct < 5 && cri > 90) ? '✅有B(恐慌)' : '❌无B(恐慌)'}`);
  
  console.log('\nB(底背离): 连续≥2天底背离 + 两天CRI≥60 + 两天成本偏离<50%');
  console.log(`   连续底背离≥2天: ${bottomStreak >= 2 ? '✅' : '❌'} (${bottomStreak}天)`);
  console.log(`   结果: ${bottomStreak >= 2 ? '可能有B(底背离)' : '❌无B(底背离)'}`);
}

check01810();
