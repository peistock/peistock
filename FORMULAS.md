# Peter量价均线交易系统 - 核心公式文档

**注意：本文档包含系统核心算法，仅供内部参考，请勿外传。**

---

## 一、换手成本指标

### 1.1 换手天数 (DD)
```
DD = SUMBARS(VOL, CAPITAL)
```
从当前日期往前累计成交量达到流通股本所需的天数。

### 1.2 换手成本线
```
MAHS = MA(C, DD)      // 换手成本简单移动平均
EMAHS = EMA(C, DD)    // 换手成本指数移动平均
```

### 1.3 成本差
```
成本差 = EMAHS - MAHS
```
成本差上穿零轴表示短期转强，下穿表示短期转弱。

### 1.4 成本偏离度
```
偏离度 = (C - EMAHS) / EMAHS * 100
```

---

## 二、CRI综合风险指标 v2.1 (恐慌专用)

### 2.1 成本偏离因子 (basis_score)
```python
basis_pct = (price - mahs) / mahs * 100
is_below_mahs = basis_pct < 0

if is_below_mahs:
    # 使用历史分位数映射：60%分位开始得分，90%分位得100分
    neg_basis_raw = abs(basis_pct) * 100
    neg_basis_history = [历史负偏离数据]
    basis_threshold_60 = percentile(neg_basis_history, 60)
    basis_threshold_90 = percentile(neg_basis_history, 90)
    
    if neg_basis_raw <= basis_threshold_60:
        basis_score = 0
    elif neg_basis_raw >= basis_threshold_90:
        basis_score = 100
    else:
        normalized = (neg_basis_raw - basis_threshold_60) / (basis_threshold_90 - basis_threshold_60)
        basis_score = pow(normalized, 0.8) * 100  # S型曲线
else:
    basis_score = 0  # 上涨不贡献恐慌分
```

### 2.2 跳跃风险因子 (jump_score)
```python
down_gap = max(0, log(prev_close / open))  # 只计算低开

avg_down_gap = mean(down_gaps[-20:])
std_down_gap = std(down_gaps[-20:])

if std_down_gap > 0:
    jump_z = (down_gap - avg_down_gap) / std_down_gap
    if jump_z > 0:
        jump_score = min(jump_z * 30, 100)  # 只关注超过平均的跳空
    else:
        jump_score = 0
```

### 2.3 波动率曲线因子 (curve_score)
```python
vol_short = yz_volatility(window=5)
vol_long = yz_volatility(window=60)

# 动态下限
vol_long_history = yz_vol_60[-60:]
vol_long_mean = mean(vol_long_history)
safe_vol_long = max(vol_long, vol_long_mean * 0.2, 0.5)

curve_slope = (vol_short - vol_long) / safe_vol_long
is_below_ma20 = close < ma20

if is_below_ma20 and curve_slope > 0:
    # 下跌趋势 + 波动放大 = 恐慌确认
    curve_score = min(curve_slope * 60, 100)
elif not is_below_ma20 and curve_slope > 0:
    # 上涨趋势 + 波动放大 = 健康上涨
    curve_score = min(curve_slope * 20, 40)
elif curve_slope < -0.2:
    curve_score = max(curve_slope * 10 + 20, 0)
else:
    curve_score = 20 + curve_slope * 30
```

### 2.4 波动率百分位 (percentile_score)
```python
percentile = percentile_rank(vol_current, vol_history[-120:]) * 100
trend_adjusted_pct = percentile if is_below_ma20 else percentile * 0.5
```

### 2.5 成交量状态 (volume_state)
```python
vr = volume / ma(volume, 20)

if vr < 0.5:
    volume_state = 'extreme-shrink'  # 极度缩量
elif vr < 0.8:
    volume_state = 'shrink'          # 缩量
elif vr <= 1.2:
    volume_state = 'normal'          # 正常
elif vr <= 2.0:
    volume_state = 'expand'          # 放量
else:
    volume_state = 'extreme-expand'  # 极度放量
```

### 2.6 CRI合成
```python
# 基础CRI
cri_raw = max(
    basis_score * 0.95,       # 成本偏离权重最高
    jump_score * 0.9,         # 向下跳空
    curve_score * (0.85 if is_below_ma20 else 0.4)
) + trend_adjusted_pct * 0.1

cri = clip(cri_raw, 0, 100)
```

### 2.7 CRI历史分位数
```python
# 120日滚动历史分位数
hist_cri = cri[-120:]
cri_percentile = percentile_rank(current_cri, hist_cri)
```

### 2.8 恐慌状态判定 (三条件矩阵)
```python
is_below_mahs = close < mahs

# 条件1: CRI历史分位数
# 条件2: 价格位置 (低于/高于MAHS)
# 条件3: 成交量状态

if cri_percentile >= 80 and is_below_mahs:
    if volume_state == 'extreme-shrink':
        state = '恐慌·洗盘?'      # 极度缩量可能是洗盘
    elif volume_state in ['expand', 'extreme-expand']:
        state = '恐慌·放量'       # 放量确认真恐慌
    else:
        state = '恐慌状态'
elif cri_percentile >= 60 and is_below_mahs:
    state = '偏高·下跌'
elif cri_percentile <= 20 and not is_below_mahs:
    if volume_state == 'extreme-expand':
        state = '自满·出货?'      # 极度放量警惕出货
    else:
        state = '自满状态'
else:
    state = '正常区间'
```

