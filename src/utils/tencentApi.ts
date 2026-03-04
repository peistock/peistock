import type { StockData } from '@/types';

/**
 * 腾讯财经 API
 * 支持 A股、港股的历史K线数据获取
 * 无需API Key，免费使用，支持CORS
 */

/**
 * 转换股票代码格式为腾讯格式
 * A股: sh600519, sz000001
 * 港股: hk00700
 */
export function formatSymbol(symbol: string): string {
  const cleanSymbol = symbol.replace(/[^0-9a-zA-Z]/g, '');
  
  // 港股 (5位)
  if (cleanSymbol.length === 5) {
    return `hk${cleanSymbol}`;
  }
  
  // A股 (6位)
  if (cleanSymbol.startsWith('6') || cleanSymbol.startsWith('5')) {
    return `sh${cleanSymbol}`;
  }
  return `sz${cleanSymbol}`;
}

/**
 * 获取 K 线数据
 * @param symbol 股票代码
 * @param period 周期 (day=日线, week=周线, month=月线)
 * @param count 数据条数
 * @param adjust 复权类型 (qfq=前复权, hfq=后复权, 空=不复权)
 */
export async function getKlines(
  symbol: string,
  period: 'day' | 'week' | 'month' = 'day',
  count: number = 500,
  adjust: 'qfq' | 'hfq' | '' = 'qfq'
): Promise<StockData[]> {
  const tencentSymbol = formatSymbol(symbol);
  const adjustParam = adjust ? `,${adjust}` : '';
  
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentSymbol},${period},,,${count}${adjustParam}`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Referer': 'https://stock.qq.com',
    },
  });
  
  if (!response.ok) {
    throw new Error(`腾讯财经 API 请求失败: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (result.code !== 0 || !result.data || !result.data[tencentSymbol]) {
    throw new Error('无数据返回，请检查股票代码');
  }
  
  const stockData = result.data[tencentSymbol];
  
  // 获取 K 线数据字段
  // 港股和A股的字段名不同
  let klines: any[] = [];
  if (period === 'day') {
    klines = stockData.qfqday || stockData.day || [];
  } else if (period === 'week') {
    klines = stockData.qfqweek || stockData.week || [];
  } else if (period === 'month') {
    klines = stockData.qfqmonth || stockData.month || [];
  }
  
  if (!klines || klines.length === 0) {
    throw new Error('该股票暂无K线数据');
  }
  
  // 解析数据 [日期, 开盘, 收盘, 最低, 最高, 成交量]
  // 注意：腾讯API返回的成交量是"手"，需要×100转换为"股"
  return klines.map((item: any) => ({
    date: item[0],
    open: parseFloat(item[1]) || 0,
    close: parseFloat(item[2]) || 0,
    low: parseFloat(item[3]) || 0,
    high: parseFloat(item[4]) || 0,
    volume: (parseInt(item[5]) || 0) * 100, // 手转股的
    amount: 0, // 腾讯 API 不直接提供成交额
  }));
}

/**
 * 获取实时行情
 * @param symbol 股票代码
 */
export async function getQuote(symbol: string): Promise<{
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  capital: number;
}> {
  const tencentSymbol = formatSymbol(symbol);
  
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentSymbol},day,,,1,qfq`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Referer': 'https://stock.qq.com',
    },
  });
  
  if (!response.ok) {
    throw new Error(`腾讯财经 API 请求失败: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (result.code !== 0 || !result.data || !result.data[tencentSymbol]) {
    throw new Error('无数据返回');
  }
  
  const qt = result.data[tencentSymbol].qt;
  const stockQt = qt?.[tencentSymbol];
  
  if (!stockQt || !Array.isArray(stockQt)) {
    throw new Error('解析行情数据失败');
  }
  
  // 腾讯 qt 数据字段索引
  // [0]=市场(1=沪,0=深,100=港), [1]=名称, [2]=代码, [3]=最新价, [4]=昨收...
  // A股: [62]=总股本, [63]=流通股本
  // 港股: [44]=总股本(亿股), [45]=流通股本(亿股) 或流通市值
  const market = stockQt[0];
  const name = stockQt[1] || symbol;
  const price = parseFloat(stockQt[3]) || 0;
  const prevClose = parseFloat(stockQt[4]) || 0;
  const change = price - prevClose;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
  
  // 尝试从腾讯API获取流通股本
  // A股: [72]=流通股本(股), [73]=总股本(股)
  // 港股: [69]=流通股本(股)
  let capital = 0;
  
  if (market === '100') {
    // 港股：索引 69 是流通股本（股）
    capital = parseInt(stockQt[69]) || 0;
  } else {
    // A股：索引 72 是流通股本（股）
    capital = parseInt(stockQt[72]) || 0;
  }
  
  // 如果腾讯没有返回或计算失败，从本地数据库获取
  if (!capital || capital <= 0) {
    const { getStockCapital } = await import('./stockCapital');
    capital = getStockCapital(symbol);
  }
  
  return {
    symbol: cleanSymbol(symbol),
    name,
    price,
    change,
    changePercent,
    capital,
  };
}

/**
 * 获取多时间维度数据
 * @param symbol 股票代码
 */
export async function getMultiTimeframeData(symbol: string): Promise<{
  daily: StockData[];
  weekly: StockData[];
  min15: StockData[];
}> {
  // 腾讯 API 分钟线格式不同，这里用日线代替15分钟线
  const [daily, weekly] = await Promise.all([
    getKlines(symbol, 'day', 500).catch(() => []),
    getKlines(symbol, 'week', 200).catch(() => []),
  ]);
  
  // 腾讯分钟线需要另一个接口，这里暂时用日线数据代替
  // 后续可以扩展 getMinKlines 方法
  return { 
    daily, 
    weekly, 
    min15: daily.slice(-100) // 临时用日线最后100条代替
  };
}

/**
 * 获取分钟线数据 (需要单独接口)
 * @param symbol 股票代码
 * @param period 分钟周期 (15, 30, 60)
 * @param count 数据条数
 */
export async function getMinKlines(
  symbol: string,
  period: 15 | 30 | 60 = 15,
  count: number = 200
): Promise<StockData[]> {
  const tencentSymbol = formatSymbol(symbol);
  
  // 腾讯分钟线接口
  const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?fq=qfq&q=${tencentSymbol}&span=${period}m&n=${count}`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Referer': 'https://stock.qq.com',
    },
  });
  
  if (!response.ok) {
    throw new Error(`腾讯财经 API 请求失败: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (result.code !== 0 || !result.data || !result.data[tencentSymbol]) {
    throw new Error('无分钟线数据');
  }
  
  const minData = result.data[tencentSymbol];
  const klines = minData.data || [];
  
  return klines.map((item: any) => ({
    date: item[0], // 时间格式: YYYYMMDDHHMM
    open: parseFloat(item[1]) || 0,
    close: parseFloat(item[2]) || 0,
    high: parseFloat(item[3]) || 0,
    low: parseFloat(item[4]) || 0,
    volume: parseInt(item[5]) || 0,
    amount: 0,
  }));
}

/**
 * 清理股票代码
 */
function cleanSymbol(symbol: string): string {
  return symbol.replace(/[^0-9]/g, '');
}

/**
 * 获取市场名称
 */
export function getMarketName(symbol: string): string {
  const clean = cleanSymbol(symbol);
  if (clean.length === 5) return '港股';
  if (clean.startsWith('6')) return '上证';
  if (clean.startsWith('3')) return '创业板';
  if (clean.startsWith('0')) return '深证';
  return 'A股';
}
