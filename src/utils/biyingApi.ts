import type { StockData } from '@/types';

/**
 * 必盈数据 API
 * 支持 A股、港股的历史K线数据获取
 * 需要配置 licence key
 * 文档: https://www.biyingapi.com
 */

// API 基础 URL
const BIYING_API_BASE = 'http://api.biyingapi.com';

// 从环境变量或配置文件获取 licence key
const getLicence = (): string => {
  // 优先从环境变量获取
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env.VITE_BIYING_LICENCE || '';
  }
  return '';
};

// 股票代码映射表（常见股票的流通股本）
const STOCK_CAPITAL_MAP: Record<string, number> = {
  '000001': 17170000000,  // 平安银行
  '600519': 1256000000,   // 贵州茅台
  '603198': 1290000000,   // 迪贝电
};

/**
 * 转换股票代码格式
 * A股: 000001 (平安银行)
 * 港股: 00700 (腾讯控股)
 */
function formatSymbol(symbol: string): { code: string; market: string } {
  const cleanSymbol = symbol.replace(/[^0-9]/g, '');
  
  // 判断市场
  if (cleanSymbol.length === 5) {
    // 港股
    return { code: cleanSymbol, market: 'hk' };
  }
  
  // A股判断 (6位)
  if (cleanSymbol.startsWith('6') || cleanSymbol.startsWith('5')) {
    return { code: cleanSymbol, market: 'sh' };
  }
  return { code: cleanSymbol, market: 'sz' };
}

/**
 * 获取 K 线数据
 * @param symbol 股票代码
 * @param timeframe 时间周期 (5=5分钟, 15=15分钟, 30=30分钟, 60=60分钟, d=日线, w=周线, m=月线)
 * @param limit 数据条数 (最大1023)
 */
export async function getKlines(
  symbol: string,
  timeframe: '5' | '15' | '30' | '60' | 'd' | 'w' | 'm' = 'd',
  limit: number = 500
): Promise<StockData[]> {
  const licence = getLicence();
  if (!licence) {
    throw new Error('必盈数据 API 需要 licence key，请在 .env 文件中配置 VITE_BIYING_LICENCE');
  }
  
  const { code } = formatSymbol(symbol);
  
  // 限制最大数据条数
  const datalen = Math.min(limit, 1023);
  
  // 必盈数据接口：历史分时数据
  // 格式: /hs/history/{code}/{timeframe}/{licence}?lt={limit}
  const url = `${BIYING_API_BASE}/hs/history/${code}/${timeframe}/${licence}?lt=${datalen}`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`必盈数据 API 请求失败: ${response.status}`);
  }
  
  const data = await response.json();
  
  // 如果返回错误信息
  if (data.detail) {
    throw new Error(`必盈数据 API 错误: ${data.detail}`);
  }
  
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('无数据返回，请检查股票代码或 licence key');
  }
  
  // 解析 K 线数据
  // 必盈数据格式: { t: '2024-01-01', o: 10.0, h: 11.0, l: 9.0, c: 10.5, v: 10000 }
  return data.map((item: any) => ({
    date: item.t || item.day || '',
    open: parseFloat(item.o || item.open) || 0,
    high: parseFloat(item.h || item.high) || 0,
    low: parseFloat(item.l || item.low) || 0,
    close: parseFloat(item.c || item.close) || 0,
    volume: parseInt(item.v || item.volume) || 0,
    amount: parseFloat(item.amount) || 0,
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
  const licence = getLicence();
  if (!licence) {
    throw new Error('必盈数据 API 需要 licence key，请在 .env 文件中配置 VITE_BIYING_LICENCE');
  }
  
  const { code } = formatSymbol(symbol);
  
  // 必盈数据实时行情接口
  const url = `${BIYING_API_BASE}/hs/real/${code}/${licence}`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`必盈数据 API 请求失败: ${response.status}`);
  }
  
  const data = await response.json();
  
  // 如果返回错误信息
  if (data.detail) {
    throw new Error(`必盈数据 API 错误: ${data.detail}`);
  }
  
  // 获取流通股本
  const capital = STOCK_CAPITAL_MAP[code] || 1000000000; // 默认10亿
  
  return {
    symbol: code,
    name: data.name || data.mc || symbol,
    price: parseFloat(data.p || data.price) || 0,
    change: parseFloat(data.ud || data.change) || 0,
    changePercent: parseFloat(data.pc || data.changePercent) || 0,
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
  try {
    const [daily, weekly, min15] = await Promise.all([
      getKlines(symbol, 'd', 500),
      getKlines(symbol, 'w', 200),
      getKlines(symbol, '15', 500),
    ]);
    return { daily, weekly, min15 };
  } catch (error: any) {
    console.warn('必盈数据 K 线获取失败:', error.message);
    throw error; // 向上抛出，让调用方处理降级
  }
}

/**
 * 获取股票列表
 */
export async function getStockList(): Promise<{ code: string; name: string; market: string }[]> {
  const licence = getLicence();
  if (!licence) {
    throw new Error('必盈数据 API 需要 licence key');
  }
  
  const url = `${BIYING_API_BASE}/hslt/list/${licence}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`获取股票列表失败: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!Array.isArray(data)) {
    return [];
  }
  
  return data.map((item: any) => ({
    code: item.dm || '',
    name: item.mc || '',
    market: item.jys || '',
  }));
}

/**
 * 检查 API 是否可用
 */
export function isAvailable(): boolean {
  return !!getLicence();
}
