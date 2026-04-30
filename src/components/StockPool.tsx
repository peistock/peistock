import { useState } from 'react';
import { ChevronDown, ChevronUp, Star } from 'lucide-react';
import { WATCHLIST_GROUPS } from '@/data/watchlist';

interface StockPoolProps {
  onSelect: (code: string) => void;
}

export default function StockPool({ onSelect }: StockPoolProps) {
  const [expanded, setExpanded] = useState(true);
  const [activeGroup, setActiveGroup] = useState(0);

  const total = WATCHLIST_GROUPS.reduce((sum, g) => sum + g.stocks.length, 0);
  const group = WATCHLIST_GROUPS[activeGroup];

  return (
    <div className="rounded-xl border border-[#30363D] bg-[#161B22] overflow-hidden">
      {/* 标题栏 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#0D1117]/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">股票池</span>
          <span className="text-xs text-[#8B949E]">({total}只)</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-[#8B949E]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#8B949E]" />
        )}
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="border-t border-[#30363D]">
          {/* Tab 页签 - 横向滚动 */}
          <div className="flex gap-1 px-3 py-2 overflow-x-auto scrollbar-hide">
            {WATCHLIST_GROUPS.map((g, i) => (
              <button
                key={g.label}
                onClick={() => setActiveGroup(i)}
                className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  i === activeGroup
                    ? 'bg-[#FF3435]/20 text-[#FF3435] border border-[#FF3435]/30'
                    : 'text-[#8B949E] hover:text-[#C9D1D9] hover:bg-[#0D1117] border border-transparent'
                }`}
              >
                {g.label}
                <span className="ml-1 text-[10px] opacity-60">({g.stocks.length})</span>
              </button>
            ))}
          </div>

          {/* 股票列表 */}
          <div className="px-3 pb-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
              {group.stocks.map((stock) => (
                <button
                  key={stock.code}
                  onClick={() => onSelect(stock.code)}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-[#0D1117] border border-[#30363D]/50 hover:border-[#FF3435]/50 hover:bg-[#0D1117]/80 transition-all text-left group"
                  title={stock.name}
                >
                  {stock.star && (
                    <Star className="w-3 h-3 text-[#E3B341] fill-[#E3B341] flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div
                      className="text-xs font-mono font-medium text-[#C9D1D9] group-hover:text-white truncate"
                      style={{ fontFamily: 'JetBrains Mono' }}
                    >
                      {stock.code}
                    </div>
                    <div className="text-[10px] text-[#8B949E] group-hover:text-[#C9D1D9] truncate">
                      {stock.name}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
