/**
 * peistock HTTP API Server
 * 供 family-mind 等外部系统调用
 *
 * 启动: npx tsx scripts/api-server.ts
 * 端口: 默认 3457（可通过 PORT 环境变量修改）
 */

import http from 'http';
import url from 'url';
import path from 'path';
import fs from 'fs';
import XLSX from 'xlsx';

import { getMultiTimeframeData, getQuote } from '../src/utils/tencentApi';
import { calculateAllIndicators } from '../src/utils/indicators';
import { detectSignals } from '../src/utils/signals';
import { getUniqueWatchlist } from '../src/data/watchlist';
import { getStockCapital } from '../src/utils/stockCapital';

const PORT = parseInt(process.env.PORT || '3457');

// CORS headers
const setCORS = (res: http.ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

const sendJSON = (res: http.ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

// ========== 单股查询 ==========
async function handleStockQuery(code: string) {
  const cleanCode = code.replace(/[^0-9a-zA-Z]/g, '');
  if (!cleanCode) {
    return { error: '股票代码不能为空' };
  }

  try {
    const [multiData, quote] = await Promise.all([
      getMultiTimeframeData(cleanCode),
      getQuote(cleanCode),
    ]);

    const capital = quote.capital || getStockCapital(cleanCode);
    const indicators = calculateAllIndicators(multiData.daily, capital, 'shares');

    if (indicators.length === 0) {
      return { error: '无指标数据' };
    }

    const current = indicators[indicators.length - 1];
    const prev = indicators.length >= 2 ? indicators[indicators.length - 2] : undefined;
    const prev2 = indicators.length >= 3 ? indicators[indicators.length - 3] : undefined;

    const recentDays = 10;
    const recentDivergences = indicators.slice(-recentDays).map(i => i.pvtDivergence);
    const recentCRI = indicators.slice(-recentDays).map(i => i.cri);
    const recentCostDev = indicators.slice(-recentDays).map(i => i.costDeviationPercentile);

    const strictResult = detectSignals({
      costDeviationPercentile: current.costDeviationPercentile,
      bias225Percentile: current.bias225Percentile,
      cri: current.cri,
      greedyPercentile: current.greedyPercentile,
      pvtDivergence: current.pvtDivergence,
      recentDivergences,
      recentCRI,
      recentCostDev,
      plusDI: current.plusDI,
      minusDI: current.minusDI,
      prevPlusDI: prev?.plusDI ?? null,
      prevMinusDI: prev?.minusDI ?? null,
      nextPlusDI: current.plusDI ?? null,
      nextMinusDI: current.minusDI ?? null,
    }, true);

    return {
      code: cleanCode,
      name: quote.name,
      price: quote.price,
      changePercent: quote.changePercent,
      market: cleanCode.length === 5 ? 'HK' : cleanCode.startsWith('6') ? 'SH' : 'SZ',
      date: multiData.daily[multiData.daily.length - 1]?.date,
      indicators: {
        cri: current.cri,
        criPercentile: current.criPercentile,
        greedy: current.greedy,
        greedyPercentile: current.greedyPercentile,
        bias225Percentile: current.bias225Percentile,
        costDeviationPercentile: current.costDeviationPercentile,
        mahs: current.mahs,
        emahs: current.emahs,
      },
      signals: {
        strict: strictResult.signals,
        signalType: strictResult.signalType,
      },
    };
  } catch (err: any) {
    return { error: err.message || '查询失败' };
  }
}

// ========== 最新信号 ==========
function handleLatestSignals() {
  const resultsDir = path.join(process.cwd(), 'daily-results');
  if (!fs.existsSync(resultsDir)) {
    return { error: '结果目录不存在' };
  }

  const files = fs.readdirSync(resultsDir)
    .filter(f => f.startsWith('signals_') && f.endsWith('.xlsx'))
    .sort()
    .reverse();

  if (files.length === 0) {
    return { error: '暂无扫描结果' };
  }

  const latestFile = path.join(resultsDir, files[0]);
  const workbook = XLSX.readFile(latestFile);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

  // 第一行是表头，跳过
  const records = data.slice(1).map(row => ({
    code: row[0],
    name: row[1],
    market: row[2],
    date: row[3],
    close: row[4],
    state: row[5],
    signals: row[6],
    type: row[7],
    bias225: row[8],
    costDev: row[9],
    cri: row[10],
    criPercentile: row[11],
    greedy: row[12],
    greedyPercentile: row[13],
    star: row[14],
  }));

  return {
    date: files[0].replace('signals_', '').replace('.xlsx', ''),
    count: records.length,
    signals: records,
  };
}

// ========== 股票池 ==========
function handleWatchlist() {
  return {
    count: getUniqueWatchlist().length,
    stocks: getUniqueWatchlist(),
  };
}

// ========== 批量扫描 ==========
async function handleScan(codes: string[]) {
  const results = [];
  for (const code of codes.slice(0, 10)) { // 限制10只，避免超时
    const result = await handleStockQuery(code);
    results.push(result);
  }
  return { count: results.length, results };
}

// ========== RROS 研究决策代理 ==========
async function proxyToRROS(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  const rrosPath = pathname.replace(/^\/api\/research/, '');
  const rrosUrl = `http://localhost:8000${rrosPath}${req.url?.includes('?') ? '?' + req.url.split('?')[1] : ''}`;

  return new Promise<void>((resolve, reject) => {
    const options = new URL(rrosUrl);
    const proxyReq = http.request(
      {
        hostname: options.hostname,
        port: options.port,
        path: options.pathname + options.search,
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'application/json' });
        proxyRes.pipe(res);
        proxyRes.on('end', resolve);
      }
    );
    proxyReq.on('error', (err) => {
      sendJSON(res, 502, { error: 'RROS backend unavailable', detail: err.message });
      resolve();
    });
    req.pipe(proxyReq);
  });
}

