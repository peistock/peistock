"""
topic_generator.py
Research Institute - 自动议题生成器
通过 searxng 搜索当日热点，生成研究议题
"""
import os
import logging
from typing import Dict, List

import requests

logger = logging.getLogger(__name__)

# 默认搜索模板（按角色/领域分类）
DEFAULT_SEARCH_QUERIES = [
    {"query": "今日财经热点 股市 A股", "category": "宏观", "roles": ["macro", "china_macro"]},
    {"query": "AI人工智能 投资 半导体 最新", "category": "TMT", "roles": ["tmt"]},
    {"query": "美联储 利率 政策 最新", "category": "宏观", "roles": ["macro"]},
    {"query": "原油 能源 电力 新能源", "category": "能源", "roles": ["energy"]},
    {"query": "量化 策略 因子 市场", "category": "量化", "roles": ["quant"]},
    {"query": "港股 美股 中概股 最新", "category": "策略", "roles": ["chief_strategist"]},
]

# 硬编码 fallback 议题（searxng 不可用时）
FALLBACK_TOPICS = [
    {"title": "宏观经济与政策动向", "roles": ["macro", "china_macro"], "query": "PMI 利率 社融"},
    {"title": "TMT 与 AI 产业进展", "roles": ["tmt"], "query": "AI CapEx 半导体"},
    {"title": "能源与公用事业", "roles": ["energy"], "query": "原油 电力"},
    {"title": "市场策略与配置", "roles": ["chief_strategist"], "query": "Mag7 板块轮动"},
    {"title": "量化信号扫描", "roles": ["quant"], "query": "因子 拥挤度"},
]


class TopicGenerator:
    """自动议题生成器"""

    def __init__(self, searxng_url: str = None):
        self.searxng_url = searxng_url or os.getenv("SEARXNG_URL", "http://localhost:8080")

    def generate(self, max_topics: int = 5) -> List[Dict]:
        """生成当日研究议题"""
        try:
            topics = self._search_and_extract()
            if not topics:
                logger.warning("searxng 未返回有效结果，使用 fallback 议题")
                return FALLBACK_TOPICS[:max_topics]
            return topics[:max_topics]
        except Exception as e:
            logger.error(f"议题生成失败: {e}")
            return FALLBACK_TOPICS[:max_topics]

    def _search_and_extract(self) -> List[Dict]:
        """搜索并提取议题"""
        all_results = []
        for item in DEFAULT_SEARCH_QUERIES:
            results = self._searxng_search(item["query"])
            for r in results:
                r["_category"] = item["category"]
                r["_roles"] = item["roles"]
            all_results.extend(results)

        if not all_results:
            return []

        return self._deduplicate_and_rank(all_results)

    def _searxng_search(self, query: str, max_results: int = 5) -> List[Dict]:
        """调用 searxng 搜索"""
        try:
            resp = requests.get(
                f"{self.searxng_url}/search",
                params={"q": query, "format": "json", "language": "zh-CN", "safesearch": "0"},
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [])
            # 只取前 max_results 条
            return [
                {
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "content": r.get("content", "")[:300],
                }
                for r in results[:max_results]
            ]
        except Exception as e:
            logger.warning(f"searxng 搜索失败 [{query}]: {e}")
            return []

    def _deduplicate_and_rank(self, results: List[Dict]) -> List[Dict]:
        """去重并生成议题"""
        seen = set()
        topics = []

        for r in results:
            title = r.get("title", "").strip()
            if not title or len(title) < 5:
                continue

            # 去重：标题前 8 个字符相同则认为重复
            key = title[:8]
            if key in seen:
                continue
            seen.add(key)

            topics.append({
                "title": title,
                "content": r.get("content", ""),
                "url": r.get("url", ""),
                "category": r.get("_category", "general"),
                "roles": r.get("_roles", []),
                "query": title,  # 分析师可用这个 query 进一步搜索
            })

        return topics

    def get_topics_for_role(self, role_slug: str, max_topics: int = 3) -> List[Dict]:
        """获取某个角色对应的当日议题"""
        all_topics = self.generate(max_topics=20)
        role_topics = [t for t in all_topics if role_slug in t.get("roles", [])]
        if not role_topics:
            # 如果没有匹配到，返回通用议题
            role_topics = [t for t in all_topics if not t.get("roles")]
        return role_topics[:max_topics]


if __name__ == "__main__":
    tg = TopicGenerator()
    topics = tg.generate()
    print(f"生成 {len(topics)} 个议题:")
    for t in topics:
        print(f"  [{t.get('category', 'general')}] {t['title']}")
        print(f"    关联角色: {t.get('roles', [])}")
