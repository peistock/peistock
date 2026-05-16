import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Search, TrendingUp, TrendingDown, Database, Clock, Star, BarChart2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
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
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  // AI 分析
  aiDecision?: {
    decision: string;
    conviction: number;
    date: string;
  } | null;
  onAnalyze?: () => void;
  analyzing?: boolean;
  analyzeProgress?: string;
  aiReport?: string | null;
  showReport?: boolean;
  onToggleReport?: () => void;
  // 额外内容（如股票池），放在最近搜索和股票信息卡片之间
  extra?: React.ReactNode;
}

// 最近搜索存储键
const RECENT_SEARCHES_KEY = 'peter_stock_recent_searches';
const MAX_RECENT = 10;

interface RecentSearch {
  symbol: string;
  name: string;
  timestamp: number;
}

const StockSearch = ({
  onSearch, loading, stockInfo, isFavorite, onToggleFavorite,
  aiDecision, onAnalyze, analyzing, analyzeProgress, aiReport, showReport, onToggleReport, extra,
}: StockSearchProps) => {
  const [symbol, setSymbol] = useState('');
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [currentCard, setCurrentCard] = useState(0);

  // 报告按 ## 标题拆分为卡片
  const sections = useMemo(() => {
    if (!aiReport) return [];
    const matches = [...aiReport.matchAll(/^## .+$/gm)];
    if (matches.length === 0) return [{ title: '报告', content: aiReport }];
    return matches.map((m, i) => {
      const start = m.index!;
      const end = i < matches.length - 1 ? matches[i + 1].index! : aiReport.length;
      const content = aiReport.slice(start, end).trim();
      const titleMatch = content.match(/^## (.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : '未命名';
      return { title, content };
    });
  }, [aiReport]);

  // 新报告载入时重置到第一张卡片
  useEffect(() => {
    setCurrentCard(0);
  }, [aiReport]);

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

      {/* 额外内容（股票池等） */}
      {extra}

      {/* Stock info + AI 决策 */}
      {stockInfo && (
        <div className="flex items-center gap-6 p-4 bg-[#161B22] rounded-xl border border-[#30363D]">
          <div>
            <div className="text-2xl font-bold text-white" style={{ fontFamily: 'JetBrains Mono' }}>
              {stockInfo.symbol}
            </div>
            <div className="text-sm text-[#8B949E]">{stockInfo.name} · {stockInfo.market}</div>
          </div>
          <div className="flex-1" />

          {/* AI 决策摘要 */}
          {aiDecision ? (
            <div className="flex items-center gap-3 px-4 py-2 rounded-lg border" style={{
              borderColor: aiDecision.decision === 'long' ? '#03B17240' : aiDecision.decision === 'short' ? '#FF343540' : '#6B728040',
              backgroundColor: aiDecision.decision === 'long' ? '#03B17210' : aiDecision.decision === 'short' ? '#FF343510' : '#6B728010',
            }}>
              <div className="text-right">
                <div className="text-xs text-[#8B949E]">AI 决策</div>
                <div className={`text-sm font-bold ${
                  aiDecision.decision === 'long' ? 'text-[#03B172]' :
                  aiDecision.decision === 'short' ? 'text-[#FF3435]' :
                  'text-[#6B7280]'
                }`}>
                  {aiDecision.decision === 'long' ? '🔼 做多' :
                   aiDecision.decision === 'short' ? '🔽 做空' : '➖ 观望'}
                </div>
              </div>
              <div className="w-px h-6 bg-[#30363D]" />
              <div className="text-right">
                <div className="text-xs text-[#8B949E]">置信度</div>
                <div className="text-sm font-bold text-[#D2A8FF]" style={{ fontFamily: 'JetBrains Mono' }}>
                  {aiDecision.conviction}%
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={onAnalyze}
              disabled={analyzing}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-[#FF3435]/10 border border-[#FF3435]/30 rounded-lg text-[#FF3435] hover:bg-[#FF3435]/20 transition-colors disabled:opacity-50"
            >
              {analyzing ? (
                <div className="w-4 h-4 border-2 border-[#FF3435]/30 border-t-[#FF3435] rounded-full animate-spin" />
              ) : (
                <BarChart2 className="w-4 h-4" />
              )}
              {analyzing ? (analyzeProgress || '分析中...') : 'AI 分析'}
            </button>
          )}

          <div className="w-px h-8 bg-[#30363D]" />

          {/* 收藏按钮 */}
          {onToggleFavorite && (
            <button
              onClick={onToggleFavorite}
              className="p-2 rounded-lg border border-[#30363D] hover:border-[#E3B341] transition-colors"
              title={isFavorite ? '取消收藏' : '添加收藏'}
            >
              <Star
                className={`w-5 h-5 ${isFavorite ? 'fill-[#E3B341] text-[#E3B341]' : 'text-[#8B949E]'}`}
              />
            </button>
          )}

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

      {/* AI 分析报告 */}
      {aiReport && stockInfo && (
        <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
          <button
            onClick={onToggleReport}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-[#8B949E] hover:text-white hover:bg-[#0D1117] transition-colors"
          >
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-[#FF3435]" />
              <span>AI 投研报告（{aiDecision?.date}）</span>
              {aiDecision && (
                <span className={`text-xs px-2 py-0.5 rounded ${
                  aiDecision.decision === 'long' ? 'bg-[#03B172]/20 text-[#03B172]' :
                  aiDecision.decision === 'short' ? 'bg-[#FF3435]/20 text-[#FF3435]' :
                  'bg-[#6B7280]/20 text-[#6B7280]'
                }`}>
                  {aiDecision.decision === 'long' ? '做多' :
                   aiDecision.decision === 'short' ? '做空' : '观望'}
                  {aiDecision.conviction > 0 && ` · ${aiDecision.conviction}%`}
                </span>
              )}
            </div>
            {showReport ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
          {showReport && (
            <div className="px-4 py-3 border-t border-[#30363D]">
              {/* 卡片轮播 */}
              <div className="relative">
                {/* 左右箭头 */}
                <button
                  onClick={() => setCurrentCard(prev => Math.max(0, prev - 1))}
                  disabled={currentCard === 0}
                  className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-white hover:border-[#FF3435] transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCurrentCard(prev => Math.min(sections.length - 1, prev + 1))}
                  disabled={currentCard === sections.length - 1}
                  className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-white hover:border-[#FF3435] transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                {/* 卡片内容区 */}
                <div className="overflow-hidden mx-6">
                  <div
                    className="flex transition-transform duration-300 ease-out"
                    style={{ transform: `translateX(-${currentCard * 100}%)` }}
                  >
                    {sections.map((section, i) => (
                      <div key={i} className="w-full flex-shrink-0 min-h-[200px] max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                        <div className="max-w-none">
                          <ReactMarkdown
                            components={{
                              h1: ({ children }) => <h3 className="text-[15px] font-bold text-white mt-2 mb-2 border-b border-[#30363D] pb-1">{children}</h3>,
                              h2: ({ children }) => <h4 className="text-[13px] font-bold text-[#C9D1D9] mt-3 mb-1.5">{children}</h4>,
                              h3: ({ children }) => <h5 className="text-[13px] font-semibold text-[#8B949E] mt-2 mb-1">{children}</h5>,
                              p: ({ children }) => <p className="text-[13px] text-[#C9D1D9] leading-relaxed mb-2">{children}</p>,
                              ul: ({ children }) => <ul className="list-disc list-inside text-[13px] text-[#C9D1D9] mb-2 space-y-0.5">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal list-inside text-[13px] text-[#C9D1D9] mb-2 space-y-0.5">{children}</ol>,
                              li: ({ children }) => <li className="text-[13px] text-[#C9D1D9]">{children}</li>,
                              strong: ({ children }) => <strong className="text-[#E3B341] font-semibold">{children}</strong>,
                              em: ({ children }) => <em className="text-[#D2A8FF]">{children}</em>,
                              code: ({ children }) => <code className="bg-[#0D1117] px-1 py-0.5 rounded text-[12px] text-[#FF3435] font-mono">{children}</code>,
                              pre: ({ children }) => <pre className="bg-[#0D1117] p-2 rounded-lg overflow-x-auto text-[12px] text-[#C9D1D9] font-mono mb-2">{children}</pre>,
                              blockquote: ({ children }) => <blockquote className="border-l-2 border-[#FF3435] pl-3 py-1 my-2 bg-[#0D1117]/50 text-[13px] text-[#8B949E] italic">{children}</blockquote>,
                              table: ({ children }) => <table className="w-full text-[12px] text-[#C9D1D9] border border-[#30363D] mb-2">{children}</table>,
                              thead: ({ children }) => <thead className="bg-[#0D1117] text-[#8B949E] text-[11px]">{children}</thead>,
                              tbody: ({ children }) => <tbody>{children}</tbody>,
                              tr: ({ children }) => <tr className="border-b border-[#30363D]">{children}</tr>,
                              th: ({ children }) => <th className="px-2 py-1 text-left font-medium border-r border-[#30363D] last:border-r-0">{children}</th>,
                              td: ({ children }) => <td className="px-2 py-1 border-r border-[#30363D] last:border-r-0">{children}</td>,
                              hr: () => <hr className="border-[#30363D] my-3" />,
                            }}
                          >
                            {section.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 底部章节指示器 */}
              <div className="mt-3 flex items-center justify-center gap-1">
                {sections.map((section, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentCard(i)}
                    className={`h-1.5 rounded-full transition-all duration-200 ${
                      i === currentCard ? 'w-6 bg-[#FF3435]' : 'w-1.5 bg-[#30363D] hover:bg-[#8B949E]'
                    }`}
                    title={section.title}
                  />
                ))}
              </div>

              {/* 章节标题 + 页码 */}
              <div className="mt-2 text-center">
                <div className="text-xs text-[#8B949E]">
                  {currentCard + 1} / {sections.length}
                </div>
                <div className="text-[11px] text-[#8B949E] mt-0.5 truncate px-8">
                  {sections[currentCard]?.title}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StockSearch;
