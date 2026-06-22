import { useState, useCallback, useEffect } from 'react';
import { AlertCircle, BookOpen, Code2, X, Database, ChevronDown, ChevronUp, Loader2, History, BarChart2, User, LogOut, BookMarked, Timer } from 'lucide-react';
import StockSearch from './components/StockSearch';
import StockPool from './components/StockPool';

import HelpDialog from './components/HelpDialog';
import StockChartsSection from './components/StockChartsSection';
import { useStockData } from './hooks/useStockData';
import { useAnalysisJob } from './hooks/useAnalysisJob';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getReportHistory } from './utils/researchApi';
import ReportHistory from './components/ReportHistory';
import BacktestPanel from './components/BacktestPanel';
import SignalBacktestPanel from './components/SignalBacktestPanel';
import ValuationReportPanel from './components/ValuationReportPanel';
import CompanyHistoryPanel from './components/CompanyHistoryPanel';
import ETFFundFlowPanel from './components/ETFFundFlowPanel';
import type { ReportHistoryItem } from './utils/researchApi';
import type { StockItem } from './data/watchlist';
import { getStockPool, addToStockPool, migrateLegacyFavorites, loadWatchlistFromBackend } from './data/watchlist';
import { getAuth, setAuth, clearAuth, isLoggedIn } from './utils/auth';

