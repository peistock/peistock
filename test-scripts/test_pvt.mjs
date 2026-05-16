/**
 * PVT (价量趋势指标) 测试工具 - 通达信公式版本
 * SUM(VOL * (CLOSE-REF(CLOSE,1))/REF(CLOSE,1), 0)
 * 
 * 使用方法:
 * node test-scripts/test_pvt.mjs <股票代码> [背离检测窗口，默认20]
 * 例如: node test-scripts/test_pvt.mjs 600989 20
 */

// ============ 数据获取函数 ============

function convertToSecid(symbol) {
  if (symbol.length === 5) return `116.${symbol}`;
  if (symbol.startsWith('6')) return `1.${symbol}`;
  return `0.${symbol}`;
}

async function getStockData(symbol, limit = 500) {
  const secid = convertToSecid(symbol);
  const klt = 101;
  
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=${klt}&fqt=0&end=20500101&lmt=${limit}`;
  
  const response = await fetch(url);
  if (!response.ok) throw new Error(`获取K线数据失败: ${response.status}`);
  
  const data = await response.json();
  if (!data.data || !data.data.klines || data.data.klines.length === 0) {
    throw new Error('无数据返回，请检查股票代码');
  }
  
  const isHK = secid.startsWith('116.');
  
  return data.data.klines.map((line) => {
    const parts = line.split(',');
    return {
      time: parts[0],
      open: parseFloat(parts[1]),
      close: parseFloat(parts[2]),
      low: parseFloat(parts[3]),
      high: parseFloat(parts[4]),
      volume: isHK ? parseFloat(parts[5]) : parseFloat(parts[5]) * 100,
      amount: parseFloat(parts[6]),
    };
  });
}

// ============ PVT 计算函数 ============

/**
 * 计算PVT - 通达信公式: SUM(VOL * (CLOSE-REF(CLOSE,1))/REF(CLOSE,1), 0)
 * @param {Object[]} stockData - K线数据
 * @param {number} lookback - 背离检测窗口，默认20天
 */
function calculatePVT(stockData, lookback = 20) {
  const n = stockData.length;
  const pvt = new Array(n).fill(null);
  const pvtDivergence = new Array(n).fill(null);
  const pvtTrend = new Array(n).fill(null);
  
  if (n < 2) return { pvt, pvtDivergence, pvtTrend };
  
  console.log(`\n📊 原始数据 (${n}条):`);
  console.log("日期\t\t收盘价\t成交量\t\t涨跌幅");
  console.log("-".repeat(70));
  
  // 计算PVT累积值 - 从第一天开始累积
  pvt[0] = 0;
  for (let i = 1; i < n; i++) {
    const priceChange = (stockData[i].close - stockData[i - 1].close) / stockData[i - 1].close;
    pvt[i] = (pvt[i - 1] || 0) + stockData[i].volume * priceChange;
    
    if (i >= n - 10) {
      const date = stockData[i].time;
      const changePct = (priceChange * 100).toFixed(2);
      const volStr = stockData[i].volume >= 10000 ? 
        `${(stockData[i].volume / 10000).toFixed(0)}万` : 
        stockData[i].volume.toString();
      console.log(`${date}\t${stockData[i].close.toFixed(2)}\t${volStr}\t\t${changePct}%`);
    }
  }
  
  console.log("\n📈 PVT 累积计算 (最近10天):");
  console.log("日期\t\t价格变动\tPVT增量\t\tPVT累积");
  console.log("-".repeat(80));
  
  for (let i = Math.max(1, n - 10); i < n; i++) {
    const date = stockData[i].time;
    const priceChange = (stockData[i].close - stockData[i - 1].close) / stockData[i - 1].close;
    const pvtChange = stockData[i].volume * priceChange;
    
    console.log(`${date}\t${(priceChange * 100).toFixed(2)}%\t${pvtChange.toFixed(0)}\t\t${pvt[i].toFixed(0)}`);
  }
  
  // 计算PVT趋势（与5天前比较）
  for (let i = 5; i < n; i++) {
    const diff = (pvt[i] || 0) - (pvt[i - 5] || 0);
    if (diff > 0) pvtTrend[i] = 'rising';
    else if (diff < 0) pvtTrend[i] = 'falling';
    else pvtTrend[i] = 'flat';
  }
  
  // 检测背离 - 使用 lookback 天窗口
  console.log(`\n🔍 背离检测 (${lookback}天窗口):`);
  console.log("日期\t\t价格位置\tPVT位置\t\t背离类型");
  console.log("-".repeat(75));
  
  for (let i = lookback; i < n; i++) {
    // 取最近 lookback 日的数据
    const recentPrice = stockData.slice(i - lookback, i + 1).map(d => d.close);
    const recentPVT = pvt.slice(i - lookback, i + 1).filter(v => v !== null);
    
    if (recentPVT.length < lookback) continue;
    
    // 找到价格和PVT的最高/最低点位置
    const priceHighIdx = recentPrice.indexOf(Math.max(...recentPrice));
    const pvtHighIdx = recentPVT.indexOf(Math.max(...recentPVT));
    const priceLowIdx = recentPrice.indexOf(Math.min(...recentPrice));
    const pvtLowIdx = recentPVT.indexOf(Math.min(...recentPVT));
    
    const currentPrice = stockData[i].close;
    const currentPVT = pvt[i] || 0;
    
    // 顶背离判断（只修复负数比较，保持原条件）
    const price5DaysAgo = stockData[i - 5]?.close || currentPrice;
    const isPriceHigher = currentPrice > price5DaysAgo * 1.01; // 价格创新高>1%
    const priceHighLater = priceHighIdx >= pvtHighIdx;
    
    // 修复负数比较：使用相对差距
    const pvtHighValue = recentPVT[pvtHighIdx];
    const pvtGapRatio = (pvtHighValue - currentPVT) / (Math.abs(pvtHighValue) + 1e-10);
    const isPVTNotHigher = pvtGapRatio > 0.02; // PVT低于高点2%以上
    
    if (priceHighLater && isPriceHigher && isPVTNotHigher) {
      pvtDivergence[i] = 'top';
      if (i >= n - 10) {
        const date = stockData[i].time;
        console.log(`${date}\t价格新高${recentPrice[priceHighIdx].toFixed(2)}\tPVT未新高${recentPVT[pvtHighIdx].toFixed(0)}\t⚠️ 顶背离`);
      }
    }
    // 底背离判断（只修复负数比较+价格位置过滤）
    else {
      // 计算BIAS判断价格位置
      const ma20 = recentPrice.reduce((a, b) => a + b, 0) / recentPrice.length;
      const bias = (currentPrice - ma20) / ma20 * 100;
      const isPriceHigh = bias > 10;
      
      const isPriceLower = currentPrice < price5DaysAgo * 0.99;
      const priceLowLater = priceLowIdx >= pvtLowIdx;
      
      // 修复负数比较：使用相对差距
      const pvtLowValue = recentPVT[pvtLowIdx];
      const pvtGapRatio = (currentPVT - pvtLowValue) / (Math.abs(pvtLowValue) + 1e-10);
      const isPVTNotLower = pvtGapRatio > 0.02; // PVT高于低点2%以上
      
      // 底背离只在非高位时显示
      if (priceLowLater && isPriceLower && isPVTNotLower && !isPriceHigh) {
        pvtDivergence[i] = 'bottom';
        if (i >= n - 10) {
          const date = stockData[i].time;
          console.log(`${date}\t价格新低${recentPrice[priceLowIdx].toFixed(2)}\tPVT未新低${recentPVT[pvtLowIdx].toFixed(0)}\t✅ 底背离`);
        }
      } else {
        pvtDivergence[i] = 'none';
      }
    }
  }
  
  return { pvt, pvtDivergence, pvtTrend };
}

// ============ 主程序 ============

async function main() {
  const stockCode = process.argv[2];
  const lookback = parseInt(process.argv[3]) || 20;
  
  if (!stockCode) {
    console.error("❌ 请提供股票代码");
    console.error("用法: node test-scripts/test_pvt.mjs <股票代码> [背离窗口]");
    process.exit(1);
  }
  
  console.log(`\n🔍 测试股票: ${stockCode}`);
  console.log(`📅 背离检测窗口: ${lookback}天`);
  console.log("=".repeat(60));
  
  try {
    console.log("\n📡 正在获取股票数据...");
    const stockData = await getStockData(stockCode, 500);
    
    if (!stockData || stockData.length < lookback + 5) {
      console.error(`❌ 数据不足，需要至少 ${lookback + 5} 条数据`);
      process.exit(1);
    }
    
    console.log(`✅ 获取到 ${stockData.length} 条数据`);
    
    const result = calculatePVT(stockData, lookback);
    
    // 输出汇总
    console.log("\n" + "=".repeat(60));
    console.log("📊 PVT 汇总结果 (最近10天):");
    console.log("=".repeat(60));
    console.log("日期\t\t收盘价\tPVT累积\t\t趋势\t背离信号");
    console.log("-".repeat(80));
    
    const n = stockData.length;
    for (let i = Math.max(5, n - 10); i < n; i++) {
      const date = stockData[i].time;
      const close = stockData[i].close.toFixed(2);
      const pvt = result.pvt[i].toFixed(0);
      const trend = result.pvtTrend[i] === 'rising' ? '↑' : 
                    result.pvtTrend[i] === 'falling' ? '↓' : '-';
      const div = result.pvtDivergence[i] === 'top' ? '⚠️ 顶背离' :
                  result.pvtDivergence[i] === 'bottom' ? '✅ 底背离' : '-';
      
      console.log(`${date}\t${close}\t${pvt}\t${trend}\t${div}`);
    }
    
    // 最新状态
    const latest = n - 1;
    console.log("\n" + "=".repeat(60));
    console.log("🎯 最新状态:");
    console.log(`   股票代码: ${stockCode}`);
    console.log(`   最新日期: ${stockData[latest].time}`);
    console.log(`   收盘价: ${stockData[latest].close.toFixed(2)}`);
    console.log(`   PVT累积值: ${result.pvt[latest].toFixed(0)}`);
    console.log(`   PVT趋势(5日): ${result.pvtTrend[latest] === 'rising' ? '↑ 上升' : result.pvtTrend[latest] === 'falling' ? '↓ 下降' : '→ 走平'}`);
    
    const latestDiv = result.pvtDivergence[latest];
    if (latestDiv === 'top') {
      console.log(`   价量背离(20日): ⚠️ 顶背离 - 价格新高但量能不足，建议减仓`);
    } else if (latestDiv === 'bottom') {
      console.log(`   价量背离(20日): ✅ 底背离 - 价格新低但量能未跟随，关注反弹`);
    } else {
      console.log(`   价量背离(20日): 无背离`);
    }
    
    // 统计
    console.log("\n📈 近期背离统计 (最近30天):");
    let topCount = 0, bottomCount = 0;
    for (let i = Math.max(0, n - 30); i < n; i++) {
      if (result.pvtDivergence[i] === 'top') topCount++;
      if (result.pvtDivergence[i] === 'bottom') bottomCount++;
    }
    console.log(`   顶背离次数: ${topCount}`);
    console.log(`   底背离次数: ${bottomCount}`);
    
    // 交易建议
    console.log("\n💡 交易建议:");
    if (latestDiv === 'top') {
      console.log(`   ⚠️ 价量顶背离，建议减仓`);
    } else if (latestDiv === 'bottom') {
      console.log(`   ✅ 价量底背离，可左侧试探`);
    } else {
      console.log(`   ⚪ 无明确背离信号`);
    }
    
    console.log("=".repeat(60));
    
  } catch (error) {
    console.error("❌ 错误:", error.message);
    process.exit(1);
  }
}

main();
