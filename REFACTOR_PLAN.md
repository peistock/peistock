# RebelResearchOS 重构方案

> 本方案由代码审查产出，可直接交给 Claude Code 逐条执行。
> 执行原则：**最小侵入、逐个验收、每次改动后跑通 `python main.py` 和 `npm run build`**。

---

## P0 安全（优先执行）

### P0-1 收紧 FastAPI CORS，生产环境禁用通配符
**文件**：`api_server.py`
**现状**：
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)
```
**改造**：
- 读取环境变量 `CORS_ORIGINS`，默认只允许 `http://localhost:5173`（Vite dev）和 `http://localhost:3000`
- 生产环境通过 `.env` 注入具体域名（如 `https://peistock.win`）
- 保留 `"*"` 仅在 `DEBUG=true` 时生效

**验收**：
- `curl -H "Origin: https://evil.com" http://localhost:8000/health` 生产环境返回 403 或不含 CORS 头
- 前端 dev 模式仍能正常调用 API

---

### P0-2 账号密码哈希化，强制淘汰明文
**文件**：`api_server.py`、`config/accounts.json`
**现状**：`accounts.json` 存明文 `"peter": "password123"`，`require_account` 直接字符串比对。

**改造**：
1. 新增 `core/auth.py`，引入 `bcrypt`（或 `hashlib.pbkdf2_hmac` 若不想加依赖）
2. 提供 `hash_password()` / `verify_password()` 两个函数
3. `api_server.py` 加载账户时验证密码改为 `verify_password(x_password, hashed)`
4. 提供一次性迁移脚本 `scripts/migrate_passwords.py`，读取旧 `accounts.json`，输出 `accounts_hashed.json`，**执行后自动删除旧明文文件**
5. `api_server.py` 启动时检测：若发现 `config/accounts.json` 存在且内容包含明文格式（无 `$2b$` 前缀），**直接打印错误并 `sys.exit(1)`，拒绝启动**

**验收**：
- 明文 `accounts.json` 存在时服务拒绝启动，报错 `"检测到明文密码，请先运行 scripts/migrate_passwords.py"`
- 迁移脚本执行后旧文件被删除，新 `accounts_hashed.json` 生效
- 新注册/修改密码走哈希流程
- `require_account` 单元测试通过

> 安全改造不给"继续使用明文"留后门。兼容期 = 0。

---

### P0-3 部署脚本强制从环境变量读取 IP，不给默认值
**文件**：`deploy.sh`
**现状**：`HOST="root@36.151.144.153"` 写死在脚本里。

**改造**：
```bash
HOST="${DEPLOY_HOST}"
REMOTE_DIR="${REMOTE_DIR:-/opt/rebel_research}"

if [ -z "$HOST" ]; then
    echo "ERROR: DEPLOY_HOST 未设置。示例: DEPLOY_HOST=root@1.2.3.4 ./deploy.sh"
    exit 1
fi
```
- **不给默认值**，`DEPLOY_HOST` 未设置直接报错退出
- `REMOTE_DIR` 保留默认值（目录路径不敏感），但可覆盖
- 注释说明 `"JD Cloud 生产 IP 不应出现在版本控制中"`

**验收**：
- 直接运行 `./deploy.sh` 输出 `ERROR: DEPLOY_HOST 未设置` 并 exit 1
- `DEPLOY_HOST=user@1.2.3.4 ./deploy.sh` 能正确同步到新地址

> 保留 `"${DEPLOY_HOST:-...}"` 式的默认值只是"换了个地方藏"，真正的脱敏是强制外部注入。

---

## P1 性能 + 可靠性（高 ROI）

### P1-1 `get_stock_quote()` 去掉全市场 spot 扫描，优先走腾讯 API
**文件**：`core/data_layer.py`
**现状**：每次调用都执行 `stock_zh_a_spot_em()` 或 `stock_hk_spot_em()` 获取全市场数据再过滤，akshare 全量表很大。

