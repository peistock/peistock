import type { StockData } from '@/types';

// 币安API基础URL
const BINANCE_API_BASE = 'https://api.binance.com';

/**
 * 获取K线数据
 * @param symbol 交易对 (如 BTCUSDT)
 * @param interval 时间间隔 (1d, 15m, 2h)
 * @param limit 获取条数 (默认500)
 */
export async function getKlines(
  symbol: string, 
  interval: string, 
  limit: number = 500
): Promise<StockData[]> {
  const url = `${BINANCE_API_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`获取K线数据失败: ${response.status}`);
  }
  
  const data = await response.json();
  
  // 转换数据格式
  // 币安返回: [开盘时间, 开盘价, 最高价, 最低价, 收盘价, 成交量, 收盘时间, ...]
  return data.map((item: any[]) => ({
    date: new Date(item[0]).toISOString().split('T')[0],
    open: parseFloat(item[1]),
    high: parseFloat(item[2]),
    low: parseFloat(item[3]),
    close: parseFloat(item[4]),
    volume: parseFloat(item[5]),
  }));
}

/**
 * 获取24小时价格统计
 * @param symbol 交易对
 */
export async function get24hrTicker(symbol: string): Promise<{
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
}> {
  const url = `${BINANCE_API_BASE}/api/v3/ticker/24hr?symbol=${symbol}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`获取价格统计失败: ${response.status}`);
  }
  
  const data = await response.json();
  
  return {
    symbol: data.symbol,
    price: parseFloat(data.lastPrice),
    change: parseFloat(data.priceChange),
    changePercent: parseFloat(data.priceChangePercent),
  };
}

/**
 * 获取交易对信息
 */
export async function getExchangeInfo(): Promise<string[]> {
  const url = `${BINANCE_API_BASE}/api/v3/exchangeInfo`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`获取交易对信息失败: ${response.status}`);
  }
  
  const data = await response.json();
  
  // 返回USDT交易对
  return data.symbols
    .filter((s: any) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
    .map((s: any) => s.symbol);
}

/**
 * 获取多个时间维度的K线数据
 */
export async function getMultiTimeframeData(symbol: string): Promise<{
  daily: StockData[];
  min15: StockData[];
  min120: StockData[];
}> {
  // 并行获取三个时间维度
  const [daily, min15, min120] = await Promise.all([
    getKlines(symbol, '1d', 365),    // 日K线，一年数据
    getKlines(symbol, '15m', 500),   // 15分钟K线
    getKlines(symbol, '2h', 500),    // 120分钟K线 (2小时)
  ]);
  
  return {
    daily,
    min15,
    min120,
  };
}

/**
 * 格式化币安交易对
 * @param input 用户输入 (如 BTC, btcusdt)
 * @returns 标准格式 (BTCUSDT)
 */
export function formatSymbol(input: string): string {
  const upper = input.toUpperCase().trim();
  
  // 如果已经包含USDT，直接返回
  if (upper.endsWith('USDT')) {
    return upper;
  }
  
  // 否则添加USDT后缀
  return `${upper}USDT`;
}

/**
 * 热门交易对列表
 */
export const POPULAR_SYMBOLS = [
  { symbol: 'BTCUSDT', name: 'Bitcoin' },
  { symbol: 'ETHUSDT', name: 'Ethereum' },
  { symbol: 'BNBUSDT', name: 'BNB' },
  { symbol: 'SOLUSDT', name: 'Solana' },
  { symbol: 'XRPUSDT', name: 'Ripple' },
  { symbol: 'DOGEUSDT', name: 'Dogecoin' },
  { symbol: 'ADAUSDT', name: 'Cardano' },
  { symbol: 'AVAXUSDT', name: 'Avalanche' },
  { symbol: 'LINKUSDT', name: 'Chainlink' },
  { symbol: 'DOTUSDT', name: 'Polkadot' },
];
