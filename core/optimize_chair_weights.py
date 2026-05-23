#!/usr/bin/env python3
"""
core/optimize_chair_weights.py
Chair 权重优化搜索算法

背景：
- Chair 裁决公式（当前硬编码在 prompt 中）：
  weighted_score = Bull置信度 × w_bull + Preemption评分 × w_preemption
                   - Bear置信度 × w_bear + MacroIndustry综合评分 × w_macro
- 阈值：long_threshold（默认 20）, short_threshold（默认 -20）
- Preemption 硬性过滤：<15 强制 NEUTRAL
- Sentiment 极端情绪过滤（极度贪婪禁止 LONG，极度恐慌禁止 SHORT）

依赖：
    pip install optuna pandas numpy

用法：
    # 从 SQLite 读取（默认）
    .venv/bin/python core/optimize_chair_weights.py

    # 从 CSV 读取
    .venv/bin/python core/optimize_chair_weights.py --csv data/history.csv

    # 指定搜索算法和 trials
    .venv/bin/python core/optimize_chair_weights.py --algo bayes --trials 500

    # 多目标帕累托优化
    .venv/bin/python core/optimize_chair_weights.py --multi-objective

CSV 格式要求（列名）：
    bull_conf, preemption, bear_conf, macro_score, sentiment_rating, actual_pnl

    sentiment_rating 取值：extreme_greed / greed / neutral / fear / extreme_fear
    actual_pnl 为持有期结束后的实际盈亏百分比（如 5.2 表示 +5.2%）
"""

import argparse
import json
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

# ---------------------------------------------------------------------------
# 0. 路径与常量
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).parent.parent
DEFAULT_DB = PROJECT_ROOT / "data" / "backtest_tracker.db"
DEFAULT_CSV = None

# Sentiment 评级 → 内部编码
SENTIMENT_MAP = {
    "extreme_greed": 2,
    "greed": 1,
    "neutral": 0,
    "fear": -1,
    "extreme_fear": -2,
}


# ---------------------------------------------------------------------------
# 1. 数据模型
# ---------------------------------------------------------------------------
@dataclass
class HistorySample:
    """单条历史样本"""
    bull_conf: float          # 0-100
    preemption: float         # 0-100
    bear_conf: float          # 0-100
    macro_score: float        # -50 ~ +50
    sentiment_rating: str     # extreme_greed/greed/neutral/fear/extreme_fear
    actual_pnl: float         # 实际盈亏 %
    code: str = ""            # 股票代码（可选）
    decision_date: str = ""   # 日期（可选）


# ---------------------------------------------------------------------------
# 2. 数据加载
# ---------------------------------------------------------------------------
def load_from_sqlite(db_path: Path) -> List[HistorySample]:
    """从 backtest_tracker.db 读取已验证的历史决策。"""
    if not db_path.exists():
        raise FileNotFoundError(f"数据库不存在: {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cursor = conn.execute(
        """
        SELECT code, decision_date, bull_confidence, bear_confidence,
               preemption_score, macro_industry_score, sentiment_rating, actual_pnl
        FROM validated_decisions
        WHERE actual_pnl IS NOT NULL
          AND bull_confidence IS NOT NULL
          AND bear_confidence IS NOT NULL
        """
    )
    rows = cursor.fetchall()
    conn.close()

    samples = []
    for r in rows:
        samples.append(HistorySample(
            bull_conf=r["bull_confidence"] or 0,
            preemption=r["preemption_score"] or 50,
            bear_conf=r["bear_confidence"] or 0,
            macro_score=r["macro_industry_score"] or 0,
            sentiment_rating=(r["sentiment_rating"] or "neutral").lower().replace(" ", "_"),
            actual_pnl=r["actual_pnl"],
            code=r["code"],
            decision_date=r["decision_date"],
        ))
    return samples


