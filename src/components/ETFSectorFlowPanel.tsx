import { useEffect, useMemo, useState } from 'react';
import { Loader2, PieChart } from 'lucide-react';
import { getETFSectorFlow } from '@/utils/researchApi';
import type { ETFSectorFlowData } from '@/types';

interface TimeOption {
  label: string;
  days: number;
}

function getYearToDateDays(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.max(1, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

const TIME_OPTIONS: TimeOption[] = [
  { label: '1日', days: 1 },
  { label: '1周', days: 7 },
  { label: '1月', days: 30 },
  { label: '3月', days: 90 },
  { label: '6月', days: 180 },
  { label: '今年来', days: getYearToDateDays() },
  { label: '1年', days: 365 },
];

function formatYi(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(0)}`;
}

export default function ETFSectorFlowPanel() {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ETFSectorFlowData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getETFSectorFlow(days)
      .then((res) => {
        if (cancelled) return;
        if (res.status === 'ok') setData(res.data);
        else setError(res.message || '数据异常');
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const { outflowItems, inflowItems, stats, rowCount, maxAbs } = useMemo(() => {
    if (!data) {
      return { outflowItems: [], inflowItems: [], stats: null, rowCount: 0, maxAbs: 1 };
    }
    const items = data.sectors.map((sector, i) => ({ sector, inflow: data.inflow[i] }));
    const outflow = items
      .filter((x) => x.inflow < 0)
      .sort((a, b) => a.inflow - b.inflow);
    const inflow = items
      .filter((x) => x.inflow > 0)
      .sort((a, b) => b.inflow - a.inflow);
    const totalOut = outflow.reduce((s, x) => s + x.inflow, 0);
    const totalIn = inflow.reduce((s, x) => s + x.inflow, 0);
    const net = totalOut + totalIn;
    const maxTo = inflow.length ? inflow[0] : null;
    const values = [
      ...outflow.map((x) => Math.abs(x.inflow)),
      ...inflow.map((x) => x.inflow),
    ];
    const maxAbs = values.length ? Math.max(...values) : 1;
    return {
      outflowItems: outflow,
      inflowItems: inflow,
      stats: { totalOut, totalIn, net, maxTo },
      rowCount: Math.max(outflow.length, inflow.length),
      maxAbs,
    };
  }, [data]);

  return (
    <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <PieChart className="w-4 h-4 text-[#58A6FF]" />
          <span className="text-sm text-[#C9D1D9]">ETF 资金轮动（单位：亿元）</span>
          {data?.latest_date && (
            <span className="text-[10px] text-[#8B949E] font-mono">({data.latest_date})</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              onClick={() => setDays(opt.days)}
              className={`px-2 py-1 rounded text-[10px] transition-colors ${
                days === opt.days
                  ? 'bg-[#03B172]/10 text-[#03B172] border border-[#03B172]/20'
                  : 'text-[#8B949E] hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-[#30363D]">
          <div className="text-center">
            <div className="text-[10px] text-[#8B949E]">流出合计</div>
            <div className="text-sm font-mono font-medium text-[#03B172]">{formatYi(stats.totalOut)}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-[#8B949E]">流入合计</div>
            <div className="text-sm font-mono font-medium text-[#FF3435]">{formatYi(stats.totalIn)}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-[#8B949E]">净流入</div>
            <div
              className={`text-sm font-mono font-medium ${
                stats.net >= 0 ? 'text-[#FF3435]' : 'text-[#03B172]'
              }`}
            >
              {formatYi(stats.net)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-[#8B949E]">最大去向</div>
            <div className="text-sm font-medium text-[#FF3435]">
              {stats.maxTo ? stats.maxTo.sector : '—'}
            </div>
          </div>
        </div>
      )}

      <div className="px-4 py-4 relative min-h-[288px]">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#161B22]/80 py-10 gap-2 text-[#8B949E] text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            加载 ETF 板块资金流向...
          </div>
        )}
        {!loading && error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#161B22]/80 text-[#FF3435] text-sm">{error}</div>
        )}
        {!loading && !error && data && rowCount === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#161B22]/80 text-[#8B949E] text-sm">暂无 ETF 板块资金流向数据</div>
        )}
        {!loading && !error && data && rowCount > 0 && (
          <div className="grid grid-cols-[1fr_auto_1fr] gap-1">
            {/* 流出侧 */}
            <div className="flex flex-col">
              {Array.from({ length: rowCount }).map((_, i) => {
                const item = outflowItems[i];
                if (!item) return <div key={`out-${i}`} className="h-7" />;
                const width = (Math.abs(item.inflow) / maxAbs) * 100;
                return (
                  <div key={item.sector} className="h-7 flex items-center gap-2">
                    <span className="text-xs text-[#C9D1D9] w-10 text-right truncate">{item.sector}</span>
                    <span className="text-xs font-mono text-[#03B172] w-8 text-right">{formatYi(item.inflow)}</span>
                    <div className="flex-1 flex justify-end h-2 bg-[#21262D]/50 rounded-l overflow-hidden">
                      <div className="h-full bg-[#03B172]" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 中间分隔线 */}
            <div className="w-px bg-[#30363D] self-stretch mx-1" />

            {/* 流入侧 */}
            <div className="flex flex-col">
              {Array.from({ length: rowCount }).map((_, i) => {
                const item = inflowItems[i];
                if (!item) return <div key={`in-${i}`} className="h-7" />;
                const width = (item.inflow / maxAbs) * 100;
                return (
                  <div key={item.sector} className="h-7 flex items-center gap-2">
                    <div className="flex-1 flex justify-start h-2 bg-[#21262D]/50 rounded-r overflow-hidden">
                      <div className="h-full bg-[#FF3435]" style={{ width: `${width}%` }} />
                    </div>
                    <span className="text-xs font-mono text-[#FF3435] w-8 text-left">{formatYi(item.inflow)}</span>
                    <span className="text-xs text-[#C9D1D9] w-10 text-left truncate">{item.sector}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
