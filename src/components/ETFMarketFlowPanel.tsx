import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { BarChart3, Loader2 } from 'lucide-react';
import { getETFMarketFlow } from '@/utils/researchApi';
import type { ETFMarketFlowData } from '@/types';

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

export default function ETFMarketFlowPanel() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ETFMarketFlowData | null>(null);
  const [error, setError] = useState('');

  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getETFMarketFlow(days)
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
    const { dates, inflow, cumulative } = data;
    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      grid: { left: 60, right: 60, top: 40, bottom: 30 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: 'rgba(22, 27, 34, 0.95)',
        borderColor: '#30363D',
        textStyle: { color: '#C9D1D9', fontSize: 11 },
        formatter: (params: any) => {
          if (!params || !params.length) return '';
          const date = params[0].axisValue;
          let html = `<div class="font-mono">${date}</div>`;
          params.forEach((p: any) => {
            html += `<div class="flex items-center gap-2 mt-1">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>
              <span class="text-[#8B949E]">${p.seriesName}:</span>
              <span class="font-mono">${formatYi(Number(p.value))}</span>
            </div>`;
          });
          return html;
        },
      },
      legend: {
        data: ['每日净流入', '累计净流入'],
        textStyle: { color: '#8B949E', fontSize: 11 },
        top: 8,
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: '#30363D' } },
        axisLabel: { color: '#8B949E', fontSize: 10 },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: '亿元',
          nameTextStyle: { color: '#8B949E', fontSize: 10 },
          axisLine: { show: false },
          splitLine: { lineStyle: { color: '#21262D' } },
          axisLabel: { color: '#8B949E', fontSize: 10 },
        },
        {
          type: 'value',
          name: '累计',
          position: 'right',
          nameTextStyle: { color: '#8B949E', fontSize: 10 },
          axisLine: { show: false },
          splitLine: { show: false },
          axisLabel: { color: '#8B949E', fontSize: 10 },
        },
      ],
      series: [
        {
          name: '每日净流入',
          type: 'bar',
          data: inflow.map((v) => ({
            value: v,
            itemStyle: { color: v >= 0 ? '#03B172' : '#FF3435' },
          })),
          barMaxWidth: 16,
        },
        {
          name: '累计净流入',
          type: 'line',
          yAxisIndex: 1,
          data: cumulative,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#58A6FF', width: 2 },
          itemStyle: { color: '#58A6FF' },
          areaStyle: { color: 'rgba(88, 166, 255, 0.08)' },
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

  const latestCumulative = data?.cumulative.length
    ? data.cumulative[data.cumulative.length - 1]
    : null;

  return (
    <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[#30363D]">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#58A6FF]" />
          <span className="text-sm text-[#C9D1D9]">ETF 市场净流入走势</span>
          {latestCumulative !== null && (
            <span className={`text-xs font-mono ${latestCumulative >= 0 ? 'text-[#03B172]' : 'text-[#FF3435]'}`}>
              {formatYi(latestCumulative)}
            </span>
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

      <div className="px-4 py-3">
        {loading && (
          <div className="flex items-center justify-center py-10 gap-2 text-[#8B949E] text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            加载 ETF 市场资金流向...
          </div>
        )}
        {!loading && error && (
          <div className="text-center py-8 text-[#FF3435] text-sm">{error}</div>
        )}
        {!loading && !error && data && data.dates.length === 0 && (
          <div className="text-center py-8 text-[#8B949E] text-sm">暂无 ETF 资金流向数据</div>
        )}
        {!loading && !error && data && data.dates.length > 0 && (
          <div ref={chartRef} className="w-full h-72" />
        )}
      </div>
    </div>
  );
}
