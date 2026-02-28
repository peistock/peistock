import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 更多A股（包含中小盘股，更容易出现极端条件）
const MORE_STOCKS = [
  // 前期强势板块回调股
  { symbol: '002460', name: '赣锋锂业' },
  { symbol: '002466', name: '天齐锂业' },
  { symbol: '300014', name: '亿纬锂能' },
  { symbol: '300124', name: '汇川技术' },
  { symbol: '002271', name: '东方雨虹' },
  { symbol: '601012', name: '隆基绿能' },
  { symbol: '600438', name: '通威股份' },
  { symbol: '002129', name: 'TCL中环' },
  { symbol: '600089', name: '特变电工' },
  { symbol: '601615', name: '明阳智能' },
  // 消费板块
  { symbol: '000895', name: '双汇发展' },
  { symbol: '603288', name: '海天味业' },
  { symbol: '600873', name: '梅花生物' },
  { symbol: '603899', name: '晨光股份' },
  { symbol: '002304', name: '洋河股份' },
  // 医药板块
  { symbol: '300760', name: '迈瑞医疗' },
  { symbol: '600436', name: '片仔癀' },
  { symbol: '000538', name: '云南白药' },
  { symbol: '603259', name: '药明康德' },
  { symbol: '300122', name: '智飞生物' },
  // TMT板块
  { symbol: '000063', name: '中兴通讯' },
  { symbol: '600498', name: '烽火通信' },
  { symbol: '300408', name: '三环集团' },
  { symbol: '002236', name: '大华股份' },
  { symbol: '601138', name: '工业富联' },
  // 金融地产链
  { symbol: '001979', name: '招商蛇口' },
  { symbol: '600048', name: '保利发展' },
  { symbol: '000069', name: '华侨城A' },
  { symbol: '600383', name: '金地集团' },
  { symbol: '601166', name: '兴业银行' },
  // 周期板块
  { symbol: '000878', name: '云南铜业' },
  { symbol: '000630', name: '铜陵有色' },
  { symbol: '601899', name: '紫金矿业' },
  { symbol: '603993', name: '洛阳钼业' },
  { symbol: '600362', name: '江西铜业' },
  { symbol: '601600', name: '中国铝业' },
  { symbol: '600111', name: '北方稀土' },
  { symbol: '603799', name: '华友钴业' },
  { symbol: '002240', name: '盛新锂能' },
  { symbol: '002497', name: '雅化集团' },
];

async function getKlines(symbol, limit = 252) {
  const isSh = symbol.startsWith('6');
  const secid = isSh ? `1.${symbol}` : `0.${symbol}`;
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=0&end=20500101&lmt=${limit}`;
  
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.data?.klines) throw new Error('无数据');
  
  return data.data.klines.map(line => {
    const p = line.split(',');
    return { date: p[0], open: +p[1], close: +p[2], low: +p[3], high: +p[4], volume: +p[5] * 100 };
  });
}

function calculateMA(data, period) {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    return sum / period;
  });
}

function calculateCRI(data) {
  const ma99 = calculateMA(data, 99);
  return data.map((d, i) => {
    if (i < 99) return { cri: null, costDeviation: null };
    const costDev = d.close - (ma99[i] || d.close);
    let cri = 0;
    if (costDev < 0) cri += Math.min(Math.abs(costDev) / (ma99[i] || 1) * 100 * 2, 40);
    if (i > 0) {
      const gap = (d.open - data[i-1].close) / data[i-1].close * 100;
      if (gap < -2) cri += 20; else if (gap < -1) cri += 10;
    }
    const volatility = (d.high - d.low) / d.low * 100;
    cri += Math.min(volatility * 3, 30);
    return { cri: Math.min(cri, 100), costDeviation: costDev };
  });
}

async function main() {
  console.log('扩大范围筛选A股...');
  console.log('条件：成本偏离度历史高位80%以上 且 CRI 90以上\n');
  
  const results = [];
  
  for (const stock of MORE_STOCKS) {
    try {
      process.stdout.write(`${stock.symbol} ${stock.name.padEnd(8)} ... `);
      
      const klines = await getKlines(stock.symbol, 252);
      if (klines.length < 120) { console.log('数据不足'); continue; }
      
      const indicators = calculateCRI(klines);
      const last = indicators[indicators.length - 1];
      if (!last.cri) { console.log('计算失败'); continue; }
      
      const validCostDev = indicators.filter(i => i.costDeviation !== null).map(i => i.costDeviation);
      const sorted = [...validCostDev].sort((a, b) => a - b);
      const rank = sorted.filter(v => v <= (last.costDeviation || 0)).length;
      const costDevPercentile = (rank / sorted.length) * 100;
      
      const meets1 = costDevPercentile >= 80;
      const meets2 = last.cri >= 90;
      
      if (meets1 && meets2) {
        console.log('✓✓ 满足双条件');
        results.push({
          代码: stock.symbol,
          名称: stock.name,
          CRI: last.cri.toFixed(1),
          成本偏离度: (last.costDeviation || 0).toFixed(2),
          成本偏离百分位: costDevPercentile.toFixed(1) + '%',
          当前价: klines[klines.length - 1].close.toFixed(2)
        });
      } else {
        console.log(`${meets1 ? '偏离高' : '     '} ${meets2 ? 'CRI高' : '     '}`);
      }
      
      await new Promise(r => setTimeout(r, 200));
    } catch (error) {
      console.log(`错误: ${error.message}`);
    }
  }
  
  console.log('\n========================================');
  console.log(`共找到 ${results.length} 只满足条件的股票`);
  console.log('========================================');
  
  if (results.length > 0) {
    console.table(results);
    fs.writeFileSync(path.join(__dirname, '../screen_results_extended.json'), JSON.stringify(results, null, 2));
  } else {
    console.log('\n当前没有股票同时满足两个条件。');
    console.log('这可能意味着：');
    console.log('1. 市场处于相对稳定状态，没有极端恐慌');
    console.log('2. 成本偏离度高的股票CRI尚未达到极端水平');
    console.log('3. 或者CRI高的股票成本偏离度还未到历史高位');
  }
}

main().catch(console.error);
