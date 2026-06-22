import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { BarChart3, ChevronDown, ChevronUp, Loader2, PieChart } from 'lucide-react';
import { getETFMarketFlow, getETFSectorFlow } from '@/utils/researchApi';
import type { ETFMarketFlowData, ETFSectorFlowData } from '@/types';

type TabType = 'trend' | 'sector';

interface TimeOption {
  label: string;
  days: number;
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

function getYearToDateDays(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.max(1, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

function formatYi(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)} 亿`;
}

export default function ETFFundFlowPanel() {
  const [showPanel, setShowPanel] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('trend');
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [marketData, setMarketData] = useState<ETFMarketFlowData | null>(null);
  const [sectorData, setSectorData] = useState<ETFSectorFlowData | null>(null);
  const [error, setError] = useState('');

  const trendChartRef = useRef<HTMLDivElement>(null);
  const sectorChartRef = useRef<HTMLDivElement>(null);
  const trendChart = useRef<echarts.ECharts | null>(null);
  const sectorChart = useRef<echarts.ECharts | null>(null);

  // 加载数据
  useEffect(() => {
    if (!showPanel) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([getETFMarketFlow(days), getETFSectorFlow(days)])
      .then(([marketRes, sectorRes]) => {
        if (cancelled) return;
        if (marketRes.status === 'ok') setMarketData(marketRes.data);
        else setError(marketRes.message || '市场趋势数据异常');
        if (sectorRes.status === 'ok') setSectorData(sectorRes.data);
        else setError(sectorRes.message || '板块轮动数据异常');
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
  }, [showPanel, days]);

  // 渲染走势图
  useEffect(() => {
    if (activeTab !== 'trend' || !marketData || !trendChartRef.current) return;
    if (!trendChart.current) {
      trendChart.current = echarts.init(trendChartRef.current, 'dark');
    }
    const { dates, inflow, cumulative } = marketData;
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
    trendChart.current.setOption(option, true);
  }, [activeTab, marketData]);

  // 渲染板块轮动图
  useEffect(() => {
    if (activeTab !== 'sector' || !sectorData || !sectorChartRef.current) return;
    if (!sectorChart.current) {
      sectorChart.current = echarts.init(sectorChartRef.current, 'dark');
    }
    const { sectors, inflow } = sectorData;
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
    sectorChart.current.setOption(option, true);
  }, [activeTab, sectorData]);

  // 窗口大小变化时重绘
  useEffect(() => {
    const handleResize = () => {
      trendChart.current?.resize();
      sectorChart.current?.resize();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const hasData = activeTab === 'trend'
    ? marketData && marketData.dates.length > 0
    : sectorData && sectorData.sectors.length > 0;

  return (
    <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-[#8B949E] hover:text-white hover:bg-[#0D1117] transition-colors"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#58A6FF]" />
          <span>ETF 资金流向</span>
          {marketData && marketData.dates.length > 0 && (
            <span className="text-xs text-[#8B949E]">
              累计 {marketData.cumulative[marketData.cumulative.length - 1]?.toFixed(1)} 亿
            </span>
          )}
        </div>
        {showPanel ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {showPanel && (
        <div className="px-4 py-3 border-t border-[#30363D]">
          {/* Tab 与时间维度 */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab('trend')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${
                  activeTab === 'trend'
                    ? 'bg-[#58A6FF]/10 text-[#58A6FF] border border-[#58A6FF]/20'
                    : 'text-[#8B949E] hover:text-white'
                }`}
              >
                <BarChart3 className="w-3 h-3" />
                走势
              </button>
              <button
                onClick={() => setActiveTab('sector')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${
                  activeTab === 'sector'
                    ? 'bg-[#58A6FF]/10 text-[#58A6FF] border border-[#58A6FF]/20'
                    : 'text-[#8B949E] hover:text-white'
                }`}
              >
                <PieChart className="w-3 h-3" />
                板块轮动
              </button>
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

          {/* 加载/错误/空状态 */}
          {loading && (
            <div className="flex items-center justify-center py-10 gap-2 text-[#8B949E] text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载 ETF 资金流向...
            </div>
          )}
          {!loading && error && (
            <div className="text-center py-8 text-[#FF3435] text-sm">
              <p>{error}</p>
            </div>
          )}
          {!loading && !error && !hasData && (
            <div className="text-center py-8 text-[#8B949E] text-sm">
              <p>暂无 ETF 资金流向数据</p>
            </div>
          )}

          {/* 图表容器 */}
          {!loading && !error && activeTab === 'trend' && (
            <div ref={trendChartRef} className="w-full h-72" />
          )}
          {!loading && !error && activeTab === 'sector' && (
            <div ref={sectorChartRef} className="w-full h-72" />
          )}
        </div>
      )}
    </div>
  );
}
