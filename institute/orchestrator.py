"""
投研角色自动化编排系统（Research Institute）

设计原则：
- 角色纯 YAML 配置，不硬编码在 Python 中
- 独立运行，不依赖外部项目
"""
import os
import re
import yaml
import logging
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

from institute.mind.agent_message import AgentMessage
from institute.mind.llm_client import LLMClient
from .vector_store import get_vector_store
from .topic_generator import TopicGenerator
from .fact_check import fact_check_report, format_fact_check

logger = logging.getLogger(__name__)

# 研报存档根目录（统一数据目录：rebel_research/data/archives/）
ARCHIVE_DIR = Path(__file__).parent.parent / "data" / "archives"
ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

# 角色配置目录（统一：rebel_research/roles/）
ROLES_DIR = Path(__file__).parent.parent / "roles"


class AnalystRole:
    """分析师角色定义（从 YAML 加载）"""

    def __init__(self, data: dict):
        self.name = data["name"]
        self.slug = data["slug"]
        self.persona = data["persona"]
        self.tools = data.get("tools", [])
        self.schedule = data["schedule"]  # cron 表达式
        self.output_template = data.get("output_template", "")
        self.model = data.get("model")
        self.max_tokens = data.get("max_tokens", 2000)
        self.temperature = data.get("temperature", 0.5)
        self.dependencies = data.get("dependencies", [])

    def __repr__(self):
        return f"<AnalystRole {self.slug}: {self.name}>"


