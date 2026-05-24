import { useState, useEffect, useCallback, useMemo } from 'react';
import { TrendingUp, TrendingDown, Activity, Loader2, ChevronDown, ChevronUp, Target } from 'lucide-react';
import { getBacktestStock, getBacktestSummary } from '@/utils/researchApi';
import type { IndicatorData } from '@/types';

interface BacktestTrade {
  decision_date: string;
  decision: string;
  conviction: number;
  actual_pnl: number | null;
  holding_days: number;
  preemption_score: number | null;
}

interface StockStats {
  code: string;
  total_decisions: number;
  long: { count: number; win_rate: number; avg_pnl: number; total_pnl: number };
  short: { count: number; win_rate: number; avg_pnl: number; total_pnl: number };
  recent_trades: BacktestTrade[];
}

// 指标条件匹配回测结果
interface IndicatorMatch {
  date: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  criPct: number;
  costDevPct: number;
}

interface IndicatorBacktestResult {
  latestCRI: number;
  latestCostDev: number;
  latestBias225: number | null;
  tolerance: number;
  count: number;
  winRate: number;
  avgPnl: number;
  maxPnl: number;
  minPnl: number;
  medianPnl: number;
  matches: IndicatorMatch[];
}

interface BacktestPanelProps {
  code: string;
  indicators?: IndicatorData[];
}

