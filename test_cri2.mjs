// 测试更符合01030的场景

const totalDays = 500;

// 生成历史CRI：前380天有波动（0-60），最近120天偏低（0-20）
const criHistory = [];

// 前380天：正常波动
for (let i = 0; i < 380; i++) {
  if (i % 50 === 0) {
    // 偶尔有高点
    criHistory.push(40 + Math.random() * 20);
  } else {
    criHistory.push(Math.random() * 30);
  }
}

// 最近120天：普遍偏低（恐慌后的平静期）
for (let i = 0; i < 119; i++) {
  criHistory.push(Math.random() * 20);
}

// 最后一天CRI=26.5（比近期高，但比历史最高低）
const currentCRI = 26.5;

// 旧算法：120天窗口
function oldPercentile(current, history) {
  const window = history.slice(-120); // 最近120天
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

console.log("=== 01030真实场景模拟 ===");
console.log("历史天数:", criHistory.length);
console.log("当前CRI:", currentCRI);
console.log("全部历史范围:", Math.min(...criHistory).toFixed(1), "~", Math.max(...criHistory).toFixed(1));
console.log("最近120天范围:", Math.min(...criHistory.slice(-120)).toFixed(1), "~", Math.max(...criHistory.slice(-120)).toFixed(1));

const oldPct = oldPercentile(currentCRI, criHistory);
const newPct = newPercentile(currentCRI, criHistory);

console.log("\n=== 分位数对比 ===");
console.log("旧算法(120天窗口):", oldPct.toFixed(1) + "% - 显示'偏高(84%分位)'");
console.log("新算法(全部历史):", newPct.toFixed(1) + "% - 更准确的长期视角");

const lessThanCount = criHistory.filter(v => v < currentCRI).length;
console.log(`\n实际比${(lessThanCount/criHistory.length*100).toFixed(1)}%的历史值高`);
