#!/usr/bin/env python3
"""
极简搜索代理 —— 兼容 SearXNG /search API
跑在 8080 端口，供 rebel_research LLM search_web 工具调用
底层：百度/必应/搜狗网页搜索 + 结果解析

背景：JD Cloud 服务器 GFW 屏蔽 Docker Hub/GitHub，无法部署 SearXNG Docker。
改用此轻量级 Python HTTP 代理直接抓取搜索引擎结果，返回 SearXNG 兼容 JSON 格式。
"""
import re
import json
import logging
import urllib.parse
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)


def _fetch_baidu(query: str, max_results: int = 5) -> list:
    """百度网页搜索，解析结果"""
    try:
        url = "https://www.baidu.com/s"
        params = urllib.parse.urlencode({"wd": query, "rn": max_results * 2, "tn": "json"})
        req = urllib.request.Request(f"{url}?{params}", headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "zh-CN,zh;q=0.9",
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        results = []
        # 百度结果解析：标题 + 摘要 + URL
        # 新版百度结构
        for m in re.finditer(r'<div[^>]*class="[^"]*result[^"]*"[^>]*>.*?</div>\s*</div>\s*</div>', html, re.S):
            block = m.group(0)
            title_match = re.search(r'<a[^>]*>\s*(.*?)\s*</a>', block, re.S)
            title = re.sub(r'<[^>]+>', '', title_match.group(1) if title_match else "").strip()

            url_match = re.search(r'href\s*=\s*"([^"]+)"', block)
            result_url = url_match.group(1) if url_match else ""
            # 百度跳转链接处理
            if result_url.startswith("/"):
                result_url = "https://www.baidu.com" + result_url

            content_match = re.search(r'<span[^>]*class="content-right_8Zs40"[^>]*>(.*?)</span>', block, re.S)
            if not content_match:
                content_match = re.search(r'<span[^>]*>(.*?)</span>', block, re.S)
            content = re.sub(r'<[^>]+>', '', content_match.group(1) if content_match else "").strip()[:200]

            if title and result_url:
                results.append({
                    "title": title,
                    "url": result_url,
                    "content": content,
                    "engine": "baidu"
                })

        return results[:max_results]
    except Exception as e:
        logger.warning(f"百度搜索失败: {e}")
        return []


def _fetch_bing(query: str, max_results: int = 5) -> list:
    """必应网页搜索，解析结果"""
    try:
        url = "https://cn.bing.com/search"
        params = urllib.parse.urlencode({"q": query, "count": max_results * 2})
        req = urllib.request.Request(f"{url}?{params}", headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "text/html",
            "Accept-Language": "zh-CN,zh;q=0.9",
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        results = []
        # 必应结果块
        for m in re.finditer(r'<li class="b_algo"[^>]*>(.*?)</li>', html, re.S):
            block = m.group(1)
            title_match = re.search(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
            if not title_match:
                continue
            result_url = title_match.group(1)
            title = re.sub(r'<[^>]+>', '', title_match.group(2)).strip()

            content_match = re.search(r'<p[^>]*>(.*?)</p>', block, re.S)
            content = re.sub(r'<[^>]+>', '', content_match.group(1) if content_match else "").strip()[:200]

            if title and result_url:
                results.append({
                    "title": title,
                    "url": result_url,
                    "content": content,
                    "engine": "bing"
                })

        return results[:max_results]
    except Exception as e:
        logger.warning(f"必应搜索失败: {e}")
        return []


def _fetch_sogou(query: str, max_results: int = 5) -> list:
    """搜狗网页搜索，解析结果"""
    try:
        url = "https://www.sogou.com/web"
        params = urllib.parse.urlencode({"query": query, "page": 1, "ie": "utf8"})
        req = urllib.request.Request(f"{url}?{params}", headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": "https://www.sogou.com/",
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        results = []
        # 搜狗结果块
        for m in re.finditer(r'<div class="vrwrap"[^>]*>(.*?)</div>\s*</div>', html, re.S):
            block = m.group(1)

            # 标题和链接
            title_match = re.search(r'<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>\s*</h3>', block, re.S)
            if not title_match:
                # 尝试另一种格式
                title_match = re.search(r'<a[^>]*href="([^"]+)"[^>]*>\s*(.*?)\s*</a>', block, re.S)
            if not title_match:
                continue

            result_url = title_match.group(1)
            title = re.sub(r'<[^>]+>', '', title_match.group(2)).strip()

            # 搜狗有跳转链接，需要处理
            if result_url.startswith("/"):
                result_url = "https://www.sogou.com" + result_url

            # 摘要
            content_match = re.search(r'<p class="str\-text"[^>]*>(.*?)</p>', block, re.S)
            if not content_match:
                content_match = re.search(r'<div class="str\-text"[^>]*>(.*?)</div>', block, re.S)
            if not content_match:
                content_match = re.search(r'<p[^>]*class="[^"]*text[^"]*"[^>]*>(.*?)</p>', block, re.S)
            content = re.sub(r'<[^>]+>', '', content_match.group(1) if content_match else "").strip()[:200]

            if title and result_url and len(title) > 3:
                results.append({
                    "title": title,
                    "url": result_url,
                    "content": content,
                    "engine": "sogou"
                })

        return results[:max_results]
    except Exception as e:
        logger.warning(f"搜狗搜索失败: {e}")
        return []


class SearchHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        logger.info(format % args)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/search":
            self.send_response(404)
            self.end_headers()
            return

        qs = urllib.parse.parse_qs(parsed.query)
        query = qs.get("q", [""])[0]
        fmt = qs.get("format", ["html"])[0]
        max_results = int(qs.get("count", ["5"])[0])

        if not query:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error": "missing q"}')
            return

        logger.info(f"搜索: {query}")

        # 并行调百度 + 必应 + 搜狗，合并去重
        baidu_results = _fetch_baidu(query, max_results)
        bing_results = _fetch_bing(query, max_results)
        sogou_results = _fetch_sogou(query, max_results)

        seen = set()
        merged = []
        for r in baidu_results + bing_results + sogou_results:
            url = r.get("url", "")
            if url and url not in seen:
                seen.add(url)
                merged.append(r)

        results = merged[:max_results]

        if fmt == "json":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"query": query, "results": results}, ensure_ascii=False).encode("utf-8"))
        else:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            html = f"<h1>搜索: {query}</h1><ul>"
            for r in results:
                html += f'<li><a href="{r["url"]}">{r["title"]}</a><br>{r["content"]}...</li>'
            html += "</ul>"
            self.wfile.write(html.encode("utf-8"))

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()


def run_server(port=8080):
    server = HTTPServer(("127.0.0.1", port), SearchHandler)
    logger.info(f"搜索代理启动: http://127.0.0.1:{port}/search?q=xxx&format=json")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
