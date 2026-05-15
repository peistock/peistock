/**
 * RROS 研究决策 API 封装
 * 通过 peistock api-server 代理到 Python 后端
 */

const API_BASE = import.meta.env.VITE_RESEARCH_API_BASE || '/api/research';

async function fetchJSON(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** 个股分析：触发 Bull/Bear/Chair 链 */
export async function analyzeStock(code: string, signal: string = 'B') {
  return fetchJSON(`/analyze/stock/${code}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signal }),
  });
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