// ========== Server ==========
const server = http.createServer(async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = url.parse(req.url || '', true);
  const pathname = parsed.pathname || '';

  try {
    // RROS 研究决策代理 /api/research/* -> localhost:8000
    if (pathname.startsWith('/api/research/')) {
      await proxyToRROS(req, res, pathname);
      return;
    }

    // GET /api/stock/:code
    const stockMatch = pathname.match(/^\/api\/stock\/(.+)$/);
    if (stockMatch && req.method === 'GET') {
      const result = await handleStockQuery(stockMatch[1]);
      if ('error' in result) {
        sendJSON(res, 400, result);
      } else {
        sendJSON(res, 200, result);
      }
      return;
    }

    // GET /api/signals/latest
    if (pathname === '/api/signals/latest' && req.method === 'GET') {
      sendJSON(res, 200, handleLatestSignals());
      return;
    }

    // GET /api/watchlist
    if (pathname === '/api/watchlist' && req.method === 'GET') {
      sendJSON(res, 200, handleWatchlist());
      return;
    }

    // POST /api/scan
    if (pathname === '/api/scan' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const json = JSON.parse(body);
          const result = await handleScan(json.codes || []);
          sendJSON(res, 200, result);
        } catch {
          sendJSON(res, 400, { error: 'JSON解析失败' });
        }
      });
      return;
    }

    // Health check
    if (pathname === '/health') {
      sendJSON(res, 200, { status: 'ok', service: 'peistock-api' });
      return;
    }

    sendJSON(res, 404, { error: '接口不存在' });
  } catch (err: any) {
    sendJSON(res, 500, { error: err.message || '服务器错误' });
  }
});

server.listen(PORT, () => {
  console.log(`🚀 peistock API server running on http://localhost:${PORT}`);
  console.log(`  GET  /api/stock/:code       — 单股查询+信号检测`);
  console.log(`  GET  /api/signals/latest    — 最新扫描结果`);
  console.log(`  GET  /api/watchlist         — 股票池列表`);
  console.log(`  POST /api/scan              — 批量扫描（限10只）`);
  console.log(`  GET  /health                — 健康检查`);
  console.log(`  ── RROS 研究决策代理 (localhost:8000) ──`);
  console.log(`  POST /api/research/analyze/stock/:code  — 个股Bull/Bear分析`);
  console.log(`  GET  /api/research/decisions/recent     — 最近决策列表`);
  console.log(`  GET  /api/research/signals/latest       — 最新异常信号`);
  console.log(`  GET  /api/research/memory/active        — 活跃观点`);
  console.log(`  GET  /api/research/roles                — 角色列表`);
});
