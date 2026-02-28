/**
 * 指标分位数测试工具
 * 用于单独测试某只股票的分位数计算逻辑
 * 
 * 使用方法:
 * node test-scripts/test_percentile.mjs <股票代码>
 * 或直接在脚本中修改测试数据
 */

// ============ 分位数计算函数 ============

/**
 * 计算BIAS（乖离率）
 * @param {number[]} closes - 收盘价数组
 * @param {number[]} ma - 均线数组
 * @returns {(number|null)[]}
 */
function calculateBIAS(closes, ma) {
  return closes.map((close, i) => {
    const maValue = ma[i];
    if (maValue === null || maValue === 0) return null;
    return ((close - maValue) / maValue) * 100;
  });
}

/**
 * 计算简单移动平均
 * @param {number[]} data - 数据数组
 * @param {number} period - 周期
 * @returns {(number|null)[]}
 */
function calculateSMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j];
    }
    result.push(sum / period);
  }
  return result;
}

/**
 * 计算分位数（使用线性插值）
 * @param {number} current - 当前值
 * @param {number[]} history - 历史数据
 * @returns {number}
 */
function calculatePercentile(current, history) {
  if (history.length === 0) return 50;
  const sorted = [...history].sort((a, b) => a - b);
  const lessThan = sorted.filter(v => v < current).length;
  const equalTo = sorted.filter(v => v === current).length;
  const rank = lessThan + equalTo / 2;
  return (rank / history.length) * 100;
}

/**
 * 计算120天窗口分位数（旧算法）
 * @param {number} current - 当前值
 * @param {(number|null)[]} fullHistory - 完整历史数据
 * @param {number} index - 当前索引
 * @returns {number|null}
 */
function calculate120DayPercentile(current, fullHistory, index) {
  const history = fullHistory.slice(Math.max(0, index - 119), index).filter(v => v !== null);
  if (history.length < 30) return null;
  const sorted = [...history].sort((a, b) => a - b);
  const rank = sorted.findIndex(v => v >= current);
  return rank >= 0 ? (rank / sorted.length) * 100 : 100;
}

/**
 * 计算全部历史分位数（新算法）
 * @param {number} current - 当前值
 * @param {(number|null)[]} fullHistory - 完整历史数据
 * @param {number} index - 当前索引
 * @param {number} startIndex - 有效数据起始索引
 * @returns {number|null}
 */
function calculateFullHistoryPercentile(current, fullHistory, index, startIndex = 0) {
  const history = fullHistory.slice(startIndex, index).filter(v => v !== null);
  if (history.length < 30) return null;
  return calculatePercentile(current, history);
}

// ============ 测试场景 ============

/**
 * 测试场景1：持续上涨后的BIAS分位数
 * 模拟股价持续上涨，BIAS高位回落的情况
 */
function testRisingTrendBIAS() {
  console.log("\n" + "=".repeat(60));
  console.log("测试场景1：持续上涨后的BIAS225分位数");
  console.log("=".repeat(60));

  const totalDays = 500;
  const closes = [];
  
  // 前400天缓慢上涨
  for (let i = 0; i < 400; i++) {
    closes.push(10 + i * 0.1);
  }
  // 后100天快速拉升
  for (let i = 400; i < totalDays; i++) {
    closes.push(50 + (i - 400) * 0.5);
  }

  const ma225 = calculateSMA(closes, 225);
  const bias225 = calculateBIAS(closes, ma225);

  // 计算最后几天的分位数
  const startIdx = bias225.findIndex(v => v !== null);
  const lastIdx = bias225.length - 1;

  console.log(`\n数据天数: ${totalDays}`);
  console.log(`第一个有效BIAS索引: ${startIdx}`);
  console.log(`最后5天分位数对比:`);
  console.log("-".repeat(50));
  console.log("日期\t\tBIAS\t120天窗口\t全部历史");
  console.log("-".repeat(50));

  for (let i = Math.max(lastIdx - 4, startIdx + 30); i <= lastIdx; i++) {
    const current = bias225[i];
    if (current === null) continue;
    
    const oldPct = calculate120DayPercentile(current, bias225, i);
    const newPct = calculateFullHistoryPercentile(current, bias225, i, startIdx);
    const day = `T-${lastIdx - i}`;
    
    console.log(`${day}\t\t${current.toFixed(2)}\t${oldPct?.toFixed(1) ?? 'N/A'}%\t\t${newPct?.toFixed(1) ?? 'N/A'}%`);
  }

  // 统计信息
  const validBias = bias225.filter(v => v !== null);
  console.log("\n" + "-".repeat(50));
  console.log(`全部BIAS范围: ${Math.min(...validBias).toFixed(2)} ~ ${Math.max(...validBias).toFixed(2)}`);
  console.log(`最后一日BIAS: ${bias225[lastIdx]?.toFixed(2)}`);
}

