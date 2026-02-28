import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { StockData, IndicatorData } from '@/types';

interface StockChartProps {
  stockData: StockData[];
  indicators: IndicatorData[];
  showMAHS: boolean;
  showEMAHS: boolean;
  showMA: boolean;
  title?: string;
  compact?: boolean;
  timeframe?: 'daily' | 'weekly' | 'min15';
}

const StockChart = ({ stockData, indicators, showMAHS, showEMAHS, showMA, title, compact, timeframe }: StockChartProps) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chartRef.current || stockData.length === 0) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, 'dark');
    }

    const dates = stockData.map(d => d.date);
    const klineData = stockData.map(d => [d.open, d.close, d.low, d.high]);
    const volumes = stockData.map(d => d.volume);

    const ma5Data = indicators.map(d => d.ma5);
    const ma20Data = indicators.map(d => d.ma20);
    const ma99Data = indicators.map(d => d.ma99);
    const ma128Data = indicators.map(d => d.ma128);
    const ma225Data = indicators.map(d => d.ma225);
    const mahsData = indicators.map(d => d.mahs);
    const emahsData = indicators.map(d => d.emahs);
    const criData = indicators.map(d => d.cri);
    const greedyData = indicators.map(d => d.greedy);
    // 情绪指数暂时隐藏，避免副图线条过多
    // const sentimentData = indicators.map(d => d.sentiment);
    const costDeviationData = indicators.map(d => d.costDeviation);

    // 计算抵扣价标注数据
    const lastIndex = indicators.length - 1;
    const ma20DeductIndex = lastIndex >= 19 ? lastIndex - 19 : -1;
    const ma60DeductIndex = lastIndex >= 59 ? lastIndex - 59 : -1;
    const ma225DeductIndex = lastIndex >= 224 ? lastIndex - 224 : -1;
    
    // 构建抵扣价markPoint数据
    const deductMarkPoints: echarts.MarkPointComponentOption['data'] = [];
    
    if (ma20DeductIndex >= 0) {
      const price = stockData[ma20DeductIndex]?.close;
      if (price !== undefined) {
        deductMarkPoints.push({
          name: `MA20\n${price.toFixed(1)}`,
          coord: [ma20DeductIndex, price],
          value: price,
          symbol: 'rect',
          symbolSize: [1, 4],
          itemStyle: { color: '#E3B341' },
          label: {
            show: true,
            position: 'top',
            distance: 3,
            fontSize: 7,
            color: '#E3B341',
            backgroundColor: 'rgba(13,17,23,0.85)',
            padding: [0, 2],
            borderRadius: 1,
            borderWidth: 0,
          },
        });
      }
    }
    
    if (ma60DeductIndex >= 0) {
      const price = stockData[ma60DeductIndex]?.close;
      if (price !== undefined) {
        deductMarkPoints.push({
          name: `MA60\n${price.toFixed(1)}`,
          coord: [ma60DeductIndex, price],
          value: price,
          symbol: 'rect',
          symbolSize: [1, 4],
          itemStyle: { color: '#D2A8FF' },
          label: {
            show: true,
            position: 'top',
            distance: 3,
            fontSize: 7,
            color: '#D2A8FF',
            backgroundColor: 'rgba(13,17,23,0.85)',
            padding: [0, 2],
            borderRadius: 1,
            borderWidth: 0,
          },
        });
      }
    }
    
    if (ma225DeductIndex >= 0) {
      const price = stockData[ma225DeductIndex]?.close;
      if (price !== undefined) {
        deductMarkPoints.push({
          name: `MA225\n${price.toFixed(1)}`,
          coord: [ma225DeductIndex, price],
          value: price,
          symbol: 'rect',
          symbolSize: [1, 4],
          itemStyle: { color: '#FF3435' },
          label: {
            show: true,
            position: 'top',
            distance: 3,
            fontSize: 7,
            color: '#FF3435',
            backgroundColor: 'rgba(13,17,23,0.85)',
            padding: [0, 2],
            borderRadius: 1,
            borderWidth: 0,
          },
        });
      }
    }

    const series: echarts.SeriesOption[] = [
      {
        name: 'K线',
        type: 'candlestick',
        data: klineData,
        itemStyle: {
          color: '#FF3435',
          color0: '#03B172',
          borderColor: '#FF3435',
          borderColor0: '#03B172',
        },
        markPoint: {
          symbol: 'rect',
          symbolSize: [1, 4],
          silent: true,
          data: deductMarkPoints,
        },
      },
    ];

    // 添加成交量到主图（用折线图简化显示，不干扰K线）
    if (timeframe === 'daily') {
      // 计算成交量的移动平均来平滑显示
      const volMA5 = volumes.map((_, i) => {
        if (i < 4) return null;
        let sum = 0;
        for (let j = i - 4; j <= i; j++) sum += volumes[j];
        return sum / 5;
      });
      
      series.push({
        name: '成交量趋势',
        type: 'line',
        data: volMA5,
        smooth: true,
        lineStyle: { width: 1, color: '#8B949E', opacity: 0.6 },
        symbol: 'none',
        yAxisIndex: 1,
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(139, 148, 158, 0.2)' },
              { offset: 1, color: 'rgba(139, 148, 158, 0.02)' }
            ]
          }
        }
      });
    }

    if (showMA) {
      series.push(
        { name: 'MA5', type: 'line', data: ma5Data, smooth: true, lineStyle: { width: 1, color: '#FFFFFF' }, symbol: 'none' },
        { name: 'MA20', type: 'line', data: ma20Data, smooth: true, lineStyle: { width: 1, color: '#E3B341' }, symbol: 'none' },
        { name: 'MA99', type: 'line', data: ma99Data, smooth: true, lineStyle: { width: 1, color: '#D2A8FF' }, symbol: 'none' },
        { name: 'MA128', type: 'line', data: ma128Data, smooth: true, lineStyle: { width: 1, color: '#03B172' }, symbol: 'none' },
        { name: 'MA225', type: 'line', data: ma225Data, smooth: true, lineStyle: { width: 1, color: '#FF3435' }, symbol: 'none' },
      );
    }

    if (showMAHS) {
      series.push({ name: 'MAHS', type: 'line', data: mahsData, smooth: true, lineStyle: { width: 2, color: '#FF3435', type: 'dashed' }, symbol: 'none' });
    }
    if (showEMAHS) {
      series.push({ name: 'EMAHS', type: 'line', data: emahsData, smooth: true, lineStyle: { width: 2, color: '#03B172', type: 'dashed' }, symbol: 'none' });
    }
    
    // 添加CRI（恐慌）、贪婪得分和综合情绪指数到副图 - 所有时间周期都显示
    // 恐慌指标（CRI）- 红色
    series.push({ 
      name: '恐慌指数', 
      type: 'line', 
      data: criData, 
      smooth: true, 
      lineStyle: { width: 2, color: '#FF6B6B', type: 'solid' }, 
      symbol: 'none',
      xAxisIndex: 1,
      yAxisIndex: 2,
    });
    
    // 贪婪指标 - 绿色 (与EMAHS同色)
    series.push({ 
      name: '贪婪指数', 
      type: 'line', 
      data: greedyData, 
      smooth: true, 
      lineStyle: { width: 2, color: '#03B172', type: 'solid' }, 
      symbol: 'none',
      xAxisIndex: 1,
      yAxisIndex: 2,
    });
    
    // 情绪指数 - 暂时隐藏，避免副图线条过多
    // series.push({ 
    //   name: '情绪指数', 
    //   type: 'line', 
    //   data: sentimentData, 
    //   smooth: true, 
    //   lineStyle: { width: 1.5, color: '#D2A8FF', type: 'dashed' }, 
    //   symbol: 'none',
    //   xAxisIndex: 1,
    //   yAxisIndex: 3,
    // });
    
    // 成本偏离度 - 黄色 (与MA20同色)
    series.push({ 
      name: '成本偏离度', 
      type: 'line', 
      data: costDeviationData, 
      smooth: true, 
      lineStyle: { width: 1.5, color: '#E3B341', type: 'solid' }, 
      symbol: 'none',
      xAxisIndex: 1,
      yAxisIndex: 4,
    });

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      animation: true,
      title: title ? {
        text: title,
        left: 'center',
        top: 5,
        textStyle: {
          color: '#8B949E',
          fontSize: compact ? 12 : 14,
          fontFamily: 'JetBrains Mono',
        },
      } : undefined,
      legend: {
        data: timeframe === 'daily' 
          ? [
              { name: 'MA5', icon: 'rect', itemStyle: { color: '#FFFFFF' } },
              { name: 'MA20', icon: 'rect', itemStyle: { color: '#E3B341' } },
              { name: 'MA99', icon: 'rect', itemStyle: { color: '#D2A8FF' } },
              { name: 'MA128', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: 'MA225', icon: 'rect', itemStyle: { color: '#FF3435' } },
              { name: 'MAHS', icon: 'rect', itemStyle: { color: '#FF3435' } },
              { name: 'EMAHS', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: '成交量趋势', icon: 'rect', itemStyle: { color: '#8B949E' } },
              { name: '恐慌指数', icon: 'rect', itemStyle: { color: '#FF6B6B' } },
              { name: '贪婪指数', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: '成本偏离度', icon: 'rect', itemStyle: { color: '#E3B341' } },
            ]
          : [
              { name: 'MA5', icon: 'rect', itemStyle: { color: '#FFFFFF' } },
              { name: 'MA20', icon: 'rect', itemStyle: { color: '#E3B341' } },
              { name: 'MA99', icon: 'rect', itemStyle: { color: '#D2A8FF' } },
              { name: 'MA128', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: 'MA225', icon: 'rect', itemStyle: { color: '#FF3435' } },
              { name: 'MAHS', icon: 'rect', itemStyle: { color: '#FF3435' } },
              { name: 'EMAHS', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: '恐慌指数', icon: 'rect', itemStyle: { color: '#FF6B6B' } },
              { name: '贪婪指数', icon: 'rect', itemStyle: { color: '#03B172' } },
              { name: '成本偏离度', icon: 'rect', itemStyle: { color: '#E3B341' } },
            ],
        textStyle: { color: '#8B949E', fontSize: compact ? 7 : 8 },
        top: 32,
        itemWidth: 10,
        itemHeight: 2,
        itemGap: 4,
        width: '96%',
        left: 'center',
        type: 'scroll',
        pageIconSize: 10,
        pageTextStyle: { fontSize: 8 }
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: 'rgba(22, 27, 34, 0.95)',
        borderColor: '#30363D',
        textStyle: { color: '#C9D1D9' },
        formatter: (params: any) => {
          if (!params || params.length === 0) return '';
          const dataIndex = params[0].dataIndex;
          const stock = stockData[dataIndex];
          const ind = indicators[dataIndex];
          
          let html = `<div style="font-family: JetBrains Mono; font-size: 12px;">`;
          html += `<div style="color: #8B949E; margin-bottom: 4px;">${stock.date}</div>`;
          html += `<div style="display: grid; grid-template-columns: auto auto; gap: 8px 16px;">`;
          html += `<span>开盘:</span><span style="color: ${stock.open > stock.close ? '#03B172' : '#FF3435'}">${stock.open.toFixed(2)}</span>`;
          html += `<span>最高:</span><span style="color: #FF3435">${stock.high.toFixed(2)}</span>`;
          html += `<span>最低:</span><span style="color: #03B172">${stock.low.toFixed(2)}</span>`;
          html += `<span>收盘:</span><span style="color: ${stock.close >= stock.open ? '#FF3435' : '#03B172'}">${stock.close.toFixed(2)}</span>`;
          html += `<span>成交量:</span><span>${(stock.volume / 10000).toFixed(2)}万</span>`;
          if (ind.mahs !== null && ind.mahs !== undefined) html += `<span>MAHS:</span><span style="color: #FF3435">${ind.mahs.toFixed(2)}</span>`;
          if (ind.emahs !== null && ind.emahs !== undefined) html += `<span>EMAHS:</span><span style="color: #03B172">${ind.emahs.toFixed(2)}</span>`;
          if (ind.costDiff !== null && ind.costDiff !== undefined) html += `<span>成本差:</span><span style="color: ${ind.costDiff >= 0 ? '#FF3435' : '#03B172'}">${ind.costDiff.toFixed(2)}</span>`;
          if (ind.cri !== null && ind.cri !== undefined) html += `<span>恐慌指数:</span><span style="color: #FF6B6B">${ind.cri.toFixed(1)}</span>`;
          if (ind.greedy !== null && ind.greedy !== undefined) html += `<span>贪婪指数:</span><span style="color: #03B172">${ind.greedy.toFixed(1)}</span>`;
          // 情绪指数暂时隐藏
          // if (ind.sentiment !== null && ind.sentiment !== undefined) {
          //   const sentimentColor = ind.sentiment > 0 ? '#03B172' : (ind.sentiment < 0 ? '#FF6B6B' : '#8B949E');
          //   html += `<span>情绪指数:</span><span style="color: ${sentimentColor}">${ind.sentiment > 0 ? '+' : ''}${ind.sentiment.toFixed(1)}</span>`;
          // }
          if (ind.costDeviation !== null && ind.costDeviation !== undefined) html += `<span>成本偏离度:</span><span style="color: #E3B341">${ind.costDeviation.toFixed(2)}</span>`;
          html += `</div></div>`;
          return html;
        },
      },
      grid: [
        { left: '50', right: '50', top: '55', bottom: '110', height: '58%' },  // 主图
        { left: '50', right: '50', top: '76%', bottom: '40', height: '16%' },  // 副图下移，避免与主图重叠
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#30363D' } },
          axisLabel: { color: '#8B949E' },
          splitLine: { show: false },
          min: 'dataMin',
          max: 'dataMax',
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#30363D' } },
          axisLabel: { show: false },
          splitLine: { show: false },
          min: 'dataMin',
          max: 'dataMax',
        },
      ],
      yAxis: [
        {
          scale: true,
          splitArea: { show: false },
          axisLine: { lineStyle: { color: '#30363D' } },
          axisLabel: { color: '#8B949E' },
          splitLine: { lineStyle: { color: '#21262D' } },
        },
        {
          type: 'value',
          position: 'right',
          min: 0,
          axisLabel: { show: false },
          axisLine: { show: false },
          splitLine: { show: false },
        },
        {
          type: 'value',
          gridIndex: 1,
          position: 'left',
          min: 0,
          max: 100,
          splitNumber: 2,
          axisLabel: { 
            show: false,  // 隐藏坐标轴数值
            color: '#FF6B6B', 
            fontSize: 10,
            formatter: '{value}',
          },
          axisLine: { lineStyle: { color: '#FF6B6B' } },
          splitLine: { show: false },
        },
        {
          type: 'value',
          gridIndex: 1,
          position: 'right',
          min: -100,
          max: 100,
          splitNumber: 2,
          axisLabel: { 
            show: false,  // 隐藏坐标轴数值
            color: '#D2A8FF', 
            fontSize: 10,
            formatter: function(value: number): string {
              return value > 0 ? '+' + value : String(value);
            }
          },
          axisLine: { lineStyle: { color: '#D2A8FF' } },
          splitLine: { 
            show: timeframe === 'min15',
            lineStyle: { color: '#30363D', type: 'dashed' }
          },
        },
        {
          type: 'value',
          gridIndex: 1,
          position: 'right',
          offset: 50,
          axisLabel: { 
            show: false,  // 隐藏坐标轴数值
            color: '#E3B341', 
            fontSize: 10,
          },
          axisLine: { lineStyle: { color: '#E3B341' } },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: 70, end: 100 },
        { 
          type: 'slider', 
          xAxisIndex: [0, 1], 
          start: 70, 
          end: 100, 
          bottom: 10, 
          height: 20,
          borderColor: '#30363D',
          fillerColor: 'rgba(255, 52, 53, 0.2)',
          handleStyle: {
            color: '#FF3435',
            borderColor: '#FF3435'
          },
          textStyle: {
            color: '#8B949E'
          },
          showDetail: true,
          showDataShadow: true
        },
      ],
      series,
    };

    chartInstance.current.setOption(option, true);
    setLoading(false);

    const handleResize = () => {
      chartInstance.current?.resize();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [stockData, indicators, showMAHS, showEMAHS, showMA, title, compact, timeframe]);

  return (
    <div className={`relative w-full bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden ${compact ? 'h-full' : 'h-[600px]'}`}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#161B22]">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-[#30363D] border-t-[#FF3435] rounded-full animate-spin" />
            <span className="text-[#8B949E]">加载图表...</span>
          </div>
        </div>
      )}
      <div ref={chartRef} className="w-full h-full" />
    </div>
  );
};

export default StockChart;
