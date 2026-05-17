"""
core/research_report.py
东方财富研报获取与客观数据提取。

设计原则：
- 只取客观数据（行业指标、市场规模、前置指标），排除观点/结论/评级/盈利预测
- PDF 下载后本地缓存，避免重复请求
- LLM 提取客观数据，失败时降级为规则提取
- 流程失败不阻断主分析链（返回空字符串）
"""
from __future__ import annotations

import logging
import re
import time
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# 缓存根目录
CACHE_ROOT = Path(__file__).parent.parent / "data" / "research_reports"
CACHE_ROOT.mkdir(parents=True, exist_ok=True)

# PDF 下载基础 URL
PDF_BASE_URL = "https://pdf.dfcfw.com/pdf/H3_{info_code}_1.pdf"

# 请求头（轮换 UA 降低被封概率）
USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]


def _safe_import_akshare():
    try:
        import akshare as ak  # type: ignore
        return ak
    except ImportError:
        logger.warning("[research_report] akshare not installed")
        return None


def _safe_import_pdfplumber():
    try:
        import pdfplumber  # type: ignore
        return pdfplumber
    except ImportError:
        logger.warning("[research_report] pdfplumber not installed")
        return None


def _extract_info_code(report_url: str) -> Optional[str]:
    """从研报 PDF 链接中提取 infoCode。
    URL 格式: https://pdf.dfcfw.com/pdf/H3_AP202605051821967356_1.pdf
    infoCode 为 H3_ 后到 _1.pdf 之间的部分。
    """
    if not report_url:
        return None
    m = re.search(r"/H3_([A-Za-z0-9]+)_1\.pdf", report_url)
    if m:
        return m.group(1)
    # 兜底：兼容旧格式 infoCode=xxx
    m = re.search(r"infoCode=([A-Za-z0-9]+)", report_url)
    return m.group(1) if m else None


def fetch_research_reports_em(code: str, limit: int = 3) -> List[Dict]:
    """
    用 akshare 获取东方财富研报元数据。

    Returns:
        List[{
            "title": str,
            "org": str,
            "author": str,
            "date": str,
            "industry": str,
            "rating": str,
            "info_code": str,      # 用于构造 PDF URL
            "pages": int,
            "url": str,
        }]
    """
    ak = _safe_import_akshare()
    if ak is None:
        return []

    try:
        df = ak.stock_research_report_em(symbol=code)
        if df is None or len(df) == 0:
            logger.info("[research_report] 无研报数据: %s", code)
            return []
    except Exception as e:
        logger.warning("[research_report] akshare 获取研报失败 %s: %s", code, e)
        return []

    reports = []
    for _, r in df.head(limit).iterrows():
        pdf_url = str(r.get("报告PDF链接", "") or "").strip()
        info_code = _extract_info_code(pdf_url)
        if not info_code:
            continue
        reports.append({
            "title": str(r.get("报告名称", "") or "").strip(),
            "org": str(r.get("机构", "") or "").strip(),
            "author": "",  # 该接口无作者字段
            "date": str(r.get("日期", "") or "").strip(),
            "industry": str(r.get("行业", "") or "").strip(),
            "rating": str(r.get("东财评级", "") or "").strip(),
            "info_code": info_code,
            "pages": 0,  # 该接口无页数字段
            "url": pdf_url,
        })

    return reports


def download_pdf(info_code: str, cache_dir: Path, timeout: int = 30) -> Optional[Path]:
    """
    下载研报 PDF 到缓存目录。
    如果本地已存在且大小 >1KB，直接返回。
    """
    pdf_path = cache_dir / f"{info_code}.pdf"
    if pdf_path.exists() and pdf_path.stat().st_size > 1024:
        return pdf_path

    url = PDF_BASE_URL.format(info_code=info_code)
    headers = {"User-Agent": USER_AGENTS[hash(info_code) % len(USER_AGENTS)]}

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            if len(data) < 1024:
                logger.warning("[research_report] PDF 下载内容过小: %s (%d bytes)", info_code, len(data))
                return None
            pdf_path.write_bytes(data)
            logger.info("[research_report] PDF 下载成功: %s (%d bytes)", info_code, len(data))
            return pdf_path
    except Exception as e:
        logger.warning("[research_report] PDF 下载失败 %s: %s", info_code, e)
        return None


