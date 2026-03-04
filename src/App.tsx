import { useState, useCallback, useEffect } from 'react';
import { AlertCircle, Clock, Calendar, BarChart2, BookOpen, Code2, Star, X } from 'lucide-react';
import StockSearch from './components/StockSearch';
import StockChart from './components/StockChart';

import HelpDialog from './components/HelpDialog';
import { calculateAllIndicators } from './utils/indicators';
import { getMultiTimeframeData, getQuote, formatSymbol, getMarketName } from './utils/eastmoneyApi';
import { getMultiTimeframeData as getTencentMultiData, getQuote as getTencentQuote } from './utils/tencentApi';
import { getMultiTimeframeData as getBiyingMultiData, getQuote as getBiyingQuote, isAvailable as isBiyingAvailable } from './utils/biyingApi';
import type { StockData, IndicatorData } from './types';
import { Alert, AlertDescription } from '@/components/ui/alert';


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
  const [apiSource, setApiSource] = useState<string>('');
  const [showMAHS, setShowMAHS] = useState(true);
  const [showEMAHS, setShowEMAHS] = useState(true);
  const [showMA, setShowMA] = useState(true);
  
  // 信号版本切换：严格版(默认) / 宽松版
  const [signalVersion, setSignalVersion] = useState<'strict' | 'loose'>('strict');
  
  // 收藏功能 - 存储代码和名称
  interface FavoriteItem {
    symbol: string;
    name: string;
  }
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => {
    // 从localStorage读取收藏列表
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('peter_stock_favorites');
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [showFavorites, setShowFavorites] = useState(false);
  
  // 保存收藏到localStorage
  useEffect(() => {
    localStorage.setItem('peter_stock_favorites', JSON.stringify(favorites));
  }, [favorites]);
  
  // 添加/移除收藏
  const toggleFavorite = useCallback((symbol: string, name: string) => {
    setFavorites(prev => {
      const exists = prev.find(item => item.symbol === symbol);
      if (exists) {
        return prev.filter(item => item.symbol !== symbol);
      }
      return [...prev, { symbol, name }];
    });
  }, []);

  const handleSearch = useCallback(async (input: string) => {
    const symbol = formatSymbol(input);
    setLoading(true);
    setError(null);
    setCurrentSymbol(symbol);
    
    try {
      let multiData, quote;
      let apiSource = '';
      
      try {
        // 尝试东方财富API
        console.log('尝试东方财富API...');
        [multiData, quote] = await Promise.all([
          getMultiTimeframeData(symbol),
          getQuote(symbol),
        ]);
        apiSource = '东方财富数据';
        console.log('东方财富API成功');
      } catch (eastmoneyErr: any) {
        console.log('东方财富API失败:', eastmoneyErr.message || eastmoneyErr);
        
        // 东方财富失败，切换到腾讯财经API
        try {
          console.log('切换到腾讯财经API...');
          [multiData, quote] = await Promise.all([
            getTencentMultiData(symbol),
            getTencentQuote(symbol),
          ]);
          apiSource = '腾讯财经';
          console.log('腾讯财经API成功');
        } catch (tencentErr: any) {
          console.log('腾讯财经API失败:', tencentErr.message || tencentErr);
          
          // 如果必盈数据配置了 licence，最后尝试必盈数据
          if (isBiyingAvailable()) {
            try {
              console.log('切换到必盈数据API...');
              [multiData, quote] = await Promise.all([
                getBiyingMultiData(symbol),
                getBiyingQuote(symbol),
              ]);
              apiSource = '必盈数据';
              console.log('必盈数据API成功');
            } catch (biyingErr: any) {
              console.log('必盈数据API也失败:', biyingErr.message || biyingErr);
              throw new Error(`东方财富: ${eastmoneyErr.message || '失败'}; 腾讯: ${tencentErr.message || '失败'}; 必盈: ${biyingErr.message || '失败'}`);
            }
          } else {
            throw new Error(`东方财富: ${eastmoneyErr.message || '失败'}; 腾讯: ${tencentErr.message || '失败'}`);
          }
        }
      }
      
      // 使用流通股本计算指标
      const capital = quote.capital;
      
      // 根据API来源确定capital单位类型
      const capitalUnit: 'shares' | 'ten_thousand_shares' = apiSource === '腾讯财经' ? 'shares' : 'ten_thousand_shares';
      
      // 为每个时间维度计算指标
      setTimeframeData({
        daily: {
          data: multiData.daily,
          indicators: calculateAllIndicators(multiData.daily, capital, capitalUnit),
        },
        weekly: {
          data: multiData.weekly,
          indicators: calculateAllIndicators(multiData.weekly, capital, capitalUnit),
        },
        min15: {
          data: multiData.min15,
          indicators: calculateAllIndicators(multiData.min15, capital, capitalUnit),
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
      
      // 更新API来源显示
      setApiSource(apiSource);
    } catch (err: any) {
      console.error('完整错误:', err);
      const msg = err.message || '';
      if (msg.includes('Load failed') || msg.includes('fetch') || msg.includes('network') || msg.includes('Failed')) {
        setError(`数据源访问失败。这可能是由于：
1. 浏览器安全限制（CORS）
2. API暂时不可用
3. 网络连接问题

请尝试：
• 刷新页面后重试
• 更换浏览器（推荐Chrome/Edge）
• 检查网络连接

技术详情：${msg.slice(0, 100)}`);
      } else {
        setError(err.message || '获取数据失败，请检查股票代码是否正确');
      }
    } finally {
      setLoading(false);
    }
  }, []);
  
  // 从收藏快速搜索（放在handleSearch之后避免依赖问题）
  const searchFromFavorite = useCallback((item: FavoriteItem) => {
    handleSearch(item.symbol);
    setShowFavorites(false);
  }, [handleSearch]);

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
                  Peter趋势交易系统
                </h1>
                <p className="text-xs text-[#8B949E]">
                  {apiSource || '东方财富/新浪数据'} · 联系: 84160034@qq.com
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {/* 收藏按钮 */}
              <div className="relative">
                <button 
                  onClick={() => setShowFavorites(!showFavorites)}
                  className="flex items-center gap-1 text-sm text-[#8B949E] hover:text-[#E3B341] transition-colors"
                >
                  <Star className={`w-4 h-4 ${favorites.length > 0 ? 'fill-[#E3B341] text-[#E3B341]' : ''}`} />
                  收藏{favorites.length > 0 && `(${favorites.length})`}
                </button>
                
                {/* 收藏列表下拉 */}
                {showFavorites && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-[#161B22] border border-[#30363D] rounded-lg shadow-xl z-50">
                    <div className="p-2 border-b border-[#30363D] flex items-center justify-between">
                      <span className="text-xs text-[#8B949E]">我的收藏</span>
                      <button 
                        onClick={() => setShowFavorites(false)}
                        className="text-[#8B949E] hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    {favorites.length === 0 ? (
                      <div className="p-3 text-xs text-[#8B949E]">暂无收藏</div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto">
                        {favorites.map(item => (
                          <div 
                            key={item.symbol}
                            className="flex items-center justify-between px-3 py-2 hover:bg-[#0D1117] cursor-pointer group"
                            onClick={() => searchFromFavorite(item)}
                          >
                            <span className="text-sm text-[#C9D1D9] flex-1">
                              {item.name}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(item.symbol, item.name);
                              }}
                              className="text-[#8B949E] hover:text-[#FF3435] opacity-0 group-hover:opacity-100 transition-opacity px-2"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              <HelpDialog defaultTab="overview">
                <button className="flex items-center gap-1 text-sm text-[#8B949E] hover:text-white transition-colors">
                  <BookOpen className="w-4 h-4" />
                  使用说明
                </button>
              </HelpDialog>
              <HelpDialog defaultTab="guide">
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
            isFavorite={stockInfo ? favorites.some(f => f.symbol === stockInfo.symbol) : false}
            onToggleFavorite={stockInfo ? () => toggleFavorite(stockInfo.symbol, stockInfo.name) : undefined}
            showMAHS={showMAHS}
            onToggleMAHS={setShowMAHS}
            showEMAHS={showEMAHS}
            onToggleEMAHS={setShowEMAHS}
            showMA={showMA}
            onToggleMA={setShowMA}
            signalVersion={signalVersion}
            onToggleSignalVersion={() => setSignalVersion(prev => prev === 'strict' ? 'loose' : 'strict')}
          />
        </section>

        {/* Error Alert */}
        {error && (
          <Alert className="mb-6 bg-[#FF3435]/10 border-[#FF3435]/30">
            <AlertCircle className="w-4 h-4 text-[#FF3435]" />
            <AlertDescription className="text-[#FF3435]">{error}</AlertDescription>
          </Alert>
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
              
              // 趋势强度分析（统一使用ADX作为标准）
              const trendStrength = lastIndicator.trendStrength;
              
              // ADX趋势强度分析
              const adx = lastIndicator.adx;
              const adxState = lastIndicator.adxState;
              const pvtDivergence = lastIndicator.pvtDivergence;
              
              // PVT背离风险判定（提前声明供后续使用）
              const hasPVTTopDivergence = pvtDivergence === 'top';
              // 底背离需要过滤高位区域（使用BIAS225判断）
              const bias225 = lastIndicator.bias225;
              const isPriceHigh = bias225 !== null && bias225 > 10; // BIAS>10%视为高位
              // 只有不在高位时才视为有效底背离
              const hasPVTBottomDivergence = pvtDivergence === 'bottom' && !isPriceHigh;
              
              // 根据ADX判断趋势强度等级
              const isADXStrongTrend = adx !== null && adx >= 40 && adxState === 'rising';
              const isADXWeakening = adx !== null && adx >= 40 && adxState === 'falling';
              
              // 统一趋势级别判断（供多处使用）
              const getTrendLevel = () => {
                if (adx === null) return 'weak';
                if (hasPVTTopDivergence && adxState === 'falling') return 'weak'; // 顶背离+ADX回落=趋势转弱
                if (hasPVTTopDivergence) return 'medium'; // 有顶背离时最高算中等
                if (adx >= 40) return 'strong';
                if (adx >= 20) return 'medium';
                return 'weak';
              };
              
              const trendLevel = getTrendLevel();
              const isStrongTrend = trendLevel === 'strong';
              const isMediumTrend = trendLevel === 'medium';
              
              // 动态超买阈值计算（结合趋势强度和ADX）
              let overboughtThreshold = 80;
              let extremeOverboughtThreshold = 95;
              
              if (isStrongTrend && isADXStrongTrend) {
                overboughtThreshold = 99; // 强趋势+ADX上升，极高容忍度
                extremeOverboughtThreshold = 99;
              } else if (isStrongTrend || isADXStrongTrend) {
                overboughtThreshold = 95; // 强趋势或ADX强
                extremeOverboughtThreshold = 99;
              } else if (isMediumTrend) {
                overboughtThreshold = 87;
                extremeOverboughtThreshold = 95;
              } else if (isADXWeakening) {
                overboughtThreshold = 87; // ADX从高位回落，降低容忍度
                extremeOverboughtThreshold = 95;
              }
              
              // 高位风险判定
              const bias225Pct = lastIndicator.bias225Percentile;
              const costDevPct = lastIndicator.costDeviationPercentile;
              
              // 固定阈值（用于机会信号否决）- 无论趋势如何，80%分位即视为高位
              const isPriceHighFixed = (bias225Pct !== null && bias225Pct >= 80) || 
                                       (costDevPct !== null && costDevPct >= 80);
              
              // 动态阈值（用于风险信号分级）
              const isPriceExtremeOverbought = (bias225Pct !== null && bias225Pct >= extremeOverboughtThreshold) || 
                                               (costDevPct !== null && costDevPct >= extremeOverboughtThreshold);
              const isPriceOverbought = (bias225Pct !== null && bias225Pct >= overboughtThreshold) || 
                                        (costDevPct !== null && costDevPct >= overboughtThreshold);
              
              // 高位钝化判断（使用统一的趋势标准）
              // 强趋势或中等趋势（无顶背离）+ 乖离率高但未达超买阈值
              const isHighBiasWithStrongTrend = 
                (isStrongTrend || (isMediumTrend && !hasPVTTopDivergence)) && 
                ((bias225Pct !== null && bias225Pct >= 80 && bias225Pct < overboughtThreshold) ||
                 (costDevPct !== null && costDevPct >= 80 && costDevPct < overboughtThreshold));
              
              // ========== BIAS225历史分位数信号 ==========
              // 当已触发高位超买时，跳过单独的BIAS信号避免重复
              if (bias225Pct !== null && !isPriceOverbought) {
                if (bias225Pct <= 10) {
                  buySignals.push(`BIAS225历史极端低位 (${bias225Pct.toFixed(1)}%分位)`);
                } else if (bias225Pct <= 20) {
                  buySignals.push(`BIAS225低于历史80%水平 (${bias225Pct.toFixed(1)}%分位)`);
                }
                
                if (bias225Pct >= 90) {
                  sellSignals.push(`BIAS225历史极端高位 (${bias225Pct.toFixed(1)}%分位)`);
                } else if (bias225Pct >= 80) {
                  sellSignals.push(`BIAS225高于历史80%水平 (${bias225Pct.toFixed(1)}%分位)`);
                }
              }
              
              // 成本差穿越零轴信号
              if (lastIndicator.costDiff !== null && prevIndicator?.costDiff !== null) {
                if (lastIndicator.costDiff > 0 && prevIndicator.costDiff <= 0) {
                  buySignals.push('成本差上穿零轴 - 短期转强');
                }
                if (lastIndicator.costDiff < 0 && prevIndicator.costDiff >= 0) {
                  sellSignals.push('成本差下穿零轴 - 短期转弱');
                }
              }
              
              // ========== 成本偏离度历史分位数信号 ==========
              // 当已触发高位超买时，跳过单独的成本偏离度信号避免重复
              if (costDevPct !== null && !isPriceOverbought) {
                if (costDevPct <= 5) {
                  buySignals.push(`成本偏离度历史极端低位 (${costDevPct.toFixed(1)}%分位)`);
                } else if (costDevPct <= 15) {
                  buySignals.push(`成本偏离度低于历史85%水平 (${costDevPct.toFixed(1)}%分位)`);
                }
                
                if (costDevPct >= 95) {
                  sellSignals.push(`成本偏离度历史极端高位 (${costDevPct.toFixed(1)}%分位)`);
                } else if (costDevPct >= 85) {
                  sellSignals.push(`成本偏离度高于历史85%水平 (${costDevPct.toFixed(1)}%分位)`);
                }
              }
              
              // ========== CRI独立风险信号（最高优先级）==========
              const criValue = lastIndicator.cri;
              const criPct = lastIndicator.criPercentile;
              const criState = lastIndicator.criState;
              const volState = lastIndicator.volumeState;
              const slopeLvl = lastIndicator.slopeLevel || 0;
              const slopePct = lastIndicator.slopePressure || 0;
              
              // CRI风险信号：结合绝对值和历史分位数
              if (criValue !== null && criPct !== null) {
                // 极高CRI（绝对值≥70）：直接触发
                if (criValue >= 90) {
                  sellSignals.push(`极度恐慌 (CRI:${criValue.toFixed(1)})`);
                } else if (criValue >= 80) {
                  sellSignals.push(`高度恐慌 (CRI:${criValue.toFixed(1)})`);
                } else if (criValue >= 70) {
                  sellSignals.push(`中度恐慌 (CRI:${criValue.toFixed(1)})`);
                }
                
                // CRI历史极端高位（但绝对值<70时不触发恐慌信号，仅提示）
                if (criPct >= 95 && criValue >= 50) {
                  sellSignals.push(`CRI历史极端高位 (${criPct.toFixed(0)}%分位)`);
                } else if (criPct >= 90 && criValue >= 50) {
                  sellSignals.push(`CRI高于历史90% (${criPct.toFixed(0)}%分位)`);
                }
              }
              
              // ========== 斜率因子三维决策矩阵 ==========
              // 高斜率压力预警
              if (slopeLvl >= 3) {
                sellSignals.push(`趋势下压·强 (${slopePct.toFixed(0)}分)`);
              } else if (slopeLvl >= 2) {
                sellSignals.push(`趋势下压·中 (${slopePct.toFixed(0)}分)`);
              }
              
              // ========== PVT背离信号（量价背离）==========
              // PVT顶背离：价格新高但PVT未新高，提示量价背离风险
              if (hasPVTTopDivergence) {
                // ADX回落时顶背离风险更高
                if (isADXWeakening) {
                  sellSignals.push('⚠️ 价量顶背离：ADX回落，建议减仓');
                } else {
                  sellSignals.push('⚠️ 价量顶背离：价格与量能背离，建议减仓');
                }
              }
              // PVT底背离：价格新低但PVT未新低，增强反弹预期
              // 条件：底背离 + 非高位 + (恐慌解除 或 ADX上升)
              if (hasPVTBottomDivergence && !isPriceHighFixed) {
                const panicRelieved = criState !== 'panic' || (criValue !== null && criValue < 60);
                const adxRising = adxState === 'rising';
                
                if (panicRelieved && adxRising) {
                  buySignals.push('✅ 价量底背离：ADX上升，可左侧试探');
                } else if (panicRelieved) {
                  buySignals.push('✅ 价量底背离：恐慌解除，关注反弹');
                }
              }
              
              // CRI极端高位（恐慌分位数高）
              // 注意：isPriceExtremeOverbought 和 isPriceOverbought 已在上面定义
              const isCRIExtremeHigh = criPct !== null && criPct >= 95;
              const isCRIHigh = criPct !== null && criPct >= 80;
              
              // 三维组合判断（CRI≥70才视为有效恐慌）
              const isRealPanic = criState === 'panic' && criValue !== null && criValue >= 70;
              const isNormalState = criState !== 'panic' || (criValue !== null && criValue < 70);
              
              if (isRealPanic && slopeLvl >= 2) {
                sellSignals.push('恐慌+下压：建议清仓');
              } else if (isRealPanic && volState === 'extreme-shrink') {
                buySignals.push('恐慌·缩量：可能洗盘，观望');
              } else if (slopeLvl >= 2 && volState === 'expand') {
                sellSignals.push('下压·放量：下跌趋势确认');
              } else if (isNormalState && slopeLvl === 0 && volState === 'shrink' && !isPriceHighFixed) {
                // 机会信号否决条件：使用固定阈值80%，无论趋势如何
                buySignals.push('正常·无压·缩量：关注反弹');
              } else if (isNormalState && slopeLvl === 0 && volState === 'shrink' && isPriceHighFixed) {
                // 价格高位（>80%分位）时抑制机会信号，改为风险提示
                if (trendStrength === 'strong_bull' || trendStrength === 'bull') {
                  sellSignals.push('高位钝化·缩量：趋势中回调，追高谨慎');
                } else {
                  sellSignals.push('高位超买·缩量：警惕回调风险');
                }
              }
              
              // ========== 趋势回调买入信号 ==========
              // 在强趋势背景下，价格回调至关键均线附近的机会
              if ((trendStrength === 'strong_bull' || trendStrength === 'bull') && 
                  lastIndicator.ma20 !== null && lastIndicator.ma60 !== null) {
                
                const close = lastIndicator.close;
                const ma20 = lastIndicator.ma20;
                const ma60 = lastIndicator.ma60;
                
                // 条件1：价格回踩MA20或MA60且获得支撑（未跌破）
                const nearMA20 = close >= ma20 * 0.98 && close <= ma20 * 1.02; // 在MA20 ±2%范围内
                const nearMA60 = close >= ma60 * 0.98 && close <= ma60 * 1.02; // 在MA60 ±2%范围内
                
                // 条件2：CRI未进入极端恐慌（分位<70%）
                const criNotExtreme = criPct !== null && criPct < 70;
                
                // 条件3：成交量萎缩（VR<0.8）
                const volumeShrinking = volState === 'extreme-shrink' || volState === 'shrink';
                
                if ((nearMA20 || nearMA60) && criNotExtreme && volumeShrinking) {
                  const maLabel = nearMA20 ? 'MA20' : 'MA60';
                  buySignals.push(`趋势回调·${maLabel}支撑 (BIAS:${bias225Pct?.toFixed(0)}%分位) - 关注买入`);
                }
              }
              
              // 高位钝化提示（等级1警告）：乖离率高但趋势强劲
              if (isHighBiasWithStrongTrend) {
                const trendLabel = isStrongTrend ? '强趋势' : '多头';
                const adxLabel = adx !== null ? `ADX:${adx.toFixed(0)}` : '';
                sellSignals.push(`高位钝化·${trendLabel} (${adxLabel}) - 追高谨慎`);
              }
              
              // 高位超买独立风险信号（等级2警告）：真正的超买
              if (isPriceExtremeOverbought) {
                const thresholdLabel = extremeOverboughtThreshold === 99 ? '99%' : '95%';
                sellSignals.push(`极端超买·${thresholdLabel}阈值 (BIAS:${bias225Pct?.toFixed(0)}%·成本:${costDevPct?.toFixed(0)}%) - 建议减仓`);
              } else if (isPriceOverbought) {
                const thresholdLabel = overboughtThreshold === 95 ? '95%' : (overboughtThreshold === 87 ? '87%' : '80%');
                sellSignals.push(`高位超买·${thresholdLabel}阈值 (BIAS:${bias225Pct?.toFixed(0)}%·成本:${costDevPct?.toFixed(0)}%) - 注意风险`);
              }
              
              // CRI高位独立风险信号（与价格超买区分）
              if (isCRIExtremeHigh) {
                sellSignals.push(`CRI极端高位 (${criPct?.toFixed(0)}%分位)`);
              } else if (isCRIHigh) {
                sellSignals.push(`CRI高位 (${criPct?.toFixed(0)}%分位)`);
              }
              
              // ========== 市场状态决策树（按权重优先级）==========
              // 权重：CRI(最高) > 极端位置(双90%+/95%+/100%) > 趋势(斜率+ADX) > PVT背离 > 一般位置
              type MarketState = 'panic' | 'trend_down' | 'overbought' | 'normal';
              let marketState: MarketState = 'normal';
              let stateTitle = '';
              let stateColor = '';
              let stateDesc = '';
              
              // 辅助判断
              const hasSlopePressure = slopeLvl >= 2;
              const adxRising = adxState === 'rising';
              const adxFalling = adxState === 'falling';
              
              // 极端位置判断（BIAS和成本偏离同时≥90%视为极端危险）
              const isDualExtremeHigh = (bias225Pct !== null && bias225Pct >= 90) && 
                                        (costDevPct !== null && costDevPct >= 90);
              const isSingleExtremeHigh = (bias225Pct !== null && bias225Pct >= 95) || 
                                          (costDevPct !== null && costDevPct >= 95);
              const isHistoricalExtreme = (bias225Pct !== null && bias225Pct >= 99) || 
                                          (costDevPct !== null && costDevPct >= 99);
              
              // ===== 第一层：CRI极端风险（权重最高）=====
              if ((criValue !== null && criValue >= 80) || isCRIExtremeHigh) {
                marketState = 'panic';
                stateTitle = '恐慌状态';
                stateColor = '#FF3435';
                stateDesc = 'CRI极端风险，情绪极度悲观，暂停左侧交易，等待风险释放';
              }
              // ===== 第二层：极端位置风险（双90%+或95%+，权重第二）=====
              else if (isHistoricalExtreme) {
                marketState = 'overbought';
                if (isStrongTrend) {
                  stateTitle = '历史极值·ADX强';
                  stateColor = '#D2A8FF';
                  stateDesc = '股价创历史新高极值(99%+)，即使ADX强也需警惕，建议减仓';
                } else {
                  stateTitle = '历史极值·高风险';
                  stateColor = '#FF3435';
                  stateDesc = '股价创历史新高极值(99%+)，强烈建议减仓';
                }
              } else if (isDualExtremeHigh) {
                marketState = 'overbought';
                if (hasPVTTopDivergence) {
                  stateTitle = '双指标极端·顶背离';
                  stateColor = '#FF3435';
                  stateDesc = 'BIAS和成本偏离均超90%且顶背离，危险信号，必须减仓';
                } else if (isStrongTrend) {
                  stateTitle = '双指标极端·ADX强';
                  stateColor = '#FF3435';
                  stateDesc = 'BIAS和成本偏离均超90%，即使ADX强也需警惕，建议减仓';
                } else {
                  stateTitle = '双指标极端·高风险';
                  stateColor = '#FF3435';
                  stateDesc = 'BIAS和成本偏离均超90%，强烈建议减仓';
                }
              } else if (isSingleExtremeHigh) {
                marketState = 'overbought';
                if (hasPVTTopDivergence) {
                  stateTitle = '单指标极端·顶背离';
                  stateColor = '#FF3435';
                  stateDesc = '单一指标超95%且顶背离，高风险，建议减仓';
                } else if (isStrongTrend) {
                  stateTitle = '单指标极端·ADX强';
                  stateColor = '#E3B341';
                  stateDesc = '单一指标超95%，ADX强趋势支撑，密切关注';
                } else {
                  stateTitle = '单指标极端';
                  stateColor = '#E3B341';
                  stateDesc = '单一指标超95%，建议减仓';
                }
              }
              // ===== 第三层：趋势因子（斜率压制）=====
              else if (hasSlopePressure) {
                marketState = 'trend_down';
                if (hasPVTTopDivergence) {
                  stateTitle = '斜率压制·顶背离';
                  stateColor = '#FF3435';
                  stateDesc = '中长期斜率压制+PVT顶背离，下跌趋势确认，建议减仓';
                } else if (isStrongTrend) {
                  stateTitle = '斜率压制·ADX强';
                  stateColor = '#E3B341';
                  stateDesc = '斜率压制但ADX强，短期有反弹，中长期仍承压';
                } else {
                  stateTitle = '斜率压制';
                  stateColor = '#E3B341';
                  stateDesc = '中长期趋势承压，不轻易抄底，等待趋势企稳';
                }
              }
              // ===== 第四层：ADX趋势反转（顶背离修正）=====
              else if (hasPVTTopDivergence && adxFalling) {
                marketState = 'overbought';
                stateTitle = '顶背离·ADX回落';
                stateColor = '#FF3435';
                stateDesc = 'PVT顶背离+ADX回落，趋势转弱，警惕回调，建议减仓';
              } else if (hasPVTTopDivergence && isStrongTrend) {
                marketState = 'overbought';
                stateTitle = '顶背离·ADX强';
                stateColor = '#E3B341';
                stateDesc = 'PVT顶背离但ADX仍强，趋势可能延续，密切关注';
              } else if (hasPVTTopDivergence) {
                marketState = 'overbought';
                stateTitle = '顶背离·ADX弱';
                stateColor = '#E3B341';
                stateDesc = 'PVT顶背离+ADX弱，趋势不明，谨慎观望';
              }
              // ===== 第五层：ADX趋势状态（核心趋势）=====
              else if (isStrongTrend && adxRising) {
                marketState = 'normal';
                stateTitle = 'ADX强趋势·上升';
                stateColor = '#03B172';
                stateDesc = 'ADX强且上升，趋势强劲，可持股待涨';
              } else if (isStrongTrend) {
                marketState = 'normal';
                stateTitle = 'ADX强趋势';
                stateColor = '#03B172';
                stateDesc = 'ADX强趋势，可持股待涨，关注回调买入';
              } else if (isMediumTrend && adxRising) {
                marketState = 'normal';
                stateTitle = 'ADX多头·上升';
                stateColor = '#58A6FF';
                stateDesc = 'ADX中等且上升，趋势转强，可积极操作';
              } else if (isMediumTrend && adxFalling) {
                marketState = 'normal';
                stateTitle = 'ADX多头·回落';
                stateColor = '#E3B341';
                stateDesc = 'ADX中等但回落，趋势减弱，谨慎追高';
              } else if (isMediumTrend) {
                marketState = 'normal';
                stateTitle = 'ADX多头';
                stateColor = '#58A6FF';
                stateDesc = 'ADX中等趋势，可积极操作';
              }
              // ===== 第六层：底背离机会（领先指标）=====
              else if (hasPVTBottomDivergence && adxRising) {
                marketState = 'normal';
                stateTitle = '底背离·ADX上升';
                stateColor = '#03B172';
                stateDesc = 'PVT底背离+ADX上升，反弹动能增强，可左侧试探';
              } else if (hasPVTBottomDivergence) {
                marketState = 'normal';
                stateTitle = '底背离·观察';
                stateColor = '#58A6FF';
                stateDesc = 'PVT底背离，关注反弹机会';
              }
              // ===== 第七层：一般位置指标（80-90%，权重最低）=====
              else if (isPriceExtremeOverbought) {
                marketState = 'overbought';
                if (isStrongTrend) {
                  stateTitle = '超买·ADX强';
                  stateColor = '#D2A8FF';
                  stateDesc = `股价较高(${extremeOverboughtThreshold}%)，ADX强支撑，暂观望`;
                } else {
                  stateTitle = '超买';
                  stateColor = '#E3B341';
                  stateDesc = '股价较高，建议减仓';
                }
              } else if (isPriceOverbought) {
                marketState = 'overbought';
                if (isStrongTrend) {
                  stateTitle = '偏高·ADX强';
                  stateColor = '#E3B341';
                  stateDesc = `股价偏高(${overboughtThreshold}%)，ADX强支撑，暂不强制减仓`;
                } else {
                  stateTitle = '偏高';
                  stateColor = '#E3B341';
                  stateDesc = '股价偏高，谨慎追高';
                }
              } else if (isPriceHighFixed) {
                marketState = 'overbought';
                if (isStrongTrend) {
                  stateTitle = '高位·ADX强';
                  stateColor = '#58A6FF';
                  stateDesc = `股价高位(${bias225Pct?.toFixed(0)}%)，ADX支撑，追高谨慎`;
                } else {
                  stateTitle = '高位';
                  stateColor = '#E3B341';
                  stateDesc = '股价高位，建议减仓';
                }
              }
              // ===== 第七层：震荡/弱趋势（ADX<20）=====
              else {
                marketState = 'normal';
                stateTitle = '震荡整理';
                stateColor = '#8B949E';
                stateDesc = 'ADX弱趋势，震荡行情，区间操作或观望';
              }
              
              // 根据状态调整信号显示
              let displayBuySignals = [...buySignals];
              let displaySellSignals = [...sellSignals];
              
              if (marketState === 'panic') {
                // 恐慌状态：机会信号降级，添加警告
                if (displayBuySignals.length > 0) {
                  displayBuySignals = displayBuySignals.map(s => `⚠️ ${s}`);
                  displayBuySignals.unshift('【左侧信号暂停】');
                }
              } else if (marketState === 'trend_down') {
                // 趋势下压状态：左侧信号权重降低
                if (displayBuySignals.length > 0) {
                  displayBuySignals = displayBuySignals.map(s => `△ ${s}`);
                  displayBuySignals.unshift('【等待趋势企稳】');
                }
              } else if (marketState === 'overbought') {
                // 高位超买状态：机会信号被抑制
                if (displayBuySignals.length > 0) {
                  displayBuySignals = displayBuySignals.map(s => `❌ ${s}`);
                  displayBuySignals.unshift('【高位超买，机会信号关闭】');
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
                      <div className="h-[600px]">
                        <StockChart
                          stockData={data.data}
                          indicators={data.indicators}
                          showMAHS={tf === 'daily' && showMAHS}
                          showEMAHS={tf === 'daily' && showEMAHS}
                          showMA={showMA}
                          title=""
                          timeframe={tf}
                          version={signalVersion}
                        />
                      </div>
                    </div>
                    
                    {/* Right: Indicators & Signals - 占1/4宽度 */}
                    <div className="lg:col-span-1 p-3 space-y-2 border-l border-[#30363D] bg-[#0D1117] overflow-y-auto max-h-[600px]">
                      {/* CRI + 斜率因子 - 只有日K显示 */}
                      {tf === 'daily' && (
                        <div className="space-y-2">
                          {/* 市场状态机（方案B）*/}
                          <div className="p-2 rounded-lg border" style={{ 
                            backgroundColor: `${stateColor}15`,
                            borderColor: `${stateColor}40`
                          }}>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px]" style={{ color: stateColor }}>状态</span>
                              <span className="text-[10px] font-bold" style={{ color: stateColor }}>{stateTitle}</span>
                            </div>
                            <div className="text-[9px] leading-tight mt-0.5" style={{ color: stateColor, opacity: 0.9 }}>
                              {stateDesc}
                            </div>
                          </div>
                          
                          {/* CRI - 综合风险指标 v2.0 */}
                          <div className="p-2 bg-[#161B22] rounded-lg border border-[#30363D]">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] text-[#8B949E]">综合风险指标(CRI)</span>
                              <span className="text-[10px] text-[#8B949E]">
                                量比:{lastIndicator?.vr?.toFixed(1) || '-'}
                              </span>
                            </div>
                            <div className="flex items-baseline gap-2 mb-1">
                              <span className={`text-xl font-bold ${
                                lastIndicator?.criState === 'panic' ? 'text-[#FF3435]' : 
                                lastIndicator?.criState === 'complacent' ? 'text-[#03B172]' : 
                                (lastIndicator?.criPercentile !== null && lastIndicator.criPercentile >= 80) ? 'text-[#E3B341]' : 
                                (lastIndicator?.criPercentile !== null && lastIndicator.criPercentile >= 60) ? 'text-[#8B949E]' : 'text-[#03B172]'
                              }`} style={{ fontFamily: 'JetBrains Mono' }}>
                                {lastIndicator?.cri?.toFixed(1) || '-'}
                              </span>
                              <span className="text-[10px] text-[#8B949E]">
                                {lastIndicator?.criPercentile?.toFixed(0) || '-'}%分位
                              </span>
                            </div>
                            {/* CRI 成分详情 */}
                            {lastIndicator?.criComponents && (
                              <div className="pt-1 border-t border-[#30363D] grid grid-cols-4 gap-1 text-[9px]">
                                <div className="text-center">
                                  <span className="text-[#8B949E] block">成本偏离</span>
                                  <span className="text-[#FF6B6B]">{lastIndicator.criComponents.basis.toFixed(0)}</span>
                                </div>
                                <div className="text-center">
                                  <span className="text-[#8B949E] block">跳跃风险</span>
                                  <span className="text-[#E3B341]">{lastIndicator.criComponents.jump.toFixed(0)}</span>
                                </div>
                                <div className="text-center">
                                  <span className="text-[#8B949E] block">波动曲线</span>
                                  <span className="text-[#D2A8FF]">{lastIndicator.criComponents.curve.toFixed(0)}</span>
                                </div>
                                <div className="text-center">
                                  <span className="text-[#8B949E] block">波动百分位</span>
                                  <span className="text-[#79C0FF]">{lastIndicator.criComponents.percentile.toFixed(0)}</span>
                                </div>
                              </div>
                            )}
                          </div>
                          
                          {/* BIAS225 & 成本偏离度 - 详细显示 */}
                          <div className="p-2 bg-[#161B22] rounded-lg border border-[#30363D]">
                            {/* BIAS225 乖离率 */}
                            <div className="mb-1">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-[#8B949E]">乖离率(BIAS225)</span>
                                <span className="text-[#8B949E]">
                                  分位:{lastIndicator?.bias225Percentile !== null ? `${lastIndicator.bias225Percentile.toFixed(0)}%` : '-'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-[#8B949E]">数值</span>
                                <span className="text-sm font-bold" style={{ 
                                  fontFamily: 'JetBrains Mono',
                                  color: lastIndicator?.bias225Percentile !== null && lastIndicator!.bias225Percentile! <= 20 ? '#03B172' :
                                         lastIndicator?.bias225Percentile !== null && lastIndicator!.bias225Percentile! >= 80 ? '#FF3435' : '#C9D1D9'
                                }}>
                                  {lastIndicator?.bias225?.toFixed(2) ?? '-'}
                                </span>
                              </div>
                            </div>
                            {/* 分隔线 */}
                            <div className="border-t border-[#30363D] my-1" />
                            {/* 成本偏离度 */}
                            <div>
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-[#8B949E]">成本偏离度</span>
                                <span className="text-[#8B949E]">
                                  分位:{lastIndicator?.costDeviationPercentile !== null ? `${lastIndicator.costDeviationPercentile.toFixed(0)}%` : '-'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-[#8B949E]">数值</span>
                                <span className="text-sm font-bold" style={{ 
                                  fontFamily: 'JetBrains Mono',
                                  color: lastIndicator?.costDeviationPercentile !== null && lastIndicator!.costDeviationPercentile! <= 15 ? '#03B172' :
                                         lastIndicator?.costDeviationPercentile !== null && lastIndicator!.costDeviationPercentile! >= 85 ? '#FF3435' : '#C9D1D9'
                                }}>
                                  {lastIndicator?.costDeviation?.toFixed(2) ?? '-'}
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          {/* 趋势强度综合面板 - ADX + PVT + 斜率 */}
                          <div className="p-2 bg-[#161B22] rounded-lg border border-[#30363D]">
                            {/* 标题行 + 整体结论 */}
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-medium text-[#8B949E]">趋势强度综合</span>
                              <span className="text-[10px] font-medium">
                                {(() => {
                                  const adx = lastIndicator?.adx || 0;
                                  const adxState = lastIndicator?.adxState;
                                  const pvtDiv = lastIndicator?.pvtDivergence;
                                  const slopeLevel = lastIndicator?.slopeLevel || 0;
                                  const bias225 = lastIndicator?.bias225 ?? 0;
                                  
                                  // 基础趋势判断（基于ADX绝对值）
                                  let baseTrend = '';
                                  if (adx >= 40) baseTrend = 'strong';
                                  else if (adx >= 20) baseTrend = 'medium';
                                  else baseTrend = 'weak';
                                  
                                  // 价格相对于长期均线的位置
                                  const isPriceAboveMA225 = bias225 > 0; // 价格在225均线之上
                                  const isPriceBelowMA225 = bias225 < -5; // 价格明显低于225均线（>5%）
                                  
                                  // 风险因子（包括弱压力）
                                  const hasTopDivergence = pvtDiv === 'top';
                                  const hasSlopePressureStrong = slopeLevel >= 2;
                                  const hasSlopePressureWeak = slopeLevel >= 1; // 包含弱压力
                                  const adxWeakening = adxState === 'falling';
                                  const adxRising = adxState === 'rising';
                                  const hasBottomDivergence = pvtDiv === 'bottom';
                                  
                                  // ===== 强趋势判断 =====
                                  // 强多头：ADX强 + 无顶背离 + 无斜率压力 + 价格在225均线之上
                                  if (baseTrend === 'strong' && !hasTopDivergence && !hasSlopePressureWeak && isPriceAboveMA225) {
                                    return <span className="text-[#03B172]">🔥 强多头</span>;
                                  }
                                  // 强空头：ADX强 + 价格明显低于225均线
                                  if (baseTrend === 'strong' && isPriceBelowMA225) {
                                    return <span className="text-[#FF3435]">🔥 强空头</span>;
                                  }
                                  // 强多头但斜率弱压：ADX强但斜率有弱压力
                                  if (baseTrend === 'strong' && !hasTopDivergence && hasSlopePressureWeak && isPriceAboveMA225) {
                                    return <span className="text-[#58A6FF]">强多头·斜率弱压</span>;
                                  }
                                  
                                  // ===== 中等趋势判断 =====
                                  // ADX中等+上升+无压力+价格在均线之上：多头形成中
                                  if (baseTrend === 'medium' && adxRising && !hasSlopePressureWeak && !hasTopDivergence && isPriceAboveMA225) {
                                    return <span className="text-[#58A6FF]">📈 多头形成</span>;
                                  }
                                  // ADX中等+价格明显低于225均线：空头形成中
                                  if (baseTrend === 'medium' && isPriceBelowMA225) {
                                    return <span className="text-[#FF3435]">📉 空头形成</span>;
                                  }
                                  // ADX中等+弱压力+价格在均线上：多头承压
                                  if (baseTrend === 'medium' && hasSlopePressureWeak && !hasTopDivergence && isPriceAboveMA225) {
                                    return <span className="text-[#E3B341]">多头·斜率弱压</span>;
                                  }
                                  // ADX中等+走平+价格在均线上：多头震荡
                                  if (baseTrend === 'medium' && !hasSlopePressureWeak && !hasTopDivergence && isPriceAboveMA225) {
                                    return <span className="text-[#E3B341]">📊 多头震荡</span>;
                                  }
                                  // ADX中等+价格在均线附近：趋势不明
                                  if (baseTrend === 'medium' && !isPriceAboveMA225 && !isPriceBelowMA225) {
                                    return <span className="text-[#8B949E]">趋势不明</span>;
                                  }
                                  
                                  // ===== 顶背离风险（只在价格偏高时显示） =====
                                  if (baseTrend === 'strong' && hasTopDivergence && isPriceAboveMA225) {
                                    return <span className="text-[#E3B341]">⚠️ 强转弱风险</span>;
                                  }
                                  if (baseTrend === 'medium' && hasTopDivergence && isPriceAboveMA225) {
                                    return <span className="text-[#FF3435]">⚠️ 顶背离风险</span>;
                                  }
                                  if (hasTopDivergence && adxWeakening && isPriceAboveMA225) {
                                    return <span className="text-[#FF3435]">🚨 趋势反转</span>;
                                  }
                                  
                                  // ===== 底背离机会（只在价格偏低时显示） =====
                                  if (hasBottomDivergence && adxRising && isPriceBelowMA225) {
                                    return <span className="text-[#03B172]">✅ 底背离机会</span>;
                                  }
                                  if (hasBottomDivergence && baseTrend !== 'weak' && isPriceBelowMA225) {
                                    return <span className="text-[#58A6FF]">📊 底背离观察</span>;
                                  }
                                  
                                  // ===== 斜率压制（多头时）/支撑（空头时） =====
                                  if (hasSlopePressureStrong && isPriceAboveMA225) {
                                    return <span className="text-[#E3B341]">📉 斜率压制</span>;
                                  }
                                  
                                  // ===== ADX走弱 =====
                                  if (adxWeakening && baseTrend === 'medium' && isPriceAboveMA225) {
                                    return <span className="text-[#E3B341]">📉 趋势减弱</span>;
                                  }
                                  if (adxWeakening && baseTrend === 'medium' && isPriceBelowMA225) {
                                    return <span className="text-[#8B949E]">📉 空头减弱</span>;
                                  }
                                  
                                  // ===== 弱趋势 =====
                                  if (baseTrend === 'weak' && isPriceAboveMA225) {
                                    return <span className="text-[#8B949E]">💤 多头整理</span>;
                                  }
                                  if (baseTrend === 'weak' && isPriceBelowMA225) {
                                    return <span className="text-[#8B949E]">💤 空头整理</span>;
                                  }
                                  if (baseTrend === 'weak') {
                                    return <span className="text-[#8B949E]">💤 震荡整理</span>;
                                  }
                                  
                                  return <span className="text-[#8B949E]">⚪ 观望</span>;
                                })()}
                              </span>
                            </div>
                            
                            {/* ADX 和 PVT 和 斜率压力 - 放在斜率详细数据上面 */}
                            <div className="space-y-1.5 mb-2">
                              {/* ADX 平均趋向指数 */}
                              <div className="flex items-center justify-between text-[9px]">
                                <span className="text-[#8B949E]">ADX趋向(14日):</span>
                                <span className={
                                  (lastIndicator?.adx || 0) >= 40 ? 'text-[#03B172]' : 
                                  (lastIndicator?.adx || 0) >= 20 ? 'text-[#E3B341]' : 
                                  'text-[#8B949E]'
                                }>
                                  {lastIndicator?.adx?.toFixed(0) ?? '-'} · 
                                  {(lastIndicator?.adx || 0) >= 40 ? '强' : 
                                   (lastIndicator?.adx || 0) >= 20 ? '中等' : '弱'}
                                  {(lastIndicator?.adxState === 'rising') ? '↗' : 
                                   (lastIndicator?.adxState === 'falling') ? '↘' : '→'}
                                </span>
                              </div>
                              {/* PVT 价量趋势背离 */}
                              <div className="flex items-center justify-between text-[9px]">
                                <span className="text-[#8B949E]">PVT量价(20日):</span>
                                {lastIndicator?.pvtDivergence === 'top' ? (
                                  <span className="text-[#FF3435]">⚠️ 顶背离</span>
                                ) : lastIndicator?.pvtDivergence === 'bottom' ? (
                                  // 底背离在高位时显示警告（回调信号，非买入信号）
                                  (lastIndicator?.bias225 !== null && lastIndicator!.bias225! > 10) ? (
                                    <span className="text-[#E3B341]">⚠️ 高位回调</span>
                                  ) : (
                                    <span className="text-[#03B172]">✅ 底背离</span>
                                  )
                                ) : (
                                  <span className="text-[#8B949E]">无背离</span>
                                )}
                              </div>
                              {/* 斜率压力判断 */}
                              <div className="flex items-center justify-between text-[9px]">
                                <span className="text-[#8B949E]">斜率压力:</span>
                                <span className={
                                  (lastIndicator?.slopeLevel || 0) >= 3 ? 'text-[#FF3435]' : 
                                  (lastIndicator?.slopeLevel || 0) >= 2 ? 'text-[#E3B341]' : 
                                  (lastIndicator?.slopeLevel || 0) >= 1 ? 'text-[#D2A8FF]' :
                                  'text-[#03B172]'
                                }>
                                  {lastIndicator?.slopePressure?.toFixed(0) ?? '-'}分 · 
                                  {(lastIndicator?.slopeLevel || 0) >= 3 ? '强' : 
                                   (lastIndicator?.slopeLevel || 0) >= 2 ? '中' : 
                                   (lastIndicator?.slopeLevel || 0) >= 1 ? '弱' : '无'}
                                </span>
                              </div>
                            </div>
                            
                            {/* 斜率详细信息 */}
                            <div className="text-[9px] text-[#8B949E] pt-2 border-t border-[#30363D] space-y-0.5">
                              <div className="flex justify-between">
                                <span>MA20斜率:</span>
                                <span className={lastIndicator?.slope20 && lastIndicator.slope20 < 0 ? 'text-[#FF3435]' : 'text-[#03B172]'}>
                                  {lastIndicator?.slope20?.toFixed(2) ?? '-'}%
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>MA60斜率:</span>
                                <span className={lastIndicator?.slope60 && lastIndicator.slope60 < 0 ? 'text-[#FF3435]' : 'text-[#03B172]'}>
                                  {lastIndicator?.slope60?.toFixed(2) ?? '-'}%
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>MA225斜率:</span>
                                <span className={lastIndicator?.slope225 && lastIndicator.slope225 < 0 ? 'text-[#FF3435]' : 'text-[#03B172]'}>
                                  {lastIndicator?.slope225?.toFixed(2) ?? '-'}%
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Signals - 并排显示节省空间 */}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {/* Opportunity Signals */}
                        <div>
                          <h4 className="text-[10px] font-medium text-[#8B949E] uppercase tracking-wider mb-1 flex items-center">
                            机会信号
                            {marketState !== 'normal' && (
                              <span className="ml-1 text-[9px] px-1 py-0.5 rounded" style={{ 
                                backgroundColor: `${stateColor}30`,
                                color: stateColor
                              }}>
                                {marketState === 'panic' ? '暂停' : 
                                 marketState === 'overbought' ? '关闭' : '谨慎'}
                              </span>
                            )}
                          </h4>
                          <div className="p-2 bg-[#03B172]/5 rounded-lg border border-[#03B172]/20 min-h-[50px] max-h-[120px] overflow-y-auto">
                            {displayBuySignals.length > 0 ? (
                              <ul className="space-y-1 text-[10px]">
                                {displayBuySignals.map((s, i) => (
                                  <li key={i} className="flex items-start gap-1.5 text-[#C9D1D9]">
                                    <span className="text-[#03B172] mt-0.5">●</span>
                                    <span className="leading-tight">{s}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-[10px] text-[#8B949E]">
                                {marketState === 'panic' ? '【暂停】' : 
                                 marketState === 'trend_down' ? '【等待企稳】' : 
                                 marketState === 'overbought' ? '【关闭】' :
                                 '暂无'}
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {/* Risk Signals */}
                        <div>
                          <h4 className="text-[10px] font-medium text-[#8B949E] uppercase tracking-wider mb-1 flex items-center flex-wrap gap-1">
                            风险信号
                            {marketState === 'panic' && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-[#FF3435]/30 text-[#FF3435]">强</span>
                            )}
                            {marketState === 'trend_down' && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-[#E3B341]/30 text-[#E3B341]">优先</span>
                            )}
                            {marketState === 'overbought' && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-[#D2A8FF]/30 text-[#D2A8FF]">高位</span>
                            )}
                          </h4>
                          <div className="p-2 bg-[#03B172]/5 rounded-lg border border-[#03B172]/20 min-h-[50px] max-h-[120px] overflow-y-auto">
                            {displaySellSignals.length > 0 ? (
                              <ul className="space-y-1 text-[10px]">
                                {displaySellSignals.map((s, i) => (
                                  <li key={i} className="flex items-start gap-1.5 text-[#C9D1D9]">
                                    <span className="text-[#03B172] mt-0.5">●</span>
                                    <span className="leading-tight">{s}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-[10px] text-[#8B949E]">暂无</span>
                            )}
                          </div>
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
                Peter趋势交易系统 - {apiSource || '东方财富/新浪数据'}
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