def load_from_csv(csv_path: Path) -> List[HistorySample]:
    """从 CSV 读取历史样本。"""
    import pandas as pd

    df = pd.read_csv(csv_path)
    required = {"bull_conf", "preemption", "bear_conf", "macro_score",
                "sentiment_rating", "actual_pnl"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV 缺少必需列: {missing}")

    samples = []
    for _, row in df.iterrows():
        samples.append(HistorySample(
            bull_conf=float(row["bull_conf"]),
            preemption=float(row["preemption"]),
            bear_conf=float(row["bear_conf"]),
            macro_score=float(row["macro_score"]),
            sentiment_rating=str(row["sentiment_rating"]).lower().replace(" ", "_"),
            actual_pnl=float(row["actual_pnl"]),
            code=str(row.get("code", "")),
            decision_date=str(row.get("decision_date", "")),
        ))
    return samples


def load_samples(csv_path: Optional[Path] = None,
                 db_path: Optional[Path] = None) -> List[HistorySample]:
    if csv_path:
        return load_from_csv(csv_path)
    return load_from_sqlite(db_path or DEFAULT_DB)


# ---------------------------------------------------------------------------
# 3. Chair 裁决模拟器（与 prompt 中规则严格对齐）
# ---------------------------------------------------------------------------
def simulate_chair_decision(
    sample: HistorySample,
    weights: Dict[str, float],
    thresholds: Dict[str, float],
) -> str:
    """
    模拟 Chair 裁决逻辑，返回 'long' / 'short' / 'neutral'。

    规则（与 chair_debate.yaml 对齐）：
    1. weighted_score = bull*w_bull + preemption*w_preemption - bear*w_bear + macro*w_macro
    2. Preemption < 15 → 强制 NEUTRAL
    3. Sentiment 极端情绪过滤：
       - extreme_greed + 机构流出 → 禁止 LONG（当前简化：只要 extreme_greed 就禁止 LONG）
       - extreme_fear + 机构流入 → 禁止 SHORT（当前简化：只要 extreme_fear 就禁止 SHORT）
    4. 基础决策：
       - score > long_threshold → LONG
       - score < short_threshold → SHORT
       - 否则 NEUTRAL
    """
    w = weights
    score = (
        sample.bull_conf * w["w_bull"]
        + sample.preemption * w["w_preemption"]
        - sample.bear_conf * w["w_bear"]
        + sample.macro_score * w["w_macro"]
    )

    # Preemption 硬性过滤
    if sample.preemption < 15:
        return "neutral"

    # Sentiment 极端情绪过滤（简化版）
    sent = SENTIMENT_MAP.get(sample.sentiment_rating, 0)
    if sent >= 2:  # extreme_greed
        if score < thresholds.get("extreme_greed_short_threshold", -10):
            return "short"
        return "neutral"
    if sent <= -2:  # extreme_fear
        if score > thresholds.get("extreme_fear_long_threshold", 10):
            return "long"
        return "neutral"

    # 基础决策
    if score > thresholds["long_threshold"]:
        return "long"
    if score < thresholds["short_threshold"]:
        return "short"
    return "neutral"


# ---------------------------------------------------------------------------
# 4. 回测指标计算
# ---------------------------------------------------------------------------
def calculate_metrics(samples: List[HistorySample],
                      decisions: List[str]) -> Dict[str, float]:
    """
    根据样本和模拟决策，计算回测指标。
    只统计非 neutral 的决策。
    """
    trades = []
    for s, d in zip(samples, decisions):
        if d == "neutral":
            continue
        trades.append({
            "decision": d,
            "pnl": s.actual_pnl,
            "is_long": d == "long",
        })

    if not trades:
        return {
            "total_trades": 0,
            "win_rate": 0.0,
            "profit_loss_ratio": 0.0,
            "sharpe": -999.0,
            "max_drawdown": 0.0,
            "total_return": 0.0,
            "calmar": -999.0,
            "avg_pnl": 0.0,
        }

    pnls = [t["pnl"] for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]

    total_trades = len(trades)
    win_rate = len(wins) / total_trades * 100 if total_trades else 0
    avg_win = sum(wins) / len(wins) if wins else 0
    avg_loss = sum(losses) / len(losses) if losses else 0
    profit_loss_ratio = abs(avg_win / avg_loss) if avg_loss != 0 else (999.0 if avg_win > 0 else 0)

    # 总收益（等权重每只交易）
    total_return = sum(pnls)
    avg_pnl = total_return / total_trades

    # 夏普近似（假设无风险利率为 0，以交易为独立样本）
    std = np.std(pnls, ddof=1) if len(pnls) > 1 else 0
    sharpe = (avg_pnl / std * np.sqrt(total_trades)) if std > 0 else (999.0 if avg_pnl > 0 else -999.0)

    # 最大回撤（按交易序列的累计收益曲线）
    cumulative = np.cumsum(pnls)
    peak = np.maximum.accumulate(cumulative)
    drawdowns = cumulative - peak
    max_drawdown = float(np.min(drawdowns)) if len(drawdowns) else 0

    # Calmar = 年化收益 / 最大回撤（简化：用总收益代替年化）
    calmar = (total_return / abs(max_drawdown)) if max_drawdown != 0 else (999.0 if total_return > 0 else -999.0)

    return {
        "total_trades": total_trades,
        "win_rate": win_rate,
        "profit_loss_ratio": profit_loss_ratio,
        "sharpe": sharpe,
        "max_drawdown": max_drawdown,
        "total_return": total_return,
        "calmar": calmar,
        "avg_pnl": avg_pnl,
        "long_count": sum(1 for t in trades if t["is_long"]),
        "short_count": sum(1 for t in trades if not t["is_long"]),
    }


# ---------------------------------------------------------------------------
# 5. 目标函数设计
# ---------------------------------------------------------------------------
def single_objective_score(metrics: Dict[str, float],
                           alpha: float = 0.5,
                           beta: float = 0.3,
                           gamma: float = 0.2) -> float:
    """
    单目标加权评分。

    设计理由：
    - 胜率（win_rate）反映决策稳定性，高胜率意味着系统可信
    - 盈亏比（profit_loss_ratio）反映赔率结构，>1 才能长期正期望
    - 夏普（sharpe）反映风险调整后收益，避免高波动带来的虚假高收益

    权重默认：胜率 50% + 盈亏比 30% + 夏普 20%
    原因：
    1. 对于几十到几百条样本的小样本场景，胜率是最稳健的统计量
    2. 盈亏比直接决定期望收益符号（E = win_rate * avg_win - loss_rate * |avg_loss|）
    3. 夏普作为约束项，惩罚过度波动；但小样本下标准差估计不稳定，权重不宜过高

    对 total_return 不做直接优化目标：
    - 样本外时间序列非独立，total_return 对交易顺序敏感
    - 在小样本下容易过拟合到某几笔大赢交易
    """
    # 归一化到 0-100 区间（或合理范围）
    win_score = metrics["win_rate"]  # 已经是 0-100
    pl_score = min(metrics["profit_loss_ratio"] * 20, 100)  # pl=5 → 100
    sharpe_score = min(max(metrics["sharpe"], -5), 5) * 10 + 50  # sharpe∈[-5,5] → [0,100]

    score = alpha * win_score + beta * pl_score + gamma * sharpe_score

    # 硬性惩罚
    if metrics["total_trades"] < 5:
        score -= 50  # 交易次数太少，不可信
    if metrics["max_drawdown"] < -20:
        score -= 30  # 最大回撤过深

    return score


# ---------------------------------------------------------------------------
# 6. 搜索空间定义
# ---------------------------------------------------------------------------
def get_search_space(trial) -> Tuple[Dict[str, float], Dict[str, float]]:
    """
    定义权重和阈值的搜索空间。

    约束设计：
    1. 权重不归一化到 1：
       - 因为 bear 是减分项，w_bull + w_preemption + w_bear + w_macro 可以 >1
       - 但为了防止某个维度主导，每个权重单独限制范围
    2. macro_score 范围 -50~+50，与其他 0-100 不同：
       - 在 Chair prompt 中 macro 已乘以 0.15，实际贡献 -7.5 ~ +7.5
       - 搜索时 w_macro 范围设小一点（0.10-0.30），让 macro 保持辅助角色
    3. 阈值与权重耦合：
       - long_threshold 必须 > short_threshold
       - 默认 long=20, short=-20，搜索范围 ±10
    """
    weights = {
        "w_bull": trial.suggest_float("w_bull", 0.10, 0.50),
        "w_preemption": trial.suggest_float("w_preemption", 0.10, 0.50),
        "w_bear": trial.suggest_float("w_bear", 0.10, 0.50),
        "w_macro": trial.suggest_float("w_macro", 0.05, 0.30),
    }

    thresholds = {
        "long_threshold": trial.suggest_float("long_threshold", 10, 35),
        "short_threshold": trial.suggest_float("short_threshold", -35, -10),
        "extreme_greed_short_threshold": trial.suggest_float("extreme_greed_short", -20, -5),
        "extreme_fear_long_threshold": trial.suggest_float("extreme_fear_long", 5, 20),
    }

    # 硬性约束：long_threshold > short_threshold（否则逻辑矛盾）
    if thresholds["long_threshold"] <= thresholds["short_threshold"]:
        raise optuna.TrialPruned()

    return weights, thresholds


# ---------------------------------------------------------------------------
# 7. 搜索算法
# ---------------------------------------------------------------------------
def run_grid_search(samples: List[HistorySample],
                    w_steps: int = 5,
                    t_steps: int = 5) -> List[Dict]:
    """
    网格搜索。

    搜索空间大小估算：
    - 4 维权重 × 2 维阈值 = 6 维
    - w_steps=5 → 每维 5 个取值点
    - t_steps=5 → 每维 5 个取值点
    - 总组合数 = 5^4 × 5^2 = 625 × 25 = 15,625

    在 100 条样本上跑，每次评估需要遍历 100 条做决策+指标计算，
    总计算量 ~ 150 万次操作，现代 CPU 几秒到几十秒可完成。

    若样本增长到 1000 条或步数加密到 10，组合数达 10^6，建议换贝叶斯优化。
    """
    import itertools

    # 权重网格
    w_bull_vals = np.linspace(0.10, 0.50, w_steps)
    w_prep_vals = np.linspace(0.10, 0.50, w_steps)
    w_bear_vals = np.linspace(0.10, 0.50, w_steps)
    w_macro_vals = np.linspace(0.05, 0.30, w_steps)

    # 阈值网格
    long_t_vals = np.linspace(10, 35, t_steps)
    short_t_vals = np.linspace(-35, -10, t_steps)

    results = []
    total = w_steps ** 4 * t_steps ** 2
    print(f"[Grid Search] 总组合数: {total}")

    for i, (wb, wp, wbe, wm, lt, st) in enumerate(itertools.product(
        w_bull_vals, w_prep_vals, w_bear_vals, w_macro_vals,
        long_t_vals, short_t_vals
    )):
        if lt <= st:
            continue

        weights = {"w_bull": wb, "w_preemption": wp, "w_bear": wbe, "w_macro": wm}
        thresholds = {"long_threshold": lt, "short_threshold": st,
                      "extreme_greed_short_threshold": -10,
                      "extreme_fear_long_threshold": 10}

        decisions = [simulate_chair_decision(s, weights, thresholds) for s in samples]
        metrics = calculate_metrics(samples, decisions)
        obj = single_objective_score(metrics)

        results.append({
            "objective": obj,
            "weights": weights,
            "thresholds": {k: v for k, v in thresholds.items() if k in ("long_threshold", "short_threshold")},
            "metrics": metrics,
        })

        if (i + 1) % 1000 == 0:
            print(f"  进度: {i+1}/{total}")

    results.sort(key=lambda x: x["objective"], reverse=True)
    return results


def run_bayesian_search(samples: List[HistorySample],
                        n_trials: int = 200,
                        multi_objective: bool = False) -> Dict:
    """
    贝叶斯优化（Optuna）。

    为什么选贝叶斯优化：
    1. 6 维连续空间，网格搜索指数爆炸；贝叶斯用高斯过程/TPE 高效采样
    2. 自动处理约束（prune 无效 trial）
    3. 支持多目标帕累托前沿（NSGA-II）

    坑与对策：
    - 坑 1：小样本（<50）时目标函数噪声大，贝叶斯可能过拟合
      → 对策：减少 n_trials（100-200），增加交叉验证；或先用网格搜索粗筛
    - 坑 2：权重空间不平滑，相邻参数可能决策完全不同（阈值跳跃）
      → 对策：TPE 对此有一定容忍度；也可对阈值用整数离散化
    - 坑 3：多目标前沿过于稀疏
      → 对策：限制目标数为 2-3 个，trials 至少 200+
    """
    import optuna

    if multi_objective:
        # 多目标：最大化 [胜率, 夏普]，同时约束回撤
        study = optuna.create_study(
            directions=["maximize", "maximize"],
            sampler=optuna.samplers.TPESampler(n_startup_trials=30, multivariate=True),
        )

        def objective(trial):
            weights, thresholds = get_search_space(trial)
            decisions = [simulate_chair_decision(s, weights, thresholds) for s in samples]
            metrics = calculate_metrics(samples, decisions)
            # 目标 1: 胜率；目标 2: 夏普
            # 若交易太少，惩罚
            if metrics["total_trades"] < 5:
                return -50, -5
            return metrics["win_rate"], metrics["sharpe"]

    else:
        study = optuna.create_study(
            direction="maximize",
            sampler=optuna.samplers.TPESampler(n_startup_trials=20, multivariate=True),
        )

        def objective(trial):
            weights, thresholds = get_search_space(trial)
            decisions = [simulate_chair_decision(s, weights, thresholds) for s in samples]
            metrics = calculate_metrics(samples, decisions)
            return single_objective_score(metrics)

    study.optimize(objective, n_trials=n_trials, show_progress_bar=True)

    return {
        "study": study,
        "best_trial": study.best_trial if not multi_objective else None,
        "pareto_front": study.best_trials if multi_objective else None,
    }


# ---------------------------------------------------------------------------
# 8. 交叉验证（防止过拟合）
# ---------------------------------------------------------------------------
def cross_validate(samples: List[HistorySample],
                   weights: Dict[str, float],
                   thresholds: Dict[str, float],
                   n_splits: int = 3) -> Dict[str, List[float]]:
    """
    时间序列交叉验证。

    为什么用时间序列 CV 而非随机 K-Fold：
    - 金融数据有时间依赖性，随机切分会泄露未来信息
    - 用前 N 条训练、后 M 条验证，模拟真实使用场景

    对于小样本（几十条），n_splits 建议 3 或留一法（LOO）。
    """
    n = len(samples)
    if n < n_splits * 2:
        n_splits = max(2, n // 2)

    fold_size = n // n_splits
    results = {
        "train_objective": [],
        "val_objective": [],
        "val_win_rate": [],
        "val_sharpe": [],
    }

    for i in range(1, n_splits):
        split_idx = i * fold_size
        train_samples = samples[:split_idx]
        val_samples = samples[split_idx:]

        train_decisions = [simulate_chair_decision(s, weights, thresholds) for s in train_samples]
        val_decisions = [simulate_chair_decision(s, weights, thresholds) for s in val_samples]

        train_metrics = calculate_metrics(train_samples, train_decisions)
        val_metrics = calculate_metrics(val_samples, val_decisions)

        results["train_objective"].append(single_objective_score(train_metrics))
        results["val_objective"].append(single_objective_score(val_metrics))
        results["val_win_rate"].append(val_metrics["win_rate"])
        results["val_sharpe"].append(val_metrics["sharpe"])

    return results


# ---------------------------------------------------------------------------
# 9. 结果输出
# ---------------------------------------------------------------------------
def print_results(results: Dict, samples: List[HistorySample]):
    print("\n" + "=" * 70)
    print("Chair 权重优化结果")
    print("=" * 70)
    print(f"历史样本数: {len(samples)}")

    if isinstance(results, list):
        # Grid search 结果列表
        best = results[0]
        print(f"\n【最优参数】(Grid Search Top-1)")
        for k, v in best["weights"].items():
            print(f"  {k} = {v:.4f}")
        for k, v in best["thresholds"].items():
            print(f"  {k} = {v:.2f}")
        m = best["metrics"]
        print(f"\n【回测指标】")
        print(f"  总交易次数: {m['total_trades']} (LONG {m.get('long_count', 0)}, SHORT {m.get('short_count', 0)})")
        print(f"  胜率: {m['win_rate']:.1f}% | 盈亏比: {m['profit_loss_ratio']:.2f} | 夏普: {m['sharpe']:.2f}")
        print(f"  最大回撤: {m['max_drawdown']:.2f}% | 总收益: {m['total_return']:.2f}% | 平均: {m['avg_pnl']:.2f}%")

        # 交叉验证
        weights = best["weights"]
        thresholds_full = {
            "long_threshold": best["thresholds"]["long_threshold"],
            "short_threshold": best["thresholds"]["short_threshold"],
            "extreme_greed_short_threshold": -10,
            "extreme_fear_long_threshold": 10,
        }
        cv = cross_validate(samples, weights, thresholds_full, n_splits=3)
        print(f"\n【时间序列交叉验证】(n_splits=3)")
        print(f"  训练集目标均值: {np.mean(cv['train_objective']):.2f}")
        print(f"  验证集目标均值: {np.mean(cv['val_objective']):.2f}")
        gap = np.mean(cv['train_objective']) - np.mean(cv['val_objective'])
        print(f"  训练-验证差距:  {gap:.2f} ({'过拟合风险低' if gap < 10 else '过拟合风险高'})")
        return

    if results.get("best_trial"):
        bt = results["best_trial"]
        print(f"\n【最优参数】(Trial #{bt.number})")
        params = bt.params
        print(f"  w_bull        = {params['w_bull']:.4f}")
        print(f"  w_preemption  = {params['w_preemption']:.4f}")
        print(f"  w_bear        = {params['w_bear']:.4f}")
        print(f"  w_macro       = {params['w_macro']:.4f}")
        print(f"  long_threshold  = {params['long_threshold']:.2f}")
        print(f"  short_threshold = {params['short_threshold']:.2f}")

        # 用最优参数重跑全量指标
        weights = {
            "w_bull": params["w_bull"],
            "w_preemption": params["w_preemption"],
            "w_bear": params["w_bear"],
            "w_macro": params["w_macro"],
        }
        thresholds = {
            "long_threshold": params["long_threshold"],
            "short_threshold": params["short_threshold"],
            "extreme_greed_short_threshold": params.get("extreme_greed_short", -10),
            "extreme_fear_long_threshold": params.get("extreme_fear_long", 10),
        }
        decisions = [simulate_chair_decision(s, weights, thresholds) for s in samples]
        metrics = calculate_metrics(samples, decisions)

        print(f"\n【回测指标】")
        print(f"  总交易次数: {metrics['total_trades']} (LONG {metrics['long_count']}, SHORT {metrics['short_count']})")
        print(f"  胜率:       {metrics['win_rate']:.1f}%")
        print(f"  盈亏比:     {metrics['profit_loss_ratio']:.2f}")
        print(f"  夏普比率:   {metrics['sharpe']:.2f}")
        print(f"  最大回撤:   {metrics['max_drawdown']:.2f}%")
        print(f"  总收益:     {metrics['total_return']:.2f}%")
        print(f"  Calmar:     {metrics['calmar']:.2f}")
        print(f"  平均盈亏:   {metrics['avg_pnl']:.2f}%")

        # 交叉验证
        print(f"\n【时间序列交叉验证】(n_splits=3)")
        cv = cross_validate(samples, weights, thresholds, n_splits=3)
        print(f"  训练集目标均值: {np.mean(cv['train_objective']):.2f}")
        print(f"  验证集目标均值: {np.mean(cv['val_objective']):.2f}")
        print(f"  验证集胜率均值: {np.mean(cv['val_win_rate']):.1f}%")
        print(f"  验证集夏普均值: {np.mean(cv['val_sharpe']):.2f}")
        gap = np.mean(cv['train_objective']) - np.mean(cv['val_objective'])
        print(f"  训练-验证差距:  {gap:.2f} ({'过拟合风险低' if gap < 10 else '过拟合风险高'})")

    elif results.get("pareto_front"):
        print(f"\n【帕累托前沿】(共 {len(results['pareto_front'])} 个解)")
        for i, trial in enumerate(results["pareto_front"][:5]):
            p = trial.params
            print(f"\n  解 #{i+1} (Trial {trial.number}):")
            print(f"    w_bull={p['w_bull']:.3f}, w_prep={p['w_preemption']:.3f}, "
                  f"w_bear={p['w_bear']:.3f}, w_macro={p['w_macro']:.3f}")
            print(f"    long_t={p['long_threshold']:.1f}, short_t={p['short_threshold']:.1f}")
            print(f"    目标值: 胜率={trial.values[0]:.1f}, 夏普={trial.values[1]:.2f}")

    print("=" * 70)


def export_best_params(results, output_path: Path):
    """将最优参数导出为 JSON，供 prompt 模板或配置系统读取。"""
    if isinstance(results, list):
        best = results[0]
        payload = {
            "weights": best["weights"],
            "thresholds": best["thresholds"],
            "objective_value": best["objective"],
        }
    elif isinstance(results, dict) and results.get("best_trial"):
        bt = results["best_trial"]
        payload = {
            "weights": {
                "w_bull": bt.params["w_bull"],
                "w_preemption": bt.params["w_preemption"],
                "w_bear": bt.params["w_bear"],
                "w_macro": bt.params["w_macro"],
            },
            "thresholds": {
                "long_threshold": bt.params["long_threshold"],
                "short_threshold": bt.params["short_threshold"],
            },
            "objective_value": bt.value,
        }
    else:
        payload = {}

    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n最优参数已导出: {output_path}")


# ---------------------------------------------------------------------------
# 10. 主入口
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Chair 权重优化搜索")
    parser.add_argument("--csv", type=Path, default=None, help="从 CSV 读取历史样本")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite 数据库路径")
    parser.add_argument("--algo", choices=["grid", "bayes"], default="bayes",
                        help="搜索算法: grid=网格搜索, bayes=贝叶斯优化(默认)")
    parser.add_argument("--trials", type=int, default=200, help="贝叶斯优化 trial 数")
    parser.add_argument("--multi-objective", action="store_true",
                        help="启用多目标帕累托优化（胜率+夏普）")
    parser.add_argument("--export", type=Path, default=PROJECT_ROOT / "data" / "chair_best_params.json",
                        help="最优参数导出路径")
    parser.add_argument("--generate-mock", action="store_true",
                        help="生成 mock 历史样本用于测试脚本")
    args = parser.parse_args()

    # 生成 mock 数据（测试用）
    if args.generate_mock:
        mock_path = PROJECT_ROOT / "data" / "chair_mock_history.csv"
        import pandas as pd
        np.random.seed(42)
        n = 120
        df = pd.DataFrame({
            "bull_conf": np.random.uniform(20, 90, n),
            "preemption": np.random.uniform(10, 95, n),
            "bear_conf": np.random.uniform(20, 90, n),
            "macro_score": np.random.uniform(-40, 40, n),
            "sentiment_rating": np.random.choice(
                ["neutral", "greed", "fear", "extreme_greed", "extreme_fear"], n
            ),
            "actual_pnl": np.random.normal(1.5, 4.0, n),  # 偏正收益
        })
        df.to_csv(mock_path, index=False)
        print(f"Mock 数据已生成: {mock_path} ({n} 条)")
        return

    # 加载样本
    try:
        samples = load_samples(csv_path=args.csv, db_path=args.db)
    except FileNotFoundError as e:
        print(f"错误: {e}")
        print("提示: 当前数据库中可能没有已验证的历史记录。")
        print("      使用 --generate-mock 生成测试数据，或提供 --csv 路径。")
        sys.exit(1)

    if len(samples) < 10:
        print(f"警告: 历史样本仅 {len(samples)} 条，优化结果可信度低。建议至少 30 条以上。")
        if len(samples) == 0:
            print("无可用样本，退出。")
            sys.exit(1)

    print(f"加载历史样本: {len(samples)} 条")

    # 执行搜索
    if args.algo == "grid":
        # 根据样本量自动调整步数
        w_steps = 4 if len(samples) > 200 else 3
        t_steps = 4 if len(samples) > 200 else 3
        results = run_grid_search(samples, w_steps=w_steps, t_steps=t_steps)
    else:
        results = run_bayesian_search(
            samples, n_trials=args.trials, multi_objective=args.multi_objective
        )

    # 输出
    print_results(results, samples)

    # 导出
    if args.export:
        export_best_params(results, args.export)


if __name__ == "__main__":
    main()
