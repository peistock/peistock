/**
 * 账号系统（简单账号密码，由管理员在 config/accounts.json 配置）
 * - 账号密码存 localStorage（纯前端，不加密，信任环境）
 * - 所有请求自动带 X-Account / X-Password header
 * - 未登录时 watchlist 走 localStorage，登录后同步到后端
 */

const AUTH_KEY = 'rros_auth';

interface AuthState {
  account: string;
  password: string;
}

export function getAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
}

export function setAuth(account: string, password: string) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ account, password }));
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

export function isLoggedIn(): boolean {
  return !!getAuth();
}

export function getAuthHeaders(): Record<string, string> {
  const auth = getAuth();
  if (!auth) return {};
  return {
    'X-Account': auth.account,
    'X-Password': auth.password,
  };
}