function App() {
  const stockData = useStockData();
  const analysisJob = useAnalysisJob(stockData.stockInfo?.symbol, stockData.stockInfo?.name);

  // 历史观点对比
  const [showHistory, setShowHistory] = useState(false);
  const [historyData, setHistoryData] = useState<ReportHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // AI研究面板 Tab: 'ai' | 'valuation' | 'history'
  const [researchTab, setResearchTab] = useState<'ai' | 'valuation' | 'history'>('ai');

  // 股票池（localStorage 持久化）
  const [stockPool, setStockPool] = useState<StockItem[]>(() => {
    if (typeof window !== 'undefined') {
      migrateLegacyFavorites();
      return getStockPool();
    }
    return [];
  });

  // 账号系统
  const [authAccount, setAuthAccount] = useState<string>(getAuth()?.account || '');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginInput, setLoginInput] = useState({ account: '', password: '' });
  const [loginError, setLoginError] = useState('');

  const refreshPool = useCallback(() => {
    setStockPool(getStockPool());
  }, []);

  // 登录状态下，从后端同步股票池
  useEffect(() => {
    if (isLoggedIn()) {
      loadWatchlistFromBackend().then(() => {
        refreshPool();
      });
    }
  }, []);

  const handleLogin = async () => {
    setLoginError('');
    if (!loginInput.account.trim() || !loginInput.password.trim()) {
      setLoginError('请输入账号和密码');
      return;
    }
    setAuth(loginInput.account.trim(), loginInput.password.trim());
    try {
      const { fetchWatchlist } = await import('./utils/researchApi');
      await fetchWatchlist();
      setAuthAccount(loginInput.account.trim());
      setShowLoginModal(false);
      setLoginInput({ account: '', password: '' });
      await loadWatchlistFromBackend();
      refreshPool();
    } catch (e: any) {
      clearAuth();
      setLoginError(e.message?.includes('401') ? '账号或密码错误' : '登录失败，请检查后端服务');
    }
  };

  const handleLogout = () => {
    clearAuth();
    setAuthAccount('');
    refreshPool();
  };

  const inPool = stockData.stockInfo ? stockPool.some(s => s.code === stockData.stockInfo!.symbol) : false;

  const handleTogglePool = useCallback(() => {
    if (!stockData.stockInfo || inPool) return;
    addToStockPool({
      code: stockData.stockInfo.symbol,
      name: stockData.stockInfo.name,
      market: stockData.stockInfo.market === '港股' ? 'HK' : stockData.stockInfo.market === '美股' ? 'US' : 'SH',
      category: '其他',
    });
    refreshPool();
  }, [stockData.stockInfo, inPool, refreshPool]);

  // 包装搜索：同时隐藏报告面板并清除分析错误
  const handleSearch = useCallback(async (input: string) => {
    analysisJob.setShowReport(false);
    analysisJob.clearAnalyzeError();
    await stockData.handleSearch(input);
  }, [analysisJob, stockData]);

  // 包装分析：同时清除数据错误
  const handleAnalyze = useCallback(async () => {
    stockData.clearError();
    await analysisJob.handleAnalyze();
  }, [stockData, analysisJob]);

  // 加载历史观点对比数据
  const loadHistory = useCallback(async () => {
    if (!stockData.stockInfo) return;
    setHistoryData([]);
    setHistoryLoading(true);
    try {
      const resp = await getReportHistory(stockData.stockInfo.symbol);
      setHistoryData(resp.history || []);
    } catch (e: any) {
      console.error('加载历史报告失败', e);
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [stockData.stockInfo]);

  // 切换股票时清空历史数据，避免显示旧股票的分析记录
  useEffect(() => {
    if (stockData.stockInfo) {
      setHistoryData([]);
      setShowHistory(false);
    }
  }, [stockData.stockInfo?.symbol]);

  // 组合错误显示
  const displayError = stockData.error || analysisJob.analyzeError;

  // 检查是否有数据
  const hasData = stockData.timeframeData.daily && stockData.timeframeData.weekly && stockData.timeframeData.min15;

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
                  {stockData.apiSource || '东方财富/新浪数据'} · 联系: 84160034@qq.com
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* 数据源选择器 */}
              <div className="relative" data-datasource-dropdown>
                <button
                  onClick={() => stockData.setShowDataSourceDropdown(!stockData.showDataSourceDropdown)}
                  className="flex items-center gap-1 text-sm text-[#8B949E] hover:text-white transition-colors"
                >
                  <Database className="w-4 h-4" />
                  {stockData.dataSource ==='auto' ? '自动' : stockData.dataSource ==='eastmoney' ? '东方财富' : '腾讯'}
                  <ChevronDown className="w-3 h-3" />
                </button>

                {stockData.showDataSourceDropdown && (
                  <div className="absolute right-0 top-full mt-2 w-40 bg-[#161B22] border border-[#30363D] rounded-lg shadow-xl z-50">
                    <div className="p-2">
                      <button
                        onClick={() => { stockData.setDataSource('auto'); stockData.setShowDataSourceDropdown(false); }}
                        className={`w-full text-left px-3 py-2 text-sm rounded ${stockData.dataSource ==='auto' ? 'bg-[#FF3435]/20 text-white' : 'text-[#8B949E] hover:bg-[#0D1117]'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span>自动切换</span>
                          {stockData.dataSource ==='auto' && <span className="text-[#FF3435]">●</span>}
                        </div>
                        <div className="text-xs text-[#8B949E] mt-0.5">东方财富优先</div>
                      </button>
                      <button
                        onClick={() => { stockData.setDataSource('eastmoney'); stockData.setShowDataSourceDropdown(false); }}
                        className={`w-full text-left px-3 py-2 text-sm rounded mt-1 ${stockData.dataSource ==='eastmoney' ? 'bg-[#FF3435]/20 text-white' : 'text-[#8B949E] hover:bg-[#0D1117]'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span>东方财富</span>
                          {stockData.dataSource ==='eastmoney' && <span className="text-[#FF3435]">●</span>}
                        </div>
                        <div className="text-xs text-[#8B949E] mt-0.5">A股数据较全</div>
                      </button>
                      <button
                        onClick={() => { stockData.setDataSource('tencent'); stockData.setShowDataSourceDropdown(false); }}
                        className={`w-full text-left px-3 py-2 text-sm rounded mt-1 ${stockData.dataSource ==='tencent' ? 'bg-[#FF3435]/20 text-white' : 'text-[#8B949E] hover:bg-[#0D1117]'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span>腾讯财经</span>
                          {stockData.dataSource ==='tencent' && <span className="text-[#FF3435]">●</span>}
                        </div>
                        <div className="text-xs text-[#8B949E] mt-0.5">港股数据较好</div>
                      </button>
                    </div>
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

              {/* 账号登录 */}
              {authAccount ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#8B949E]">
                    <User className="w-3.5 h-3.5 inline mr-1" />
                    {authAccount}
                  </span>
                  <button
                    onClick={handleLogout}
                    className="text-[#8B949E] hover:text-[#FF3435] transition-colors"
                    title="退出"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowLoginModal(true)}
                  className="flex items-center gap-1 text-sm text-[#8B949E] hover:text-white transition-colors"
                >
                  <User className="w-4 h-4" />
                  登录
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* 后台分析通知条 */}
      {Object.values(analysisJob.backgroundJobs).filter(job =>
        (job.status === 'running' || (job.status === 'completed' && !job.notified))
        && job.code !== stockData.stockInfo?.symbol
      ).length > 0 && (
        <div className="max-w-7xl mx-auto px-4 pt-3 space-y-2">
          {Object.values(analysisJob.backgroundJobs)
            .filter(job =>
              (job.status === 'running' || (job.status === 'completed' && !job.notified))
              && job.code !== stockData.stockInfo?.symbol
            )
            .map(job => (
              <div key={job.code} className={`px-3 py-2 rounded-lg border text-sm flex items-center justify-between ${
                job.status === 'running'
                  ? 'bg-[#1C2128] border-[#30363D] text-[#8B949E]'
                  : 'bg-[#03B172]/10 border-[#03B172]/30 text-[#03B172]'
              }`}>
                <div className="flex items-center gap-2">
                  {job.status === 'running' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <BarChart2 className="w-3.5 h-3.5" />
                  )}
                  <span>{job.name} ({job.code}) {job.status === 'running' ? job.progress || '分析中...' : '分析完成'}</span>
                </div>
                <div className="flex items-center gap-2">
                  {job.status === 'completed' && (
                    <button
                      onClick={() => {
                        handleSearch(job.code);
                        analysisJob.setShowReport(true);
                        analysisJob.setBackgroundJobs(prev => ({
                          ...prev,
                          [job.code]: { ...prev[job.code], notified: true },
                        }));
                      }}
                      className="text-xs px-2 py-1 rounded bg-[#03B172]/20 hover:bg-[#03B172]/30 text-[#03B172] transition-colors"
                    >
                      点击查看
                    </button>
                  )}
                  <button
                    onClick={() => {
                      analysisJob.setBackgroundJobs(prev => ({
                        ...prev,
                        [job.code]: { ...prev[job.code], notified: true },
                      }));
                    }}
                    className="text-[#8B949E] hover:text-white p-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Search Section */}
        <section className="mb-6">
          <StockSearch
            onSearch={handleSearch}
            loading={stockData.loading}
            stockInfo={stockData.stockInfo}
            inPool={inPool}
            onTogglePool={handleTogglePool}
            aiDecision={analysisJob.aiDecision}
            onAnalyze={handleAnalyze}
            analyzing={analysisJob.analyzing}
            analyzeProgress={analysisJob.analyzeProgress}
            aiReport={analysisJob.aiReport}
            showReport={analysisJob.showReport}
            onToggleReport={() => analysisJob.setShowReport(v => !v)}
            extra={<StockPool pool={stockPool} onPoolChange={refreshPool} onSelect={handleSearch} />}
          />
        </section>

        {/* AI 研究面板（AI分析 + 估值报告 Tab 切换） */}
        {stockData.stockInfo && (
          <section className="mb-6">
            <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
              <button
                onClick={() => {
                  const next = !showHistory;
                  setShowHistory(next);
                  if (next && historyData.length === 0) {
                    loadHistory();
                  }
                }}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-[#8B949E] hover:text-white hover:bg-[#0D1117] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-[#D2A8FF]" />
                  <span>AI 研究</span>
                  {historyData.length > 0 && (
                    <span className="text-xs text-[#8B949E]">
                      ({historyData.length} 次分析)
                    </span>
                  )}
                </div>
                {showHistory ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              {showHistory && (
                <div className="px-4 py-3 border-t border-[#30363D]">
                  {/* Tab 切换 */}
                  <div className="flex gap-1 mb-3 p-1 bg-[#0D1117] rounded-lg border border-[#30363D]/60 w-fit">
                    <button
                      onClick={() => setResearchTab('ai')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        researchTab === 'ai'
                          ? 'bg-[#30363D] text-white'
                          : 'text-[#8B949E] hover:text-white'
                      }`}
                    >
                      <BarChart2 className="w-3.5 h-3.5" />
                      AI 分析
                    </button>
                    <button
                      onClick={() => setResearchTab('valuation')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        researchTab === 'valuation'
                          ? 'bg-[#30363D] text-white'
                          : 'text-[#8B949E] hover:text-white'
                      }`}
                    >
                      <BookMarked className="w-3.5 h-3.5" />
                      估值报告
                    </button>
                    <button
                      onClick={() => setResearchTab('history')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        researchTab === 'history'
                          ? 'bg-[#30363D] text-white'
                          : 'text-[#8B949E] hover:text-white'
                      }`}
                    >
                      <Timer className="w-3.5 h-3.5" />
                      前世今生
                    </button>
                  </div>

                  {researchTab === 'ai' ? (
                    historyLoading ? (
                      <div className="flex items-center justify-center py-8 gap-2 text-[#8B949E] text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        加载历史数据中...
                      </div>
                    ) : (
                      <ReportHistory data={historyData} />
                    )
                  ) : researchTab === 'valuation' ? (
                    <ValuationReportPanel code={stockData.stockInfo.symbol} />
                  ) : (
                    <CompanyHistoryPanel code={stockData.stockInfo.symbol} />
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Error Alert */}
        {displayError && (
          <Alert className="mb-6 bg-[#FF3435]/10 border-[#FF3435]/30">
            <AlertCircle className="w-4 h-4 text-[#FF3435]" />
            <AlertDescription className="text-[#FF3435]">{displayError}</AlertDescription>
          </Alert>
        )}

        <StockChartsSection data={stockData.timeframeData} stockInfo={stockData.stockInfo} />

        {/* ETF 资金流向面板 */}
        {stockData.stockInfo && (
          <section className="mb-6">
            <ETFFundFlowPanel />
          </section>
        )}

        {/* Empty State */}
        {!hasData && !stockData.loading && (
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

        {/* 信号级回测看板 */}
        {stockData.stockInfo && (
          <section className="mb-6">
            <SignalBacktestPanel code={stockData.stockInfo.symbol} />
          </section>
        )}

        {/* AI 决策验证（回测闭环） */}
        {stockData.stockInfo && (
          <section className="mb-6">
            <BacktestPanel code={stockData.stockInfo.symbol} />
          </section>
        )}
      </main>

      {/* Footer */}
      {/* 登录弹窗 */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowLoginModal(false)}>
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">账号登录</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#8B949E] block mb-1">账号</label>
                <input
                  type="text"
                  value={loginInput.account}
                  onChange={e => setLoginInput(prev => ({ ...prev, account: e.target.value }))}
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58A6FF]"
                  placeholder="输入账号"
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                />
              </div>
              <div>
                <label className="text-xs text-[#8B949E] block mb-1">密码</label>
                <input
                  type="password"
                  value={loginInput.password}
                  onChange={e => setLoginInput(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full bg-[#0D1117] border border-[#30363D] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#58A6FF]"
                  placeholder="输入密码"
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                />
              </div>
              {loginError && (
                <p className="text-xs text-[#FF3435]">{loginError}</p>
              )}
              <button
                onClick={handleLogin}
                className="w-full py-2 rounded bg-[#58A6FF] hover:bg-[#58A6FF]/90 text-white text-sm font-medium transition-colors"
              >
                登录
              </button>
            </div>
          </div>
        </div>
      )}

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
                Peter趋势交易系统 - {stockData.apiSource || '东方财富/新浪数据'}
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
