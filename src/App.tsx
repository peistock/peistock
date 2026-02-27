import { useState, useCallback } from 'react';
import { AlertCircle, Settings, Clock, Calendar, BarChart2, BookOpen, Code2 } from 'lucide-react';
import StockSearch from './components/StockSearch';
import StockChart from './components/StockChart';

import HelpDialog from './components/HelpDialog';
import { calculateAllIndicators } from './utils/indicators';
import { getMultiTimeframeData, getQuote, formatSymbol, getMarketName } from './utils/eastmoneyApi';
import type { StockData, IndicatorData } from './types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

// 时间维度类型
type TimeframeType = 'daily' | 'weekly' | 'min15';

interface TimeframeData {
  data: StockData[];
  indicators: IndicatorData[];
}

function App() {
  const [timeframeData, setTimeframeData] = useState<Record<TimeframeType, TimeframeData | null>>({
    daily: null,
    weekly: null,
    min15: null,
  });
  const [, setCurrentSymbol] = useState<string>('');
  const [stockInfo, setStockInfo] = useState<{
    symbol: string;
    name: string;
    market: string;
    price: number;
    change: number;
    changePercent: number;
    capital: number; // 流通股本（股）
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMAHS, setShowMAHS] = useState(true);
  const [showEMAHS, setShowEMAHS] = useState(true);
  const [showMA, setShowMA] = useState(true);

  const handleSearch = useCallback(async (input: string) => {
    const symbol = formatSymbol(input);
    setLoading(true);
    setError(null);
    setCurrentSymbol(symbol);
    
    try {
      // 并行获取三个时间维度的数据和报价信息
      const [multiData, quote] = await Promise.all([
        getMultiTimeframeData(symbol),
        getQuote(symbol),
      ]);
      
      // 使用流通股本计算指标
      const capital = quote.capital;
      
      // 为每个时间维度计算指标
      setTimeframeData({
        daily: {
          data: multiData.daily,
          indicators: calculateAllIndicators(multiData.daily, capital),
        },
        weekly: {
          data: multiData.weekly,
          indicators: calculateAllIndicators(multiData.weekly, capital),
        },
        min15: {
          data: multiData.min15,
          indicators: calculateAllIndicators(multiData.min15, capital),
        },
      });
      
      setStockInfo({
        symbol: quote.symbol,
        name: quote.name,
        market: getMarketName(symbol),
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
        capital: quote.capital,
      });
    } catch (err: any) {
      setError(err.message || '获取数据失败，请检查股票代码是否正确');
    } finally {
      setLoading(false);
    }
  }, []);

  // 检查是否有数据
  const hasData = timeframeData.daily && timeframeData.weekly && timeframeData.min15;

  // 图表配置
  const chartConfigs: { key: TimeframeType; label: string; icon: typeof Calendar; color: string }[] = [
    { key: 'daily', label: '日K线', icon: Calendar, color: '#FF3435' },
    { key: 'weekly', label: '周K线', icon: BarChart2, color: '#D2A8FF' },
    { key: 'min15', label: '15分钟', icon: Clock, color: '#03B172' },
  ];

  return (
    <div className="min-h-screen bg-[#0D1117]">
      {/* Header */}
      <header className="border-b border-[#30363D] bg-[#161B22]">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#FF3435] to-[#03B172] flex items-center justify-center">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3v18h18" />
                  <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white" style={{ fontFamily: 'JetBrains Mono' }}>
                  Peter量价均线交易系统
                </h1>
                <p className="text-xs text-[#8B949E]">东方财富数据 | 双周期成本共振分析</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <HelpDialog defaultTab="overview">
                <button className="flex items-center gap-1 text-sm text-[#8B949E] hover:text-white transition-colors">
                  <BookOpen className="w-4 h-4" />
                  使用说明
                </button>
              </HelpDialog>
              <HelpDialog defaultTab="formula">
                <button className="flex items-center gap-1 text-sm text-[#8B949E] hover:text-white transition-colors">
                  <Code2 className="w-4 h-4" />
                  公式参考
                </button>
              </HelpDialog>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Search Section */}
        <section className="mb-6">
          <StockSearch 
            onSearch={handleSearch} 
            loading={loading} 
            stockInfo={stockInfo} 
          />
        </section>

        {/* Error Alert */}
        {error && (
          <Alert className="mb-6 bg-[#FF3435]/10 border-[#FF3435]/30">
            <AlertCircle className="w-4 h-4 text-[#FF3435]" />
            <AlertDescription className="text-[#FF3435]">{error}</AlertDescription>
          </Alert>
        )}

        {/* Chart Controls */}
        {hasData && (
          <div className="flex flex-wrap items-center gap-6 p-4 bg-[#161B22] rounded-xl border border-[#30363D] mb-6">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-[#8B949E]" />
              <span className="text-sm text-[#8B949E]">指标显示:</span>
            </div>
            
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="mahs"
                  checked={showMAHS}
                  onCheckedChange={setShowMAHS}
                />
                <Label htmlFor="mahs" className="text-sm text-white cursor-pointer flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-[#FF3435]" />
                  MAHS
                </Label>
              </div>
              
              <div className="flex items-center gap-2">
                <Switch
                  id="emahs"
                  checked={showEMAHS}
                  onCheckedChange={setShowEMAHS}
                />
                <Label htmlFor="emahs" className="text-sm text-white cursor-pointer flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-[#03B172]" />
                  EMAHS
                </Label>
              </div>
              
              <div className="flex items-center gap-2">
                <Switch
                  id="ma"
                  checked={showMA}
                  onCheckedChange={setShowMA}
                />
                <Label htmlFor="ma" className="text-sm text-white cursor-pointer">
                  均线系统
                </Label>
              </div>
            </div>
          </div>
        )}

        {/* Three Charts - Left/Right Layout */}
        {hasData && (
          <div className="space-y-6">
            {chartConfigs.map((config) => {
              const tf = config.key;
              const data = timeframeData[tf]!;
              const Icon = config.icon;
              const lastIndicator = data.indicators[data.indicators.length - 1];
              const prevIndicator = data.indicators[data.indicators.length - 2];
              
              // 计算买卖信号
              const buySignals: string[] = [];
              const sellSignals: string[] = [];
              
              // 基于BIAS225历史极值的信号计算
              const allBias225 = data.indicators
                .map(d => d.bias225)
                .filter((v): v is number => v !== null);
              
              const currentBias225 = lastIndicator.bias225;
              let bias225Percentile: number | null = null;
              
              if (currentBias225 !== null && allBias225.length > 0) {
                // 计算当前BIAS225在历史数据中的百分位
                const sorted = [...allBias225].sort((a, b) => a - b);
                const rank = sorted.findIndex(v => v >= currentBias225);
                bias225Percentile = rank >= 0 ? (rank / sorted.length) * 100 : 100;
                
                // 极值信号：90%以上重点推荐，80%以上提示
                if (bias225Percentile <= 10) {
                  buySignals.push(`BIAS225历史极端低位 (${bias225Percentile.toFixed(1)}%分位)`);
                } else if (bias225Percentile <= 20) {
                  buySignals.push(`BIAS225低于历史80%水平 (${bias225Percentile.toFixed(1)}%分位)`);
                }
                
                if (bias225Percentile >= 90) {
                  sellSignals.push(`BIAS225历史极端高位 (${bias225Percentile.toFixed(1)}%分位)`);
                } else if (bias225Percentile >= 80) {
                  sellSignals.push(`BIAS225高于历史80%水平 (${bias225Percentile.toFixed(1)}%分位)`);
                }
              }
              
              if (lastIndicator.costDiff !== null && prevIndicator?.costDiff !== null) {
                if (lastIndicator.costDiff > 0 && prevIndicator.costDiff <= 0) {
                  buySignals.push('成本差上穿零轴 - 短期转强');
                }
                if (lastIndicator.costDiff < 0 && prevIndicator.costDiff >= 0) {
                  sellSignals.push('成本差下穿零轴 - 短期转弱');
                }
              }
              if (lastIndicator.mahs !== null) {
                if (lastIndicator.close < lastIndicator.mahs * 1.02) {
                  buySignals.push('价格在成本附近 (低于2%)');
                }
                if (lastIndicator.close > lastIndicator.mahs * 1.08) {
                  sellSignals.push('价格高于成本8%以上');
                }
              }
              
              return (
                <section key={tf} className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
                  {/* Section Header */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-[#30363D] bg-[#0D1117]">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${config.color}20` }}>
                      <Icon className="w-4 h-4" style={{ color: config.color }} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-white text-sm">{config.label}</h3>
                    </div>
                    <div className="text-xs text-[#8B949E]">
                      <span className="text-white font-mono">{data.data.length}</span> 条数据
                      {tf === 'daily' && (
                        <span className="ml-2">DD: <span className="text-[#D2A8FF] font-mono">{lastIndicator?.dd?.toFixed(0) || '-'}</span></span>
                      )}
                    </div>
                  </div>
                  
                  {/* Content: Chart Left + Indicators/Signals Right */}
                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-0">
                    {/* Left: Chart - 占3/4宽度 */}
                    <div className="lg:col-span-3 p-4">
                      <div className="h-[450px]">
                        <StockChart
                          stockData={data.data}
                          indicators={data.indicators}
                          showMAHS={tf === 'daily' && showMAHS}
                          showEMAHS={tf === 'daily' && showEMAHS}
                          showMA={showMA}
                          title=""
                          timeframe={tf}
                        />
                      </div>
                    </div>
                    
                    {/* Right: Indicators & Signals - 占1/4宽度 */}
                    <div className="lg:col-span-1 p-4 space-y-4 border-l border-[#30363D] bg-[#0D1117]">
                      {/* Turnover Cost - 只有日K显示 */}
                      {tf === 'daily' && (
                        <div className="space-y-3">
                          <h4 className="text-xs font-medium text-[#8B949E] uppercase tracking-wider">换手成本</h4>
                          
                          <div className="grid grid-cols-2 gap-2">
                            <div className="p-3 bg-[#161B22] rounded-lg border border-[#30363D]">
                              <div className="text-xs text-[#8B949E] mb-1">MAHS</div>
                              <div className="text-lg font-bold text-[#FF3435]" style={{ fontFamily: 'JetBrains Mono' }}>
                                {lastIndicator?.mahs?.toFixed(2) || '-'}
                              </div>
                            </div>
                            <div className="p-3 bg-[#161B22] rounded-lg border border-[#30363D]">
                              <div className="text-xs text-[#8B949E] mb-1">EMAHS</div>
                              <div className="text-lg font-bold text-[#03B172]" style={{ fontFamily: 'JetBrains Mono' }}>
                                {lastIndicator?.emahs?.toFixed(2) || '-'}
                              </div>
                            </div>
                          </div>
                          
                          <div className="p-3 bg-[#161B22] rounded-lg border border-[#30363D]">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-[#8B949E]">成本差</span>
                              {lastIndicator?.costDiff !== null && lastIndicator?.costDiff !== undefined && (
                                <span className={`text-xs ${lastIndicator.costDiff >= 0 ? 'text-[#FF3435]' : 'text-[#03B172]'}`}>
                                  {lastIndicator.costDiff >= 0 ? '↗' : '↘'}
                                </span>
                              )}
                            </div>
                            <div className={`text-xl font-bold ${lastIndicator?.costDiff && lastIndicator.costDiff >= 0 ? 'text-[#FF3435]' : 'text-[#03B172]'}`} style={{ fontFamily: 'JetBrains Mono' }}>
                              {lastIndicator?.costDiff?.toFixed(2) || '-'}
                            </div>
                          </div>
                          
                          {/* CRI - 综合风险指标 v2.0 */}
                          <div className="p-3 bg-[#161B22] rounded-lg border border-[#30363D]">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-[#8B949E]">CRI（综合风险指标）</span>
                              {lastIndicator?.cri !== null && lastIndicator?.cri !== undefined && (
                                <span className={`text-xs ${
                                  lastIndicator.criState === 'panic' ? 'text-[#FF3435]' : 
                                  lastIndicator.criState === 'complacent' ? 'text-[#03B172]' : 
                                  (lastIndicator.criPercentile !== null && lastIndicator.criPercentile >= 80) ? 'text-[#E3B341]' : 'text-[#8B949E]'
                                }`}>
                                  {lastIndicator.criState === 'panic' ? '恐慌状态' : 
                                   lastIndicator.criState === 'complacent' ? '自满状态' : 
                                   (lastIndicator.criPercentile !== null && lastIndicator.criPercentile >= 80) ? 
                                     `历史高位 (${lastIndicator.criPercentile.toFixed(0)}%分位)` : 
                                   (lastIndicator.criPercentile !== null && lastIndicator.criPercentile >= 60) ? 
                                     `偏高 (${lastIndicator.criPercentile.toFixed(0)}%分位)` : 
                                   (lastIndicator.criPercentile !== null && lastIndicator.criPercentile <= 20) ? 
                                     `历史低位 (${lastIndicator.criPercentile.toFixed(0)}%分位)` : 
                                     '正常区间'}
                                </span>
                              )}
                            </div>
                            <div className={`text-2xl font-bold ${
                              lastIndicator?.criState === 'panic' ? 'text-[#FF3435]' : 
                              lastIndicator?.criState === 'complacent' ? 'text-[#03B172]' : 
                              (lastIndicator?.criPercentile !== null && lastIndicator.criPercentile >= 80) ? 'text-[#E3B341]' : 
                              (lastIndicator?.criPercentile !== null && lastIndicator.criPercentile >= 60) ? 'text-[#8B949E]' : 'text-[#03B172]'
                            }`} style={{ fontFamily: 'JetBrains Mono' }}>
                              {lastIndicator?.cri?.toFixed(1) || '-'}
                            </div>
                            <div className="text-xs text-[#8B949E] mt-1">
                              成本偏离·跳跃风险·波动曲线·历史百分位
                            </div>
                            
                            {/* CRI 成分详情 */}
                            {lastIndicator?.criComponents && (
                              <div className="mt-2 pt-2 border-t border-[#30363D] grid grid-cols-2 gap-1 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-[#8B949E]">成本偏离</span>
                                  <span className="text-[#FF6B6B]">{lastIndicator.criComponents.basis.toFixed(0)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-[#8B949E]">跳跃风险</span>
                                  <span className="text-[#E3B341]">{lastIndicator.criComponents.jump.toFixed(0)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-[#8B949E]">波动曲线</span>
                                  <span className="text-[#D2A8FF]">{lastIndicator.criComponents.curve.toFixed(0)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-[#8B949E]">波动百分位</span>
                                  <span className="text-[#79C0FF]">{lastIndicator.criComponents.percentile.toFixed(0)}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* Opportunity Signals */}
                      <div>
                        <h4 className="text-xs font-medium text-[#8B949E] uppercase tracking-wider mb-2">机会信号</h4>
                        <div className="p-3 bg-[#FF3435]/5 rounded-lg border border-[#FF3435]/20">
                          {buySignals.length > 0 ? (
                            <ul className="space-y-1.5 text-xs">
                              {buySignals.map((s, i) => (
                                <li key={i} className="flex items-start gap-2 text-[#C9D1D9]">
                                  <span className="text-[#FF3435] mt-0.5">●</span>
                                  {s}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-xs text-[#8B949E]">暂无机会信号</span>
                          )}
                        </div>
                      </div>
                      
                      {/* Risk Signals */}
                      <div>
                        <h4 className="text-xs font-medium text-[#8B949E] uppercase tracking-wider mb-2">风险信号</h4>
                        <div className="p-3 bg-[#03B172]/5 rounded-lg border border-[#03B172]/20">
                          {sellSignals.length > 0 ? (
                            <ul className="space-y-1.5 text-xs">
                              {sellSignals.map((s, i) => (
                                <li key={i} className="flex items-start gap-2 text-[#C9D1D9]">
                                  <span className="text-[#03B172] mt-0.5">●</span>
                                  {s}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-xs text-[#8B949E]">暂无风险信号</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {!hasData && !loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 rounded-full bg-[#161B22] border border-[#30363D] flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-[#8B949E]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3v18h18" />
                <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-white mb-2">输入股票代码开始分析</h3>
            <p className="text-[#8B949E] text-center max-w-md">
              输入A股代码（如 600519、000001）或港股代码（如 00700）
              <br />
              <span className="text-xs">同时显示日K线、周线、15分钟三个时间维度</span>
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#30363D] bg-[#161B22] mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#FF3435] to-[#03B172] flex items-center justify-center">
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3v18h18" />
                  <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
                </svg>
              </div>
              <span className="text-sm text-[#8B949E]">
                Peter量价均线交易系统 - 东方财富数据
              </span>
            </div>
            <p className="text-xs text-[#484F58]">
              风险提示：本工具仅供学习研究，不构成投资建议
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
