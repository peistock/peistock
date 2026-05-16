// 简化版调试脚本
function calculateMA(data: number[], period: number) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) result.push(null);
    else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      result.push(sum / period);
    }
  }
  return result;
}

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
  console.log(`股票: ${symbol}, 数据: ${n}天`);
  
  // 计算关键指标
  const ma225 = calculateMA(close, 225);
  const lastClose = close[n-1];
  const lastMA225 = ma225[n-1];
  const bias225 = lastMA225 ? ((lastClose - lastMA225) / lastMA225) * 100 : null;
  
  console.log(`最新日期: ${klines[n-1][0]}`);
  console.log(`收盘价: ${lastClose}`);
  console.log(`MA225: ${lastMA225?.toFixed(2)}`);
  console.log(`BIAS225: ${bias225?.toFixed(2)}%`);
  
  // 检查近10天的PVT背离
  console.log('\n近10天PVT背离检测:');
  const pvt: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) pvt.push(volume[i]);
    else {
      const change = close[i-1] !== 0 ? (close[i] - close[i-1]) / close[i-1] : 0;
      pvt.push(pvt[i-1] + volume[i] * change);
    }
  }
  
  for (let i = n-10; i < n; i++) {
    const priceWindow = close.slice(i-4, i+1);
    const pvtWindow = pvt.slice(i-4, i+1);
    const priceMin = Math.min(...priceWindow);
    const pvtTrendDown = pvt[i] < pvtWindow[0];
    
    let div = '无';
    if (close[i] === priceMin && !pvtTrendDown) div = '底背离?';
    
    console.log(`  ${klines[i][0]}: 收${close[i].toFixed(2)}, PVT趋势${pvtTrendDown?'↓':'↑'}, ${div}`);
  }
}

debug03690();
