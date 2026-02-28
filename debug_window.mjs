// 验证窗口选取问题

// 假设300308有400天的数据
const totalDays = 400;
const closes = new Array(totalDays).fill(0).map((_, i) => 10 + i * 0.1); // 价格从10涨到50

// MA225 - 前224天为null
const ma225 = new Array(totalDays).fill(null);
for (let i = 224; i < totalDays; i++) {
  let sum = 0;
  for (let j = i - 224; j <= i; j++) sum += closes[j];
  ma225[i] = sum / 225;
}

// BIAS225
const bias225 = new Array(totalDays).fill(null);
for (let i = 0; i < totalDays; i++) {
  if (ma225[i] !== null) {
    bias225[i] = ((closes[i] - ma225[i]) / ma225[i]) * 100;
  }
}

// 计算分位数（代码逻辑）
const bias225Percentile = new Array(totalDays).fill(null);
for (let i = 119; i < totalDays; i++) {
  const currentBias = bias225[i];
  if (currentBias === null) {
    bias225Percentile[i] = null;
    continue;
  }
  // 取前119天的数据
  const history = bias225.slice(i - 119, i).filter(v => v !== null);
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

// 打印关键位置的数据
console.log("=== 300308 数据窗口分析 ===");
console.log("总数据天数:", totalDays);
console.log("第一个有效BIAS225索引:", bias225.findIndex(v => v !== null));

// 找出第一个计算出分位数的位置
const firstValidPct = bias225Percentile.findIndex(v => v !== null);
console.log("第一个有效分位数索引:", firstValidPct);

if (firstValidPct >= 0) {
  console.log("\n=== 首次计算分位数时的数据 ===");
  console.log("当前BIAS:", bias225[firstValidPct]?.toFixed(2));
  console.log("历史数据范围:", `${Math.min(...bias225.slice(firstValidPct-119, firstValidPct).filter(v=>v!==null)).toFixed(2)} ~ ${Math.max(...bias225.slice(firstValidPct-119, firstValidPct).filter(v=>v!==null)).toFixed(2)}`);
  console.log("计算的分位数:", bias225Percentile[firstValidPct]?.toFixed(1) + "%");
}

// 打印最后几天
console.log("\n=== 最后5天 ===");
for (let i = totalDays - 5; i < totalDays; i++) {
  console.log(`Day ${i}: BIAS=${bias225[i]?.toFixed(2)}, Percentile=${bias225Percentile[i]?.toFixed(1) + "%"}`);
}

// 问题分析：如果BIAS一直在上涨，历史窗口里全是较小的值
console.log("\n=== 问题分析 ===");
console.log("如果股价持续上涨，BIAS也会持续上升。");
console.log("取最近120天的历史窗口，可能全是上涨的BIAS值。");
console.log("当前值如果比历史窗口里的值都小，分位数就是0%。");
console.log("但这不代表历史上没有更低的BIAS，只是窗口选取得太短了！");
