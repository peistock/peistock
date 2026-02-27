import { useState, useEffect } from 'react';
import { Search, TrendingUp, TrendingDown, Database, Clock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { formatCapital } from '@/utils/indicators';

interface StockSearchProps {
  onSearch: (symbol: string) => void;
  loading: boolean;
  stockInfo: {
    symbol: string;
    name: string;
    market: string;
    price: number;
    change: number;
    changePercent: number;
    capital: number;
  } | null;
}

// 最近搜索存储键
const RECENT_SEARCHES_KEY = 'peter_stock_recent_searches';
const MAX_RECENT = 10;

interface RecentSearch {
  symbol: string;
  name: string;
  timestamp: number;
}

const StockSearch = ({ onSearch, loading, stockInfo }: StockSearchProps) => {
  const [symbol, setSymbol] = useState('');
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);

  // 从 localStorage 加载最近搜索
  useEffect(() => {
    const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setRecentSearches(parsed);
      } catch {
        // 忽略解析错误
      }
    }
  }, []);

  // 保存搜索记录
  const saveSearch = (symbol: string, name: string) => {
    const newSearch: RecentSearch = {
      symbol,
      name,
      timestamp: Date.now(),
    };
    
    setRecentSearches(prev => {
      // 去重并添加到开头
      const filtered = prev.filter(item => item.symbol !== symbol);
      const updated = [newSearch, ...filtered].slice(0, MAX_RECENT);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (symbol.trim()) {
      onSearch(symbol.trim());
    }
  };

  // 当 stockInfo 更新时，保存到最近搜索
  useEffect(() => {
    if (stockInfo) {
      saveSearch(stockInfo.symbol, stockInfo.name);
    }
  }, [stockInfo?.symbol]);

  const handleRecentClick = (item: RecentSearch) => {
    setSymbol(item.symbol);
    onSearch(item.symbol);
  };

  const clearRecent = () => {
    setRecentSearches([]);
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8B949E]" />
          <Input
            type="text"
            placeholder="输入股票代码或名称 (如: 600519, 茅台, 00700...)"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="pl-10 h-12 bg-[#161B22] border-[#30363D] text-white placeholder:text-[#8B949E] focus:border-[#FF3435] focus:ring-[#FF3435]/20"
            style={{ fontFamily: 'JetBrains Mono' }}
          />
        </div>
        <Button
          type="submit"
          disabled={loading || !symbol.trim()}
          className="h-12 px-6 bg-[#FF3435] hover:bg-[#E62E2F] text-white disabled:opacity-50"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            '查询'
          )}
        </Button>
      </form>

      {/* Recent searches */}
      {recentSearches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-sm text-[#8B949E] py-1">
            <Clock className="w-3.5 h-3.5" />
            最近:
          </div>
          {recentSearches.map((item) => (
            <button
              key={item.symbol}
              onClick={() => handleRecentClick(item)}
              className="px-3 py-1 text-sm bg-[#161B22] border border-[#30363D] rounded-lg text-[#C9D1D9] hover:border-[#FF3435] hover:text-[#FF3435] transition-colors"
              style={{ fontFamily: 'JetBrains Mono' }}
              title={item.name}
            >
              {item.symbol}
            </button>
          ))}
          <button
            onClick={clearRecent}
            className="text-xs text-[#8B949E] hover:text-white ml-2"
          >
            清除
          </button>
        </div>
      )}

      {/* Stock info */}
      {stockInfo && (
        <div className="flex items-center gap-6 p-4 bg-[#161B22] rounded-xl border border-[#30363D]">
          <div>
            <div className="text-2xl font-bold text-white" style={{ fontFamily: 'JetBrains Mono' }}>
              {stockInfo.symbol}
            </div>
            <div className="text-sm text-[#8B949E]">{stockInfo.name} · {stockInfo.market}</div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-6">
            {/* 流通股本 */}
            <div className="text-right">
              <div className="flex items-center gap-1 text-sm text-[#8B949E]">
                <Database className="w-3 h-3" />
                流通股本
              </div>
              <div className="text-lg font-bold text-[#D2A8FF]" style={{ fontFamily: 'JetBrains Mono' }}>
                {formatCapital(stockInfo.capital)}
              </div>
            </div>
            {/* 价格 */}
            <div className="text-right">
              <div className="text-3xl font-bold text-white" style={{ fontFamily: 'JetBrains Mono' }}>
                ¥{stockInfo.price.toFixed(2)}
              </div>
              <div className={`flex items-center gap-1 text-sm ${stockInfo.change >= 0 ? 'text-[#FF3435]' : 'text-[#03B172]'}`}>
                {stockInfo.change >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                <span style={{ fontFamily: 'JetBrains Mono' }}>
                  {stockInfo.change >= 0 ? '+' : ''}{stockInfo.change.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StockSearch;