---

## 三、GSI贪婪情绪指标

### 3.1 正向成本偏离 (权重30%)
```python
pos_basis = max(0, (price - mahs) / mahs * 100)
pos_history = [历史正向偏离数据]
pos_threshold = percentile(pos_history[-120:], 80)
pos_extreme = percentile(pos_history[-120:], 95)

if pos_basis <= pos_threshold:
    score1 = 0
elif pos_basis >= pos_extreme:
    score1 = 100
else:
    score1 = (pos_basis - pos_threshold) / (pos_extreme - pos_threshold) * 100
```

### 3.2 向上跳空强度 (权重20%)
```python
up_gap = max(0, log(open / prev_close))
avg_up = mean(up_gaps[-20:])
std_up = std(up_gaps[-20:]) + 0.0001
z_up = (up_gap - avg_up) / std_up
score2 = clip(z_up * 15 + 50, 0, 100)
```

### 3.3 贪婪型波动 (权重15%)
```python
is_up_trend = close > ma20
if is_up_trend:
    curve_slope = (vol_short - vol_long) / max(vol_long, 1)
    score3 = clip(curve_slope * 40, 0, 100)
else:
    score3 = 0
```

### 3.4 乖离率极端高位 (权重20%)
```python
pct_bias225 = percentile_rank(bias225, bias225_history[-120:]) * 100
if pct_bias225 > 80:
    score4 = (pct_bias225 - 80) / (95 - 80) * 100
else:
    score4 = 0
score4 = clip(score4, 0, 100)
```

### 3.5 成交量激增 (权重15%)
```python
vol_ratio = volume / ma(volume, 20)
vol_threshold = percentile(vol_ratios[-120:], 90)

if vol_ratio <= 1.2:
    score5 = 0
elif vol_ratio >= vol_threshold:
    score5 = 100
else:
    score5 = (vol_ratio - 1.2) / (vol_threshold - 1.2) * 100
```

### 3.6 贪婪总分合成
```python
greedy = score1 * 0.30 + score2 * 0.20 + score3 * 0.15 + score4 * 0.20 + score5 * 0.15

greedy = clip(greedy, 0, 100)

# 贪婪状态判定
if greedy >= 70 and price > mahs:
    greedy_state = 'greedy'
else:
    greedy_state = 'normal'
```

---

## 四、Yang-Zhang波动率

### 4.1 组成部分
```
overnight_return = log(Open_t / Close_t-1)
intraday_return = log(Close_t / Open_t)
```

### 4.2 Rogers-Satchell估计
```
log_HC = log(High / Close)
log_HO = log(High / Open)
log_LC = log(Low / Close)
log_LO = log(Low / Open)
RS_est = log_HC * log_HO + log_LC * log_LO
```

### 4.3 YZ方差与波动率
```
variance_YZ = var(overnight) + 0.34 * var(intraday) + 0.66 * mean(RS_est)
YZ_Vol = sqrt(variance_YZ) * sqrt(252) * 100
```

---

## 五、均线系统

### 5.1 日线/周线均线
```
MA5 = MA(C, 5)      // 短线趋势
MA20 = MA(C, 20)    // 月线级别
MA99 = MA(C, 99)    // 季线级别
MA128 = MA(C, 128)  // 半年线
MA225 = MA(C, 225)  // 年线/牛熊分界
```

### 5.2 15分钟均线
```
MA5_15 = MA(C, 5)      // 75分钟趋势
MA20_15 = MA(C, 20)    // 5小时趋势
MA99_15 = MA(C, 99)    // 约25小时
MA128_15 = MA(C, 128)  // 约32小时
MA225_15 = MA(C, 225)  // 约56小时
```

---

## 六、乖离率 (BIAS)

```
BIAS_N = (C - MA(C, N)) / MA(C, N) * 100

BIAS5 = (C - MA5) / MA5 * 100
BIAS20 = (C - MA20) / MA20 * 100
BIAS99 = (C - MA99) / MA99 * 100
BIAS128 = (C - MA128) / MA128 * 100
BIAS225 = (C - MA225) / MA225 * 100
```

---

## 七、综合情绪指数

```
sentiment = greedy - cri  // 范围 -100 ~ +100

正值  -> 贪婪主导
接近0 -> 情绪平衡
负值  -> 恐慌主导
```

---

## 八、选股条件参考

### 8.1 恐慌抄底条件
```
条件1: 成本差上穿零轴          (短期转强)
条件2: 价格 < MAHS * 1.03      (低于成本3%以内)
条件3: BIAS20 < -5             (BIAS20超跌)
条件4: CRI > 40 AND 负成本偏离 (恐慌状态)
条件5: 成交量非极度缩量        (排除流动性风险)
```

---

**文档版本：** v1.0  
**最后更新：** 2024年  
**保密级别：** 内部资料
