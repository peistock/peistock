import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
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
  return `${sign}${value.toFixed(2)} 亿`;
}

export default function ETFSectorFlowPanel() {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ETFSectorFlowData | null>(null);
  const [error, setError] = useState('');

  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

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

  useEffect(() => {
    if (!data || !chartRef.current) return;
    if (!chart.current) {
      chart.current = echarts.init(chartRef.current, 'dark');
    }
    const { sectors, inflow } = data;
    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      grid: { left: 70, right: 60, top: 20, bottom: 30 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(22, 27, 34, 0.95)',
        borderColor: '#30363D',
        textStyle: { color: '#C9D1D9', fontSize: 11 },
        formatter: (params: any) => {
          if (!params || !params.length) return '';
          const p = params[0];
          const v = Number(p.value);
          return `<div class="font-mono">${p.name}</div>
            <div class="mt-1 text-[#8B949E]">${v >= 0 ? '流入' : '流出'}:
              <span class="font-mono" style="color:${v >= 0 ? '#03B172' : '#FF3435'}">${formatYi(v)}</span>
            </div>`;
        },
      },
      xAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: '#30363D' } },
        splitLine: { lineStyle: { color: '#21262D' } },
        axisLabel: {
          color: '#8B949E',
          fontSize: 10,
          formatter: (v: number) => Math.abs(v).toString(),
        },
      },
      yAxis: {
        type: 'category',
        data: sectors,
        axisLine: { lineStyle: { color: '#30363D' } },
        axisLabel: { color: '#C9D1D9', fontSize: 11 },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: inflow.map((v) => ({
            value: v,
            itemStyle: { color: v >= 0 ? '#03B172' : '#FF3435' },
            label: {
              show: true,
              position: v >= 0 ? 'right' : 'left',
              formatter: `${v >= 0 ? '+' : ''}${v.toFixed(1)} 亿`,
              color: '#8B949E',
              fontSize: 10,
              fontFamily: 'JetBrains Mono',
            },
          })),
          barMaxWidth: 18,
        },
      ],
    };
    chart.current.setOption(option, true);
  }, [data]);

  useEffect(() => {
    const handleResize = () => chart.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <PieChart className="w-4 h-4 text-[#58A6FF]" />
          <span className="text-sm text-[#C9D1D9]">ETF 板块资金轮动</span>
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

      <div className="px-4 py-3">
        {loading && (
          <div className="flex items-center justify-center py-10 gap-2 text-[#8B949E] text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            加载 ETF 板块资金流向...
          </div>
        )}
        {!loading && error && (
          <div className="text-center py-8 text-[#FF3435] text-sm">{error}</div>
        )}
        {!loading && !error && data && data.sectors.length === 0 && (
          <div className="text-center py-8 text-[#8B949E] text-sm">暂无 ETF 板块资金流向数据</div>
        )}
        {!loading && !error && data && data.sectors.length > 0 && (
          <div ref={chartRef} className="w-full h-72" />
        )}
      </div>
    </div>
  );
}