function StatCard({
  label,
  count,
  winRate,
  avgPnl,
  totalPnl,
  color,
}: {
  label: string;
  count: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  color: string;
}) {
  if (count === 0) return null;
  return (
    <div className="p-3 rounded-lg border" style={{ borderColor: `${color}40`, backgroundColor: `${color}10` }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium" style={{ color }}>{label}</span>
        <span className="text-[10px] text-[#8B949E]">{count} 次</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold" style={{ fontFamily: 'JetBrains Mono', color }}>
          {winRate.toFixed(0)}%
        </span>
        <span className="text-[10px] text-[#8B949E]">胜率</span>
      </div>
      <div className="flex items-center justify-between mt-1 text-[10px]">
        <span className={avgPnl >= 0 ? 'text-[#03B172]' : 'text-[#FF3435]'}>
          均{avgPnl >= 0 ? '+' : ''}{avgPnl.toFixed(2)}%
        </span>
        <span className={totalPnl >= 0 ? 'text-[#03B172]' : 'text-[#FF3435]'}>
          累{totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

function runIndicatorBacktest(indicators: IndicatorData[], tolerance: number = 10): IndicatorBacktestResult | null {
  if (indicators.length < 30) return null;

  const latest = indicators[indicators.length - 1];
  const latestCRI = latest.criPercentile;
  const latestCostDev = latest.costDeviationPercentile;
  const latestBias225 = latest.bias225Percentile;

  if (latestCRI == null || latestCostDev == null) return null;

  const matches: IndicatorMatch[] = [];

  // 遍历历史（排除最新一日，防止 trivial match）
  for (let i = 0; i < indicators.length - 1; i++) {
    const ind = indicators[i];
    if (ind.criPercentile == null || ind.costDeviationPercentile == null) continue;

    const criDiff = Math.abs(ind.criPercentile - latestCRI);
    const costDevDiff = Math.abs(ind.costDeviationPercentile - latestCostDev);

    if (criDiff <= tolerance && costDevDiff <= tolerance) {
      const entryPrice = ind.close;
      const exitPrice = latest.close;
      const pnl = ((exitPrice - entryPrice) / entryPrice) * 100;
      matches.push({
        date: ind.date,
        entryPrice,
        exitPrice,
        pnl,
        criPct: ind.criPercentile,
        costDevPct: ind.costDeviationPercentile,
      });
    }
  }

  const count = matches.length;
  if (count === 0) {
    return {
      latestCRI, latestCostDev, latestBias225, tolerance,
      count: 0, winRate: 0, avgPnl: 0, maxPnl: 0, minPnl: 0, medianPnl: 0, matches: [],
    };
  }

  const wins = matches.filter(m => m.pnl > 0).length;
  const winRate = (wins / count) * 100;
  const avgPnl = matches.reduce((s, m) => s + m.pnl, 0) / count;
  const maxPnl = Math.max(...matches.map(m => m.pnl));
  const minPnl = Math.min(...matches.map(m => m.pnl));
  const sortedPnl = [...matches.map(m => m.pnl)].sort((a, b) => a - b);
  const medianPnl = count % 2 === 0
    ? (sortedPnl[count / 2 - 1] + sortedPnl[count / 2]) / 2
    : sortedPnl[Math.floor(count / 2)];

  // 按日期倒序
  matches.sort((a, b) => b.date.localeCompare(a.date));

  return {
    latestCRI, latestCostDev, latestBias225, tolerance,
    count, winRate, avgPnl, maxPnl, minPnl, medianPnl, matches,
  };
}

export default function BacktestPanel({ code, indicators }: BacktestPanelProps) {
  const [showPanel, setShowPanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [stats, setStats] = useState<StockStats | null>(null);
  const [globalStats, setGlobalStats] = useState<Record<string, any> | null>(null);

  // 指标条件回测结果（纯前端计算）
  const indicatorResult = useMemo(() => {
    if (!indicators || indicators.length < 30) return null;
    return runIndicatorBacktest(indicators, 10);
  }, [indicators]);

  const loadData = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    try {
      const [stockRes, globalRes] = await Promise.all([
        getBacktestStock(code),
        getBacktestSummary(),
      ]);
      if (stockRes.data) {
        setStats(stockRes.data);
      } else {
        setStats(null);
      }
      if (globalRes.stats) {
        setGlobalStats(globalRes.stats);
      }
    } catch (e) {
      console.error('加载回测数据失败', e);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [code]);

  useEffect(() => {
    if (showPanel && !loaded && !loading) {
      loadData();
    }
  }, [showPanel, loaded, loading, loadData]);

  const hasDecisionData = stats && (stats.long.count > 0 || stats.short.count > 0);
  const hasIndicatorData = indicatorResult && indicatorResult.count > 0;

  return (
    <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-[#8B949E] hover:text-white hover:bg-[#0D1117] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#E3B341]" />
          <span>AI 决策验证</span>
          {hasDecisionData && (
            <span className="text-xs text-[#8B949E]">
              ({stats!.total_decisions} 次已验证)
            </span>
          )}
        </div>
        {showPanel ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {showPanel && (
        <div className="px-4 py-3 border-t border-[#30363D]">
          {/* ===== 指标条件回测（优先展示，无需后端） ===== */}
          {indicatorResult ? (
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-[#58A6FF]" />
                <h4 className="text-xs font-medium text-[#C9D1D9]">指标条件历史回测</h4>
                <span className="text-[10px] text-[#484F58]">基于最新 K 线条件，找历史相似日</span>
              </div>

              {/* 当前条件 */}
              <div className="flex flex-wrap gap-2 mb-3">
                <span className="px-2 py-1 rounded text-[10px] bg-[#58A6FF]/10 text-[#58A6FF] border border-[#58A6FF]/20">
                  CRI 分位: {indicatorResult.latestCRI.toFixed(1)}%
                </span>
                <span className="px-2 py-1 rounded text-[10px] bg-[#E3B341]/10 text-[#E3B341] border border-[#E3B341]/20">
                  成本偏离分位: {indicatorResult.latestCostDev.toFixed(1)}%
                </span>
                {indicatorResult.latestBias225 != null && (
                  <span className="px-2 py-1 rounded text-[10px] bg-[#03B172]/10 text-[#03B172] border border-[#03B172]/20">
                    BIAS225 分位: {indicatorResult.latestBias225.toFixed(1)}%
                  </span>
                )}
                <span className="px-2 py-1 rounded text-[10px] bg-[#484F58]/20 text-[#8B949E] border border-[#484F58]/30">
                  容差: ±{indicatorResult.tolerance}%
                </span>
              </div>

              {indicatorResult.count > 0 ? (
                <>
                  {/* 统计卡片 */}
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <div className="p-2 rounded bg-[#0D1117] border border-[#30363D]/60 text-center">
                      <div className="text-[10px] text-[#8B949E]">历史匹配</div>
                      <div className="text-sm font-bold text-[#C9D1D9]" style={{ fontFamily: 'JetBrains Mono' }}>
                        {indicatorResult.count}次
                      </div>
                    </div>
                    <div className="p-2 rounded bg-[#0D1117] border border-[#30363D]/60 text-center">
                      <div className="text-[10px] text-[#8B949E]">胜率</div>
                      <div className={`text-sm font-bold ${indicatorResult.winRate >= 50 ? 'text-[#03B172]' : 'text-[#FF3435]'}`} style={{ fontFamily: 'JetBrains Mono' }}>
                        {indicatorResult.winRate.toFixed(0)}%
                      </div>
                    </div>
                    <div className="p-2 rounded bg-[#0D1117] border border-[#30363D]/60 text-center">
                      <div className="text-[10px] text-[#8B949E]">平均收益</div>
                      <div className={`text-sm font-bold ${indicatorResult.avgPnl >= 0 ? 'text-[#03B172]' : 'text-[#FF3435]'}`} style={{ fontFamily: 'JetBrains Mono' }}>
                        {indicatorResult.avgPnl >= 0 ? '+' : ''}{indicatorResult.avgPnl.toFixed(2)}%
                      </div>
                    </div>
                    <div className="p-2 rounded bg-[#0D1117] border border-[#30363D]/60 text-center">
                      <div className="text-[10px] text-[#8B949E]">中位收益</div>
                      <div className={`text-sm font-bold ${indicatorResult.medianPnl >= 0 ? 'text-[#03B172]' : 'text-[#FF3435]'}`} style={{ fontFamily: 'JetBrains Mono' }}>
                        {indicatorResult.medianPnl >= 0 ? '+' : ''}{indicatorResult.medianPnl.toFixed(2)}%
                      </div>
                    </div>
                  </div>

                  {/* 极值 */}
                  <div className="flex items-center gap-3 mb-3 text-[10px]">
                    <span className="text-[#8B949E]">区间:</span>
                    <span className="text-[#03B172]">最大 +{indicatorResult.maxPnl.toFixed(2)}%</span>
                    <span className="text-[#FF3435]">最小 {indicatorResult.minPnl.toFixed(2)}%</span>
                  </div>

                  {/* 最近匹配记录 */}
                  <div>
                    <h5 className="text-[10px] font-medium text-[#8B949E] mb-1.5">最近匹配记录（买入日 → 今日）</h5>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {indicatorResult.matches.slice(0, 10).map((m, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between px-2 py-1 rounded bg-[#0D1117] border border-[#30363D]/60"
                        >
                          <div className="flex items-center gap-2">
                            {m.pnl >= 0 ? (
                              <TrendingUp className="w-3 h-3 text-[#03B172]" />
                            ) : (
                              <TrendingDown className="w-3 h-3 text-[#FF3435]" />
                            )}
                            <span className="text-[11px] text-[#C9D1D9]">{m.date}</span>
                            <span className="text-[10px] text-[#484F58]">
                              C{m.criPct.toFixed(0)}%·D{m.costDevPct.toFixed(0)}%
                            </span>
                          </div>
                          <span
                            className={`text-[11px] font-mono font-medium ${
                              m.pnl >= 0 ? 'text-[#03B172]' : 'text-[#FF3435]'
                            }`}
                          >
                            {m.pnl >= 0 ? '+' : ''}{m.pnl.toFixed(2)}%
                          </span>
                        </div>
                      ))}
                    </div>
                    {indicatorResult.matches.length > 10 && (
                      <p className="text-[10px] text-[#484F58] mt-1 text-center">
                        还有 {indicatorResult.matches.length - 10} 条记录未显示
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-4 text-[#8B949E] text-sm">
                  <p>历史数据中未找到相似条件</p>
                  <p className="text-xs mt-1 text-[#484F58]">
                    当前 CRI {indicatorResult.latestCRI.toFixed(1)}% + 成本偏离 {indicatorResult.latestCostDev.toFixed(1)}% 的组合在历史上首次出现
                  </p>
                </div>
              )}
            </div>
          ) : indicators && indicators.length > 0 ? (
            <div className="text-center py-4 text-[#8B949E] text-sm mb-4">
              <p>指标数据不足，无法回测（需至少 30 个交易日）</p>
            </div>
          ) : null}

          {/* 分隔线 */}
          {hasIndicatorData && hasDecisionData && (
            <div className="border-t border-[#30363D] my-4" />
          )}

          {/* ===== AI 决策回测（原有逻辑，需后端数据） ===== */}
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-[#8B949E] text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载回测数据中...
            </div>
          ) : !hasDecisionData ? (
            <div className="text-center py-6 text-[#8B949E] text-sm">
              <p>该股票暂无已验证的 AI 决策数据</p>
              <p className="text-xs mt-1 text-[#484F58]">
                决策生成后需持有期结束才会自动验证盈亏
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 胜率卡片 */}
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  label="LONG"
                  count={stats!.long.count}
                  winRate={stats!.long.win_rate}
                  avgPnl={stats!.long.avg_pnl}
                  totalPnl={stats!.long.total_pnl}
                  color="#03B172"
                />
                <StatCard
                  label="SHORT"
                  count={stats!.short.count}
                  winRate={stats!.short.win_rate}
                  avgPnl={stats!.short.avg_pnl}
                  totalPnl={stats!.short.total_pnl}
                  color="#FF3435"
                />
              </div>

              {/* 最近交易 */}
              {stats!.recent_trades.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-medium text-[#8B949E] mb-2">最近验证记录</h4>
                  <div className="space-y-1.5">
                    {stats!.recent_trades.map((t, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between px-2 py-1.5 rounded bg-[#0D1117] border border-[#30363D]/60"
                      >
                        <div className="flex items-center gap-2">
                          {t.decision === 'long' ? (
                            <TrendingUp className="w-3 h-3 text-[#03B172]" />
                          ) : (
                            <TrendingDown className="w-3 h-3 text-[#FF3435]" />
                          )}
                          <span className="text-[11px] text-[#C9D1D9]">{t.decision_date}</span>
                          <span className="text-[10px] text-[#8B949E]">conv={t.conviction}</span>
                          {t.preemption_score != null && (
                            <span className="text-[10px] text-[#D2A8FF]">
                              P={t.preemption_score}
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-[11px] font-mono font-medium ${
                            t.actual_pnl != null && t.actual_pnl >= 0
                              ? 'text-[#03B172]'
                              : 'text-[#FF3435]'
                          }`}
                        >
                          {t.actual_pnl != null
                            ? `${t.actual_pnl >= 0 ? '+' : ''}${t.actual_pnl.toFixed(2)}%`
                            : 'N/A'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 全局条件统计（如果有数据） */}
              {globalStats && Object.keys(globalStats).length > 0 && (
                <div>
                  <h4 className="text-[11px] font-medium text-[#8B949E] mb-2">全局策略表现</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(globalStats)
                      .filter(([, v]: [string, any]) => v && v.count > 0)
                      .slice(0, 4)
                      .map(([key, v]: [string, any]) => (
                        <div
                          key={key}
                          className="px-2 py-1.5 rounded bg-[#0D1117] border border-[#30363D]/60"
                        >
                          <div className="text-[9px] text-[#8B949E] truncate">{key}</div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[10px] text-[#C9D1D9]">{v.count}次</span>
                            <span className="text-[10px] font-mono" style={{ color: v.win_rate >= 50 ? '#03B172' : '#FF3435' }}>
                              {v.win_rate}%胜
                            </span>
                          </div>
                          <div className="text-[9px] text-[#8B949E]">
                            均{v.avg_pnl >= 0 ? '+' : ''}{v.avg_pnl}%
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
