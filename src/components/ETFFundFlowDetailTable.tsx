import { useEffect, useMemo, useState } from 'react';
import { Loader2, Table2, ChevronDown, ChevronRight } from 'lucide-react';
import { getETFFundFlowDetail } from '@/utils/researchApi';
import type { ETFFundFlowDetailItem } from '@/types';

const CATEGORIES = [
  '全部',
  '宽基',
  '红利',
  '科技',
  '新能源',
  '消费',
  '医药',
  '金融',
  '周期',
  '军工',
  '传媒',
  '商品',
  '跨境',
  '债券',
];

const WINDOWS = [
  { key: '1', label: '1日' },
  { key: '7', label: '1周' },
  { key: '14', label: '2周' },
  { key: '30', label: '1月' },
  { key: '90', label: '3月' },
  { key: '180', label: '6月' },
  { key: '365', label: '1年' },
] as const;

type WindowKey = typeof WINDOWS[number]['key'];

function formatFlow(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}`;
}

function formatRate(v: number | null): string {
  if (v === null) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

export default function ETFFundFlowDetailTable() {
  const [sector, setSector] = useState('全部');
  const [data, setData] = useState<ETFFundFlowDetailItem[]>([]);
  const [latestDate, setLatestDate] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<WindowKey>('7');
  const [sortDesc, setSortDesc] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    getETFFundFlowDetail(sector === '全部' ? '' : sector)
      .then((res) => {
        if (cancelled) return;
        if (res.status === 'ok') {
          setData(res.data);
          setLatestDate(res.latest_date);
        } else setError(res.message || '数据异常');
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
  }, [sector, expanded]);

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = a.windows[sortKey].flow;
      const bv = b.windows[sortKey].flow;
      return sortDesc ? bv - av : av - bv;
    });
  }, [data, sortKey, sortDesc]);

  const handleSort = (key: WindowKey) => {
    if (sortKey === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  return (
    <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[#30363D]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-[#8B949E]" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[#8B949E]" />
          )}
          <Table2 className="w-4 h-4 text-[#58A6FF]" />
          <span className="text-sm text-[#C9D1D9]">ETF 资金流向明细</span>
          {latestDate && (
            <span className="text-[10px] text-[#8B949E] font-mono">({latestDate})</span>
          )}
        </button>

        {expanded && (
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-xs text-[#C9D1D9] focus:outline-none focus:border-[#58A6FF]"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      {expanded && (
        <div className="overflow-x-auto">
          {loading && (
            <div className="flex items-center justify-center py-10 gap-2 text-[#8B949E] text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载 ETF 明细数据...
            </div>
          )}
          {!loading && error && (
            <div className="text-center py-8 text-[#FF3435] text-sm">{error}</div>
          )}
          {!loading && !error && data.length === 0 && (
            <div className="text-center py-8 text-[#8B949E] text-sm">暂无 ETF 明细数据</div>
          )}
          {!loading && !error && data.length > 0 && (
            <table className="w-full text-[11px]">
              <thead className="bg-[#0D1117] text-[#8B949E]">
                <tr>
                  <th className="text-left py-2 px-3 font-medium sticky left-0 bg-[#0D1117] z-10">基金名称</th>
                  <th className="text-left py-2 px-3 font-medium">代码</th>
                  <th className="text-right py-2 px-3 font-medium">规模(亿)</th>
                  {WINDOWS.map((w) => (
                    <th
                      key={w.key}
                      onClick={() => handleSort(w.key)}
                      className="text-center py-2 px-3 font-medium cursor-pointer hover:text-white whitespace-nowrap"
                    >
                      {w.label}
                      {sortKey === w.key && (
                        <span className="ml-1 text-[#58A6FF]">{sortDesc ? '↓' : '↑'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363D]/40">
                {sortedData.map((item) => (
                  <tr
                    key={item.code}
                    className="hover:bg-[#0D1117]/50 transition-colors"
                  >
                    <td className="py-2 px-3 text-[#C9D1D9] sticky left-0 bg-[#161B22] z-10 min-w-[140px]">
                      {item.name}
                    </td>
                    <td className="py-2 px-3 font-mono text-[#8B949E] whitespace-nowrap">{item.code}</td>
                    <td className="py-2 px-3 text-right font-mono text-[#C9D1D9] whitespace-nowrap">
                      {item.scale > 0 ? item.scale.toFixed(1) : '—'}
                    </td>
                    {WINDOWS.map((w) => {
                      const v = item.windows[w.key];
                      const flowColor = v.flow >= 0 ? 'text-[#03B172]' : 'text-[#FF3435]';
                      const rateColor =
                        v.change_rate === null
                          ? 'text-[#8B949E]'
                          : v.change_rate >= 0
                          ? 'text-[#03B172]'
                          : 'text-[#FF3435]';
                      return (
                        <td
                          key={w.key}
                          className="py-2 px-3 text-center whitespace-nowrap min-w-[70px]"
                        >
                          <div className={`font-mono ${flowColor}`}>{formatFlow(v.flow)}</div>
                          <div className={`font-mono text-[10px] opacity-70 ${rateColor}`}>{formatRate(v.change_rate)}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
