// 验证分位数计算逻辑

// 模拟场景：300308的BIAS225 = 59.83，但分位数显示0%

// 假设历史数据中有一些bias值
const history = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]; // 20个值

// 当前值59.83
const currentBias = 59.83;

// 原算法（有问题）
function oldPercentile(current, data) {
  const sorted = [...data].sort((a, b) => a - b);
  const rank = sorted.findIndex(v => v >= current);
  return rank >= 0 ? (rank / sorted.length) * 100 : 100;
}

// 新算法
function newPercentile(current, data) {
  const sorted = [...data].sort((a, b) => a - b);
  const lessThan = sorted.filter(v => v < current).length;
  const equalTo = sorted.filter(v => v === current).length;
  const rank = lessThan + equalTo / 2;
  return (rank / data.length) * 100;
}

console.log("=== 正常情况测试 ===");
console.log("历史数据:", history.join(", "));
console.log("当前值:", currentBias);
console.log("原算法分位数:", oldPercentile(currentBias, history).toFixed(1) + "%");
console.log("新算法分位数:", newPercentile(currentBias, history).toFixed(1) + "%");

// 模拟如果当前值比历史所有值都小
const lowBias = 1;
console.log("\n=== 极小值测试 ===");
console.log("当前值:", lowBias);
console.log("原算法分位数:", oldPercentile(lowBias, history).toFixed(1) + "%");
console.log("新算法分位数:", newPercentile(lowBias, history).toFixed(1) + "%");

// 模拟如果当前值比历史所有值都大
const highBias = 200;
console.log("\n=== 极大值测试 ===");
console.log("当前值:", highBias);
console.log("原算法分位数:", oldPercentile(highBias, history).toFixed(1) + "%");
console.log("新算法分位数:", newPercentile(highBias, history).toFixed(1) + "%");

// 模拟300308的情况：BIAS=59.83，但历史数据都在60以上（即当前比历史都小）
const highHistory = [60, 65, 70, 75, 80, 85, 90, 95, 100, 105];
console.log("\n=== 300308场景模拟 ===");
console.log("历史数据都在60以上:", highHistory.join(", "));
console.log("当前值:", currentBias, "(比历史最小值60还小)");
console.log("原算法分位数:", oldPercentile(currentBias, highHistory).toFixed(1) + "%");
console.log("新算法分位数:", newPercentile(currentBias, highHistory).toFixed(1) + "%");

// 排序后的历史
const sortedHigh = [...highHistory].sort((a, b) => a - b);
console.log("\n排序后历史最小值:", sortedHigh[0]);
console.log("当前值 < 历史最小值?", currentBias < sortedHigh[0]);
