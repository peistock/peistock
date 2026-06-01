import { useState } from 'react';
import { ChevronDown, ChevronUp, Star, X, Plus, Loader2 } from 'lucide-react';
import type { StockItem } from '@/data/watchlist';
import {
  getWatchlistGroups, removeFromStockPool, toggleStar, addToStockPool,
  updateCategory, getCategories, addCategory, removeCategory,
} from '@/data/watchlist';
import { getQuote } from '@/utils/eastmoneyApi';
import { searchStock } from '@/utils/researchApi';

interface StockPoolProps {
  pool: StockItem[];
  onPoolChange: () => void;
  onSelect: (code: string) => void;
}

export default function StockPool({ pool, onPoolChange, onSelect }: StockPoolProps) {
  const [expanded, setExpanded] = useState(true);
  const [activeGroup, setActiveGroup] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('其他');
  const [newStar, setNewStar] = useState(false);
  const [addError, setAddError] = useState('');
  const [nameLoading, setNameLoading] = useState(false);
  const [categories, setCategories] = useState<string[]>(() => getCategories());
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState('');

  const groups = getWatchlistGroups(pool);
  const total = pool.length;
  const group = groups[activeGroup] || { label: '其他', stocks: [] };

  const refreshCategories = () => setCategories(getCategories());

  const handleAddCategory = () => {
    setCategoryError('');
    if (!newCategoryName.trim()) return;
    if (addCategory(newCategoryName.trim())) {
      setNewCategoryName('');
      setShowAddCategory(false);
      refreshCategories();
    } else {
      setCategoryError('分类已存在或名称无效');
    }
  };

  const handleRemoveCategory = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (removeCategory(name)) {
      refreshCategories();
      if (groups[activeGroup]?.label === name) {
        setActiveGroup(0);
      }
    }
  };

  const handleDelete = (code: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (removeFromStockPool(code)) {
      onPoolChange();
    }
  };

  const handleToggleStar = (code: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (toggleStar(code)) {
      onPoolChange();
    }
  };

  const lookupName = async (input: string) => {
    if (!input.trim()) return;
    setNameLoading(true);
    setAddError('');
    try {
      let code = input.trim();

      // 名称/拼音搜索：非纯数字代码格式时先解析代码
      const looksLikeCode = /^\d{4,6}$/.test(code);
      if (!looksLikeCode) {
        const resp = await searchStock(code);
        if (resp.code) {
          code = resp.code;
          setNewCode(code);
        } else {
          setAddError('未找到该股票，请检查名称');
          setNameLoading(false);
          return;
        }
      }

      const q = await getQuote(code);
      if (q?.name) {
        setNewName(q.name);
        setNewCode(q.symbol);
      }
    } catch {
      setAddError('未找到该股票，请检查代码');
    } finally {
      setNameLoading(false);
    }
  };

  const handleAdd = () => {
    setAddError('');
    const code = newCode.trim();
    if (!code) {
      setAddError('请输入股票代码');
      return;
    }
    const name = newName.trim() || code;
    const market = /^\d{5}$/.test(code) ? 'HK' : /^[A-Za-z]+$/.test(code) ? 'US' : 'SH';
    const ok = addToStockPool({ code, name, market, category: newCategory, star: newStar });
    if (!ok) {
      setAddError('该股票已在池中');
      return;
    }
    setNewCode('');
    setNewName('');
    setNewStar(false);
    setShowAdd(false);
    onPoolChange();
  };

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
        <div className="flex items-center gap-2">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); setShowAdd(!showAdd); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setShowAdd(!showAdd); }}}
            className="flex items-center gap-1 text-xs text-[#8B949E] hover:text-[#03B172] transition-colors px-2 py-1 rounded hover:bg-[#0D1117] cursor-pointer"
            title="添加股票"
          >
            <Plus className="w-3.5 h-3.5" />
            添加
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-[#8B949E]" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[#8B949E]" />
          )}
        </div>
      </button>

      {/* 添加股票弹窗 */}
      {showAdd && (
        <div className="px-4 py-3 border-t border-[#30363D] bg-[#0D1117]/50">
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 items-center">
              <input
                type="text"
                placeholder="输入代码或名称，如 600989 / 茅台"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                onBlur={() => lookupName(newCode)}
                onKeyDown={(e) => { if (e.key === 'Enter') lookupName(newCode); }}
                className="flex-1 min-w-0 bg-[#161B22] border border-[#30363D] rounded px-2.5 py-1.5 text-xs text-[#C9D1D9] placeholder:text-[#8B949E] focus:border-[#FF3435] focus:outline-none"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="bg-[#161B22] border border-[#30363D] rounded px-2 py-1.5 text-xs text-[#C9D1D9] focus:border-[#FF3435] focus:outline-none"
              >
                {categories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 min-h-[18px]">
              {nameLoading ? (
                <div className="flex items-center gap-1 text-[11px] text-[#8B949E]">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  查询中...
                </div>
              ) : newName ? (
                <div className="text-[11px] text-[#03B172]">
                  识别到：{newName}
                </div>
              ) : null}
              {addError && !nameLoading && (
                <div className="text-[11px] text-[#FF3435]">{addError}</div>
              )}
            </div>

            <div className="flex gap-2 items-center">
              <button
                onClick={handleAdd}
                disabled={nameLoading}
                className="px-3 py-1 rounded text-xs bg-[#03B172]/20 text-[#03B172] hover:bg-[#03B172]/30 transition-colors disabled:opacity-50"
              >
                确认添加
              </button>
              <button
                onClick={() => { setShowAdd(false); setAddError(''); setNewName(''); setNewStar(false); }}
                className="px-3 py-1 rounded text-xs text-[#8B949E] hover:text-[#C9D1D9] hover:bg-[#161B22] transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => setNewStar(v => !v)}
                className="ml-auto flex items-center gap-1 text-[11px] text-[#8B949E] hover:text-[#E3B341] transition-colors"
                title={newStar ? '取消关注' : '添加时关注'}
              >
                <Star className={`w-3 h-3 ${newStar ? 'text-[#E3B341] fill-[#E3B341]' : 'text-[#8B949E]'}`} />
                {newStar ? '已关注' : '关注'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 展开内容 */}
      {expanded && (
        <div className="border-t border-[#30363D]">
          {total === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[#8B949E]">
              暂无股票，请点击右上角「添加」或搜索股票后加入
            </div>
          ) : (
            <>
              {/* Tab 页签 */}
              <div className="flex gap-1 px-3 py-2 overflow-x-auto scrollbar-hide items-center">
                {groups.map((g, i) => (
                  <button
                    key={g.label}
                    onClick={() => setActiveGroup(i)}
                    className={`relative flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-md transition-colors group/tab ${
                      i === activeGroup
                        ? 'bg-[#FF3435]/20 text-[#FF3435] border border-[#FF3435]/30'
                        : 'text-[#8B949E] hover:text-[#C9D1D9] hover:bg-[#0D1117] border border-transparent'
                    }`}
                  >
                    {g.label}
                    <span className="ml-1 text-[10px] opacity-60">({g.stocks.length})</span>
                    {/* 空分类可删除 */}
                    {g.stocks.length === 0 && (
                      <span
                        onClick={(e) => handleRemoveCategory(g.label, e)}
                        className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#FF3435] text-white flex items-center justify-center opacity-0 group-hover/tab:opacity-100 transition-opacity cursor-pointer z-10"
                        title="删除空分类"
                      >
                        <X className="w-2 h-2" />
                      </span>
                    )}
                  </button>
                ))}

                {/* 添加分类 */}
                {showAddCategory ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input
                      type="text"
                      placeholder="新分类"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }}
                      className="w-20 bg-[#161B22] border border-[#30363D] rounded px-2 py-1 text-[11px] text-[#C9D1D9] placeholder:text-[#8B949E] focus:border-[#FF3435] focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={handleAddCategory}
                      className="text-[11px] text-[#03B172] hover:text-[#03B172]/80 px-1"
                    >
                      添加
                    </button>
                    <button
                      onClick={() => { setShowAddCategory(false); setCategoryError(''); setNewCategoryName(''); }}
                      className="text-[11px] text-[#8B949E] hover:text-[#C9D1D9] px-1"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddCategory(true)}
                    className="flex-shrink-0 px-2 py-1.5 text-xs text-[#8B949E] hover:text-[#03B172] hover:bg-[#0D1117] rounded-md transition-colors border border-transparent"
                    title="添加分类"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
                {categoryError && (
                  <span className="text-[11px] text-[#FF3435] flex-shrink-0">{categoryError}</span>
                )}
              </div>

              {/* 股票列表 */}
              <div className="px-3 pb-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
                  {group.stocks.map((stock) => (
                    <button
                      key={stock.code}
                      onClick={() => onSelect(stock.code)}
                      className="relative flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-[#0D1117] border border-[#30363D]/50 hover:border-[#FF3435]/50 hover:bg-[#0D1117]/80 transition-all text-left group"
                      title={stock.name}
                    >
                      {/* 删除按钮 */}
                      <span
                        onClick={(e) => handleDelete(stock.code, e)}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#FF3435] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10"
                        title="删除"
                      >
                        <X className="w-2.5 h-2.5" />
                      </span>

                      {/* Star 切换 */}
                      <span
                        onClick={(e) => handleToggleStar(stock.code, e)}
                        className="cursor-pointer flex-shrink-0"
                        title={stock.star ? '取消关注' : '关注'}
                      >
                        <Star className={`w-3 h-3 ${stock.star ? 'text-[#E3B341] fill-[#E3B341]' : 'text-[#8B949E] hover:text-[#E3B341]'}`} />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div
                          className="text-xs font-mono font-medium text-[#C9D1D9] group-hover:text-white truncate"
                          style={{ fontFamily: 'JetBrains Mono' }}
                        >
                          {stock.code}
                        </div>
                        <div className="text-[10px] text-[#8B949E] group-hover:text-[#C9D1D9] truncate">
                          {stock.name}
                        </div>
                        {/* 分类切换 */}
                        <select
                          value={stock.category || '其他'}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            updateCategory(stock.code, e.target.value);
                            onPoolChange();
                          }}
                          className="mt-0.5 w-full bg-transparent text-[9px] text-[#8B949E] focus:text-[#C9D1D9] focus:outline-none cursor-pointer hover:text-[#C9D1D9]"
                          title="点击修改行业"
                        >
                          {categories.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
