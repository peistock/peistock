import type { StockData } from '@/types';

// Yahoo Finance API基础URL
const YAHOO_API_BASE = 'https://query1.finance.yahoo.com';

/**
 * 获取K线数据
 * @param symbol 股票代码 (如 AAPL, BTC-USD)
 * @param interval 时间间隔 (1d, 15m, 2h)
 * @param range 时间范围 (1y, 60d, 60d)
 */
export async function getKlines(
  symbol: string, 
  interval: string, 
  range: string = '1y'
): Promise<StockData[]> {
  const url = `${YAHOO_API_BASE}/v8/finance/chart/${symbol}?interval=${interval}&range=${range}&includeAdjustedClose=true`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`获取K线数据失败: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (!result.chart || !result.chart.result || result.chart.result.length === 0) {
    throw new Error('无数据返回，请检查股票代码');
  }
  
  const chart = result.chart.result[0];
  const timestamps = chart.timestamp;
  const quotes = chart.indicators.quote[0];
  
  // 转换数据格式
  const data: StockData[] = [];
  
  for (let i = 0; i < timestamps.length; i++) {
    // 跳过无效数据
    if (quotes.open[i] === null || quotes.high[i] === null || 
        quotes.low[i] === null || quotes.close[i] === null) {
      continue;
    }
    
    data.push({
      date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
      open: quotes.open[i],
      high: quotes.high[i],
      low: quotes.low[i],
      close: quotes.close[i],
      volume: quotes.volume[i] || 0,
      amount: 0, // Yahoo Finance API 可能需要额外字段获取成交额
    });
  }
  
  return data;
}

/**
 * 获取股票报价信息
 * @param symbol 股票代码
 */
export async function getQuote(symbol: string): Promise<{
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  name: string;
}> {
  const url = `${YAHOO_API_BASE}/v7/finance/quote?symbols=${symbol}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`获取报价失败: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (!result.quoteResponse || !result.quoteResponse.result || result.quoteResponse.result.length === 0) {
    throw new Error('无股票信息返回');
  }
  
  const quote = result.quoteResponse.result[0];
  
  return {
    symbol: quote.symbol,
    price: quote.regularMarketPrice || 0,
    change: quote.regularMarketChange || 0,
    changePercent: quote.regularMarketChangePercent || 0,
    name: quote.shortName || quote.longName || quote.symbol,
  };
}

/**
 * 获取多个时间维度的K线数据
 */
export async function getMultiTimeframeData(symbol: string): Promise<{
  daily: StockData[];
  min15: StockData[];
  min120: StockData[];
}> {
  // Yahoo Finance的interval参数:
  // 1d = 日线
  // 15m = 15分钟
  // 2h = 2小时 (120分钟)
  
  // 并行获取三个时间维度
  const [daily, min15, min120] = await Promise.all([
    getKlines(symbol, '1d', '2y'),      // 日K线，两年数据
    getKlines(symbol, '15m', '60d'),    // 15分钟K线，60天
    getKlines(symbol, '2h', '120d'),    // 120分钟K线 (2小时)，120天
  ]);
  
  return {
    daily,
    min15,
    min120,
  };
}

/**
 * 格式化Yahoo Finance股票代码
 * @param input 用户输入
 * @returns 标准格式
 */
export function formatSymbol(input: string): string {
  const trimmed = input.toUpperCase().trim();
  
  // 如果已经包含-USD或-USDT，直接返回
  if (trimmed.includes('-USD') || trimmed.includes('-USDT')) {
    return trimmed;
  }
  
  // 加密货币添加-USD后缀
  const cryptoSymbols = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'MATIC', 'LTC', 'BCH'];
  if (cryptoSymbols.includes(trimmed)) {
    return `${trimmed}-USD`;
  }
  
  // 美股直接返回
  return trimmed;
}

/**
 * 热门股票/加密货币列表
 */
export const POPULAR_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'BTC-USD', name: 'Bitcoin' },
  { symbol: 'ETH-USD', name: 'Ethereum' },
  { symbol: 'SOL-USD', name: 'Solana' },
];
