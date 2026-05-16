/**
 * 简化测试脚本 - 扫描前5只股票
 */

import { getUniqueWatchlist } from '../src/data/watchlist';

async function testScan() {
  const stocks = getUniqueWatchlist();
  console.log(`共加载 ${stocks.length} 只股票`);
  console.log('前5只股票:');
  
  for (let i = 0; i < Math.min(5, stocks.length); i++) {
    const s = stocks[i];
    console.log(`  ${i+1}. ${s.code} ${s.name} [${s.market}]${s.star ? ' ⭐' : ''}`);
  }
}

testScan();
