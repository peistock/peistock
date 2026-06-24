import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Activity, Loader2 } from 'lucide-react';
import { getMarketBreadth } from '@/utils/researchApi';
import type { MarketBreadthData } from '@/types';

const MA_DAYS = 200;
const MA_WEEKS = 40;
const INDEX_CODE = '000300';

export default function MarketBreadthPanel() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MarketBreadthData | null>(null);
  const [error, setError] = useState('');

  const chartRef = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getMarketBreadth(INDEX_CODE, MA_DAYS)
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
  }, []);

  const latest = useMemo(() => {
    if (!data || !data.dates.length) return null;
    const i = data.dates.length - 1;
    return {
      date: data.dates[i],
      ratio: data.above_ratio[i],
      close: data.index_close[i],
    };
  }, [data]);

  useEffect(() => {
    if (!data || !chartRef.current) return;
    if (!chart.current) {
      chart.current = echarts.init(chartRef.current, 'dark');
    }
    const { dates, above_ratio, index_close } = data;
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
            const val = p.seriesName === `站上${MA_WEEKS}周线占比` ? `${p.value}%` : p.value;
            html += `<div class="flex items-center gap-2 mt-1">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>
              <span class="text-[#8B949E]">${p.seriesName}:</span>
              <span class="font-mono">${val}</span>
            </div>`;
          });
          return html;
        },
      },
      legend: {
        data: [`站上${MA_WEEKS}周线占比（${MA_DAYS}日等效）`, '沪深300收盘价'],
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
          name: '占比(%)',
          min: 0,
          max: 100,
          position: 'left',
          nameTextStyle: { color: '#8B949E', fontSize: 10 },
          axisLine: { show: false },
          splitLine: { lineStyle: { color: '#21262D' } },
          axisLabel: { color: '#8B949E', fontSize: 10, formatter: '{value}%' },
        },
        {
          type: 'value',
          name: '指数',
          position: 'right',
          nameTextStyle: { color: '#8B949E', fontSize: 10 },
          axisLine: { show: false },
          splitLine: { show: false },
          axisLabel: { color: '#8B949E', fontSize: 10 },
        },
      ],
      series: [
        {
          name: `站上${MA_WEEKS}周线占比（${MA_DAYS}日等效）`,
          type: 'line',
          data: above_ratio,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#FF9500', width: 2 },
          itemStyle: { color: '#FF9500' },
          areaStyle: {
            color: new (echarts as any).graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(255, 149, 0, 0.3)' },
              { offset: 1, color: 'rgba(255, 149, 0, 0)' },
            ]),
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              { yAxis: 50, lineStyle: { color: '#8B949E', type: 'dashed', width: 1 }, label: { show: false } },
            ],
          },
        },
        {
          name: '沪深300收盘价',
          type: 'line',
          yAxisIndex: 1,
          data: index_close,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#58A6FF', width: 2 },
          itemStyle: { color: '#58A6FF' },
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
          <Activity className="w-4 h-4 text-[#FF9500]" />
          <span className="text-sm text-[#C9D1D9]">沪深300 市场宽度（周线）</span>
          {latest && (
            <span className="text-xs text-[#8B949E]">
              <span className="font-mono text-[#FF9500]">{latest.ratio.toFixed(1)}%</span>
              <span className="mx-1">站上{MA_WEEKS}周线（{MA_DAYS}日等效）</span>
              <span className="font-mono text-[#58A6FF]">{latest.close.toFixed(2)}</span>
            </span>
          )}
        </div>
        {latest && (
          <div className="text-[10px] text-[#8B949E]">
            最新: <span className="font-mono text-[#C9D1D9]">{latest.date}</span>
          </div>
        )}
      </div>

      <div className="px-4 py-3 relative min-h-[288px]">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#161B22]/80 py-10 gap-2 text-[#8B949E] text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            加载市场宽度数据...
          </div>
        )}
        {!loading && error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#161B22]/80 text-[#FF3435] text-sm">{error}</div>
        )}
        {!loading && !error && data && data.dates.length === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#161B22]/80 text-[#8B949E] text-sm">暂无市场宽度数据</div>
        )}
        <div ref={chartRef} className="w-full h-72" />
      </div>
    </div>
  );
}