**改造**：
- 调整逻辑顺序：先走 `_fetch_tencent_quote()`（已在代码里，只是当前作为 fallback）
- akshare spot 仅作为腾讯失败后的 fallback
- 同时修复腾讯 API 返回字段：确保 `capital` 字段正确映射

**关键代码变更**（`get_stock_quote` 方法）：
```python
def get_stock_quote(self, code: str) -> Dict:
    code = str(code)
    market = _market_of(code)
    # 1. 优先腾讯 API（快、轻量）
    tencent = self._fetch_tencent_quote(code)
    if tencent:
        return {"code": code, "name": tencent["name"], ...}
    # 2. fallback akshare
    ...
```

**验收**：
- 连续串行调用 `get_stock_quote("600519")` 100 次，总耗时从 >30s 降到 <5s
- 腾讯 API 失败时仍能正确 fallback

---

### P1-2 `calculate_dd()` O(n²) → O(n)，严格保持原始语义
**文件**：`core/indicators.py`
**现状**：每个交易日向前累加成交量直到 >= 流通股本，O(n²)。

**改造**：使用双指针/滑动窗口，**保持原始语义不变**：
```python
def calculate_dd(volumes: List[float], capital: float) -> List[int]:
    n = len(volumes)
    out = [0] * n
    cum = 0.0
    left = 0
    for right in range(n):
        cum += volumes[right]
        while cum >= capital and left <= right:
            out[right] = right - left + 1
            cum -= volumes[left]
            left += 1
        # 注意：这里不继承前一天的值
        # 若 cum 始终 < capital（如上市初期），out[right] 保持 0
    return out
```

**关键约束**：
- 双指针版本必须与 O(n²) 版本在 **所有边界场景** 结果一致
- 特别注意：上市初期累计成交量不足流通股本时，旧版和新版必须逐字节一致（通常是 `i+1` 或 `0`，取决于旧版实际行为）

**验收**：
- 300 天数据计算结果与旧版逐字节一致
- **上市前 30 天数据（累计成交量不足股本）边界测试通过**
- `timeit` 显示 1000 次调用耗时下降 90%+

> 原始伪代码里的 `out[right] = out[right-1]` 兜底逻辑改变了语义，已删除。

---

### P1-3 DataLayer 延迟初始化 + 单例化
**文件**：`core/data_layer.py`、`api_server.py`
**现状**：`DataLayer` 实例被频繁创建，每次请求都 new 一个。

**改造**：
- 在 `api_server.py` 把 `dl = DataLayer()` 做成模块级单例/依赖注入
- 类级别缓存 `_ak_class` / `_yf_class`，避免重复 import

**验收**：
- `api_server.py` 中 `DataLayer` 只初始化一次
- 并发 10 请求调用 `/api/stock/600519/quote`，内存不爆炸、总耗时 <3s

---

### P1-4 前端 API 代理层（可靠性改进）
**文件**：`src/utils/eastmoneyApi.ts`、`api_server.py`
**现状**：浏览器直接请求东方财富 API，无后端代理。东财有 CORS 限流和封 IP 风险。

**说明**：东方财富 K 线/搜索接口是**公开无 Key 接口**，不存在"API key 暴露在浏览器"的安全泄露问题。但可靠性风险确实存在，属于 **P1 可靠性** 而非 P0 安全。

**改造**：
- `api_server.py` 新增代理端点：`/api/proxy/klines?symbol=xxx&period=daily`
- 前端 `eastmoneyApi.ts` 改为优先请求后端代理，失败后再 fallback 直连东财
- 保留直连作为兜底，避免后端挂掉时前端完全不可用

**验收**：
- 前端通过 `/api/proxy/klines` 能正常拿到 K 线数据
- 后端代理挂掉时前端自动 fallback 直连东财

---

## P2 代码质量（逐步推进）

### P2-1 统一异常处理：禁止裸 `except Exception: pass`
**文件**：`core/data_layer.py`、`core/news_fetcher.py`、`core/financial_data.py` 等
**改造**：
- 所有 `except Exception: pass` 改为至少打印 warning：
  ```python
  except Exception as e:
      logger.warning(f"[data_layer] get_pmi failed: {e}")
      return None
  ```
