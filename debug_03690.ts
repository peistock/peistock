async function debug03690() {
  const symbol = '03690';
  const formatSymbol = (s: string) => `hk${s}`;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${formatSymbol(symbol)},day,,,400,qfq`;
  
  console.log('URL:', url);
  
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json', 'Referer': 'https://stock.qq.com' },
  });
  
  const result = await response.json();
  console.log('Response code:', result.code);
  console.log('Data keys:', result.data ? Object.keys(result.data) : 'no data');
  
  const tencentSymbol = formatSymbol(symbol);
  if (result.data && result.data[tencentSymbol]) {
    const stockData = result.data[tencentSymbol];
    console.log('Stock data keys:', Object.keys(stockData));
    
    const klines = stockData.qfqday || stockData.day;
    console.log('Klines length:', klines ? klines.length : 0);
    
    if (klines && klines.length > 0) {
      console.log('最近3天:', klines.slice(-3));
    }
  } else {
    console.log('No data for symbol:', tencentSymbol);
  }
}

debug03690();
