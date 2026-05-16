// 验证修复后的分位数计算

// 模拟300308场景：持续上涨后BIAS=59.83
const totalDays = 400;

// 价格：前期缓慢上涨，后期快速拉升
const closes = [];
for (let i = 0; i < totalDays; i++) {
  if (i < 300) {
    // 前300天缓慢上涨：10 -> 25
    closes.push(10 + i * 0.05);
  } else {
    // 后100天快速拉升：25 -> 60
    closes.push(25 + (i - 300) * 0.35);
  }
}

// 计算MA225
const ma225 = new Array(totalDays).fill(null);
for (let i = 224; i < totalDays; i++) {
  let sum = 0;
  for (let j = i - 224; j <= i; j++) sum += closes[j];
  ma225[i] = sum / 225;
}

// 计算BIAS225
const bias225 = new Array(totalDays).fill(null);
for (let i = 0; i < totalDays; i++) {
  if (ma225[i] !== null) {
    bias225[i] = ((closes[i] - ma225[i]) / ma225[i]) * 100;
  }
}

// 修复后的分位数计算（使用全部历史）
const bias225Percentile = new Array(totalDays).fill(null);
for (let i = 225; i < totalDays; i++) {
  const currentBias = bias225[i];
  if (currentBias === null) continue;
  
  // 使用全部历史（从第225天开始到当前）
  const history = bias225.slice(225, i).filter(v => v !== null);
  if (history.length >= 30) {
    const sorted = [...history].sort((a, b) => a - b);
    const lessThan = sorted.filter(v => v < currentBias).length;
    const equalTo = sorted.filter(v => v === currentBias).length;
    const rank = lessThan + equalTo / 2;
    bias225Percentile[i] = (rank / history.length) * 100;
  } else {
    bias225Percentile[i] = 50;
  }
}

console.log("=== 修复后的BIAS225分位数 ===");
console.log("最后一天 BIAS225:", bias225[bias225.length - 1]?.toFixed(2));
console.log("最后一天 分位数:", bias225Percentile[bias225Percentile.length - 1]?.toFixed(1) + "%");

// 打印历史范围
const allBias = bias225.filter(v => v !== null);
console.log("\n全部历史BIAS范围:", `${Math.min(...allBias).toFixed(2)} ~ ${Math.max(...allBias).toFixed(2)}`);

// 对比旧算法（120天窗口）
const oldPercentile = [];
for (let i = 225; i < totalDays; i++) {
  const currentBias = bias225[i];
  if (currentBias === null) continue;
  
  // 旧算法：120天窗口
  const history = bias225.slice(Math.max(0, i - 119), i).filter(v => v !== null);
  if (history.length >= 30) {
    const sorted = [...history].sort((a, b) => a - b);
    const lessThan = sorted.filter(v => v < currentBias).length;
    const equalTo = sorted.filter(v => v === currentBias).length;
    const rank = lessThan + equalTo / 2;
    oldPercentile[i] = (rank / history.length) * 100;
  }
}

console.log("\n=== 对比 ===");
console.log("最后一天（新算法-全部历史）:", bias225Percentile[bias225Percentile.length - 1]?.toFixed(1) + "%");
console.log("最后一天（旧算法-120天）:", oldPercentile[oldPercentile.length - 1]?.toFixed(1) + "%");

// 检查关键转折点
console.log("\n=== 近期走势 ===");
for (let i = totalDays - 10; i < totalDays; i++) {
  console.log(`Day ${i}: Price=${closes[i].toFixed(1)}, BIAS=${bias225[i]?.toFixed(1)}, Pct=${bias225Percentile[i]?.toFixed(0)}%`);
}