- 若方法内有多个独立子调用（如 `get_a_market_breadth` 里的 zt/dt），每个子调用单独 try/except，避免一个失败导致全丢

**验收**：
- `grep -rn "except Exception:" core/ | grep "pass$"` 返回空

---

### P2-2 提取硬编码阈值到配置文件，重启生效
**文件**：`core/decision_card.py`、`core/signal_detector.py`、`core/risk_manager.py`、`config/rebel.yaml`
**改造**：
1. 在 `config/rebel.yaml` 新增 `thresholds:` 段：
   ```yaml
   thresholds:
     decision:
       bull_confident: 70
       bear_confident: 70
       neutral_gap: 30
     signals:
       buy_cost_dev: 5
       buy_bias: 5
       buy_cri: 90
       ...
   ```
2. 各模块读取 `rebel.yaml` 而不是硬编码
3. 提供默认值，配置文件缺失时不报错

**验收**：
- 删除 `core/signal_detector.py` 里的 `XUEQIU_THRESHOLDS` 全局变量
- 修改 `config/rebel.yaml` 后**重启服务即可生效**

> 原方案写"无需重启即可生效"不现实。Python 模块级变量不会自动重载，要么引入文件 watch 增加复杂度，要么老老实实重启。验收标准改为"重启生效"。

---

### P2-3 `api_server.py` 路由与业务逻辑拆分（两天）
**文件**：`api_server.py`（1222 行）

**改造分两天执行**：

**Day A — 抽接口 + 补单测**：
- 新建 `services/analysis_service.py`，把 `_run_analysis_task`、`_generate_stock_decision_card`、`_find_recent_cache` 移入
- 新建 `services/summary_service.py`，把 `_extract_summary`、`_clean_md_paragraphs` 移入
- 定义清晰的 service 接口，补单元测试（尤其 `_generate_stock_decision_card` 的 JSON/Markdown 双模式解析）

**Day B — 切调用方 + 联调**：
- `api_server.py` 只保留 FastAPI 路由定义、参数校验、调用 service
- 跑通所有接口 `curl` 测试

**验收**：
- `api_server.py` 行数降到 600 行以下
- 所有接口 `curl` 测试通过

> 原方案标 4h 过于乐观。`_run_analysis_task` 与全局锁、线程池、LLMProxy、归档路径深度交织，实际拆分需要大量接口设计和边界测试。拆两天更务实。

---

### P2-4 `App.tsx` 拆分为容器+子组件（两天）
**文件**：`src/App.tsx`（1649 行）

**改造分两天执行**：

**Day A — 抽 hooks + 梳理状态依赖**：
- 提取 `useAnalysisJob()` hook 到 `src/hooks/useAnalysisJob.ts`，包含 backgroundJobs、轮询、currentJob 推导
- 提取 `useStockData()` hook 到 `src/hooks/useStockData.ts`，包含 search、timeframeData、loading、error

**Day B — 切组件 + 联调**：
- `App.tsx` 只负责布局组合（Header、StockSearch、StockPool、StockChart、ReportPanel）
- 验证搜索、AI分析、股票池、历史记录功能正常

**验收**：
- `App.tsx` 行数降到 400 行以下
- `npm run build` 无错误
- 搜索、AI分析、股票池功能正常

> 原方案标 4h 过于乐观。App.tsx 涉及 backgroundJobs、轮询、stockInfo、stockPool 多个状态域解耦，实际拆分需要仔细处理依赖关系。拆两天更务实。

---

## P3 架构加固（可延后）

### P3-1 JSON 文件存储加文件锁
**文件**：`core/watchlist_store.py`、`core/agent_state.py`
**改造**：
- `watchlist_store.py` 的 `_load` / `_save` 加 `filelock.FileLock`（需新增依赖 `filelock`）
- 或简单方案：写临时文件再 `os.replace()` 保证原子性

**验收**：
- 并发写入 100 次不损坏 JSON

---

