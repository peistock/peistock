// 调试 300308 的 BIAS225 分位数计算

// 模拟计算BIAS
function calculateBIAS(closes, ma) {
  return closes.map((close, i) => {
    const maValue = ma[i];
    if (maValue === null || maValue === 0) return null;
    return ((close - maValue) / maValue) * 100;
  });
}

// 计算简单移动平均
function calculateSMA(closes, period) {
  const result = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += closes[j];
    }
    result.push(sum / period);
  }
  return result;
}

// 计算分位数（修正版）
function calculatePercentile(current, history) {
  if (history.length === 0) return 50;
  const sorted = [...history].sort((a, b) => a - b);
  const lessThan = sorted.filter(v => v < current).length;
  const equalTo = sorted.filter(v => v === current).length;
  const rank = lessThan + equalTo / 2;
  return (rank / history.length) * 100;
}

// 模拟数据 - 假设300308最近的价格数据（从用户描述推断股价比225日均线高59.83%）
// 这意味着最近的BIAS225应该在59.83左右
const mockCloses = [];
let basePrice = 20;

// 生成历史价格（前119天）- 模拟一个上涨趋势
for (let i = 0; i < 119; i++) {
  // 添加一些随机波动
  const change = (Math.random() - 0.45) * 0.02; // 略微向上偏斜
  basePrice = basePrice * (1 + change);
  mockCloses.push(basePrice);
}

// 最后一天价格大幅拉升，导致BIAS225达到59.83%
const lastPrice = mockCloses[mockCloses.length - 1] * 1.6; // 比前一日高60%
mockCloses.push(lastPrice);

console.log("模拟数据点数:", mockCloses.length);
console.log("最后一天价格:", lastPrice.toFixed(2));
console.log("前一天价格:", mockCloses[mockCloses.length - 2].toFixed(2));

// 计算MA225
const ma225 = calculateSMA(mockCloses, 225);

// 计算BIAS225
const bias225 = calculateBIAS(mockCloses, ma225);

const lastBias = bias225[bias225.length - 1];
const prevBias = bias225[bias225.length - 2];

console.log("\n=== BIAS225 计算结果 ===");
console.log("最后一天BIAS225:", lastBias?.toFixed(2));
console.log("前一天BIAS225:", prevBias?.toFixed(2));

// 检查MA225是否足够
const validMa225 = ma225.filter(v => v !== null);
console.log("有效MA225数据点:", validMa225.length);

// 计算历史分位数（使用120日窗口）
const lastIndex = bias225.length - 1;
const currentBias = bias225[lastIndex];

// 收集历史数据（不包含当前值）
const historyStart = Math.max(0, lastIndex - 119);
const history = bias225.slice(historyStart, lastIndex).filter((v) => v !== null);

console.log("\n=== 分位数计算 ===");
console.log("历史数据窗口大小:", history.length);
console.log("历史数据范围:", history.length > 0 ? `${Math.min(...history).toFixed(2)} ~ ${Math.max(...history).toFixed(2)}` : 'N/A');
console.log("当前值:", currentBias?.toFixed(2));

if (history.length > 0 && currentBias !== null) {
  const percentile = calculatePercentile(currentBias, history);
  console.log("计算得到的分位数:", percentile.toFixed(1) + "%");
  
  // 检查排序后的数据
  const sorted = [...history].sort((a, b) => a - b);
  console.log("历史最小值:", sorted[0].toFixed(2));
  console.log("历史最大值:", sorted[sorted.length - 1].toFixed(2));
  console.log("历史平均值:", (sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2));
}

// 模拟如果当前值是极端高位的情况
console.log("\n=== 极端高位测试 ===");
if (history.length > 0) {
  const maxHistory = Math.max(...history);
  const extremeValue = maxHistory + 10; // 比历史最大值还大10
  const extremePercentile = calculatePercentile(extremeValue, history);
  console.log(`如果BIAS=${extremeValue.toFixed(2)}(比历史最大还大), 分位数=${extremePercentile.toFixed(1)}%`);
  
  const minHistory = Math.min(...history);
  const lowValue = minHistory - 10; // 比历史最小值还小
  const lowPercentile = calculatePercentile(lowValue, history);
  console.log(`如果BIAS=${lowValue.toFixed(2)}(比历史最小还小), 分位数=${lowPercentile.toFixed(1)}%`);
}
