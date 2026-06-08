import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Calendar, BarChart2, Clock } from 'lucide-react';
import StockChart from './StockChart';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

type TimeframeType = 'daily' | 'weekly' | 'min15';

interface TimeframeData {
  data: any[];
  indicators: any[];
}

interface StockChartsSectionProps {
  data: {
    daily?: TimeframeData | null;
    weekly?: TimeframeData | null;
    min15?: TimeframeData | null;
  };
  stockInfo?: { symbol: string } | null;
}

const chartConfigs: { key: TimeframeType; label: string; icon: LucideIcon; color: string }[] = [
  { key: 'daily', label: '日K线', icon: Calendar, color: '#FF3435' },
  { key: 'weekly', label: '周K线', icon: BarChart2, color: '#D2A8FF' },
  { key: 'min15', label: '15分钟', icon: Clock, color: '#03B172' },
];

export default function StockChartsSection({ data }: StockChartsSectionProps) {
  const [showMAHS, setShowMAHS] = useState(false);
  const [showEMAHS, setShowEMAHS] = useState(true);
  const [showMA, setShowMA] = useState(false);
  const [showVolumeTrend, setShowVolumeTrend] = useState(false);
  const [showOBV, setShowOBV] = useState(true);
  const [signalVersion, setSignalVersion] = useState<'strict' | 'loose'>('strict');

  const hasData = data.daily && data.weekly && data.min15;
  if (!hasData) return null;

  // 防御：指标数组为空时跳过该维度，但不整体隐藏（避免网络波动导致全黑）
  const hasAnyIndicators =
    (data.daily?.indicators.length || 0) > 0 ||
    (data.weekly?.indicators.length || 0) > 0 ||
    (data.min15?.indicators.length || 0) > 0;
  if (!hasAnyIndicators) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {chartConfigs.map((config) => (
          <div key={config.key} className="bg-[#161B22] rounded-xl border border-[#30363D] p-8 text-center">
            <div className="text-sm text-[#8B949E]">K线数据加载失败，请检查网络连接</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {chartConfigs.map((config) => {
        const tf = config.key;
        const tfData = data[tf]!;
        const Icon = config.icon;
        const lastIndicator = tfData.indicators[tfData.indicators.length - 1];
        const prevIndicator = tfData.indicators[tfData.indicators.length - 2];

        // 防御：该维度指标为空时显示占位
        if (!lastIndicator) {
          return (
            <div key={tf} className="bg-[#161B22] rounded-xl border border-[#30363D] p-8 text-center">
              <div className="text-sm text-[#8B949E]">{config.label} 数据加载失败</div>
            </div>
          );
        }

        const buySignals: string[] = [];
        const sellSignals: string[] = [];

        const trendStrength = lastIndicator.trendStrength;
        const adx = lastIndicator.adx;
        const adxState = lastIndicator.adxState;
        const pvtDivergence = lastIndicator.pvtDivergence;
        const hasPVTTopDivergence = pvtDivergence === 'top';
        const bias225 = lastIndicator.bias225;
        const isPriceHigh = bias225 !== null && bias225 > 10;
        const hasPVTBottomDivergence = pvtDivergence === 'bottom' && !isPriceHigh;
        const isADXStrongTrend = adx !== null && adx >= 40 && adxState === 'rising';
        const isADXWeakening = adx !== null && adx >= 40 && adxState === 'falling';

        const getTrendLevel = () => {
          if (adx === null) return 'weak';
          if (hasPVTTopDivergence && adxState === 'falling') return 'weak';
          if (hasPVTTopDivergence) return 'medium';
          if (adx >= 40) return 'strong';
          if (adx >= 20) return 'medium';
          return 'weak';
        };

        const trendLevel = getTrendLevel();
        const isStrongTrend = trendLevel === 'strong';
        const isMediumTrend = trendLevel === 'medium';

        let overboughtThreshold = 80;
        let extremeOverboughtThreshold = 95;

        if (isStrongTrend && isADXStrongTrend) {
          overboughtThreshold = 99;
          extremeOverboughtThreshold = 99;
        } else if (isStrongTrend || isADXStrongTrend) {
          overboughtThreshold = 95;
          extremeOverboughtThreshold = 99;
        } else if (isMediumTrend) {
          overboughtThreshold = 87;
          extremeOverboughtThreshold = 95;
        } else if (isADXWeakening) {
          overboughtThreshold = 87;
          extremeOverboughtThreshold = 95;
        }

        const bias225Pct = lastIndicator.bias225Percentile;
        const costDevPct = lastIndicator.costDeviationPercentile;
        const isPriceHighFixed = (bias225Pct !== null && bias225Pct >= 80) ||
                                 (costDevPct !== null && costDevPct >= 80);
        const isPriceExtremeOverbought = (bias225Pct !== null && bias225Pct >= extremeOverboughtThreshold) ||
                                         (costDevPct !== null && costDevPct >= extremeOverboughtThreshold);
        const isPriceOverbought = (bias225Pct !== null && bias225Pct >= overboughtThreshold) ||
                                  (costDevPct !== null && costDevPct >= overboughtThreshold);
        const isHighBiasWithStrongTrend =
          (isStrongTrend || (isMediumTrend && !hasPVTTopDivergence)) &&
          ((bias225Pct !== null && bias225Pct >= 80 && bias225Pct < overboughtThreshold) ||
           (costDevPct !== null && costDevPct >= 80 && costDevPct < overboughtThreshold));

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

        if (lastIndicator.costDiff !== null && prevIndicator?.costDiff !== null) {
          if (lastIndicator.costDiff > 0 && prevIndicator.costDiff <= 0) {
            buySignals.push('成本差上穿零轴 - 短期转强');
          }
          if (lastIndicator.costDiff < 0 && prevIndicator.costDiff >= 0) {
            sellSignals.push('成本差下穿零轴 - 短期转弱');
          }
        }

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

        const criValue = lastIndicator.cri;
        const criPct = lastIndicator.criPercentile;
        const criState = lastIndicator.criState;
        const volState = lastIndicator.volumeState;
        const slopeLvl = lastIndicator.slopeLevel || 0;
        const slopePct = lastIndicator.slopePressure || 0;

        if (criValue !== null && criPct !== null) {
          if (criValue >= 90) {
            sellSignals.push(`极度恐慌 (CRI:${criValue.toFixed(1)})`);
          } else if (criValue >= 80) {
            sellSignals.push(`高度恐慌 (CRI:${criValue.toFixed(1)})`);
          } else if (criValue >= 70) {
            sellSignals.push(`中度恐慌 (CRI:${criValue.toFixed(1)})`);
          }
          if (criPct >= 95 && criValue >= 50) {
            sellSignals.push(`CRI历史极端高位 (${criPct.toFixed(0)}%分位)`);
          } else if (criPct >= 90 && criValue >= 50) {
            sellSignals.push(`CRI高于历史90% (${criPct.toFixed(0)}%分位)`);
          }
        }

        if (slopeLvl >= 3) {
          sellSignals.push(`趋势下压·强 (${slopePct.toFixed(0)}分)`);
        } else if (slopeLvl >= 2) {
          sellSignals.push(`趋势下压·中 (${slopePct.toFixed(0)}分)`);
        }

        if (hasPVTTopDivergence) {
          if (isADXWeakening) {
            sellSignals.push('⚠️ 价量顶背离：ADX回落，建议减仓');
          } else {
            sellSignals.push('⚠️ 价量顶背离：价格与量能背离，建议减仓');
          }
        }
        if (hasPVTBottomDivergence && !isPriceHighFixed) {
          const panicRelieved = criState !== 'panic' || (criValue !== null && criValue < 60);
          const adxRising = adxState === 'rising';
          if (panicRelieved && adxRising) {
            buySignals.push('✅ 价量底背离：ADX上升，可左侧试探');
          } else if (panicRelieved) {
            buySignals.push('✅ 价量底背离：恐慌解除，关注反弹');
          }
        }

        const isCRIExtremeHigh = criPct !== null && criPct >= 95;
        const isCRIHigh = criPct !== null && criPct >= 80;
        const isRealPanic = criState === 'panic' && criValue !== null && criValue >= 70;
        const isNormalState = criState !== 'panic' || (criValue !== null && criValue < 70);

        if (isRealPanic && slopeLvl >= 2) {
          sellSignals.push('恐慌+下压：建议清仓');
        } else if (isRealPanic && volState === 'extreme-shrink') {
          buySignals.push('恐慌·缩量：可能洗盘，观望');
        } else if (slopeLvl >= 2 && volState === 'expand') {
          sellSignals.push('下压·放量：下跌趋势确认');
        } else if (isNormalState && slopeLvl === 0 && volState === 'shrink' && !isPriceHighFixed) {
          buySignals.push('正常·无压·缩量：关注反弹');
        } else if (isNormalState && slopeLvl === 0 && volState === 'shrink' && isPriceHighFixed) {
          if (trendStrength === 'strong_bull' || trendStrength === 'bull') {
            sellSignals.push('高位钝化·缩量：趋势中回调，追高谨慎');
          } else {
            sellSignals.push('高位超买·缩量：警惕回调风险');
          }
        }

        if ((trendStrength === 'strong_bull' || trendStrength === 'bull') &&
            lastIndicator.ma20 !== null && lastIndicator.ma60 !== null) {
          const close = lastIndicator.close;
          const ma20 = lastIndicator.ma20;
          const ma60 = lastIndicator.ma60;
          const nearMA20 = close >= ma20 * 0.98 && close <= ma20 * 1.02;
          const nearMA60 = close >= ma60 * 0.98 && close <= ma60 * 1.02;
          const criNotExtreme = criPct !== null && criPct < 70;
          const volumeShrinking = volState === 'extreme-shrink' || volState === 'shrink';
          if ((nearMA20 || nearMA60) && criNotExtreme && volumeShrinking) {
            const maLabel = nearMA20 ? 'MA20' : 'MA60';
            buySignals.push(`趋势回调·${maLabel}支撑 (BIAS:${bias225Pct?.toFixed(0)}%分位) - 关注买入`);
          }
        }

        if (isHighBiasWithStrongTrend) {
          const trendLabel = isStrongTrend ? '强趋势' : '多头';
          const adxLabel = adx !== null ? `ADX:${adx.toFixed(0)}` : '';
          sellSignals.push(`高位钝化·${trendLabel} (${adxLabel}) - 追高谨慎`);
        }

        if (isPriceExtremeOverbought) {
          const thresholdLabel = extremeOverboughtThreshold === 99 ? '99%' : '95%';
          sellSignals.push(`极端超买·${thresholdLabel}阈值 (BIAS:${bias225Pct?.toFixed(0)}%·成本:${costDevPct?.toFixed(0)}%) - 建议减仓`);
        } else if (isPriceOverbought) {
          const thresholdLabel = overboughtThreshold === 95 ? '95%' : (overboughtThreshold === 87 ? '87%' : '80%');
          sellSignals.push(`高位超买·${thresholdLabel}阈值 (BIAS:${bias225Pct?.toFixed(0)}%·成本:${costDevPct?.toFixed(0)}%) - 注意风险`);
        }

        if (isCRIExtremeHigh) {
          sellSignals.push(`CRI极端高位 (${criPct?.toFixed(0)}%分位)`);
        } else if (isCRIHigh) {
          sellSignals.push(`CRI高位 (${criPct?.toFixed(0)}%分位)`);
        }

        type MarketState = 'panic' | 'trend_down' | 'overbought' | 'normal';
        let marketState: MarketState = 'normal';
        let stateTitle = '';
        let stateColor = '';
        let stateDesc = '';

        const hasSlopePressure = slopeLvl >= 2;
        const adxRising = adxState === 'rising';
        const adxFalling = adxState === 'falling';
        const isDualExtremeHigh = (bias225Pct !== null && bias225Pct >= 90) &&
                                  (costDevPct !== null && costDevPct >= 90);
        const isSingleExtremeHigh = (bias225Pct !== null && bias225Pct >= 95) ||
                                    (costDevPct !== null && costDevPct >= 95);
        const isHistoricalExtreme = (bias225Pct !== null && bias225Pct >= 99) ||
                                    (costDevPct !== null && costDevPct >= 99);

        if ((criValue !== null && criValue >= 80) || isCRIExtremeHigh) {
          marketState = 'panic';
          stateTitle = '恐慌状态';
          stateColor = '#FF3435';
          stateDesc = 'CRI极端风险，情绪极度悲观，暂停左侧交易，等待风险释放';
        } else if (isHistoricalExtreme) {
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
        } else if (hasSlopePressure) {
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
        } else if (hasPVTTopDivergence && adxFalling) {
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
        } else if (isStrongTrend && adxRising) {
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
        } else if (hasPVTBottomDivergence && adxRising) {
          marketState = 'normal';
          stateTitle = '底背离·ADX上升';
          stateColor = '#03B172';
          stateDesc = 'PVT底背离+ADX上升，反弹动能增强，可左侧试探';
        } else if (hasPVTBottomDivergence) {
          marketState = 'normal';
          stateTitle = '底背离·观察';
          stateColor = '#58A6FF';
          stateDesc = 'PVT底背离，关注反弹机会';
        } else if (isPriceExtremeOverbought) {
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
        } else {
          marketState = 'normal';
          stateTitle = '震荡整理';
          stateColor = '#8B949E';
          stateDesc = 'ADX弱趋势，震荡行情，区间操作或观望';
        }

        let displayBuySignals = [...buySignals];
        let displaySellSignals = [...sellSignals];

        if (marketState === 'panic') {
          if (displayBuySignals.length > 0) {
            displayBuySignals = displayBuySignals.map(s => `⚠️ ${s}`);
            displayBuySignals.unshift('【左侧信号暂停】');
          }
        } else if (marketState === 'trend_down') {
          if (displayBuySignals.length > 0) {
            displayBuySignals = displayBuySignals.map(s => `△ ${s}`);
            displayBuySignals.unshift('【等待趋势企稳】');
          }
        } else if (marketState === 'overbought') {
          if (displayBuySignals.length > 0) {
            displayBuySignals = displayBuySignals.map(s => `❌ ${s}`);
            displayBuySignals.unshift('【高位超买，机会信号关闭】');
          }
        }

        return (
          <section key={tf} className={`bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden ${tf === 'daily' ? 'lg:col-span-2' : ''}`}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#30363D] bg-[#0D1117]">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${config.color}20` }}>
                <Icon className="w-4 h-4" style={{ color: config.color }} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-white text-sm">{config.label}</h3>
              </div>
              {tf === 'daily' && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSignalVersion(prev => prev === 'strict' ? 'loose' : 'strict')}
                    className={`text-xs font-medium transition-colors ${
                      signalVersion === 'strict' ? 'text-[#58A6FF]' : 'text-[#E3B341]'
                    }`}
                  >
                    {signalVersion === 'strict' ? '低频BS' : '高频BS'}
                  </button>
                  <div className="w-px h-3 bg-[#30363D]" />
                  <div className="flex items-center gap-1.5">
                    <Switch id="mahs-daily" checked={showMAHS} onCheckedChange={setShowMAHS} className="data-[state=checked]:bg-[#FF3435] scale-75" />
                    <Label htmlFor="mahs-daily" className="text-[10px] text-[#8B949E] cursor-pointer">MAHS</Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Switch id="emahs-daily" checked={showEMAHS} onCheckedChange={setShowEMAHS} className="data-[state=checked]:bg-[#03B172] scale-75" />
                    <Label htmlFor="emahs-daily" className="text-[10px] text-[#8B949E] cursor-pointer">EMAHS</Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Switch id="ma-daily" checked={showMA} onCheckedChange={setShowMA} className="data-[state=checked]:bg-[#58A6FF] scale-75" />
                    <Label htmlFor="ma-daily" className="text-[10px] text-[#8B949E] cursor-pointer">MA</Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Switch id="vol-daily" checked={showVolumeTrend} onCheckedChange={setShowVolumeTrend} className="data-[state=checked]:bg-[#8B949E] scale-75" />
                    <Label htmlFor="vol-daily" className="text-[10px] text-[#8B949E] cursor-pointer">量</Label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Switch id="obv-daily" checked={showOBV} onCheckedChange={setShowOBV} className="data-[state=checked]:bg-[#6B7B8E] scale-75" />
                    <Label htmlFor="obv-daily" className="text-[10px] text-[#8B949E] cursor-pointer">OBV</Label>
                  </div>
                </div>
              )}
              <div className="text-xs text-[#8B949E]">
                <span className="text-white font-mono">{tfData.data.length}</span> 条数据
                {tf === 'daily' && (
                  <span className="ml-2">DD: <span className="text-[#D2A8FF] font-mono">{lastIndicator?.dd?.toFixed(0) || '-'}</span></span>
                )}
              </div>
            </div>

            <div className={tf === 'daily' ? 'grid grid-cols-1 lg:grid-cols-4 gap-0' : 'grid grid-cols-1 gap-0'}>
              <div className={tf === 'daily' ? 'lg:col-span-3 p-4' : 'p-4'}>
                <div className={tf === 'daily' ? 'h-[600px]' : 'h-[380px]'}>
                  <StockChart
                    stockData={tfData.data}
                    indicators={tfData.indicators}
                    showMAHS={tf === 'daily' && showMAHS}
                    showEMAHS={tf === 'daily' && showEMAHS}
                    showMA={showMA}
                    showVolumeTrend={showVolumeTrend}
                    showOBV={showOBV}
                    title=""
                    compact={tf !== 'daily'}
                    timeframe={tf}
                    version={signalVersion}
                  />
                </div>
              </div>

              <div className={tf === 'daily' ? 'lg:col-span-1 p-3 space-y-2 border-l border-[#30363D] bg-[#0D1117] overflow-y-auto max-h-[600px]' : 'p-3 space-y-2 border-t border-[#30363D] bg-[#0D1117] min-h-[120px]'}>
                {tf === 'daily' && (
                  <div className="space-y-2">
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

                    <div className="p-2 bg-[#161B22] rounded-lg border border-[#30363D]">
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
                      <div className="border-t border-[#30363D] my-1" />
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

                    <div className="p-2 bg-[#161B22] rounded-lg border border-[#30363D]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-medium text-[#8B949E]">趋势强度综合</span>
                        <span className="text-[10px] font-medium">
                          {(() => {
                            const adx = lastIndicator?.adx || 0;
                            const adxState = lastIndicator?.adxState;
                            const pvtDiv = lastIndicator?.pvtDivergence;
                            const slopeLevel = lastIndicator?.slopeLevel || 0;
                            const bias225 = lastIndicator?.bias225 ?? 0;
                            let baseTrend = '';
                            if (adx >= 40) baseTrend = 'strong';
                            else if (adx >= 20) baseTrend = 'medium';
                            else baseTrend = 'weak';
                            const isPriceAboveMA225 = bias225 > 0;
                            const isPriceBelowMA225 = bias225 < -5;
                            const hasTopDivergence = pvtDiv === 'top';
                            const hasSlopePressureStrong = slopeLevel >= 2;
                            const hasSlopePressureWeak = slopeLevel >= 1;
                            const adxWeakening = adxState === 'falling';
                            const adxRising = adxState === 'rising';
                            const hasBottomDivergence = pvtDiv === 'bottom';

                            if (baseTrend === 'strong' && !hasTopDivergence && !hasSlopePressureWeak && isPriceAboveMA225) {
                              return <span className="text-[#03B172]">🔥 强多头</span>;
                            }
                            if (baseTrend === 'strong' && isPriceBelowMA225) {
                              return <span className="text-[#FF3435]">🔥 强空头</span>;
                            }
                            if (baseTrend === 'strong' && !hasTopDivergence && hasSlopePressureWeak && isPriceAboveMA225) {
                              return <span className="text-[#58A6FF]">强多头·斜率弱压</span>;
                            }
                            if (baseTrend === 'medium' && adxRising && !hasSlopePressureWeak && !hasTopDivergence && isPriceAboveMA225) {
                              return <span className="text-[#58A6FF]">📈 多头形成</span>;
                            }
                            if (baseTrend === 'medium' && isPriceBelowMA225) {
                              return <span className="text-[#FF3435]">📉 空头形成</span>;
                            }
                            if (baseTrend === 'medium' && hasSlopePressureWeak && !hasTopDivergence && isPriceAboveMA225) {
                              return <span className="text-[#E3B341]">多头·斜率弱压</span>;
                            }
                            if (baseTrend === 'medium' && !hasSlopePressureWeak && !hasTopDivergence && isPriceAboveMA225) {
                              return <span className="text-[#E3B341]">📊 多头震荡</span>;
                            }
                            if (baseTrend === 'medium' && !isPriceAboveMA225 && !isPriceBelowMA225) {
                              return <span className="text-[#8B949E]">趋势不明</span>;
                            }
                            if (baseTrend === 'strong' && hasTopDivergence && isPriceAboveMA225) {
                              return <span className="text-[#E3B341]">⚠️ 强转弱风险</span>;
                            }
                            if (baseTrend === 'medium' && hasTopDivergence && isPriceAboveMA225) {
                              return <span className="text-[#FF3435]">⚠️ 顶背离风险</span>;
                            }
                            if (hasTopDivergence && adxWeakening && isPriceAboveMA225) {
                              return <span className="text-[#FF3435]">🚨 趋势反转</span>;
                            }
                            if (hasBottomDivergence && adxRising && isPriceBelowMA225) {
                              return <span className="text-[#03B172]">✅ 底背离机会</span>;
                            }
                            if (hasBottomDivergence && baseTrend !== 'weak' && isPriceBelowMA225) {
                              return <span className="text-[#58A6FF]">📊 底背离观察</span>;
                            }
                            if (hasSlopePressureStrong && isPriceAboveMA225) {
                              return <span className="text-[#E3B341]">📉 斜率压制</span>;
                            }
                            if (adxWeakening && baseTrend === 'medium' && isPriceAboveMA225) {
                              return <span className="text-[#E3B341]">📉 趋势减弱</span>;
                            }
                            if (adxWeakening && baseTrend === 'medium' && isPriceBelowMA225) {
                              return <span className="text-[#8B949E]">📉 空头减弱</span>;
                            }
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

                      <div className="space-y-1.5 mb-2">
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
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="text-[#8B949E]">PVT量价(20日):</span>
                          {lastIndicator?.pvtDivergence === 'top' ? (
                            <span className="text-[#FF3435]">⚠️ 顶背离</span>
                          ) : lastIndicator?.pvtDivergence === 'bottom' ? (
                            (lastIndicator?.bias225 !== null && lastIndicator!.bias225! > 10) ? (
                              <span className="text-[#E3B341]">⚠️ 高位回调</span>
                            ) : (
                              <span className="text-[#03B172]">✅ 底背离</span>
                            )
                          ) : (
                            <span className="text-[#8B949E]">无背离</span>
                          )}
                        </div>
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

                <div className="mt-3 grid grid-cols-2 gap-2">
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
  );
}