/**
 * 测试场景2：CRI分位数计算
 * 模拟CRI=26.5但分位数较高的情况（如01030）
 */
function testCRIPercentile() {
  console.log("\n" + "=".repeat(60));
  console.log("测试场景2：CRI分位数计算（类似01030）");
  console.log("=".repeat(60));

  const totalDays = 500;
  const criHistory = [];

  // 前380天：正常波动，偶尔有高点
  for (let i = 0; i < 380; i++) {
    if (i % 50 === 0) {
      criHistory.push(40 + Math.random() * 20); // 偶尔恐慌
    } else {
      criHistory.push(Math.random() * 30);
    }
  }

  // 最近120天：普遍偏低（平静期）
  for (let i = 0; i < 119; i++) {
    criHistory.push(Math.random() * 20);
  }

  const currentCRI = 26.5;
  const lastIdx = criHistory.length;

  console.log(`\n模拟股票: 01030`);
  console.log(`当前CRI: ${currentCRI}`);
  console.log(`历史天数: ${criHistory.length}`);
  console.log(`全部历史范围: ${Math.min(...criHistory).toFixed(1)} ~ ${Math.max(...criHistory).toFixed(1)}`);
  console.log(`最近120天范围: ${Math.min(...criHistory.slice(-120)).toFixed(1)} ~ ${Math.max(...criHistory.slice(-120)).toFixed(1)}`);

  const oldPct = calculate120DayPercentile(currentCRI, criHistory, lastIdx);
  const newPct = calculateFullHistoryPercentile(currentCRI, criHistory, lastIdx, 0);

  console.log("\n" + "-".repeat(50));
  console.log(`120天窗口分位数: ${oldPct?.toFixed(1) ?? 'N/A'}%`);
  console.log(`全部历史分位数: ${newPct?.toFixed(1) ?? 'N/A'}%`);
  console.log(`实际比${(criHistory.filter(v => v < currentCRI).length / criHistory.length * 100).toFixed(1)}%的历史值高`);
}

/**
 * 测试场景3：自定义股票数据
 * 用户可以修改这里的数据来测试特定股票
 */
function testCustomStock() {
  console.log("\n" + "=".repeat(60));
  console.log("测试场景3：自定义股票数据");
  console.log("=".repeat(60));

  // ========== 在这里输入你的测试数据 ==========
  
  // 示例：输入最近一段时间的收盘价
  const customCloses = [
    // 请在这里粘贴实际的收盘价数据
    // 至少需要225天数据才能计算BIAS225
  ];

  // 或者使用模拟数据
  const mockCloses = Array.from({length: 300}, (_, i) => 50 + Math.sin(i * 0.1) * 10 + i * 0.05);

  const closes = customCloses.length >= 225 ? customCloses : mockCloses;
  
  console.log(`\n使用${customCloses.length >= 225 ? '自定义' : '模拟'}数据 (${closes.length}天)`);

  const ma225 = calculateSMA(closes, 225);
  const bias225 = calculateBIAS(closes, ma225);

  const startIdx = bias225.findIndex(v => v !== null);
  const lastIdx = bias225.length - 1;
  const currentBias = bias225[lastIdx];

  if (currentBias !== null) {
    const oldPct = calculate120DayPercentile(currentBias, bias225, lastIdx);
    const newPct = calculateFullHistoryPercentile(currentBias, bias225, lastIdx, startIdx);

    console.log(`\n当前BIAS225: ${currentBias.toFixed(2)}`);
    console.log(`120天窗口分位数: ${oldPct?.toFixed(1) ?? 'N/A'}%`);
    console.log(`全部历史分位数: ${newPct?.toFixed(1) ?? 'N/A'}%`);
    
    const validBias = bias225.filter(v => v !== null);
    console.log(`全部BIAS范围: ${Math.min(...validBias).toFixed(2)} ~ ${Math.max(...validBias).toFixed(2)}`);
  }
}

/**
 * 针对特定股票运行完整测试
 * @param {string} symbol - 股票代码
 */
function testStock(symbol) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`针对股票 ${symbol} 的测试`);
  console.log("=".repeat(60));
  console.log("\n请在此函数中手动输入该股票的历史数据");
  console.log("数据可以从实际API获取后粘贴到这里进行测试");
}

// ============ 主程序 ============

function main() {
  const args = process.argv.slice(2);
  const symbol = args[0];

  console.log("\n" + "█".repeat(60));
  console.log("█" + " ".repeat(20) + "分位数测试工具" + " ".repeat(21) + "█");
  console.log("█".repeat(60));

  if (symbol) {
    testStock(symbol);
  } else {
    // 运行所有测试场景
    testRisingTrendBIAS();
    testCRIPercentile();
    testCustomStock();
  }

  console.log("\n" + "=".repeat(60));
  console.log("测试完成");
  console.log("=".repeat(60) + "\n");
}

main();
