/**
 * RROS 研究决策 API 封装
 * 通过 peistock api-server 代理到 Python 后端
 */

import { getAuthHeaders } from './auth';

const API_BASE = import.meta.env.VITE_RESEARCH_API_BASE || '/api/research';

async function fetchJSON(path: string, options?: RequestInit) {
  const authHeaders = getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    headers: {
      ...authHeaders,
      ...(options?.headers || {}),
    },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** 提交分析任务，返回 task_id */
export async function submitAnalysisJob(code: string, signal: string = 'B') {
  return fetchJSON(`/analyze/stock/${code}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signal }),
  });
}

/** 轮询查询任务状态 */
export async function getTaskStatus(taskId: string) {
  return fetchJSON(`/tasks/${taskId}`);
}

/** 最近决策列表 */
export async function getRecentDecisions(days: number = 7) {
  return fetchJSON(`/decisions/recent?days=${days}`);
}

/** 最新异常信号 */
export async function getLatestSignals() {
  return fetchJSON(`/signals/latest`);
}

/** 活跃观点（衰减后 >30%） */
export async function getActiveMemory() {
  return fetchJSON(`/memory/active`);
}

/** 角色列表 */
export async function getRoles() {
  return fetchJSON(`/roles`);
}

/** 通过名称/拼音搜索股票代码（走后端代理，绕过 CORS） */
export async function searchStock(keyword: string): Promise<{ code: string | null; name: string | null; market: string | null; error?: string }> {
  return fetchJSON(`/search/stock?q=${encodeURIComponent(keyword)}`);
}

export interface DecisionItem {
  file: string;
  code: string;
  name: string;
  decision: string;
  conviction: number;
  date: string;
}

export interface SignalItem {
  type: string;
  severity: string;
  trigger_value: number;
  note: string;
}

export interface ClaimItem {
  claim_id: string;
  type: string;
  content: string;
  confidence: number;
  age_days: number;
}

export interface ReportHistoryItem {
  date: string;
  decision: string;
  conviction: number;
  price: number | null;
  change_pct: number | null;
  reports: {
    bull: { summary: string; full: string };
    bear: { summary: string; full: string };
    preemption: { summary: string; full: string };
    chair_debate: { summary: string; full: string };
  };
}

export interface ReportHistoryResponse {
  code: string;
  count: number;
  history: ReportHistoryItem[];
}

/** 查询个股历史 AI 分析报告 */
export async function getReportHistory(code: string): Promise<ReportHistoryResponse> {
  return fetchJSON(`/stock/${code}/report-history?_t=${Date.now()}`);
}

/** 全局回测统计 */
export async function getBacktestSummary() {
  return fetchJSON(`/backtest/summary`);
}

/** 单股票回测统计 */
export async function getBacktestStock(code: string) {
  return fetchJSON(`/backtest/stock/${code}`);
}

export interface SignalBacktestItem {
  date: string;
  price: number;
  signal_type: 'B' | 'S';
  signal_label: string;
  max_gain: number;
  max_drawdown: number;
  profit_loss_ratio: number;
}

export interface SignalBacktestMatch {
  date: string;
  price: number;
  bias225_pct: number;
  cost_dev_pct: number;
  distance: number;
  max_gain: number;
  max_drawdown: number;
  profit_loss_ratio: number;
}

export interface SignalBacktestData {
  code: string;
  current_price: number;
  latest_date: string;
  latest_bias225_pct: number;
  latest_cost_dev_pct: number;
  signals: SignalBacktestItem[];
  current_match: SignalBacktestMatch | null;
}

export interface SignalBacktestResponse {
  status: string;
  code: string;
  data: SignalBacktestData | null;
  message?: string;
}

/** 信号级回测：逐日 B/S 信号持有统计 + 当前条件最相似历史日期回测 */
export async function getSignalBacktest(code: string): Promise<SignalBacktestResponse> {
  return fetchJSON(`/backtest/signals/${code}?_t=${Date.now()}`);
}

/** 估值分析报告列表（按股票代码分组） */
export async function getAnalysisList() {
  return fetchJSON('/analysis/list?_t=' + Date.now());
}

/** 某股票的估值分析报告内容 */
export async function getAnalysisByCode(code: string, type?: string) {
  const q = type ? `?type=${encodeURIComponent(type)}&_t=${Date.now()}` : `?_t=${Date.now()}`;
  return fetchJSON(`/analysis/${code}${q}`);
}

/** 获取后端股票池（需登录） */
export async function fetchWatchlist() {
  return fetchJSON('/watchlist');
}

/** 保存股票池到后端（需登录） */
export async function saveWatchlist(stocks: any[], categories: string[]) {
  return fetchJSON('/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stocks, categories }),
  });
}

export interface AnalysisReportItem {
  filename: string;
  type: string;
  updated_at: string;
  size: number;
}

export interface AnalysisReport {
  filename: string;
  type: string;
  title: string;
  updated_at: string;
  content: string;
  content_type: 'html' | 'markdown';
}

export interface AnalysisByCodeResponse {
  code: string;
  reports: AnalysisReport[];
  count: number;
}

/** 股息率响应 */
export interface DividendYieldResponse {
  code: string;
  name: string;
  price: number;
  yield_rate: number | null;
  bonus_per_share: number;
  recent_count: number;
  error?: string;
}

/** 获取股息率（最近一年累计现金分红 / 当前股价） */
export async function getDividendYield(code: string): Promise<DividendYieldResponse> {
  return fetchJSON(`/dividend/${code}`);
}

// ---------------------------------------------------------------------------
// ETF 资金流向
// ---------------------------------------------------------------------------

import type { ETFMarketFlowData, ETFSectorFlowData, ETFListItem, ETFFundFlowDetailItem } from '@/types';

export interface ETFMarketFlowResponse {
  status: string;
  data: ETFMarketFlowData;
  message?: string;
}

export interface ETFSectorFlowResponse {
  status: string;
  data: ETFSectorFlowData;
  message?: string;
}

export interface ETFListResponse {
  status: string;
  data: ETFListItem[];
  message?: string;
}

/** 全市场 ETF 净流入趋势 */
export async function getETFMarketFlow(days: number = 30): Promise<ETFMarketFlowResponse> {
  return fetchJSON(`/etf/fund-flow/market?days=${days}`);
}

/** ETF 板块资金轮动 */
export async function getETFSectorFlow(days: number = 7): Promise<ETFSectorFlowResponse> {
  return fetchJSON(`/etf/fund-flow/sector?days=${days}`);
}

/** 热门 ETF 列表 */
export async function getETFList(): Promise<ETFListResponse> {
  return fetchJSON('/etf/list');
}

/** ETF 单只多窗口资金流向明细 */
export interface ETFFundFlowDetailResponse {
  status: string;
  data: ETFFundFlowDetailItem[];
  message?: string;
}

export async function getETFFundFlowDetail(sector: string = ''): Promise<ETFFundFlowDetailResponse> {
  const q = sector ? `?sector=${encodeURIComponent(sector)}` : '';
  return fetchJSON(`/etf/fund-flow/detail${q}`);
}
