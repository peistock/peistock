import { useState, useCallback, useEffect } from 'react';
import { calculateAllIndicators } from '../utils/indicators';
import { getMultiTimeframeData, getQuote, formatSymbol, getMarketName } from '../utils/eastmoneyApi';
import { getMultiTimeframeData as getTencentMultiData, getQuote as getTencentQuote } from '../utils/tencentApi';
import { searchStock } from '../utils/researchApi';
import type { StockData, IndicatorData } from '../types';

type TimeframeType = 'daily' | 'weekly' | 'min15';

interface TimeframeData {
  data: StockData[];
  indicators: IndicatorData[];
}

interface StockInfo {
  symbol: string;
  name: string;
  market: string;
  price: number;
  change: number;
  changePercent: number;
  capital: number;
}

export function useStockData() {
  const [timeframeData, setTimeframeData] = useState<Record<TimeframeType, TimeframeData | null>>({
    daily: null,
    weekly: null,
    min15: null,
  });
  const [, setCurrentSymbol] = useState<string>('');
  const [stockInfo, setStockInfo] = useState<StockInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiSource, setApiSource] = useState<string>('');
  const [dataSource, setDataSource] = useState<'auto' | 'eastmoney' | 'tencent'>('tencent');
  const [showDataSourceDropdown, setShowDataSourceDropdown] = useState(false);

  // 点击外部关闭数据源下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-datasource-dropdown]')) {
        setShowDataSourceDropdown(false);
      }
    };
    if (showDataSourceDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showDataSourceDropdown]);

  const handleSearch = useCallback(async (input: string) => {
    let symbol = formatSymbol(input);
    const looksLikeCode = /^\d{4,6}$/.test(symbol);
    if (!looksLikeCode) {
      const resp = await searchStock(input.trim());
      if (resp.code) {
        symbol = resp.code;
      } else {
        setError(`未找到与 "${input.trim()}" 匹配的股票，请检查名称或代码`);
        return;
      }
    }

    setLoading(true);
    setError(null);
    setCurrentSymbol(symbol);

    try {
      let multiData: any, quote: any;
      let source = '';

      if (dataSource === 'eastmoney') {
        [multiData, quote] = await Promise.all([
          getMultiTimeframeData(symbol),
          getQuote(symbol),
        ]);
        source = '东方财富数据';
      } else if (dataSource === 'tencent') {
        [multiData, quote] = await Promise.all([
          getTencentMultiData(symbol),
          getTencentQuote(symbol),
        ]);
        source = '腾讯财经';
      } else {
        try {
          [multiData, quote] = await Promise.all([
            getMultiTimeframeData(symbol),
            getQuote(symbol),
          ]);
          source = '东方财富数据';
        } catch (eastmoneyErr: any) {
          [multiData, quote] = await Promise.all([
            getTencentMultiData(symbol),
            getTencentQuote(symbol),
          ]);
          source = '腾讯财经(自动切换)';
        }
      }

      const capital = quote.capital;
      const capitalUnit: 'shares' | 'ten_thousand_shares' = 'shares';

      setTimeframeData({
        daily: { data: multiData.daily, indicators: calculateAllIndicators(multiData.daily, capital, capitalUnit) },
        weekly: { data: multiData.weekly, indicators: calculateAllIndicators(multiData.weekly, capital, capitalUnit) },
        min15: { data: multiData.min15, indicators: calculateAllIndicators(multiData.min15, capital, capitalUnit) },
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
      setApiSource(source);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('Load failed') || msg.includes('fetch') || msg.includes('network') || msg.includes('Failed')) {
        setError(`数据源访问失败。这可能是由于：\n1. 浏览器安全限制（CORS）\n2. API暂时不可用\n3. 网络连接问题\n\n请尝试：\n• 刷新页面后重试\n• 更换浏览器（推荐Chrome/Edge）\n• 检查网络连接\n\n技术详情：${msg.slice(0, 100)}`);
      } else {
        setError(err.message || '获取数据失败，请检查股票代码是否正确');
      }
    } finally {
      setLoading(false);
    }
  }, [dataSource]);

  const clearError = useCallback(() => setError(null), []);

  return {
    timeframeData,
    stockInfo,
    loading,
    error,
    apiSource,
    dataSource,
    setDataSource,
    showDataSourceDropdown,
    setShowDataSourceDropdown,
    handleSearch,
    clearError,
  };
}
