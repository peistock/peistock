import type { StockData } from '@/types';

/**
 * 新浪财经K线数据API
 * 支持A股、港股的历史K线数据获取
 * 无需API Key，免费使用
 */

// 新浪财经K线API基础URL
const SINA_KLINE_API = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData';

// 新浪财经实时行情API
const SINA_QUOTE_API = 'https://hq.sinajs.cn/list';

/**
 * 获取K线数据
 * @param symbol 股票代码 (如 sh600519, sz000001, hk00700)
 * @param scale 时间间隔 (5=5分钟, 15=15分钟, 30=30分钟, 60=60分钟, 240=240分钟/日线)
 * @param datalen 数据条数 (最大1023)
 */
export async function getKlines(
  symbol: string,
  scale: number,
  datalen: number = 500
): Promise<StockData[]> {
  // 限制最大数据条数
  const limit = Math.min(datalen, 1023);
  
  const url = `${SINA_KLINE_API}?symbol=${symbol}&scale=${scale}&ma=no&datalen=${limit}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`获取K线数据失败: ${response.status}`);
  }
  
  const text = await response.text();
  
  // 新浪返回的是JSONP格式，需要解析
  // 格式: [{"day":"2024-01-01 10:00:00","open":"100.00","high":"101.00","low":"99.00","close":"100.50","volume":"10000"},...]
  try {
    // 尝试直接解析JSON
    const data = JSON.parse(text);
    return parseKlineData(data);
  } catch {
    // 如果是JSONP格式，提取JSON部分
    const match = text.match(/\[.*\]/);
    if (match) {
      const data = JSON.parse(match[0]);
      return parseKlineData(data);
    }
    throw new Error('解析K线数据失败');
  }
}

/**
 * 解析K线数据
 */
function parseKlineData(data: any[]): StockData[] {
  if (!Array.isArray(data)) return [];
  
  return data.map((item: any) => ({
    date: item.day || '',
    open: parseFloat(item.open) || 0,
    high: parseFloat(item.high) || 0,
    low: parseFloat(item.low) || 0,
    close: parseFloat(item.close) || 0,
    volume: parseInt(item.volume) || 0,
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
  open: number;
  high: number;
  low: number;
  volume: number;
}> {
  const url = `${SINA_QUOTE_API}=${symbol}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`获取行情失败: ${response.status}`);
  }
  
  // 新浪返回的是JavaScript变量赋值格式
  // var hq_str_sh600519="1,贵州茅台,600519,1700.00,1690.00,1705.00,1710.00,1685.00,10000,17000000,1700.00,1701.00,100,1702.00,200,...";
  const text = await response.text();
  
  const match = text.match(/var hq_str_\w+="([^"]*)"/);
  if (!match) {
    throw new Error('解析行情数据失败');
  }
  
  const parts = match[1].split(',');
  
  // 解析字段（A股格式）
  // 0: 未知 1: 名称 2: 代码 3: 当前价 4: 昨收 5: 今开 6: 最高 7: 最低 8: 成交量
  const name = parts[1] || '';
  const price = parseFloat(parts[3]) || 0;
  const prevClose = parseFloat(parts[4]) || 0;
  const open = parseFloat(parts[5]) || 0;
  const high = parseFloat(parts[6]) || 0;
  const low = parseFloat(parts[7]) || 0;
  const volume = parseInt(parts[8]) || 0;
  
  const change = price - prevClose;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
  
  return {
    symbol,
    name,
    price,
    change,
    changePercent,
    open,
    high,
    low,
    volume,
  };
}

/**
 * 获取多个时间维度的K线数据
 * @param symbol 股票代码
 */
export async function getMultiTimeframeData(symbol: string): Promise<{
  daily: StockData[];
  min15: StockData[];
  min120: StockData[];
}> {
  // 并行获取三个时间维度
  // 日线使用240分钟(4小时)近似
  const [daily, min15, min120] = await Promise.all([
    getKlines(symbol, 240, 500),   // 日线 (240分钟)
    getKlines(symbol, 15, 500),    // 15分钟
    getKlines(symbol, 120, 500),   // 120分钟
  ]);
  
  return {
    daily,
    min15,
    min120,
  };
}

/**
 * 格式化股票代码
 * @param input 用户输入
 * @returns 标准格式 (sh600519, sz000001, hk00700)
 */
export function formatSymbol(input: string): string {
  const trimmed = input.toUpperCase().trim();
  
  // 如果已经是标准格式，直接返回
  if (trimmed.startsWith('SH') || trimmed.startsWith('SZ') || trimmed.startsWith('HK')) {
    return trimmed.toLowerCase();
  }
  
  // 港股代码 (5位数字，如00700)
  if (/^\d{5}$/.test(trimmed)) {
    return `hk${trimmed}`;
  }
  
  // A股代码判断
  // 上海: 600xxx, 601xxx, 603xxx, 688xxx (科创板)
  // 深圳: 000xxx, 002xxx (中小板), 300xxx (创业板)
  if (/^\d{6}$/.test(trimmed)) {
    const code = parseInt(trimmed);
    if (code >= 600000 || code >= 688000) {
      return `sh${trimmed}`;
    } else {
      return `sz${trimmed}`;
    }
  }
  
  // 默认返回原样
  return trimmed.toLowerCase();
}

/**
 * 获取市场名称
 */
export function getMarketName(symbol: string): string {
  if (symbol.startsWith('sh')) return '上海';
  if (symbol.startsWith('sz')) return '深圳';
  if (symbol.startsWith('hk')) return '香港';
  return '未知';
}

/**
 * 热门股票列表
 */
export const POPULAR_SYMBOLS = [
  { symbol: 'sh600519', name: '贵州茅台', market: '上海' },
  { symbol: 'sh600036', name: '招商银行', market: '上海' },
  { symbol: 'sh600276', name: '恒瑞医药', market: '上海' },
  { symbol: 'sh600900', name: '长江电力', market: '上海' },
  { symbol: 'sz000001', name: '平安银行', market: '深圳' },
  { symbol: 'sz000858', name: '五粮液', market: '深圳' },
  { symbol: 'sz002594', name: '比亚迪', market: '深圳' },
  { symbol: 'sz300750', name: '宁德时代', market: '深圳' },
  { symbol: 'hk00700', name: '腾讯控股', market: '香港' },
  { symbol: 'hk03690', name: '美团-W', market: '香港' },
];