class ResearchInstitute:
    """投研编排器"""

    def __init__(self, llm=None):
        self.llm = llm or LLMClient()
        if hasattr(self.llm, "_init"):
            self.llm._init()
        self.roles: Dict[str, AnalystRole] = self._load_roles()
        self._alt_llms: Dict[str, LLMClient] = self._init_alt_llms()
        logger.info(f"ResearchInstitute 初始化完成，加载 {len(self.roles)} 个角色")

    def _init_alt_llms(self) -> Dict[str, LLMClient]:
        """为角色配置的不同模型初始化备用 LLM 客户端"""
        alt_models = set()
        for role in self.roles.values():
            if role.model and role.model != self.llm.model_daily:
                alt_models.add(role.model)

        alt_llms = {}
        for model_name in alt_models:
            env_key = model_name.upper().replace("-", "_").replace(".", "_")
            base_url = os.getenv(f"ALT_MODEL_{env_key}_BASE_URL")
            api_key = os.getenv(f"ALT_MODEL_{env_key}_API_KEY")
            if not base_url or not api_key:
                logger.warning(f"角色配置了模型 '{model_name}'，但未找到对应环境变量 "
                               f"(ALT_MODEL_{env_key}_BASE_URL / API_KEY)，将使用默认模型")
                continue
            try:
                # 绕过单例创建新实例
                original = LLMClient._instance
                LLMClient._instance = None
                client = LLMClient()
                client._initialized = False
                client._init()
                # 替换为备用配置
                from openai import OpenAI
                client.client = OpenAI(base_url=base_url, api_key=api_key, timeout=180)
                client.model_daily = model_name
                client.model_complex = model_name
                client.model_summary = model_name
                # 冻结备用配置：覆盖 _init 防止 chat_with_tools/chat 运行时重置回默认端点
                client._init = lambda: None
                alt_llms[model_name] = client
                logger.info(f"备用模型客户端已创建: {model_name} @ {base_url}")
                # 恢复单例
                LLMClient._instance = original
            except Exception as e:
                logger.error(f"创建备用模型客户端失败 {model_name}: {e}")
                LLMClient._instance = original if 'original' in dir() else None
        return alt_llms

    def _get_llm_for_role(self, role: AnalystRole) -> LLMClient:
        """根据角色配置返回对应的 LLM 客户端"""
        if role.model and role.model in self._alt_llms:
            return self._alt_llms[role.model]
        return self.llm

    def _load_roles(self) -> Dict[str, AnalystRole]:
        roles = {}
        if not ROLES_DIR.exists():
            logger.warning(f"角色配置目录不存在: {ROLES_DIR}")
            return roles
        for path in sorted(ROLES_DIR.glob("*.yaml")):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                if not data or not data.get("slug"):
                    continue
                role = AnalystRole(data)
                roles[role.slug] = role
                logger.info(f"加载角色: {role}")
            except Exception as e:
                logger.error(f"加载角色失败 {path}: {e}")
        return roles

    def reload_roles(self):
        """热重载角色配置"""
        self.roles = self._load_roles()

    # ---------- 数据预处理 ----------

    def _fetch_peistock_data(self, code: str) -> Optional[str]:
        """
        获取 peistock 技术指标。优先 HTTP 直连本地 API（开发环境），
        失败时回退到本地 Python 指标引擎（生产环境无 peistock API 时）。
        返回格式化后的 Markdown 字符串，可直接注入 prompt。
        """
        import urllib.request
        import json
        import os

        # --- 1. 尝试 HTTP 直连本地 peistock API ---
        base_url = os.getenv("PEISTOCK_API_URL", "http://localhost:3457")
        if base_url.endswith("/"):
            base_url = base_url[:-1]
        url = f"{base_url}/api/stock/{code}"

        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            if "error" not in data:
                indicators = data.get("indicators", {})
                signals = data.get("signals", {})
                lines = [
                    f"【peistock 技术指标 · {data.get('name', code)} {code}】",
                    f"价格: {data.get('price', '—')}  涨跌: {data.get('changePercent', '—')}%  日期: {data.get('date', '—')}",
                    "",
                    "| 指标 | 值 | 分位 |",
                    "|------|-----|------|",
                    f"| CRI | {indicators.get('cri', '—'):.2f} | {indicators.get('criPercentile', '—'):.1f}% |",
                    f"| 贪婪指数 | {indicators.get('greedy', '—'):.2f} | {indicators.get('greedyPercentile', '—'):.1f}% |",
                    f"| BIAS225 | — | {indicators.get('bias225Percentile', '—'):.1f}% |",
                    f"| 成本偏离 | — | {indicators.get('costDeviationPercentile', '—'):.1f}% |",
                    f"| MAHS | {indicators.get('mahs', '—'):.2f} | — |",
                    f"| EMAHS | {indicators.get('emahs', '—'):.2f} | — |",
                    "",
                    f"严格信号: {' / '.join(signals.get('strict', [])) or '无'}（类型: {signals.get('signalType', '—')}）",
                ]
                return "\n".join(lines)
        except Exception as e:
            logger.info(f"peistock HTTP API 不可用，回退到本地指标引擎: {e}")

        # --- 2. HTTP 失败时，直连腾讯 API 获取真实数据（绕过 akshare/mock）---
        try:
            return self._fetch_tencent_indicators(code)
        except Exception as e:
            logger.warning(f"腾讯 API 回退也失败 {code}: {e}")
            return None

    def _fetch_tencent_klines(self, code: str):
        """
        直连腾讯财经 API 获取 K 线 + 实时行情。
        返回 (records, name, price, prev_close, tencent_symbol)，供指标计算和真空期分析复用。
        """
        import urllib.request
        import json

        clean = re.sub(r'[^0-9]', '', code)
        if len(clean) == 5:
            tencent_symbol = f"hk{clean}"
            market = "hk"
        elif clean.startswith('6') or clean.startswith('5'):
            tencent_symbol = f"sh{clean}"
            market = "a"
        else:
            tencent_symbol = f"sz{clean}"
            market = "a"

        # 1. 获取 K 线数据（前复权，500天）
        kline_url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={tencent_symbol},day,,,500,qfq"
        req = urllib.request.Request(kline_url, headers={
            "Accept": "application/json",
            "Referer": "https://stock.qq.com",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            kline_data = json.loads(resp.read().decode("utf-8"))

        if kline_data.get("code") != 0 or not kline_data.get("data"):
            raise ValueError("腾讯 K 线 API 返回异常")

        stock_data = kline_data["data"][tencent_symbol]
        klines = stock_data.get("qfqday") or stock_data.get("day") or []
        if not klines:
            raise ValueError("无 K 线数据")

        is_hk = tencent_symbol.startswith("hk")
        is_keb = clean.startswith("688")

        records = []
        for item in klines:
            vol = int(float(item[5])) if is_hk or is_keb else int(float(item[5])) * 100
            records.append({
                "date": str(item[0]),
                "open": float(item[1]) if item[1] else 0,
                "close": float(item[2]) if item[2] else 0,
                "low": float(item[3]) if item[3] else 0,
                "high": float(item[4]) if item[4] else 0,
                "volume": vol,
                "amount": 0.0,
            })

        if len(records) < 60:
            raise ValueError(f"K 线数据不足: {len(records)} 条")

        # 2. 获取实时行情
        quote_url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={tencent_symbol},day,,,1,qfq"
        req2 = urllib.request.Request(quote_url, headers={
            "Accept": "application/json",
            "Referer": "https://stock.qq.com",
        })
        with urllib.request.urlopen(req2, timeout=10) as resp2:
            quote_data = json.loads(resp2.read().decode("utf-8"))

        qt = quote_data["data"][tencent_symbol]["qt"][tencent_symbol]
        name = qt[1] or code
        price = float(qt[3]) if qt[3] else 0
        prev_close = float(qt[4]) if qt[4] else 0

        return records, name, price, prev_close, tencent_symbol

    def _fetch_tencent_indicators(self, code: str) -> Optional[str]:
        """
        直连腾讯财经 API 获取 K 线 + 实时行情，用 Python 指标引擎计算。
        与前端 peistock 使用完全同源的数据，避免 akshare mock 失真。
        """
        from core.indicators import calculate_all_indicators
        from core.signal_detector import detect_signals, build_signal_input

        records, name, price, prev_close, tencent_symbol = self._fetch_tencent_klines(code)
        market = "hk" if tencent_symbol.startswith("hk") else "a"
        change_pct = ((price - prev_close) / prev_close * 100) if prev_close > 0 else 0

        # 流通股本：港股 idx 70，A股 idx 72
        clean = re.sub(r'[^0-9]', '', code)
        import urllib.request
        import json
        quote_url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={tencent_symbol},day,,,1,qfq"
        req2 = urllib.request.Request(quote_url, headers={
            "Accept": "application/json",
            "Referer": "https://stock.qq.com",
        })
        with urllib.request.urlopen(req2, timeout=10) as resp2:
            quote_data = json.loads(resp2.read().decode("utf-8"))
        qt = quote_data["data"][tencent_symbol]["qt"][tencent_symbol]

        capital = 0
        if market == "hk":
            capital = int(float(qt[70])) if len(qt) > 70 and qt[70] else 0
        else:
            capital = int(float(qt[72])) if len(qt) > 72 and qt[72] else 0

        if capital <= 0:
            from core.data_layer import DataLayer
            capital = DataLayer().get_stock_capital(code)

        # 计算 5 日涨幅
        change_5d = 0
        if len(records) >= 6:
            price_5d_ago = records[-6]["close"]
            change_5d = (price - price_5d_ago) / price_5d_ago * 100

        # 计算指标
        indicators_list = calculate_all_indicators(records, capital, capital_unit="shares")
        if not indicators_list:
            raise ValueError("指标计算失败")

        latest = indicators_list[-1]
        date_str = str(latest.get("date", ""))

        sig_input = build_signal_input(indicators_list)
        signals = detect_signals(sig_input)
        strict_sigs = signals.get("strict", [])
        sig_type = signals.get("signalType", "—")

        cri_pct = latest.get('cri_percentile', latest.get('criPercentile', 0))
        greedy_pct = latest.get('greedy_percentile', latest.get('greedyPercentile', 0))
        bias225_pct = latest.get('bias225_percentile', latest.get('bias225Percentile', 0))
        cost_pct = latest.get('cost_deviation_percentile', latest.get('costDeviationPercentile', 0))
        lines = [
            f"【peistock 技术指标 · {name} {code}】",
            f"价格: {price:.2f}  涨跌: {change_pct:.2f}%  5日涨幅: {change_5d:+.2f}%  日期: {date_str}",
            "",
            "| 指标 | 值 | 分位 |",
            "|------|-----|------|",
            f"| CRI | {latest.get('cri', 0):.2f} | {cri_pct:.1f}% |",
            f"| 贪婪指数 | {latest.get('greedy', 0):.2f} | {greedy_pct:.1f}% |",
            f"| BIAS225 | — | {bias225_pct:.1f}% |",
            f"| 成本偏离 | — | {cost_pct:.1f}% |",
            f"| MAHS | {latest.get('mahs', 0):.2f} | — |",
            f"| EMAHS | {latest.get('emahs', 0):.2f} | — |",
            "",
            f"严格信号: {' / '.join(strict_sigs) or '无'}（类型: {sig_type}）",
        ]
        logger.info(f"腾讯 API 指标计算成功: {code}")
        return "\n".join(lines)

    def _calc_vacuum_period_change(self, code: str, announce_date: str) -> Optional[float]:
        """
        计算「上次财报公告日 → 今日」的涨跌幅（真空期涨跌幅）。
        如果 announce_date 在 K 线数据中找不到，返回 None。
        """
        try:
            records, name, price, prev_close, _ = self._fetch_tencent_klines(code)
            if price <= 0 or not announce_date:
                return None

            # announce_date 格式通常是 YYYY-MM-DD，K 线日期是 YYYYMMDD 或 YYYY-MM-DD
            target_date = announce_date.replace("-", "")

            # 找公告日或之后第一个交易日的收盘价
            entry_price = None
            for r in records:
                r_date = str(r["date"]).replace("-", "")
                if r_date >= target_date:
                    entry_price = r["close"]
                    break

            if entry_price is None or entry_price <= 0:
                return None

            change = (price - entry_price) / entry_price * 100
            logger.info(f"[{code}] 真空期涨跌幅: {announce_date} → 今日, 入口价={entry_price:.2f}, 当前={price:.2f}, 变化={change:+.2f}%")
            return change
        except Exception as e:
            logger.warning(f"[{code}] 真空期涨跌幅计算失败: {e}")
            return None

    def _fetch_sentiment_data(self, code: str) -> Optional[str]:
        """
        获取 Sentiment 角色需要的结构化情绪数据：融资融券、北向资金、龙虎榜。
        直接注入 prompt，避免 LLM 调用 web search（搜索经常无结果）。
        返回格式化 Markdown 字符串，None 表示数据不可用。
        """
        from core.data_layer import DataLayer
        dl = DataLayer()
        lines = ["【情绪行为数据 · {}】".format(code), ""]
        has_data = False

        # 1. 融资融券
        margin = dl.get_stock_margin(code)
        if margin:
            has_data = True
            lines.append("### 融资融券（最新交易日）")
            for k, v in margin.items():
                if k in ("融券余量", "融券卖出量"):
                    # 股数格式
                    val = f"{int(v):,}" if v else "—"
                    lines.append(f"- {k}: {val} 股")
                else:
                    # 金额转亿元
                    val = round(v / 1e8, 2) if v and v > 1e7 else v
                    lines.append(f"- {k}: {val} 亿元" if isinstance(val, float) else f"- {k}: {v}")
            lines.append("")

        # 2. 北向资金
        nb = dl.get_stock_northbound(code, days=5)
        if nb:
            has_data = True
            lines.append("### 北向资金持股（最近5个交易日）")
            lines.append("| 日期 | 持股数量(万股) | 占A股% | 增持股数 | 增持资金(万元) |")
            lines.append("|------|---------------|--------|----------|---------------|")
            for r in nb:
                hold = round(r.get("持股数量", 0) / 1e4, 2) if r.get("持股数量") else "—"
                pct = round(r.get("占A股百分比", 0), 3) if r.get("占A股百分比") else "—"
                add = int(r.get("增持股数", 0)) if r.get("增持股数") else "—"
                fund = round(r.get("增持资金", 0) / 1e4, 2) if r.get("增持资金") else "—"
                lines.append(f"| {r.get('日期','—')} | {hold} | {pct} | {add} | {fund} |")
            lines.append("")

        # 3. 龙虎榜
        lhb = dl.get_stock_lhb(code, days=5)
        if lhb:
            has_data = True
            lines.append("### 龙虎榜（最近上榜记录）")
            lines.append("| 上榜日 | 净买额(万元) | 买入额(万元) | 卖出额(万元) | 上榜原因 |")
            lines.append("|--------|-------------|-------------|-------------|----------|")
            for r in lhb:
                lines.append(
                    f"| {r.get('上榜日','—')} | {round(r.get('净买额',0)/1e4,2)} | "
                    f"{round(r.get('买入额',0)/1e4,2)} | {round(r.get('卖出额',0)/1e4,2)} | {r.get('上榜原因','—')} |"
                )
            lines.append("")

        if not has_data:
            return None
        return "\n".join(lines)

    # ---------- 单角色执行 ----------

    def run_analyst(self, slug: str, date_str: str = None, context: dict = None, llm=None) -> Optional[Path]:
        """执行单个分析师，返回报告文件路径。

        Args:
            slug: 角色标识
            date_str: 日期字符串
            context: 上下文数据（股票代码、研报数据等）
            llm: 可选，自定义 LLM 实例（用于线程安全地覆盖 reasoning_effort 等配置）
        """
        # signal_monitor 是规则引擎，不走 AgentLoop
        if slug == "signal_monitor":
            return self._run_signal_monitor(date_str)

        role = self.roles.get(slug)
        if not role:
            logger.error(f"未知角色: {slug}")
            return None

        date_str = date_str or datetime.now().strftime("%Y%m%d")
        code = (context or {}).get("code", "")
        code_suffix = f"_{code}" if code else ""
        report_path = ARCHIVE_DIR / f"{date_str}{code_suffix}_{slug}.md"

        if report_path.exists():
            logger.info(f"[{slug}] 报告已存在，跳过: {report_path}")
            return report_path

        logger.info(f"[{slug}] 开始执行 {role.name}")
        today = datetime.now().strftime("%Y年%m月%d日")
        system_prompt = self._build_system_prompt(role, today, context=context)

        # 自动议题生成：获取该角色当日热点议题
        try:
            tg = TopicGenerator()
            topics = tg.get_topics_for_role(slug, max_topics=3)
        except Exception as e:
            logger.warning(f"[{slug}] 议题生成失败: {e}")
            topics = []

        user_prompt = self._build_user_prompt(role, today, topics, context)

        messages = [
            AgentMessage.system(system_prompt),
            AgentMessage.user(user_prompt),
        ]

        # 预注入 peistock 技术指标（避免 LLM 工具调用偶发失败）
        if context and context.get("code"):
            code = context.get("code")
            peistock_data = self._fetch_peistock_data(code)
            if peistock_data:
                logger.info(f"[{slug}] 预注入 peistock 数据: {code}")
                messages.append(AgentMessage.user(peistock_data))

            # Sentiment 角色额外注入融资融券/北向资金/龙虎榜结构化数据
            # Chair 也需要直接读取原始情绪数据，避免三手信息失真
            if slug in ("sentiment", "chair_debate"):
                sentiment_data = self._fetch_sentiment_data(code)
                if sentiment_data:
                    logger.info(f"[{slug}] 预注入情绪行为数据: {code}")
                    messages.append(AgentMessage.user(sentiment_data))
                else:
                    logger.warning(f"[{slug}] 情绪行为数据不可用: {code}")

            # 季度财报核心数据注入（优先从 context 读取 api_server 预取数据，避免重复调用 akshare）
            fin_data = context.get("financial_data") if context else None
            if not fin_data:
                try:
                    from core.financial_data import get_quarterly_financial_for_prompt
                    market = context.get("market") if context else ("a" if len(code) == 6 and code.isdigit() else "hk")
                    fin_data = get_quarterly_financial_for_prompt(code, market=market)
                except Exception as e:
                    logger.warning(f"[{slug}] 季度财报数据获取失败: {e}")
            if fin_data and "⚠️" not in fin_data:
                logger.info(f"[{slug}] 预注入季度财报数据: {code} ({'context' if context and context.get('financial_data') else 'fallback'})")
                messages.append(AgentMessage.user(fin_data))
            else:
                logger.warning(f"[{slug}] 季度财报数据不可用: {code}")

            # 预期基准数据注入（Preemption/Chair 需要，用于量化预期差；优先从 context 读取）
            if slug in ("preemption", "chair_debate"):
                exp_data = context.get("expectation_data") if context else None
                if not exp_data:
                    try:
                        from core.financial_data import get_expectation_for_stock
                        market = context.get("market") if context else ("a" if len(code) == 6 and code.isdigit() else "hk")
                        exp_data = get_expectation_for_stock(code, market=market)
                    except Exception as e:
                        logger.warning(f"[{slug}] 预期基准数据获取失败: {e}")
                if exp_data and "⚠️" not in exp_data:
                    logger.info(f"[{slug}] 预注入预期基准数据: {code} ({'context' if context and context.get('expectation_data') else 'fallback'})")
                    messages.append(AgentMessage.user(exp_data))
                else:
                    logger.warning(f"[{slug}] 预期基准数据不可用: {code}")

            # Preemption 角色：公式化计算入场时机评分并注入
            if slug == "preemption":
                try:
                    from core.preemption_scorer import build_preemption_score_from_prompt_data
                    from core.financial_data import extract_announce_date
                    # 提取 5 日涨幅（优先从预注入的 peistock 数据）
                    price_change_5d = 0
                    peistock_text = peistock_data or ""
                    pm = re.search(r'5日涨幅:\s*([+-]?\d+\.?\d*)%', peistock_text)
                    if pm:
                        price_change_5d = float(pm.group(1))
                    else:
                        # fallback：尝试提取当日涨跌作为近似
                        pm = re.search(r'涨跌:\s*([+-]?\d+\.?\d*)%', peistock_text)
                        if pm:
                            price_change_5d = float(pm.group(1))
                    if context and context.get("price_change_5d"):
                        price_change_5d = float(context.get("price_change_5d"))

                    # 计算跨财报真空期涨跌幅（上次财报公告日 → 今日）
                    price_change_vacuum = 0
                    announce_date = extract_announce_date(fin_data or "")
                    if announce_date:
                        vacuum_change = self._calc_vacuum_period_change(code, announce_date)
                        if vacuum_change is not None:
                            price_change_vacuum = vacuum_change
                            # 注入真空期数据供分析师参考
                            vacuum_md = (
                                f"【跨财报真空期价格数据 · {code}】\n\n"
                                f"上次财报公告日: {announce_date}\n"
                                f"从上次财报公告日至今涨跌幅: {price_change_vacuum:+.2f}%\n\n"
                                f"此数据用于判断「真空期定价」：\n"
                                f"- 如果上次财报后股价已大涨 30%+，说明市场可能已在交易「下次财报超预期」的预期\n"
                                f"- 如果真空期股价几乎没涨甚至下跌，而实际财报显著超预期 → 存在真正的预期差\n"
                                f"- 分析时必须结合此数据，不要只看最近 5 日涨幅"
                            )
                            messages.append(AgentMessage.user(vacuum_md))
                            logger.info(f"[preemption] 注入真空期数据: {announce_date} → 今日 {price_change_vacuum:+.2f}%")

                    score_result = build_preemption_score_from_prompt_data(
                        financial_md=fin_data or "",
                        expectation_md=exp_data or "",
                        price_change_5d=price_change_5d,
                        price_change_vacuum=price_change_vacuum,
                    )
                    if score_result:
                        score_md = (
                            f"【系统公式化 Preemption 评分 · {code}】\n\n"
                            f"系统已基于量化公式自动计算入场时机评分，此评分独立于你的主观判断，"
                            f"你的任务是解释这个评分并验证其合理性：\n\n"
                            f"- **入场时机评分**: {score_result['score']}/100\n"
                            f"  - 基本面偏离分: {score_result['fundamental']}/100\n"
                            f"  - 综合价格消化度: {score_result['priced_in']}/100（越高表示股价已反应越多）\n"
                            f"    - 短期消化度(5日): {score_result.get('priced_in_5d', 0)}/100\n"
                            f"    - 真空期消化度(财报至今): {score_result.get('priced_in_vacuum', 0)}/100  ← 权重 70%\n"
                            f"  - 营收偏离: {score_result['rev_diff']:+.2f}%\n"
                            f"  - 净利润偏离: {score_result['profit_diff']:+.2f}%\n"
                            f"  - 真空期涨跌幅: {score_result.get('price_change_vacuum', 0):+.2f}%\n"
                            f"- **计算过程**: {score_result['details']}\n\n"
                            f"评分含义：100=信息完全未被消化（最佳入场点）；0=已被完全消化（入场即接盘）。\n"
                            f"你的输出中「预判结论」部分的「入场时机评分」**必须使用此系统评分 {score_result['score']} 分**，"
                            f"不要自行打分。你的价值在于：基于 Bull/Bear 观点和股价证据，解释这个评分是否合理、"
                            f"是否存在公式未捕捉到的额外信息（如突发政策、行业催化、技术面突破等）。"
                        )
                        messages.append(AgentMessage.user(score_md))
                        logger.info(f"[preemption] 注入公式化评分: {score_result['score']} 分")
                except Exception as e:
                    logger.warning(f"[preemption] 公式评分计算失败: {e}")

            # 研报客观数据注入（Bull/Bear/Preemption/Chair 需要，已预取于 context）
            if slug in ("bull", "bear", "preemption", "chair_debate"):
                rr_data = context.get("research_report_data") if context else None
                if rr_data:
                    logger.info(f"[{slug}] 预注入研报客观数据: {code} ({len(rr_data)} 字符)")
                    messages.append(AgentMessage.user(rr_data))

            # Chair 裁决前注入该股票历史验证表现（回测闭环反馈）
            if slug == "chair_debate":
                try:
                    from core.backtest_tracker import format_stock_stats_for_prompt
                    history_md = format_stock_stats_for_prompt(code)
                    if history_md:
                        logger.info(f"[chair] 注入历史验证表现: {code}")
                        messages.append(AgentMessage.user(history_md))
                except Exception as e:
                    logger.warning(f"[chair] 历史验证表现注入失败: {e}")

        # 依赖角色：注入已完成的分析师报告（全部读完整原文，Chair 不再截断）
        if role.dependencies:
            dep_reports = []
            for dep_slug in role.dependencies:
                dep_path = ARCHIVE_DIR / f"{date_str}{code_suffix}_{dep_slug}.md"
                if dep_path.exists():
                    dep_role = self.roles.get(dep_slug)
                    dep_name = dep_role.name if dep_role else dep_slug
                    dep_content = dep_path.read_text(encoding="utf-8")
                    dep_reports.append(f"---\n## {dep_name}报告\n\n{dep_content}")
                else:
                    logger.warning(f"[{slug}] 依赖报告不存在: {dep_path}")
            if dep_reports:
                logger.info(f"[{slug}] 注入 {len(dep_reports)} 份依赖报告")
                messages.append(AgentMessage.user(
                    "以下是你需要阅读的各分析师报告（原始内容），请据此合成最终简报。\n"
                    "报告内容已完整提供在下方，请直接阅读并合成，不需要调用任何工具。\n\n"
                    + "\n\n".join(dep_reports)
                ))

        # 向量检索和衰减记忆已禁用（减少LLM输入长度和外部依赖，加速分析）
        # TODO: 向量库修复后恢复
        pass

        llm_for_role = llm or self._get_llm_for_role(role)

        try:
            reply = llm_for_role.chat_messages(
                messages=[m.to_llm() for m in messages],
                model=role.model,
                max_tokens=role.max_tokens,
                temperature=role.temperature,
            )
            # 清洗模型 reasoning token
            reply = self._clean_reasoning_tokens(reply)

            report_content = self._format_report(role, today, reply)

            # 空内容保护：LLM 返回异常时不跑无意义的 Fact-Check
            if len(report_content.strip()) < 200:
                logger.error(f"[{slug}] 报告内容过短 ({len(report_content)} 字符)，判定为生成失败")
                report_path.write_text(
                    f"# {role.name} - {today}\n\n"
                    f"⚠️ 报告生成失败：LLM 返回内容为空或极短。\n"
                    f"（原始回复长度：{len(reply)} 字符，清洗后：{len(report_content)} 字符）\n"
                    f"请稍后重试，或检查模型服务状态。\n",
                    encoding="utf-8"
                )
                return report_path

            report_path.write_text(report_content, encoding="utf-8")

            # Fact-Check：事实核查
            try:
                llm_for_check = llm or self._get_llm_for_role(role)
                fc_result = fact_check_report(report_content, llm_for_check, max_claims=6)
                if fc_result.get("verified"):
                    fc_md = format_fact_check(fc_result)
                    report_path.write_text(report_content + fc_md, encoding="utf-8")
                    logger.info(f"[{slug}] Fact-Check: {fc_result['summary']}")
            except Exception as e:
                logger.warning(f"[{slug}] Fact-Check 失败: {e}")

            logger.info(f"[{slug}] 完成，报告: {report_path} ({len(report_content)} 字符)")
            return report_path

        except Exception as e:
            logger.error(f"[{slug}] 执行失败: {e}", exc_info=True)
            report_path.write_text(f"# {role.name} - {today}\n\n执行失败: {e}\n", encoding="utf-8")
            return report_path

    # ---------- 异常信号监控（signal_monitor 特殊角色） ----------

    def _run_signal_monitor(self, date_str: str = None) -> Optional[Path]:
        """异常监控：规则检测 → 自动触发 Bull/Bear/Chair"""
        import json
        from core.anomaly_trigger import AnomalyTrigger
        from core.data_layer import DataLayer

        date_str = date_str or datetime.now().strftime("%Y%m%d")
        report_path = ARCHIVE_DIR / f"{date_str}_signal_monitor.md"

        # 加载阈值配置
        config_path = Path(__file__).parent.parent / "config" / "rebel.yaml"
        thresholds = {}
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                thresholds = yaml.safe_load(f).get("triggers", {})

        # 拉市场数据
        dl = DataLayer()
        dl.clear_mock_sources()
        try:
            snapshot = dl.get_full_snapshot()
        except Exception as e:
            logger.error(f"[signal_monitor] 获取市场快照失败: {e}")
            return None

        # Mock 数据拦截
        if dl.has_mock():
            mock_sources = dl.get_mock_sources()
            logger.warning(f"[signal_monitor] Mock 数据 detected: {mock_sources}，跳过触发")
            report_path.write_text(
                f"# {date_str} 异常信号监控\n\n⚠️ Mock 数据拦截 — 以下源使用了假数据：\n"
                + "\n".join(f"- {s}" for s in mock_sources)
                + "\n\n未触发 Bull/Bear 辩论。\n",
                encoding="utf-8"
            )
            return report_path

        # 检测异常
        trigger = AnomalyTrigger(thresholds)
        signals = trigger.should_trigger(snapshot)

        # 生成报告
        lines = [f"# {date_str} 异常信号监控", ""]
        if not signals:
            lines.append("✅ 无异常信号，系统静默。")
            report_path.write_text("\n".join(lines), encoding="utf-8")
            logger.info("[signal_monitor] 无异常信号")
            return report_path

        lines.append(f"🚨 检测到 {len(signals)} 个异常信号：")
        lines.append("")
        for s in signals:
            lines.append(f"- **[{s.severity.upper()}]** {s.type}: {s.note}")
        lines.append("")

        # 保存信号到 JSON
        signals_data = {
            "date": date_str,
            "signals": [
                {
                    "type": s.type,
                    "severity": s.severity,
                    "trigger_value": s.trigger_value,
                    "note": s.note,
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                }
                for s in signals
            ],
            "snapshot": {
                k: (float(v) if isinstance(v, (int, float)) else v)
                for k, v in snapshot.items()
                if k not in ("a_breadth", "pmi")
            },
        }
        signals_json_path = Path(__file__).parent.parent / "data" / f"signals_{date_str}.json"
        signals_json_path.write_text(json.dumps(signals_data, ensure_ascii=False, indent=2), encoding="utf-8")

        # 自动触发 Bull/Bear/Chair（注入信号上下文）
        logger.info(f"[signal_monitor] 触发 {len(signals)} 个信号，启动 Bull/Bear/Chair")
        for signal in signals:
            ctx = {
                "signal_type": signal.type,
                "severity": signal.severity,
                "trigger_value": signal.trigger_value,
                "note": signal.note,
            }
            self.run_analyst("bull", date_str, context=ctx)
            self.run_analyst("bear", date_str, context=ctx)
            self.run_analyst("chair_debate", date_str)
            lines.append(f"已自动触发 Bull/Bear/Chair 辩论（{signal.type}）")

        report_path.write_text("\n".join(lines), encoding="utf-8")
        logger.info(f"[signal_monitor] 完成，报告: {report_path}")
        return report_path

    def _build_system_prompt(self, role: AnalystRole, today: str, context: dict = None) -> str:
        weekday = datetime.now().strftime("%A")
        lines = [
            f"今天是 {today}（{weekday}）。",
            "",
            f"日期锚（DATE ANCHOR）：以下所有数据、事件和分析均基于 {today} 当天的信息。不要依赖训练数据中的历史知识，必须以当日可获取的实时信息为准。",
            "",
        ]

        # 个股分析时追加财报时间线锚定（基于当前日期动态推断）
        if context and context.get("code"):
            now = datetime.now()
            year = now.year
            month = now.month
            # A股：Q1(4月底) / 半年报(8月底) / Q3(10月底) / 年报(次年4月底)
            # 动态推断最新已披露财报
            if month >= 5:
                latest_a = f"{year}年Q1季报"
                latest_a_deadline = f"{year}年4月30日"
            elif month >= 9:
                latest_a = f"{year}年半年报"
                latest_a_deadline = f"{year}年8月31日"
            elif month >= 11:
                latest_a = f"{year}年Q3季报"
                latest_a_deadline = f"{year}年10月31日"
            else:
                latest_a = f"{year - 1}年年报"
                latest_a_deadline = f"{year}年4月30日"

            lines.append("财报时间线锚定（必须遵守）：")
            lines.append(f"- A股{latest_a}已于{latest_a_deadline}前全部披露完毕，分析中不得将其视为'即将披露'的未来催化剂")
            lines.append(f"- 港股主要公司{year}年Q1财报通常在5月中旬发布，截至今日可能已发布也可能尚未发布")
            lines.append(f"- 美股Mag7的{year}年Q1财报通常在4月下旬至5月初发布，截至今日应已全部披露完毕")
            lines.append("- 严禁基于已披露财报进行'可能''或将''预计'等猜测性表述；已披露的数据就是事实，未披露的数据才能使用预期")
            lines.append("")

        # 替换 persona 中的动态占位符
        persona_text = role.persona.replace("{current_date}", today)
        lines.extend([
            persona_text,
            "",
            "执行规则：",
            "1. 你需要主动使用工具收集实时信息，不要依赖已有知识",
            "2. 每个观点必须基于数据或事实，标注信息来源",
            "3. 使用具体数字，不要笼统描述（如'增长很快'→'增长23%'）",
            "4. 输出 Markdown 格式，结构清晰",
            "5. 不要输出任何 thinking、reasoning 或 thought 标签，直接输出最终报告",
            "6. 直接在最终回复中输出完整报告全文，不要调用 write_file 工具写入文件",
            "7. 禁止写代码、禁止创建文件、禁止执行脚本——所有分析必须在同一条回复中用自然语言完成",
            "8. 如果搜索工具不可用或返回结果为空，不要反复尝试，立即基于已有数据（预注入的技术指标、新闻、研报）输出完整报告。严禁在报告中提及「搜索不可用」「搜索失败」「无法获取最新消息」等任何关于工具失败的描述——读者不需要知道工具是否工作，只需要看到完整的分析结论。绝不允许输出'还没做完'、'需要更多时间'等未完成话术——你的任务就是输出完整报告，不是请求用户继续。",
        ])
        if role.tools:
            lines.append(f"9. 你可以使用的工具: {', '.join(role.tools)}")
        lines.append(
            "10. 涉及财报、业绩、营收、利润等财务数据时，必须明确标注数据来源类型："
            "[已发布财报] — 公司正式披露并经审计的数据；"
            "[市场预期/一致预期] — 分析师预测或市场共识，尚未正式发布；"
            "[历史数据] — 过往季度/年度的已发布数据。"
            "严禁将市场预期误当作已发布财报，严禁将历史数据误当作最新数据。"
        )
        return "\n".join(lines)

    def _build_user_prompt(self, role: AnalystRole, today: str, topics: list = None, context: dict = None) -> str:
        lines = [
            f"请完成今日（{today}）的{role.name}研究简报。",
            "使用工具收集最新信息，按指定格式输出完整报告。",
        ]

        # 注入上下文（如股票代码、peistock 信号等）
        if context:
            code = context.get("code")
            signal = context.get("signal")
            if code:
                lines.append("")
                lines.append(f"【分析标的】{code}")
                if signal:
                    lines.append(f"【触发信号】{signal}")
                # 技术指标已由 orchestrator 预注入（本地计算或 HTTP），无需 LLM 再调工具

        # 注入自动生成的议题
        if topics:
            lines.append("")
            lines.append("【今日热点议题】（供参考，请结合搜索深入分析）")
            for i, t in enumerate(topics, 1):
                title = t.get("title", "")
                content = t.get("content", "")
                lines.append(f"{i}. {title}")
                if content:
                    lines.append(f"   摘要：{content[:100]}")
            lines.append("")
            lines.append("你可以选择围绕上述议题展开分析，也可以根据最新搜索结果自行判断今日最重要的研究方向。")

        lines.extend([
            "",
            "重要：",
            "1. 直接在回复中输出完整报告内容，不要调用 write_file。",
            "2. 搜索获取信息后，必须在同一条回复中输出完整报告，不要只返回确认信息。",
            "3. 如果搜索结果不够详细，基于已有信息和你的专业知识进行合理推演，输出完整报告。",
        ])
        return "\n".join(lines)

    def _format_report(self, role: AnalystRole, today: str, content: str) -> str:
        # chair_debate 自己控制格式，不额外加 header
        if role.slug == "chair_debate":
            if role.output_template:
                template = role.output_template.replace("{date}", today)
                if "{content}" in template:
                    return template.replace("{content}", content, 1)
            return content
        header = f"# {today} {role.name}简报\n\n"
        if role.output_template:
            template = role.output_template.replace("{date}", today)
            if "{content}" in template:
                return template.replace("{content}", content, 1)
            return header + template + "\n\n" + content
        return header + content

    def _clean_reasoning_tokens(self, text: str) -> str:
        """清洗模型内部 reasoning token（支持 DeepSeek <think>、Qwen <|channel|> 等格式）"""
        import re
        # DeepSeek-R1 等模型：<think>...</think>
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
        # 匹配 <|channel>thought ... <|channel|> 格式的 thinking 块
        text = re.sub(r"<\|channel\>thought.*?<\|channel\|>", "", text, flags=re.DOTALL)
        # 匹配单独的 thinking 标签
        text = re.sub(r"<\|[^>]*\>(thought|thinking|reason).*?(<\|[^>]*\>|$)", "", text, flags=re.DOTALL)
        # 清理多余空行
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def _extract_thesis_and_confidence(self, report_content: str) -> tuple:
        """从 Bull/Bear 报告中提取核心论点 (thesis) 和置信度"""
        import re
        thesis = ""
        confidence = 50.0

        # 提取 thesis：找 "核心论点" 或 "Thesis" 后面的内容
        thesis_patterns = [
            r"## 核心论点.*?\n+(.*?)(?=\n## |\n---|$)",
            r"## Thesis.*?\n+(.*?)(?=\n## |\n---|$)",
            r"核心论点[：:]\s*(.+?)(?=\n\n|\n## |$)",
        ]
        for pattern in thesis_patterns:
            m = re.search(pattern, report_content, re.DOTALL | re.IGNORECASE)
            if m:
                thesis = m.group(1).strip().replace("\n", " ")[:300]
                break

        # 提取 confidence：找 "置信度" 或 "confidence" 后面的数字
        conf_patterns = [
            r"置信度.*?([0-9]{1,3})\s*/\s*100",
            r"confidence.*?([0-9]{1,3})",
            r"([0-9]{1,3})\s*/\s*100",
        ]
        for pattern in conf_patterns:
            m = re.search(pattern, report_content, re.IGNORECASE)
            if m:
                val = int(m.group(1))
                if 0 <= val <= 100:
                    confidence = float(val)
                    break

        return thesis, confidence

    # ---------- 简报合成 ----------

    def run_briefing(self, briefing_type: str = "daily", date_str: str = None) -> Optional[Path]:
        date_str = date_str or datetime.now().strftime("%Y%m%d")
        today = datetime.now().strftime("%Y年%m月%d日")

        independent_roles = [
            slug for slug, role in self.roles.items()
            if not role.dependencies and slug != "signal_monitor"
        ]
        if not independent_roles:
            logger.warning("没有独立角色可执行")
            return None

        logger.info(f"Phase 1: 并行执行 {len(independent_roles)} 个角色")
        report_paths: Dict[str, Path] = {}

        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {
                executor.submit(self.run_analyst, slug, date_str): slug
                for slug in independent_roles
            }
            for future in futures:
                slug = futures[future]
                try:
                    path = future.result(timeout=300)
                    if path:
                        report_paths[slug] = path
                except Exception as e:
                    logger.error(f"[{slug}] 并行执行失败: {e}")

        logger.info(f"Phase 1 完成: {len(report_paths)}/{len(independent_roles)} 个角色成功")

        dependent_roles = [
            slug for slug, role in self.roles.items()
            if role.dependencies and all(dep in report_paths for dep in role.dependencies)
        ]
        for slug in dependent_roles:
            path = self.run_analyst(slug, date_str)
            if path:
                report_paths[slug] = path

        chair_slug = "chair"
        if chair_slug in self.roles and chair_slug in report_paths:
            final_briefing = report_paths[chair_slug]
        else:
            final_briefing = self._generate_fallback_briefing(date_str, today, report_paths)

        self._deliver_briefing(final_briefing, today)
        return final_briefing

    def _generate_fallback_briefing(self, date_str: str, today: str, report_paths: Dict[str, Path]) -> Path:
        lines = [f"# {today} 投研早报", ""]
        for slug, path in sorted(report_paths.items()):
            role = self.roles.get(slug)
            if not role:
                continue
            content = path.read_text(encoding="utf-8")[:800]
            lines.append(f"## {role.name}")
            lines.append(content)
            lines.append("")
        text = "\n".join(lines)
        path = ARCHIVE_DIR / f"{date_str}_briefing.md"
        path.write_text(text, encoding="utf-8")
        return path

    def _deliver_briefing(self, briefing_path: Path, today: str):
        if not briefing_path.exists():
            return
        content = briefing_path.read_text(encoding="utf-8")
        logger.info(f"简报已生成: {briefing_path} ({len(content)} 字符)")

    # ---------- 定时任务注册 ----------

    def schedule_all(self, scheduler):
        from apscheduler.triggers.cron import CronTrigger

        for slug, role in self.roles.items():
            if role.dependencies:
                continue
            job_id = f"analyst_{slug}"
            try:
                scheduler.add_job(
                    self.run_analyst,
                    trigger=CronTrigger.from_crontab(role.schedule),
                    args=[slug],
                    id=job_id,
                    replace_existing=True,
                    misfire_grace_time=3600,
                )
                logger.info(f"已注册定时任务: {job_id} ({role.schedule}) {role.name}")
            except Exception as e:
                logger.error(f"注册定时任务失败 {job_id}: {e}")

        try:
            scheduler.add_job(
                self.run_briefing,
                trigger=CronTrigger(hour=7, minute=30),
                args=["daily"],
                id="research_daily_briefing",
                replace_existing=True,
                misfire_grace_time=3600,
            )
            logger.info("已注册定时任务: research_daily_briefing (7:30)")
        except Exception as e:
            logger.error(f"注册简报任务失败: {e}")
