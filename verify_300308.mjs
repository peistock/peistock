// 模拟300308场景：前期上涨积累历史数据，最近BIAS下降到59.83

const totalDays = 500;

// 价格：前期上涨，后期快速拉升后回落
const closes = [];
for (let i = 0; i < totalDays; i++) {
  if (i < 400) {
    closes.push(10 + i * 0.1);  // 10 -> 50
  } else if (i < 480) {
    closes.push(50 + (i - 400) * 0.625);  // 50 -> 100
  } else {
    closes.push(100 - (i - 480) * 0.75);  // 100 -> 85
  }
}

// 计算MA225和BIAS225
const ma225 = new Array(totalDays).fill(null);
for (let i = 224; i < totalDays; i++) {
  let sum = 0;
  for (let j = i - 224; j <= i; j++) sum += closes[j];
  ma225[i] = sum / 225;
}

const bias225 = new Array(totalDays).fill(null);
for (let i = 0; i < totalDays; i++) {
  if (ma225[i] !== null) {
    bias225[i] = ((closes[i] - ma225[i]) / ma225[i]) * 100;
  }
}

// 修复后的分位数（全部历史）
const newPercentile = new Array(totalDays).fill(null);
for (let i = 225; i < totalDays; i++) {
  const current = bias225[i];
  if (current === null) continue;
  const history = bias225.slice(225, i).filter(v => v !== null);
  if (history.length >= 30) {
    const sorted = [...history].sort((a, b) => a - b);
    const lessThan = sorted.filter(v => v < current).length;
    const equalTo = sorted.filter(v => v === current).length;
    newPercentile[i] = ((lessThan + equalTo / 2) / history.length) * 100;
  } else {
    newPercentile[i] = 50;
  }
}

// 旧算法（120天窗口）
const oldPercentile = new Array(totalDays).fill(null);
for (let i = 225; i < totalDays; i++) {
  const current = bias225[i];
  if (current === null) continue;
  const history = bias225.slice(Math.max(225, i - 119), i).filter(v => v !== null);
  if (history.length >= 30) {
    const sorted = [...history].sort((a, b) => a - b);
    const lessThan = sorted.filter(v => v < current).length;
    const equalTo = sorted.filter(v => v === current).length;
    oldPercentile[i] = ((lessThan + equalTo / 2) / history.length) * 100;
  }
}

console.log("=== 300308场景模拟：BIAS高位回落 ===");
for (let i = totalDays - 15; i < totalDays; i++) {
  const dayOffset = i - totalDays + 15;
  const b = bias225[i]?.toFixed(2).padStart(6);
  const n = newPercentile[i]?.toFixed(1).padStart(5);
  const o = oldPercentile[i]?.toFixed(1).padStart(5);
  console.log(`T-${15-dayOffset}: BIAS=${b}, 新=${n}%, 旧=${o}%`);
}

console.log("\n=== 结论 ===");
const lastBias = bias225[bias225.length - 1];
const lastNew = newPercentile[newPercentile.length - 1];
const lastOld = oldPercentile[oldPercentile.length - 1];
console.log(`最后BIAS: ${lastBias?.toFixed(2)}`);
console.log(`新算法分位: ${lastNew?.toFixed(1)}% (正确反映高位)`);
console.log(`旧算法分位: ${lastOld?.toFixed(1)}% (可能错误显示0%)`);