### P3-2 引入 Pydantic Settings 统一配置
**文件**：新增 `core/settings.py`
**改造**：
- 用 `pydantic-settings` 统一管理 `.env` + `rebel.yaml`
- 所有 `os.getenv("KEY", default")` 改为 `settings.KEY`
- 逐步替换，不要一次性改完，先改 `api_server.py` 里的 LLM 相关配置

**验收**：
- `python -c "from core.settings import settings; print(settings.model_dump())"` 能正确合并 env 和 yaml

---

### P3-3 `AnomalyTrigger` cooldown 持久化
**文件**：`core/anomaly_trigger.py`
**改造**：
- `last_trigger_by_type` 从内存 dict 改为写入 `data/trigger_cooldown.json`
- 服务重启时加载，避免 cooldown 丢失导致重复触发

**验收**：
- 触发一次信号后重启进程，1 小时内同类型信号仍被 cooldown 拦截

---

## 执行顺序建议

| 批次 | 任务 | 预估工时 | 可并行 |
|------|------|----------|--------|
| Day 1 | P0-1 CORS、P0-3 部署脚本 | 1h | ✅ |
| Day 1 | P0-2 密码哈希 | 2h | ❌（需改认证流程） |
| Day 2 | P1-1 quote 优先腾讯 | 2h | ✅ |
| Day 2 | P1-2 calculate_dd O(n) | 3h | ❌（需单测保障） |
| Day 3 | P1-3 DataLayer 单例、P1-4 前端代理 | 2h | ✅ |
| Day 3 | P2-1 异常处理规范化 | 2h | ✅ |
| Day 4 | P2-2 阈值提取到 YAML | 2h | ✅ |
| Day 5-6 | P2-3 api_server 拆分（Day A 抽接口+单测，Day B 切调用方+联调） | 6-8h | ❌ |
| Day 7-8 | P2-4 App.tsx 拆分（Day A 抽 hooks，Day B 切组件+联调） | 6-8h | ❌ |
| Day 9+ | P3 系列 | 按需 | - |

---

## 每次改动后的通用验收流程

```bash
# 1. Python 后端冒烟测试
cd /Users/peter/rebel_research
python -c "from core.data_layer import DataLayer; dl=DataLayer(); print(dl.get_stock_quote('600519'))"
python main.py  # 应正常执行到静默或输出决策卡

# 2. 前端构建
cd /Users/peter/rebel_research
npm run build   # 应 0 error

# 3. API 服务启动（若改了 api_server.py）
.venv/bin/uvicorn api_server:app --port 8000 &
curl http://localhost:8000/health
curl -X POST http://localhost:8000/api/analyze/stock/600989
curl http://localhost:8000/api/tasks/<task_id>
```

## P1 性能改造完成后的集中压测（非每次必做）

```bash
# 并发 10 请求压测（需安装 wrk 或 apache bench）
ab -n 100 -c 10 http://localhost:8000/api/stock/600519/quote

# 或手动并发 curl
for i in {1..10}; do
  curl -s http://localhost:8000/api/stock/600519/quote &
done
wait

# 观察指标：
# - 内存是否稳定（ps aux | grep uvicorn）
# - 总耗时是否 < 3s
# - 无 500 错误
```

---

## 附录：审查发现的完整问题清单（供参考）

<details>
<summary>点击查看</summary>

- **安全**：CORS 通配符、明文密码、部署脚本硬编码 IP
- **性能**：全市场 spot 重复拉取、calculate_dd O(n²)、无连接池、LLM 阻塞、无限流、回测无持久缓存
- **可靠性**：前端直连东财（CORS/限流风险）
- **质量**：函数过长（_run_analysis_task 370 行、App.tsx 1649 行）、重复代码（A/HK history）、静默吞异常、硬编码阈值、内存状态易失、Magic String、JSON 并发风险
- **架构**：无 DB（全 JSON）、无 JWT、内存任务队列、配置来源混杂、api_server 未分层

> 注：管理 Token 硬编码属于 cc-connect 项目，不在本仓库范围内；前端直连东财是公开无 Key 接口，不存在 API key 泄露，列为 P1 可靠性项。

</details>
