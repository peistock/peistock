import type { StockData } from '@/types';

/**
 * 东方财富K线数据API
 * 支持A股、港股的历史K线数据获取
 * 支持CORS，可直接在浏览器调用
 */

/**
 * 获取K线数据
 * @param symbol 股票代码 (如 600519, 000001, 00700)
 * @param klt K线类型 (101=日线, 15=15分钟, 120=120分钟)
 * @param limit 数据条数
 */
export async function getKlines(
  symbol: string,
  klt: number,
  limit: number = 500
): Promise<StockData[]> {
  // 转换代码格式
  const secid = convertToSecid(symbol);
  
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${klt}&fqt=0&end=20500101&lmt=${limit}`;
  
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`获取K线数据失败: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!data.data || !data.data.klines || data.data.klines.length === 0) {
    throw new Error('无数据返回，请检查股票代码');
  }
  
  // 解析K线数据
  // 格式: "2024-01-01,100.00,101.00,99.00,100.50,10000,500000,0.50,0.00,0.00"
  // 日期,开盘,收盘,最低,最高,成交量(手),成交额(元),振幅,涨跌幅,涨跌额,换手率
  const isHK = secid.startsWith('116.');
  
  const result = data.data.klines.map((line: string) => {
    const parts = line.split(',');
    return {
      date: parts[0],
      open: parseFloat(parts[1]),
      close: parseFloat(parts[2]),
      low: parseFloat(parts[3]),
      high: parseFloat(parts[4]),
      // 港股成交量直接是股，A股是手需要乘100
      volume: isHK ? parseFloat(parts[5]) : parseFloat(parts[5]) * 100,
      amount: parseFloat(parts[6]),
    };
  });
  
  return result;
}

/**
 * 获取实时行情和流通盘数据
 * @param symbol 股票代码
 */
export async function getQuote(symbol: string): Promise<{
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  capital: number; // 流通股本（股）
}> {
  const secid = convertToSecid(symbol);
  
  // f43: 最新价, f57: 股票代码, f58: 股票名称, f60: 昨收
  // f84: 总股本, f85: 流通股本
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f57,f58,f60,f84,f85,f170`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`获取行情失败: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!data.data) {
    throw new Error('无股票信息返回');
  }
  
  const d = data.data;
  
  // 东方财富字段说明:
  // f43: 最新价(乘以0.01)
  // f57: 股票代码
  // f58: 股票名称
  // f60: 昨收(乘以0.01)
  // f84: 总股本(万股)
  // f85: 流通股本(万股)
  // f170: 涨跌幅
  
  // 港股(secid以116.开头)价格需要除以1000，A股除以100
  const isHK = secid.startsWith('116.');
  const priceDivisor = isHK ? 1000 : 100;
  
  const price = (d.f43 || 0) / priceDivisor;
  const prevClose = (d.f60 || 0) / priceDivisor;
  const change = price - prevClose;
  const changePercent = d.f170 || 0;
  
  // f85: 流通股本
  // 东方财富 API 中，A股的 f85 是"万股"，港股可能直接是"股"
  // 判断逻辑：如果 f85 < 1000万，认为是万股需要转换；否则已经是股
  const f85Value = d.f85 || 0;
  // 600989 流通盘约 73 亿股 = 733360万股，f85 应该返回 733360 左右
  // 如果 f85 返回 7333600000，说明已经是股
  const capital = f85Value < 10000000 ? f85Value * 10000 : f85Value;
  
  return {
    symbol: d.f57 || symbol,
    name: d.f58 || symbol,
    price,
    change,
    changePercent,
    capital,
  };
}

/**
 * 获取多个时间维度的K线数据
 * @param symbol 股票代码
 */
export async function getMultiTimeframeData(symbol: string): Promise<{
  daily: StockData[];
  weekly: StockData[];
  min15: StockData[];
}> {
  // 并行获取三个时间维度，使用最大数据量以确保 DD 计算准确
  // klt: 101=日线, 102=周线, 15=15分钟
  // limit: 东方财富 API 理论上支持很大数量，使用 2000 条确保覆盖足够历史数据
  const [daily, weekly, min15] = await Promise.all([
    getKlines(symbol, 101, 2000),   // 日线 - 约8年数据
    getKlines(symbol, 102, 500),    // 周线 - 约10年数据
    getKlines(symbol, 15, 2000),    // 15分钟 - 约2个月数据
  ]);
  
  return {
    daily,
    weekly,
    min15,
  };
}

/**
 * 转换股票代码为东方财富格式
 * @param symbol 股票代码
 * @returns secid (1.600000 上海, 0.000001 深圳, 116.00700 港股)
 */
function convertToSecid(symbol: string): string {
  const trimmed = symbol.toUpperCase().trim();
  
  // 如果已经是secid格式，直接返回
  if (trimmed.includes('.')) {
    return trimmed;
  }
  
  // 移除前缀
  let code = trimmed;
  if (code.startsWith('SH')) code = code.slice(2);
  if (code.startsWith('SZ')) code = code.slice(2);
  if (code.startsWith('HK')) code = code.slice(2);
  
  // 判断市场
  // 上海: 600xxx, 601xxx, 603xxx, 605xxx, 688xxx
  // 深圳: 000xxx, 001xxx, 002xxx, 003xxx, 300xxx
  // 港股: 5位数字 (00700, 03690等)
  
  const numCode = parseInt(code);
  
  // 港股 (5位)
  if (code.length === 5) {
    return `116.${code}`;
  }
  
  // 上海
  if (numCode >= 600000 || numCode >= 688000) {
    return `1.${code}`;
  }
  
  // 深圳
  return `0.${code}`;
}

/**
 * 格式化股票代码（用于显示）
 * @param input 用户输入
 * @returns 标准格式
 */
export function formatSymbol(input: string): string {
  const trimmed = input.toUpperCase().trim();
  
  // 移除前缀
  let code = trimmed;
  if (code.startsWith('SH')) code = code.slice(2);
  if (code.startsWith('SZ')) code = code.slice(2);
  if (code.startsWith('HK')) code = code.slice(2);
  
  return code;
}

/**
 * 获取市场名称
 */
export function getMarketName(symbol: string): string {
  const code = formatSymbol(symbol);
  const numCode = parseInt(code);
  
  // 港股
  if (code.length === 5) return '香港';
  
  // 上海
  if (numCode >= 600000 || numCode >= 688000) return '上海';
  
  // 深圳
  return '深圳';
}

/**
 * 格式化流通盘
 */
export function formatCapital(capital: number): string {
  if (capital >= 100000000) {
    return (capital / 100000000).toFixed(2) + '亿股';
  } else if (capital >= 10000) {
    return (capital / 10000).toFixed(2) + '万股';
  }
  return capital.toString() + '股';
}

/**
 * 热门股票列表
 */
export const POPULAR_SYMBOLS = [
  { symbol: '600519', name: '贵州茅台', market: '上海' },
  { symbol: '600036', name: '招商银行', market: '上海' },
  { symbol: '600276', name: '恒瑞医药', market: '上海' },
  { symbol: '600900', name: '长江电力', market: '上海' },
  { symbol: '000001', name: '平安银行', market: '深圳' },
  { symbol: '000858', name: '五粮液', market: '深圳' },
  { symbol: '002594', name: '比亚迪', market: '深圳' },
  { symbol: '300750', name: '宁德时代', market: '深圳' },
  { symbol: '00700', name: '腾讯控股', market: '香港' },
  { symbol: '03690', name: '美团-W', market: '香港' },
];
