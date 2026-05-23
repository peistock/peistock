"""core/data_sandbox.py — 数据预处理沙盒

让 LLM 写 Python 脚本处理原始数据，只把结论数字注入 prompt。
不直接执行任意代码，通过关键词黑名单 + 超时 + 受限 locals 控制风险。
"""
import io
import sys
import signal
import math
from typing import Dict, Any, Optional

# 尝试导入 pandas，不可用则降级
_try_pandas = None
try:
    import pandas as _try_pandas  # type: ignore
except Exception:
    pass

# 黑名单关键词（大小写不敏感）
_BLOCKLIST = {
    "__import__", "__builtins__", "__class__", "__base__", "__subclasses__",
    "open", "file", "os", "sys", "subprocess", "eval", "exec", "compile",
    "input", "raw_input", "breakpoint", "pty", "socket", "urllib", "http",
    "ftp", "ssh", "telnet", "pickle", "marshal", "ctypes", "ffi",
    "importlib", "imp", "modulefinder", "zipimport",
}


def _alarm_handler(signum, frame):
    raise TimeoutError("Sandbox 执行超时（5秒）")


class DataSandbox:
    """在受限环境中执行用户提供的 Python 代码片段，只返回 stdout。"""

    TIMEOUT_SECONDS = 5

    def __init__(self):
        self._locals: Dict[str, Any] = {
            "print": print,
            "len": len,
            "range": range,
            "enumerate": enumerate,
            "zip": zip,
            "sum": sum,
            "min": min,
            "max": max,
            "abs": abs,
            "round": round,
            "math": math,
            "float": float,
            "int": int,
            "str": str,
            "dict": dict,
            "list": list,
            "tuple": tuple,
            "set": set,
            "sorted": sorted,
            "filter": filter,
            "map": map,
            "any": any,
            "all": all,
        }
        if _try_pandas is not None:
            self._locals["pd"] = _try_pandas
            self._locals["pandas"] = _try_pandas

    def _check_code(self, code: str) -> Optional[str]:
        """检查代码是否包含危险关键词。返回拒绝原因或 None。

        使用词边界匹配，避免子字符串误杀（如 "os" 误伤 "close"）。
        """
        import re
        for word in _BLOCKLIST:
            # \b 匹配单词边界，确保是独立 token
            pattern = r'\b' + re.escape(word.lower()) + r'\b'
            if re.search(pattern, code.lower()):
                return f"代码包含禁用关键词: {word}"
        return None

    def execute(self, code: str, data: Dict[str, Any]) -> str:
        """在沙箱中执行代码，返回 stdout 内容。

        Args:
            code: Python 代码片段
            data: 预注入的数据字典（如 {"klines": [...], "news": [...]}）

        Returns:
            捕获的 stdout 字符串
        """
        reason = self._check_code(code)
        if reason:
            return f"[SANDBOX_REJECTED] {reason}"

        # 构造受限执行环境（把 data 包成变量注入，而不是展开键值对）
        sandbox_locals = dict(self._locals)
        sandbox_locals["data"] = data

        # 重定向 stdout
        old_stdout = sys.stdout
        buf = io.StringIO()
        sys.stdout = buf

        # 设置超时
        old_handler = signal.signal(signal.SIGALRM, _alarm_handler)
        signal.alarm(self.TIMEOUT_SECONDS)

        try:
            exec(code, {"__builtins__": {}}, sandbox_locals)
        except TimeoutError:
            return "[SANDBOX_TIMEOUT] 执行超过 5 秒"
        except Exception as e:
            return f"[SANDBOX_ERROR] {type(e).__name__}: {e}"
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old_handler)
            sys.stdout = old_stdout

        return buf.getvalue()


def build_kline_script(days: int = 300) -> str:
    """返回预置的 K 线指标提取脚本模板。

    脚本从 klines 列表中提取关键指标，只输出 3-5 个结论数字。
    klines 格式假设为 List[Dict]，每个 Dict 包含 open/high/low/close/volume。
    """
    return f'''# 从 klines 提取关键指标（只输出结论数字，不输出原始数据）
klines = data.get("klines", [])
if not klines or len(klines) < 20:
    print("数据不足（需至少20天）")
else:
    closes = [float(k["close"]) for k in klines if "close" in k]
    volumes = [float(k.get("volume", 0)) for k in klines]
    n = len(closes)

    # MA20 斜率（最近一天 vs 前一天）
    ma20 = [sum(closes[i-20:i]) / 20 for i in range(20, n)]
    ma20_slope = ma20[-1] - ma20[-2] if len(ma20) >= 2 else 0
    print(f"MA20斜率: {{ma20_slope:.4f}}")

    # 最新收盘价
    print(f"最新收盘价: {{closes[-1]:.2f}}")

    # 20日振幅
    high20 = max(closes[-20:])
    low20 = min(closes[-20:])
    amplitude20 = (high20 - low20) / low20 * 100 if low20 else 0
    print(f"20日振幅: {{amplitude20:.2f}}%")

    # 量价关系（近5日均量 vs 前5日均量）
    if len(volumes) >= 10:
        vol_recent = sum(volumes[-5:]) / 5
        vol_before = sum(volumes[-10:-5]) / 5
        vol_ratio = vol_recent / vol_before if vol_before else 0
        print(f"量比(近5日/前5日): {{vol_ratio:.2f}}")

    # 简单趋势判断（收盘价在 MA20 上方还是下方）
    position = "上方" if closes[-1] > ma20[-1] else "下方"
    print(f"收盘价相对MA20: {{position}}")
'''
