#!/usr/bin/env node
/**
 * A股筛选脚本
 * 条件：成本偏离度历史高位80%以上 且 CRI 90以上
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// A股列表（简化版，只包含主要股票）
const A_STOCKS = [
  { symbol: '600519', name: '贵州茅台' },
  { symbol: '000858', name: '五粮液' },
  { symbol: '000333', name: '美的集团' },
  { symbol: '000001', name: '平安银行' },
  { symbol: '600036', name: '招商银行' },
  { symbol: '600900', name: '长江电力' },
  { symbol: '002594', name: '比亚迪' },
  { symbol: '300750', name: '宁德时代' },
  { symbol: '601012', name: '隆基绿能' },
  { symbol: '601318', name: '中国平安' },
  { symbol: '600276', name: '恒瑞医药' },
  { symbol: '000568', name: '泸州老窖' },
  { symbol: '002415', name: '海康威视' },
  { symbol: '000002', name: '万科A' },
  { symbol: '600030', name: '中信证券' },
  { symbol: '601398', name: '工商银行' },
  { symbol: '601288', name: '农业银行' },
  { symbol: '601939', name: '建设银行' },
  { symbol: '600887', name: '伊利股份' },
  { symbol: '600309', name: '万华化学' },
  { symbol: '601888', name: '中国中免' },
  { symbol: '002142', name: '宁波银行' },
  { symbol: '600809', name: '山西汾酒' },
  { symbol: '300059', name: '东方财富' },
  { symbol: '601668', name: '中国建筑' },
  { symbol: '601728', name: '中国电信' },
  { symbol: '600028', name: '中国石化' },
  { symbol: '601857', name: '中国石油' },
  { symbol: '601088', name: '中国神华' },
  { symbol: '601225', name: '陕西煤业' },
];

// 获取K线数据
async function getKlines(symbol, klt = 101, limit = 252) {
  const isSh = symbol.startsWith('6');
  const secid = isSh ? `1.${symbol}` : `0.${symbol}`;
  
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${klt}&fqt=0&end=20500101&lmt=${limit}`;
  
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  
  const data = await response.json();
  if (!data.data?.klines) throw new Error('无数据');
  
  return data.data.klines.map(line => {
    const parts = line.split(',');
    return {
      date: parts[0],
      open: parseFloat(parts[1]),
      close: parseFloat(parts[2]),
      low: parseFloat(parts[3]),
      high: parseFloat(parts[4]),
      volume: parseFloat(parts[5]) * 100,
      amount: parseFloat(parts[6]),
    };
  });
}

// 计算简单均线
function calculateMA(data, period) {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    return sum / period;
  });
}

// 计算CRI简化版
function calculateCRI(data) {
  const ma99 = calculateMA(data, 99);
  
  return data.map((d, i) => {
    if (i < 99) return { cri: null, costDeviation: null };
    
    const costDev = d.close - (ma99[i] || d.close);
    let cri = 0;
    
    // 成本负偏离
    if (costDev < 0) {
      cri += Math.min(Math.abs(costDev) / (ma99[i] || 1) * 100 * 2, 40);
    }
    
    // 跳空风险
    if (i > 0) {
      const gap = (d.open - data[i-1].close) / data[i-1].close * 100;
      if (gap < -2) cri += 20;
      else if (gap < -1) cri += 10;
    }
    
    // 波动率
    const volatility = (d.high - d.low) / d.low * 100;
    cri += Math.min(volatility * 3, 30);
    
    return { cri: Math.min(cri, 100), costDeviation: costDev };
  });
}

async function main() {
  console.log('开始筛选A股...');
  console.log('条件：成本偏离度历史高位80%以上 且 CRI 90以上\n');
  
  const results = [];
  
  for (const stock of A_STOCKS) {
    try {
      process.stdout.write(`${stock.symbol} ${stock.name} ... `);
      
      const klines = await getKlines(stock.symbol, 101, 252);
      if (klines.length < 120) {
        console.log('数据不足');
        continue;
      }
      
      const indicators = calculateCRI(klines);
      const last = indicators[indicators.length - 1];
      
      if (!last.cri) {
        console.log('计算失败');
        continue;
      }
      
      const validCostDev = indicators.filter(i => i.costDeviation !== null).map(i => i.costDeviation);
      const sorted = [...validCostDev].sort((a, b) => a - b);
      const rank = sorted.filter(v => v <= (last.costDeviation || 0)).length;
      const costDevPercentile = (rank / sorted.length) * 100;
      
      const meetsCondition1 = costDevPercentile >= 80;
      const meetsCondition2 = last.cri >= 90;
      
      if (meetsCondition1 && meetsCondition2) {
        console.log('✓ 满足条件');
        results.push({
          代码: stock.symbol,
          名称: stock.name,
          CRI: last.cri.toFixed(1),
          成本偏离度: (last.costDeviation || 0).toFixed(2),
          成本偏离百分位: costDevPercentile.toFixed(1) + '%',
          当前价: klines[klines.length - 1].close.toFixed(2)
        });
      } else {
        console.log(`条件1:${meetsCondition1 ? '✓' : '✗'} 条件2:${meetsCondition2 ? '✓' : '✗'}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.log(`错误: ${error.message}`);
    }
  }
  
  console.log('\n========================================');
  console.log(`筛选完成，共找到 ${results.length} 只满足条件的股票`);
  console.log('========================================\n');
  
  if (results.length > 0) {
    console.table(results);
    const outputPath = path.join(__dirname, '../screen_results.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n结果已保存到: ${outputPath}`);
  } else {
    console.log('当前没有股票同时满足两个条件。');
  }
}

main().catch(console.error);
