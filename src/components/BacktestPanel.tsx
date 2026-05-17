import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Activity, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { getBacktestStock, getBacktestSummary } from '@/utils/researchApi';

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

interface BacktestPanelProps {
  code: string;
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

export default function BacktestPanel({ code }: BacktestPanelProps) {
  const [showPanel, setShowPanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [stats, setStats] = useState<StockStats | null>(null);
  const [globalStats, setGlobalStats] = useState<Record<string, any> | null>(null);

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

  const hasData = stats && (stats.long.count > 0 || stats.short.count > 0);

  return (
    <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-[#8B949E] hover:text-white hover:bg-[#0D1117] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#E3B341]" />
          <span>AI 决策验证</span>
          {hasData && (
            <span className="text-xs text-[#8B949E]">
              ({stats!.total_decisions} 次已验证)
            </span>
          )}
        </div>
        {showPanel ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {showPanel && (
        <div className="px-4 py-3 border-t border-[#30363D]">
          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-[#8B949E] text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载回测数据中...
            </div>
          ) : !hasData ? (
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
