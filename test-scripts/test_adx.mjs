/**
 * ADX (平均趋向指数) 测试工具
 * 用于单独测试某只股票的 ADX 计算逻辑
 * 
 * 使用方法:
 * node test-scripts/test_adx.mjs <股票代码> [周期，默认14]
 * 例如: node test-scripts/test_adx.mjs 600989 14
 */

// ============ 数据获取函数 ============

/**
 * 转换股票代码为东方财富格式
 * @param {string} symbol - 股票代码
 * @returns {string} secid
 */
function convertToSecid(symbol) {
  // 港股
  if (symbol.length === 5) {
    return `116.${symbol}`;
  }
  // A股
  if (symbol.startsWith('6')) {
    return `1.${symbol}`; // 上海
  }
  return `0.${symbol}`; // 深圳
}

/**
 * 获取股票K线数据
 * @param {string} symbol - 股票代码
 * @param {number} limit - 数据条数，默认500
 * @returns {Promise<Object[]>} - K线数据
 */
async function getStockData(symbol, limit = 500) {
  const secid = convertToSecid(symbol);
  const klt = 101; // 日线
  
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
  
  return data.data.klines.map((line) => {
    const parts = line.split(',');
    return {
      time: parts[0],
      open: parseFloat(parts[1]),
      close: parseFloat(parts[2]),
      low: parseFloat(parts[3]),
      high: parseFloat(parts[4]),
      // 港股成交量直接是股，A股是手需要乘100
      volume: isHK ? parseFloat(parts[5]) : parseFloat(parts[5]) * 100,
      amount: parseFloat(parts[6]),
    };
  });
}

// ============ ADX 计算函数 ============

/**
 * Wilder平滑法
 * @param {number[]} data - 数据数组
 * @param {number} period - 周期
 * @returns {number[]}
 */
function wilderSmooth(data, period) {
  const result = [];
  if (data.length < period) return result;
  
  // 第一个值是简单平均
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  result.push(sum / period);
  
  // 后续使用Wilder公式
  for (let i = period; i < data.length; i++) {
    const prevEMA = result[result.length - 1];
    result.push((prevEMA * (period - 1) + data[i]) / period);
  }
  
  return result;
}

/**
 * 计算ADX
 * @param {Object[]} stockData - K线数据 {high, low, close}
 * @param {number} period - 周期，默认14
 * @returns {Object} {adx[], plusDI[], minusDI[], adxState[]}
 */
function calculateADX(stockData, period = 14) {
  const n = stockData.length;
  const adx = new Array(n).fill(null);
  const plusDI = new Array(n).fill(null);
  const minusDI = new Array(n).fill(null);
  const adxState = new Array(n).fill(null);
  
  if (n < period + 1) {
    return { adx, plusDI, minusDI, adxState };
  }
  
  // 计算+DM, -DM, TR
  const plusDM = [];
  const minusDM = [];
  const tr = [];
  
  console.log(`\n📊 原始数据 (${n}条):`);
  console.log("日期\t\t最高价\t最低价\t收盘价");
  console.log("-".repeat(60));
  
  for (let i = 1; i < n; i++) {
    const current = stockData[i];
    const prev = stockData[i - 1];
    
    // 打印最近几天的原始数据
    if (i >= n - 10) {
      console.log(`${current.time}\t${current.high.toFixed(2)}\t${current.low.toFixed(2)}\t${current.close.toFixed(2)}`);
    }
    
    const upMove = current.high - prev.high;
    const downMove = prev.low - current.low;
    
    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }
    
    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
    
    // TR = max(high-low, |high-prevClose|, |low-prevClose|)
    const tr1 = current.high - current.low;
    const tr2 = Math.abs(current.high - prev.close);
    const tr3 = Math.abs(current.low - prev.close);
    tr.push(Math.max(tr1, tr2, tr3));
  }
  
  console.log("\n📈 DM 和 TR 计算 (最近5天):");
  console.log("索引\t+DM\t-DM\tTR");
  console.log("-".repeat(40));
  for (let i = Math.max(0, plusDM.length - 5); i < plusDM.length; i++) {
    console.log(`${i}\t${plusDM[i].toFixed(2)}\t${minusDM[i].toFixed(2)}\t${tr[i].toFixed(2)}`);
  }
  
  // 使用Wilder平滑计算
  const smoothPlusDM = wilderSmooth(plusDM, period);
  const smoothMinusDM = wilderSmooth(minusDM, period);
  const smoothTR = wilderSmooth(tr, period);
  
  console.log(`\n🔄 Wilder平滑后 (${period}周期):`);
  console.log("索引\t+DM平滑\t-DM平滑\tTR平滑");
  console.log("-".repeat(50));
  for (let i = Math.max(0, smoothTR.length - 5); i < smoothTR.length; i++) {
    console.log(`${i}\t${smoothPlusDM[i]?.toFixed(2) || '-'}\t${smoothMinusDM[i]?.toFixed(2) || '-'}\t${smoothTR[i]?.toFixed(2) || '-'}`);
  }
  
  // 计算+DI和-DI
  for (let i = period; i < n; i++) {
    const idx = i - period;
    if (smoothTR[idx] > 0) {
      plusDI[i] = 100 * smoothPlusDM[idx] / smoothTR[idx];
      minusDI[i] = 100 * smoothMinusDM[idx] / smoothTR[idx];
      
      const currentPlusDI = plusDI[i];
      const currentMinusDI = minusDI[i];
      
      const diDiff = Math.abs(currentPlusDI - currentMinusDI);
      const diSum = currentPlusDI + currentMinusDI;
      
      if (diSum > 0) {
        const dx = 100 * diDiff / diSum;
        
        // 计算ADX（DX的Wilder平滑）
        if (i === period) {
          adx[i] = dx;
        } else {
          const prevADX = adx[i - 1] ?? dx;
          adx[i] = (prevADX * (period - 1) + dx) / period;
        }
        
        // 判断ADX状态（与3天前比较）
        if (i >= period + 3) {
          const currentADX = adx[i];
          const adx3DaysAgo = adx[i - 3];
          if (currentADX !== null && adx3DaysAgo !== null) {
            const diff = currentADX - adx3DaysAgo;
            if (diff > 1) {
              adxState[i] = 'rising';
            } else if (diff < -1) {
              adxState[i] = 'falling';
            } else {
              adxState[i] = 'flat';
            }
          }
        }
      }
    }
  }
  
  return { adx, plusDI, minusDI, adxState };
}

