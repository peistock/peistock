"""
国内大模型通用适配层
- 支持所有 OpenAI-compatible API（DeepSeek、Kimi、通义、智谱、字节等）
- 统一封装 chat_completion，屏蔽各家差异
- 自动处理 JSON 模式、重试、降级
"""
import os
import json
import logging
from typing import List, Dict, Optional

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

logger = logging.getLogger(__name__)

# 默认配置：LM Studio 本地模型
DEFAULT_BASE_URL = "http://127.0.0.1:1234/v1"
DEFAULT_API_KEY = "lm-studio"
DEFAULT_MODEL_DAILY = "qwen3.6-plus"
DEFAULT_MODEL_COMPLEX = "qwen3.6-plus"
DEFAULT_MODEL_SUMMARY = "qwen3.6-plus"


class LLMClient:
    """通用 LLM 客户端"""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def _init(self):
        if OpenAI is None:
            raise ImportError("请安装 openai SDK: pip install openai>=1.0.0")

        base_url = os.getenv("LLM_BASE_URL", DEFAULT_BASE_URL)
        api_key = os.getenv("LLM_API_KEY", DEFAULT_API_KEY)

        if not api_key:
            logger.warning("LLM_API_KEY 未设置，模型调用将失败")

        self.client = OpenAI(base_url=base_url, api_key=api_key, timeout=180)
        self.model_daily = os.getenv("MODEL_DAILY", DEFAULT_MODEL_DAILY)
        self.model_complex = os.getenv("MODEL_COMPLEX", DEFAULT_MODEL_COMPLEX)
        self.model_summary = os.getenv("MODEL_SUMMARY", DEFAULT_MODEL_SUMMARY)
        self.reasoning_effort = os.getenv("REASONING_EFFORT", "").strip() or None
        self._initialized = True

        logger.info(f"LLM 客户端初始化: base_url={base_url}, daily={self.model_daily}, complex={self.model_complex}")

    def chat(self, system: str, user_prompt: str, model: str = None, max_tokens: int = 1500,
             temperature: float = 0.7, json_mode: bool = False, reasoning_effort: str = None) -> str:
        """
        统一对话接口
        - system: 系统提示词
        - user_prompt: 用户输入
        - model: 指定模型，None 则用 daily 模型
        - json_mode: 是否强制输出 JSON
        - reasoning_effort: 覆盖实例默认的 reasoning_effort（None 则使用实例默认值）
        """
        self._init()

        if not self.client.api_key:
            return ""

        model = model or self.model_daily
        _effort = reasoning_effort if reasoning_effort is not None else self.reasoning_effort

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_prompt}
        ]

        try:
            kwargs = {
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }

            # JSON 模式（各家支持情况不同，优先用 prompt 约束）
            if json_mode:
                # DeepSeek/Kimi/通义都支持 response_format={"type": "json_object"}
                kwargs["response_format"] = {"type": "json_object"}

            # DeepSeek v4 thinking mode
            if _effort:
                kwargs["extra_body"] = {"reasoning_effort": _effort}

            resp = self.client.chat.completions.create(**kwargs)
            msg = resp.choices[0].message
            content = msg.content or ""
            if not content and hasattr(msg, "reasoning_content") and msg.reasoning_content:
                content = msg.reasoning_content
            return content.strip()

        except Exception as e:
            logger.error(f"LLM 调用失败 [{model}]: {e}")
            # 降级：复杂模型失败时切 daily 模型重试一次
            if model != self.model_daily:
                logger.info(f"降级到 {self.model_daily} 重试...")
                try:
                    kwargs["model"] = self.model_daily
                    resp = self.client.chat.completions.create(**kwargs)
                    msg = resp.choices[0].message
                    content = msg.content or ""
                    if not content and hasattr(msg, "reasoning_content") and msg.reasoning_content:
                        content = msg.reasoning_content
                    return content
                except Exception as e2:
                    logger.error(f"降级也失败: {e2}")
            return ""

    def chat_messages(self, messages: list,
                      model: str = None, max_tokens: int = 4096,
                      temperature: float = 0.7,
                      reasoning_effort: str = None) -> str:
        """
        单轮直接调用：传入完整 messages 列表，返回 content 文本。
        绕过 AgentLoop，用于数据已预注入、无需 tool calling 的场景。
        """
        self._init()
        if not self.client.api_key:
            return ""

        model = model or self.model_daily
        # 优先使用传入的 reasoning_effort，否则回退到实例默认值
        _effort = reasoning_effort if reasoning_effort is not None else self.reasoning_effort
        try:
            kwargs = {
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
            if _effort:
                kwargs["extra_body"] = {"reasoning_effort": _effort}

            resp = self.client.chat.completions.create(**kwargs)
            msg = resp.choices[0].message
            # 优先返回普通 content；如果为空但存在 reasoning_content，回退到 reasoning_content
            content = msg.content or ""
            if not content and hasattr(msg, "reasoning_content") and msg.reasoning_content:
                content = msg.reasoning_content
            return content
        except Exception as e:
            logger.error(f"LLM 单轮调用失败 [{model}]: {e}")
            # 降级重试
            if model != self.model_daily:
                logger.info(f"降级到 {self.model_daily} 重试...")
                try:
                    kwargs["model"] = self.model_daily
                    resp = self.client.chat.completions.create(**kwargs)
                    msg = resp.choices[0].message
                    content = msg.content or ""
                    if not content and hasattr(msg, "reasoning_content") and msg.reasoning_content:
                        content = msg.reasoning_content
                    return content
                except Exception as e2:
                    logger.error(f"降级也失败: {e2}")
            return ""

    def chat_with_tools(self, messages: list, tools: list = None,
                        model: str = None, max_tokens: int = 4096,
                        temperature: float = 0.7) -> Optional[dict]:
        """
        Tool Calling 接口：传入消息历史（含 tool results），返回 LLM 响应
        响应包含 .choices[0].message.content 或 .choices[0].message.tool_calls
        """
        self._init()

        if not self.client.api_key:
            return None

        model = model or self.model_complex

        try:
            kwargs = {
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = "auto"

            # DeepSeek v4 thinking mode
            if self.reasoning_effort:
                kwargs["extra_body"] = {"reasoning_effort": self.reasoning_effort}

            resp = self.client.chat.completions.create(**kwargs)
            return resp
        except Exception as e:
            logger.error(f"LLM Tool Calling 失败 [{model}]: {e}")
            return None

    def is_ready(self) -> bool:
        """检查客户端是否可用"""
        try:
            self._init()
            return self.client is not None
        except:
            return False


# 全局快捷函数
def chat(system: str, user_prompt: str, model: str = None, **kwargs) -> str:
    """快捷调用"""
    return LLMClient().chat(system, user_prompt, model, **kwargs)

def chat_with_tools(messages: list, tools: list = None, model: str = None, **kwargs):
    """Tool Calling 快捷调用"""
    return LLMClient().chat_with_tools(messages, tools, model, **kwargs)
