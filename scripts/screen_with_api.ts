/**
 * 使用项目中已有的指标计算逻辑进行A股筛选
 * 条件：成本偏离度历史高位80%以上 且 CRI 90以上
 */

import { getKlines, convertToSecid } from '../src/utils/eastmoneyApi';
import { calculateAllIndicators } from '../src/utils/indicators';

// A股测试列表（蓝筹股+热门股）
const TEST_STOCKS = [
  { symbol: '600519', name: '贵州茅台', capital: 1256000000 },
  { symbol: '000858', name: '五粮液', capital: 3881000000 },
  { symbol: '600900', name: '长江电力', capital: 24400000000 },
  { symbol: '601012', name: '隆基绿能', capital: 7580000000 },
  { symbol: '300750', name: '宁德时代', capital: 4390000000 },
  { symbol: '601398', name: '工商银行', capital: 356400000000 },
  { symbol: '000001', name: '平安银行', capital: 19410000000 },
  { symbol: '601318', name: '中国平安', capital: 18280000000 },
  { symbol: '600036', name: '招商银行', capital: 25220000000 },
  { symbol: '000002', name: '万科A', capital: 11630000000 },
  { symbol: '601888', name: '中国中免', capital: 2069000000 },
  { symbol: '000568', name: '泸州老窖', capital: 1465000000 },
  { symbol: '002594', name: '比亚迪', capital: 2911000000 },
  { symbol: '000333', name: '美的集团', capital: 6997000000 },
  { symbol: '601668', name: '中国建筑', capital: 41930000000 },
  { symbol: '601728', name: '中国电信', capital: 91570000000 },
  { symbol: '600028', name: '中国石化', capital: 121700000000 },
  { symbol: '601088', name: '中国神华', capital: 19869000000 },
  { symbol: '002142', name: '宁波银行', capital: 6604000000 },
  { symbol: '600809', name: '山西汾酒', capital: 1220000000 },
];

interface ScreenResult {
  symbol: string;
  name: string;
  price: number;
  cri: number;
  criPercentile: number;
  costDeviation: number;
  costDeviationPercentile: number;
  mahs: number;
  meetsCondition: boolean;
}

async function screenStock(stock: typeof TEST_STOCKS[0]): Promise<ScreenResult | null> {
  try {
    console.log(`分析 ${stock.symbol} ${stock.name}...`);
    
    // 获取日K线数据（一年）
    const klineData = await getKlines(stock.symbol, 101, 252);
    
    if (klineData.length < 120) {
      console.log(`  数据不足: ${klineData.length}条`);
      return null;
    }
    
    // 使用项目中的完整指标计算
    const indicators = calculateAllIndicators(klineData, stock.capital);
    const lastIndicator = indicators[indicators.length - 1];
    
    if (!lastIndicator || lastIndicator.cri === null) {
      console.log(`  指标计算失败`);
      return null;
    }
    
    // 计算成本偏离度历史百分位
    const validCostDev = indicators
      .map(i => i.costDeviation)
      .filter((v): v is number => v !== null);
    
    let costDevPercentile = 0;
    if (validCostDev.length >= 60 && lastIndicator.costDeviation !== null) {
      const sorted = [...validCostDev].sort((a, b) => a - b);
      const current = lastIndicator.costDeviation;
      const rank = sorted.filter(v => v <= current).length;
      costDevPercentile = (rank / sorted.length) * 100;
    }
    
    const meetsCondition = costDevPercentile >= 80 && (lastIndicator.cri || 0) >= 90;
    
    const result: ScreenResult = {
      symbol: stock.symbol,
      name: stock.name,
      price: lastIndicator.close,
      cri: lastIndicator.cri || 0,
      criPercentile: lastIndicator.criPercentile || 0,
      costDeviation: lastIndicator.costDeviation || 0,
      costDeviationPercentile: costDevPercentile,
      mahs: lastIndicator.mahs || 0,
      meetsCondition,
    };
    
    console.log(`  CRI: ${result.cri.toFixed(1)}, 成本偏离分位: ${result.costDeviationPercentile.toFixed(1)}% ${meetsCondition ? '✓✓ 满足!' : ''}`);
    
    return result;
  } catch (error) {
    console.log(`  错误: ${error}`);
    return null;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('A股筛选：成本偏离度历史高位80%以上 且 CRI 90以上');
  console.log('='.repeat(70));
  console.log('');
  
  const results: ScreenResult[] = [];
  
  for (const stock of TEST_STOCKS) {
    const result = await screenStock(stock);
    if (result && result.meetsCondition) {
      results.push(result);
    }
    // 延迟避免请求过快
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  console.log('');
  console.log('='.repeat(70));
  console.log(`筛选完成，共找到 ${results.length} 只满足条件的股票`);
  console.log('='.repeat(70));
  console.log('');
  
  if (results.length > 0) {
    console.log('详细结果：');
    console.log('');
    results.forEach((r, i) => {
      console.log(`${i + 1}. ${r.symbol} ${r.name}`);
      console.log(`   当前价: ${r.price.toFixed(2)}`);
      console.log(`   CRI: ${r.cri.toFixed(1)} (分位: ${r.criPercentile.toFixed(1)}%)`);
      console.log(`   成本偏离度: ${r.costDeviation.toFixed(2)} (分位: ${r.costDeviationPercentile.toFixed(1)}%)`);
      console.log(`   换手成本MAHS: ${r.mahs.toFixed(2)}`);
      console.log('');
    });
    
    // 输出表格
    console.log('汇总表格：');
    console.table(results.map(r => ({
      代码: r.symbol,
      名称: r.name,
      价格: r.price.toFixed(2),
      CRI: r.cri.toFixed(1),
      成本偏离分位: r.costDeviationPercentile.toFixed(1) + '%',
    })));
  } else {
    console.log('当前没有股票同时满足两个条件。');
    console.log('');
    console.log('可能原因：');
    console.log('1. 市场处于相对稳定状态，没有极端恐慌');
    console.log('2. 成本偏离度高的股票CRI尚未达到极端水平');
    console.log('3. 当前是结构性行情，并非全面恐慌');
  }
}

main().catch(console.error);