def extract_pdf_text(pdf_path: Path, max_chars: int = 15000) -> str:
    """
    提取研报文本。支持 PDF（pdfplumber）和纯文本文件。
    返回前 max_chars 字符（避免过长）。
    """
    # 先尝试作为文本文件读取（有些"PDF"链接返回的是 HTML/文本）
    try:
        raw = pdf_path.read_bytes()
        # 如果是纯文本（非二进制PDF头），直接解码
        if not raw.startswith(b'%PDF'):
            text = raw.decode('utf-8', errors='ignore')
            return text[:max_chars]
    except Exception:
        pass

    pdfplumber = _safe_import_pdfplumber()
    if pdfplumber is None:
        logger.warning("[research_report] pdfplumber 未安装，跳过 PDF 解析")
        return ""

    try:
        text_parts = []
        with pdfplumber.open(str(pdf_path)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
        full_text = "\n".join(text_parts)
        return full_text[:max_chars]
    except Exception as e:
        logger.warning("[research_report] PDF 解析失败 %s: %s", pdf_path.name, e)
        return ""


# ── LLM 提取客观数据 ──────────────────────────────────────────────────────────

_OBJECTIVE_EXTRACTION_PROMPT = """你是一位严谨的数据提取专员。请从以下券商研报文本中提取「客观事实数据」，严格排除所有主观观点、投资建议和盈利预测。

研报标题：{title}
发布机构：{org}
发布日期：{date}

【必须提取的内容——按优先级排序】
**A. 行业层面客观数据（优先级最高）**
- 行业市场规模（全球/中国）、增速、渗透率
- 产业链上下游关键数据：产能、产能利用率、库存、价格走势
- 竞争格局：市占率排名、主要玩家份额
- 行业前置指标：存储芯片价格指数、DRAM/NAND 价格、晶圆代工价格、PMI等

**B. 公司层面客观数据（已披露的历史数据）**
- 营收、净利润、毛利率、净利率（已披露的财报数据）
- 销量/出货量、用户数、产能

**C. 宏观经济/政策**
- 相关宏观指标、政策变化（客观描述，不含解读）

【必须排除的内容】
- 投资评级、目标价
- 盈利预测表格（如"2026E 2027E 2028E"的未来预测数据）
- 投资建议、核心观点、投资结论
- 「看好」「推荐」「建议」「维持」「上调」等主观措辞
- 风险描述中带有倾向性的语言

【输出格式】
按以下分类输出，每个分类下用 bullet list：

**行业数据**
- ...

**公司数据**
- ...

**宏观/政策**
- ...

如果没有某类数据，该类输出"(无)"。严禁输出盈利预测表格。

---

研报文本：
{text}
"""


def extract_objective_data(text: str, title: str = "", org: str = "", date: str = "",
                           llm=None, max_text_len: int = 12000) -> str:
    """
    用 LLM 从研报文本中提取客观数据。
    如果 llm 不可用，降级为规则提取（正则匹配数字+关键词）。
    """
    if not text or len(text.strip()) < 100:
        return ""

    # 截断文本避免超出 LLM 上下文
    truncated = text[:max_text_len]

    if llm is not None:
        try:
            prompt = _OBJECTIVE_EXTRACTION_PROMPT.format(
                title=title or "未知",
                org=org or "未知",
                date=date or "未知",
                text=truncated,
            )
            resp = llm.chat(
                system="你是一位数据提取专员，只输出客观数据，绝不输出主观观点、评级或投资建议。",
                user_prompt=prompt,
                max_tokens=1200,
                temperature=0.1,
            )
            if resp and len(resp.strip()) > 10:
                return resp.strip()
        except Exception as e:
            logger.warning("[research_report] LLM 提取客观数据失败: %s", e)

    # 降级：规则提取（正则匹配含数字的关键句）
    return _rule_extract_objective(text)


def _rule_extract_objective(text: str) -> str:
    """规则提取：找含数字+行业/市场关键词的句子，过滤盈利预测表格。"""
    lines = []
    lines_industry = []
    lines_company = []
    # 行业关键词（优先级高）
    ind_keywords = re.compile(
        r"(?:全球|中国|行业|产业|市场|规模|容量|增速|增长|复合|CAGR|"
        r"半导体|存储|芯片|DRAM|NAND|NOR|MCU|模拟|代工|晶圆|"
        r"产能|产量|销量|出货量|库存|价格|指数|渗透率|市占率|份额|"
        r"WSTS|Gartner|ICInsights|弗若斯特沙利文|赛迪|"
        r"PMI|CPI|PPI|社零|固定资产投资)",
        re.IGNORECASE,
    )
    # 公司关键词
    co_keywords = re.compile(
        r"(?:营收|收入|净利润|毛利|净利率|毛利率|归母|扣非|"
        r"同比|环比|销量|出货量|产量|产能)",
        re.IGNORECASE,
    )
    # 排除盈利预测表格行（连续多列数字，含E/预测年份）
    forecast_pattern = re.compile(r"\d{4}E?\s+[\d,]+\s+[\d,]+\s+[\d,]+")
    # 排除投资建议行
    advice_pattern = re.compile(r"(?:买入|增持|中性|减持|卖出|评级|目标价|投资建议)")
    num_pattern = re.compile(r"[+-]?\d+\.?\d*[%亿万美元元]")

    for para in text.split("\n"):
        para = para.strip()
        if len(para) < 15 or len(para) > 250:
            continue
        # 跳过盈利预测表格
        if forecast_pattern.search(para):
            continue
        # 跳过投资建议
        if advice_pattern.search(para):
            continue
        # 跳过纯数字表格行
        if re.match(r"^[\d\s,\.\-%]+$", para):
            continue
        has_num = bool(num_pattern.search(para))
        if has_num and ind_keywords.search(para):
            lines_industry.append(f"- {para}")
        elif has_num and co_keywords.search(para):
            lines_company.append(f"- {para}")

    # 去重
    seen = set()
    result = []
    for item in lines_industry[:12] + lines_company[:8]:
        key = re.sub(r"\s+", "", item)
        if key not in seen:
            seen.add(key)
            result.append(item)

    if not result:
        return "(无客观数据)"

    header = "**行业数据**\n" if lines_industry else ""
    body = "\n".join(result)
    return header + body


# ── 主入口 ───────────────────────────────────────────────────────────────────

def get_research_report_data(code: str,
                             market: str = "a",
                             limit: int = 3,
                             llm=None,
                             max_chars: int = 15000) -> str:
    """
    获取研报客观数据的完整流程，返回可直接注入 prompt 的 Markdown 字符串。

    Args:
        code: 股票代码（A股6位 / HK 5位）
        market: "a" / "hk"
        limit: 最多处理几篇研报
        llm: LLM 客户端（用于提取客观数据，可选）
        max_chars: 每篇 PDF 最多提取字符数

    Returns:
        Markdown 字符串。失败时返回空字符串（不阻断主流程）。
    """
    # 港股暂不支持（akshare stock_research_report_em 对 HK 代码报错）
    if market == "hk" or not (len(code) == 6 and code.isdigit()):
        logger.info("[research_report] 暂只支持 A 股 6 位数字代码: %s", code)
        return ""

    reports = fetch_research_reports_em(code, limit=limit)
    if not reports:
        return ""

    cache_dir = CACHE_ROOT / code
    cache_dir.mkdir(parents=True, exist_ok=True)

    sections = []
    for r in reports:
        info_code = r["info_code"]
        title = r["title"]
        org = r["org"]
        date = r["date"]

        # 检查客观数据缓存
        obj_cache = cache_dir / f"{info_code}_objective.txt"
        if obj_cache.exists():
            obj_text = obj_cache.read_text(encoding="utf-8")
            if obj_text and len(obj_text) > 20:
                sections.append(
                    f"### 《{title}》({org}, {date})\n\n{obj_text}"
                )
                continue

        # 下载 PDF
        pdf_path = download_pdf(info_code, cache_dir)
        if not pdf_path:
            continue

        # 提取文本
        pdf_text = extract_pdf_text(pdf_path, max_chars=max_chars)
        if not pdf_text:
            continue

        # LLM 提取客观数据
        obj_text = extract_objective_data(
            pdf_text, title=title, org=org, date=date, llm=llm
        )
        if not obj_text:
            continue

        # 缓存客观数据
        try:
            obj_cache.write_text(obj_text, encoding="utf-8")
        except Exception:
            pass

        sections.append(f"### 《{title}》({org}, {date})\n\n{obj_text}")

        # 延时避免被封
        time.sleep(2)

    if not sections:
        return ""

    header = f"【券商研报客观数据 · {code} · 最近 {len(sections)} 篇】\n\n"
    header += "以下数据来自券商研报中的客观事实描述，已排除评级、目标价、盈利预测和投资建议。\n\n"
    return header + "\n\n".join(sections)


def summarize_for_prompt(text: str, max_total_chars: int = 2500) -> str:
    """
    截断研报数据到 prompt 友好长度。
    """
    if not text:
        return ""
    if len(text) <= max_total_chars:
        return text
    # 截断到段落边界
    truncated = text[:max_total_chars]
    last_para = truncated.rfind("\n\n")
    if last_para > max_total_chars * 0.7:
        truncated = truncated[:last_para]
    return truncated + "\n\n...（研报数据已截断）"


if __name__ == "__main__":
    # 本地快速测试
    logging.basicConfig(level=logging.INFO)
    result = get_research_report_data("600989", limit=1)
    print(result[:2000] if result else "(无数据)")
