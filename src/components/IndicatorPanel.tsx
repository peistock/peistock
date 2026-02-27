import { useState } from 'react';
import { TrendingUp, TrendingDown, Activity, BarChart3, GitCommit } from 'lucide-react';
import type { IndicatorData } from '@/types';
import { formatNumber } from '@/utils/indicators';

interface IndicatorPanelProps {
  indicators: IndicatorData[];
  currentIndex: number;
  timeframe?: 'daily' | 'weekly' | 'min15';
}

const IndicatorPanel = ({ indicators, currentIndex, timeframe = 'daily' }: IndicatorPanelProps) => {
  const [activeTab, setActiveTab] = useState<'cost' | 'ma' | 'bias'>('cost');
  
  const current = indicators[currentIndex] || indicators[indicators.length - 1];
  if (!current) return null;

  // 根据时间维度显示不同的描述
  const timeframeLabels = {
    daily: { ma5: '5日', ma20: '20日', ma99: '99日', ma128: '128日', ma225: '225日' },
    weekly: { ma5: '5周', ma20: '20周', ma99: '约2年', ma128: '约2.5年', ma225: '约4年' },
    min15: { ma5: '75分钟', ma20: '5小时', ma99: '约25小时', ma128: '约32小时', ma225: '约56小时' },
  };

  const labels = timeframeLabels[timeframe];

  const tabs = [
    { id: 'cost' as const, label: '换手成本', icon: GitCommit },
    { id: 'ma' as const, label: '均线系统', icon: Activity },
    { id: 'bias' as const, label: '乖离率', icon: BarChart3 },
  ];

  const renderCostIndicators = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#0D1117] rounded-lg p-4 border border-[#30363D]">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-[#FF3435]" />
            <span className="text-sm text-[#8B949E]">MAHS (换手成本)</span>
          </div>
          <div className="text-2xl font-bold text-white" style={{ fontFamily: 'JetBrains Mono' }}>
            {formatNumber(current.mahs)}
          </div>
          <div className="text-xs text-[#8B949E] mt-1">
            DD: {current.dd?.toFixed(0) || '-'} 
            {timeframe === 'daily' ? ' 天' : timeframe === 'weekly' ? ' 周' : ' 个15分钟'}
          </div>
        </div>
        
        <div className="bg-[#0D1117] rounded-lg p-4 border border-[#30363D]">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-[#03B172]" />
            <span className="text-sm text-[#8B949E]">EMAHS (指数成本)</span>
          </div>
          <div className="text-2xl font-bold text-white" style={{ fontFamily: 'JetBrains Mono' }}>
            {formatNumber(current.emahs)}
          </div>
          <div className="text-xs text-[#8B949E] mt-1">
            动态周期均线
          </div>
        </div>
      </div>
      
      <div className="bg-[#0D1117] rounded-lg p-4 border border-[#30363D]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-[#8B949E]">成本差 (EMAHS - MAHS)</span>
          {current.costDiff !== null && current.costDiff !== undefined && (
            <span className={`text-sm font-medium ${current.costDiff >= 0 ? 'text-[#FF3435]' : 'text-[#03B172]'}`}>
              {current.costDiff >= 0 ? <TrendingUp className="w-4 h-4 inline" /> : <TrendingDown className="w-4 h-4 inline" />}
            </span>
          )}
        </div>
        <div className={`text-3xl font-bold ${current.costDiff !== null && current.costDiff !== undefined && current.costDiff >= 0 ? 'text-[#FF3435]' : 'text-[#03B172]'}`} style={{ fontFamily: 'JetBrains Mono' }}>
          {formatNumber(current.costDiff)}
        </div>
        <div className="text-xs text-[#8B949E] mt-2">
          {current.costDiff !== null && current.costDiff !== undefined ? (
            current.costDiff > 0 ? '近期资金成本高于历史成本 → 资金抢筹，短期强势' :
            current.costDiff < 0 ? '近期资金成本低于历史成本 → 资金派发，短期弱势' :
            '成本差为零 → 趋势转折信号'
          ) : '-'}
        </div>
      </div>
      
      <div className="bg-[#0D1117] rounded-lg p-4 border border-[#30363D]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-[#8B949E]">当前价格相对成本</span>
        </div>
        <div className="text-lg">
          {current.mahs !== null && current.mahs !== undefined ? (
            <span style={{ fontFamily: 'JetBrains Mono' }}>
              价格: <span className="text-white font-bold">{current.close.toFixed(2)}</span>
              {' '}vs 成本: <span className="text-[#FF3435] font-bold">{current.mahs.toFixed(2)}</span>
              {' '}({((current.close - current.mahs) / current.mahs * 100).toFixed(2)}%)
            </span>
          ) : '-'}
        </div>
      </div>
    </div>
  );

  const renderMAIndicators = () => (
    <div className="space-y-3">
      {[
        { name: 'MA5', value: current.ma5, color: '#FFFFFF', desc: labels.ma5 },
        { name: 'MA20', value: current.ma20, color: '#E3B341', desc: labels.ma20 },
        { name: 'MA99', value: current.ma99, color: '#D2A8FF', desc: labels.ma99 },
        { name: 'MA128', value: current.ma128, color: '#03B172', desc: labels.ma128 },
        { name: 'MA225', value: current.ma225, color: '#FF3435', desc: labels.ma225 },
      ].map((ma) => (
        <div key={ma.name} className="flex items-center justify-between p-3 bg-[#0D1117] rounded-lg border border-[#30363D]">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: ma.color }} />
            <div>
              <span className="text-white font-medium" style={{ fontFamily: 'JetBrains Mono' }}>{ma.name}</span>
              <span className="text-xs text-[#8B949E] ml-2">{ma.desc}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-white font-bold" style={{ fontFamily: 'JetBrains Mono' }}>
              {formatNumber(ma.value)}
            </div>
            {ma.value !== null && ma.value !== undefined && (
              <div className={`text-xs ${current.close >= ma.value ? 'text-[#FF3435]' : 'text-[#03B172]'}`}>
                价格{current.close >= ma.value ? '上方' : '下方'}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const renderBIASIndicators = () => (
    <div className="space-y-3">
      {[
        { name: 'BIAS5', value: current.bias5, threshold: 3, desc: '超短周期' },
        { name: 'BIAS20', value: current.bias20, threshold: 5, desc: '短线' },
        { name: 'BIAS99', value: current.bias99, threshold: 8, desc: '中线' },
        { name: 'BIAS128', value: current.bias128, threshold: 10, desc: '长线' },
        { name: 'BIAS225', value: current.bias225, threshold: 12, desc: '超长线' },
      ].map((bias) => {
        const isOverbought = bias.value !== null && bias.value !== undefined && bias.value > bias.threshold;
        const isOversold = bias.value !== null && bias.value !== undefined && bias.value < -bias.threshold;
        
        return (
          <div key={bias.name} className="flex items-center justify-between p-3 bg-[#0D1117] rounded-lg border border-[#30363D]">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${isOverbought ? 'bg-[#FF3435]' : isOversold ? 'bg-[#03B172]' : 'bg-[#8B949E]'}`} />
              <div>
                <span className="text-white font-medium" style={{ fontFamily: 'JetBrains Mono' }}>{bias.name}</span>
                <span className="text-xs text-[#8B949E] ml-2">{bias.desc}</span>
              </div>
            </div>
            <div className="text-right">
              <div className={`font-bold ${isOverbought ? 'text-[#FF3435]' : isOversold ? 'text-[#03B172]' : 'text-white'}`} style={{ fontFamily: 'JetBrains Mono' }}>
                {formatNumber(bias.value)}%
              </div>
              {isOverbought && <div className="text-xs text-[#FF3435]">超买</div>}
              {isOversold && <div className="text-xs text-[#03B172]">超卖</div>}
            </div>
          </div>
        );
      })}
      
      <div className="mt-4 p-3 bg-[#0D1117] rounded-lg border border-[#30363D]">
        <div className="text-sm text-[#8B949E] mb-2">乖离率参考阈值</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex justify-between">
            <span className="text-[#FF3435]">超买:</span>
            <span className="text-white">+3% ~ +12%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#03B172]">超卖:</span>
            <span className="text-white">-3% ~ -12%</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-[#30363D]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-white bg-[#0D1117] border-b-2 border-[#FF3435]'
                : 'text-[#8B949E] hover:text-white'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>
      
      {/* Content */}
      <div className="p-4">
        {activeTab === 'cost' && renderCostIndicators()}
        {activeTab === 'ma' && renderMAIndicators()}
        {activeTab === 'bias' && renderBIASIndicators()}
      </div>
    </div>
  );
};

export default IndicatorPanel;
