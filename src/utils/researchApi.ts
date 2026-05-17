/**
 * RROS 研究决策 API 封装
 * 通过 peistock api-server 代理到 Python 后端
 */

const API_BASE = import.meta.env.VITE_RESEARCH_API_BASE || '/api/research';

async function fetchJSON(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
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
<<<<<<< HEAD
    bull: { summary: string; full: string };
    bear: { summary: string; full: string };
    preemption: { summary: string; full: string };
    chair_debate: { summary: string; full: string };
=======
    bull: string;
    bear: string;
    preemption: string;
    chair_debate: string;
>>>>>>> origin/main
  };
}

export interface ReportHistoryResponse {
  code: string;
  count: number;
  history: ReportHistoryItem[];
}

/** 查询个股历史 AI 分析报告 */
export async function getReportHistory(code: string): Promise<ReportHistoryResponse> {
<<<<<<< HEAD
  return fetchJSON(`/stock/${code}/report-history?_t=${Date.now()}`);
}

/** 全局回测统计 */
export async function getBacktestSummary() {
  return fetchJSON(`/backtest/summary`);
}

/** 单股票回测统计 */
export async function getBacktestStock(code: string) {
  return fetchJSON(`/backtest/stock/${code}`);
=======
  return fetchJSON(`/stock/${code}/report-history`);
>>>>>>> origin/main
}