// ============ 主程序 ============

async function main() {
  const stockCode = process.argv[2];
  const period = parseInt(process.argv[3]) || 14;
  
  if (!stockCode) {
    console.error("❌ 请提供股票代码");
    console.error("用法: node test-scripts/test_adx.mjs <股票代码> [周期]");
    process.exit(1);
  }
  
  console.log(`\n🔍 测试股票: ${stockCode}`);
  console.log(`📅 ADX周期: ${period}天`);
  console.log("=".repeat(60));
  
  try {
    // 获取股票数据
    console.log("\n📡 正在获取股票数据...");
    const stockData = await getStockData(stockCode, 500);
    
    if (!stockData || stockData.length < period + 10) {
      console.error(`❌ 数据不足，需要至少 ${period + 10} 条数据，实际只有 ${stockData?.length || 0} 条`);
      process.exit(1);
    }
    
    console.log(`✅ 获取到 ${stockData.length} 条数据`);
    
    // 计算ADX
    const result = calculateADX(stockData, period);
    
    // 输出结果
    console.log("\n" + "=".repeat(60));
    console.log("📊 ADX 计算结果 (最近10天):");
    console.log("=".repeat(60));
    console.log("日期\t\t+DI\t-DI\tADX\t状态\t趋势强度");
    console.log("-".repeat(75));
    
    const n = stockData.length;
    for (let i = Math.max(period, n - 10); i < n; i++) {
      const date = stockData[i].time;
      const pdi = result.plusDI[i];
      const mdi = result.minusDI[i];
      const adx = result.adx[i];
      const state = result.adxState[i] || '-';
      
      let trendStrength = '-';
      if (adx !== null) {
        if (adx >= 40) trendStrength = '强趋势';
        else if (adx >= 20) trendStrength = '中等';
        else trendStrength = '弱/震荡';
      }
      
      console.log(
        `${date}\t` +
        `${pdi !== null ? pdi.toFixed(2) : '-'}\t` +
        `${mdi !== null ? mdi.toFixed(2) : '-'}\t` +
        `${adx !== null ? adx.toFixed(2) : '-'}\t` +
        `${state}\t` +
        `${trendStrength}`
      );
    }
    
    // 输出最新状态
    const latest = n - 1;
    console.log("\n" + "=".repeat(60));
    console.log("🎯 最新状态:");
    console.log(`   股票代码: ${stockCode}`);
    console.log(`   最新日期: ${stockData[latest].time}`);
    console.log(`   收盘价: ${stockData[latest].close.toFixed(2)}`);
    console.log(`   +DI: ${result.plusDI[latest]?.toFixed(2) || '-'}`);
    console.log(`   -DI: ${result.minusDI[latest]?.toFixed(2) || '-'}`);
    console.log(`   ADX: ${result.adx[latest]?.toFixed(2) || '-'}`);
    console.log(`   ADX状态: ${result.adxState[latest] || '-'}`);
    
    const latestADX = result.adx[latest];
    if (latestADX !== null) {
      console.log(`   趋势强度: ${latestADX >= 40 ? '🔥 强趋势' : latestADX >= 20 ? '⚡ 中等趋势' : '💤 弱趋势/震荡'}`);
      
      // 交易信号提示
      const pdi = result.plusDI[latest];
      const mdi = result.minusDI[latest];
      if (pdi > mdi && latestADX >= 25) {
        console.log(`   信号: 🟢 多头趋势${latestADX >= 40 ? '强劲' : ''}`);
      } else if (pdi < mdi && latestADX >= 25) {
        console.log(`   信号: 🔴 空头趋势${latestADX >= 40 ? '强劲' : ''}`);
      } else {
        console.log(`   信号: ⚪ 无明确趋势`);
      }
    }
    console.log("=".repeat(60));
    
  } catch (error) {
    console.error("❌ 错误:", error.message);
    process.exit(1);
  }
}

main();
