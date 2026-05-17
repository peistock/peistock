import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Loader2, ChevronDown, ChevronUp, Target, BarChart3 } from 'lucide-react';
import { getSignalBacktest } from '@/utils/researchApi';
import type { SignalBacktestItem, SignalBacktestMatch } from '@/utils/researchApi';

interface SignalBacktestData {
  code: string;
  current_price: number;
  latest_date: string;
  latest_cri_pct: number;
  latest_cost_dev_pct: number;
  signals: SignalBacktestItem[];
  current_match: SignalBacktestMatch | null;
}

interface SignalBacktestPanelProps {
  code: string;
}

function formatPct(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function formatRatio(v: number): string {
  if (typeof v !== 'number' || isNaN(v)) return '—';
  return v.toFixed(2);
}

function RatioCell({ value }: { value: number }) {
  const isGood = typeof value === 'number' && value >= 1;
  return (
    <span className={`font-mono font-medium ${isGood ? 'text-[#03B172]' : 'text-[#FF3435]'}`}>
      {formatRatio(value)}
    </span>
  );
}

function PctCell({ value, reverse = false }: { value: number; reverse?: boolean }) {
  const isGood = reverse ? value < 0 : value >= 0;
  return (
    <span className={`font-mono font-medium ${isGood ? 'text-[#03B172]' : 'text-[#FF3435]'}`}>
      {formatPct(value)}
    </span>
  );
}

export default function SignalBacktestPanel({ code }: SignalBacktestPanelProps) {
  const [showPanel, setShowPanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [data, setData] = useState<SignalBacktestData | null>(null);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError('');
    try {
      const res = await getSignalBacktest(code);
      if (res.status === 'ok' && res.data) {
        setData(res.data);
      } else {
        setError(res.message || '无回测数据');
      }
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [code]);

  // code 变化时重置状态，确保切换股票后重新加载
  useEffect(() => {
    setLoaded(false);
    setData(null);
    setError('');
  }, [code]);

  useEffect(() => {
    if (showPanel && !loaded && !loading) {
      loadData();
    }
  }, [showPanel, loaded, loading, loadData]);

  // 强制刷新
  const handleRefresh = () => {
    setLoaded(false);
    loadData();
  };

  const hasSignals = data && data.signals.length > 0;

  return (
    <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-[#8B949E] hover:text-white hover:bg-[#0D1117] transition-colors"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#58A6FF]" />
          <span>信号级回测看板</span>
          {hasSignals && (
            <span className="text-xs text-[#8B949E]">
              ({data!.signals.length} 个历史信号)
            </span>
          )}
        </div>
        {showPanel ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {showPanel && (
        <div className="px-4 py-3 border-t border-[#30363D]">
          {/* 顶部条件栏 */}
          {data && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="px-2 py-1 rounded text-[10px] bg-[#58A6FF]/10 text-[#58A6FF] border border-[#58A6FF]/20">
                CRI 分位: {data.latest_cri_pct.toFixed(1)}%
              </span>
              <span className="px-2 py-1 rounded text-[10px] bg-[#E3B341]/10 text-[#E3B341] border border-[#E3B341]/20">
                成本偏离分位: {data.latest_cost_dev_pct.toFixed(1)}%
              </span>
              <span className="px-2 py-1 rounded text-[10px] bg-[#484F58]/20 text-[#8B949E] border border-[#484F58]/30">
                现价: {data.current_price.toFixed(2)}
              </span>
              <button
                onClick={handleRefresh}
                className="ml-auto text-[10px] text-[#8B949E] hover:text-white transition-colors"
              >
                刷新
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-[#8B949E] text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载回测数据中...
            </div>
          ) : error ? (
            <div className="text-center py-6 text-[#FF3435] text-sm">
              <p>{error}</p>
            </div>
          ) : !hasSignals ? (
            <div className="text-center py-6 text-[#8B949E] text-sm">
              <p>该股票暂无历史 B/S 信号</p>
            </div>
          ) : (
            <>
              {/* 当前条件匹配卡片 */}
              {data!.current_match && (
                <div className="mb-4 p-3 rounded-lg border border-[#58A6FF]/30 bg-[#58A6FF]/5">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 text-[#58A6FF]" />
                    <h4 className="text-xs font-medium text-[#C9D1D9]">当前条件最接近匹配</h4>
                    <span className="text-[10px] text-[#484F58]">
                      欧氏距离: {data!.current_match.distance}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    <span className="px-2 py-1 rounded text-[10px] bg-[#0D1117] text-[#C9D1D9] border border-[#30363D]/60">
                      匹配日: {data!.current_match.date}
                    </span>
                    <span className="px-2 py-1 rounded text-[10px] bg-[#0D1117] text-[#58A6FF] border border-[#30363D]/60">
                      CRI: {data!.current_match.cri_pct.toFixed(1)}%
                    </span>
                    <span className="px-2 py-1 rounded text-[10px] bg-[#0D1117] text-[#E3B341] border border-[#30363D]/60">
                      成本偏离: {data!.current_match.cost_dev_pct.toFixed(1)}%
                    </span>
                    <span className="px-2 py-1 rounded text-[10px] bg-[#0D1117] text-[#C9D1D9] border border-[#30363D]/60">
                      买入价: {data!.current_match.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="text-center">
                      <div className="text-[10px] text-[#8B949E]">盈亏比</div>
                      <RatioCell value={data!.current_match.profit_loss_ratio} />
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-[#8B949E]">最大收益</div>
                      <PctCell value={data!.current_match.max_gain} />
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-[#8B949E]">最大回撤</div>
                      <PctCell value={data!.current_match.max_drawdown} reverse />
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-[#8B949E]">买入价</div>
                      <span className="font-mono font-medium text-[#C9D1D9]">{data!.current_match.price.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 信号表格 */}
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-[10px] text-[#8B949E] border-b border-[#30363D]">
                      <th className="text-left py-1.5 px-1 font-medium">日期</th>
                      <th className="text-left py-1.5 px-1 font-medium">信号</th>
                      <th className="text-right py-1.5 px-1 font-medium">买入价</th>
                      <th className="text-right py-1.5 px-1 font-medium">最大收益</th>
                      <th className="text-right py-1.5 px-1 font-medium">最大回撤</th>
                      <th className="text-right py-1.5 px-1 font-medium">盈亏比</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363D]/40">
                    {data!.signals.map((s, i) => (
                      <tr
                        key={i}
                        className="hover:bg-[#0D1117]/50 transition-colors"
                      >
                        <td className="py-1.5 px-1 text-[#C9D1D9]">{s.date}</td>
                        <td className="py-1.5 px-1">
                          <div className="flex items-center gap-1">
                            {s.signal_type === 'B' ? (
                              <TrendingUp className="w-3 h-3 text-[#03B172]" />
                            ) : (
                              <TrendingDown className="w-3 h-3 text-[#FF3435]" />
                            )}
                            <span
                              className={`font-medium ${
                                s.signal_type === 'B' ? 'text-[#03B172]' : 'text-[#FF3435]'
                              }`}
                            >
                              {s.signal_label}
                            </span>
                          </div>
                        </td>
                        <td className="py-1.5 px-1 text-right text-[#C9D1D9] font-mono">
                          {s.price.toFixed(2)}
                        </td>
                        <td className="py-1.5 px-1 text-right">
                          <PctCell value={s.max_gain} />
                        </td>
                        <td className="py-1.5 px-1 text-right">
                          <PctCell value={s.max_drawdown} reverse />
                        </td>
                        <td className="py-1.5 px-1 text-right">
                          <RatioCell value={s.profit_loss_ratio} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 底部统计 */}
              {data!.signals.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#30363D]/40 flex items-center justify-between text-[10px] text-[#8B949E]">
                  <span>
                    B 信号: {data!.signals.filter(s => s.signal_type === 'B').length} 次
                  </span>
                  <span>
                    S 信号: {data!.signals.filter(s => s.signal_type === 'S').length} 次
                  </span>
                  <span>
                    平均盈亏比:{' '}
                    <span className="font-mono">
                      {formatRatio(
                        data!.signals.reduce((sum, s) => sum + s.profit_loss_ratio, 0) /
                          data!.signals.length
                      )}
                    </span>
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
