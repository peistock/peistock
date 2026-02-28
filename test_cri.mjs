// 测试CRI分位数计算 - 模拟01030场景

// 模拟01030的CRI历史数据
// 假设这个股票历史上CRI普遍较低（0-30），当前CRI=26.5

const totalDays = 300;

// 生成历史CRI数据（偏低）
const criHistory = [];
for (let i = 0; i < totalDays - 1; i++) {
  // 大部分时间在0-25之间波动
  criHistory.push(Math.random() * 25);
}

// 最后一天CRI=26.5（比历史稍高）
const currentCRI = 26.5;

// 旧算法：120天窗口
function oldPercentile(current, history) {
  const window = history.slice(-120);
  const sorted = [...window].sort((a, b) => a - b);
  const rank = sorted.findIndex(v => v >= current);
  return rank >= 0 ? (rank / sorted.length) * 100 : 100;
}

// 新算法：全部历史
function newPercentile(current, history) {
  const sorted = [...history].sort((a, b) => a - b);
  const lessThan = sorted.filter(v => v < current).length;
  const equalTo = sorted.filter(v => v === current).length;
  return ((lessThan + equalTo / 2) / sorted.length) * 100;
}

console.log("=== 01030 CRI分位数测试 ===");
console.log("当前CRI:", currentCRI);
console.log("历史CRI范围:", Math.min(...criHistory).toFixed(1), "~", Math.max(...criHistory).toFixed(1));
console.log("历史CRI平均:", (criHistory.reduce((a,b)=>a+b,0)/criHistory.length).toFixed(1));

const oldPct = oldPercentile(currentCRI, criHistory);
const newPct = newPercentile(currentCRI, criHistory);

console.log("\n=== 分位数对比 ===");
console.log("旧算法(120天窗口):", oldPct.toFixed(1) + "%");
console.log("新算法(全部历史):", newPct.toFixed(1) + "%");

// 统计有多少历史值小于当前值
const lessThanCount = criHistory.filter(v => v < currentCRI).length;
console.log(`\n实际排名: 比${(lessThanCount/criHistory.length*100).toFixed(1)}%的历史值高`);

// 极端测试：如果最近120天CRI都很低
console.log("\n=== 场景：最近120天CRI都特别低 ===");
const lowRecent = criHistory.slice(0, 180).concat(new Array(120).fill(0).map(() => Math.random() * 10));
console.log("旧算法:", oldPercentile(26.5, lowRecent).toFixed(1) + "%");
console.log("新算法:", newPercentile(26.5, lowRecent).toFixed(1) + "%");
