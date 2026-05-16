"""
vector_store.py
Research Institute - FAISS 向量检索层
移植自 ResearchOS Local，适配 research-institute 接口
"""
import json
import time
from pathlib import Path
from typing import Dict, List, Optional

# 延迟加载，避免初始化时占用过多资源
_faiss = None
_model = None


def _init_faiss():
    global _faiss, _model
    if _faiss is None:
        import faiss
        from sentence_transformers import SentenceTransformer
        _faiss = faiss
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        print("[VectorStore] FAISS + sentence-transformers 已加载")


class VectorStore:
    """FAISS 向量存储：按角色分类索引历史报告"""

    def __init__(self, index_dir: str = "./storage/vector_index"):
        self.index_dir = Path(index_dir)
        self.index_dir.mkdir(parents=True, exist_ok=True)

        # 每个角色一个 FAISS 索引 + 元数据
        self._indices: Dict[str, _faiss.IndexFlatL2] = {}
        self._metas: Dict[str, List[Dict]] = {}

        _init_faiss()
        self._load_all()

    # ---------- 内部加载/保存 ----------

    def _index_path(self, slug: str) -> Path:
        return self.index_dir / f"{slug}.faiss"

    def _meta_path(self, slug: str) -> Path:
        return self.index_dir / f"{slug}.json"

    def _load_all(self):
        for meta_path in self.index_dir.glob("*.json"):
            slug = meta_path.stem
            self._load_one(slug)

    def _load_one(self, slug: str):
        idx_path = self._index_path(slug)
        meta_path = self._meta_path(slug)

        if idx_path.exists() and meta_path.exists():
            self._indices[slug] = _faiss.read_index(str(idx_path))
            self._metas[slug] = json.loads(meta_path.read_text(encoding="utf-8"))
        else:
            self._indices[slug] = _faiss.IndexFlatL2(384)
            self._metas[slug] = []

    def _save_one(self, slug: str):
        if slug in self._indices:
            _faiss.write_index(self._indices[slug], str(self._index_path(slug)))
            self._meta_path(slug).write_text(
                json.dumps(self._metas[slug], ensure_ascii=False, indent=2),
                encoding="utf-8"
            )

    # ---------- 核心接口 ----------

    def add_report(self, slug: str, date_str: str, content: str) -> bool:
        """将报告存入向量库"""
        if not content or len(content.strip()) < 100:
            return False

        # 首次使用时初始化该角色的索引
        if slug not in self._indices:
            self._indices[slug] = _faiss.IndexFlatL2(384)
            self._metas[slug] = []

        # 取前 800 字作为摘要
        summary = content.strip()[:800]

        # 生成向量
        vector = _model.encode([summary], convert_to_numpy=True)

        # 添加到对应角色的索引
        self._indices[slug].add(vector)
        self._metas[slug].append({
            "date": date_str,
            "slug": slug,
            "summary": summary,
            "added_at": int(time.time()),
        })

        self._save_one(slug)
        return True

    def retrieve_similar(self, slug: str, query: str, top_k: int = 3) -> List[Dict]:
        """检索某角色历史报告中与 query 最相似的 top_k 条"""
        if slug not in self._indices or self._indices[slug].ntotal == 0:
            return []

        query_vec = _model.encode([query], convert_to_numpy=True)
        distances, indices = self._indices[slug].search(query_vec, top_k)

        results = []
        for idx, dist in zip(indices[0], distances[0]):
            if idx < 0 or idx >= len(self._metas[slug]):
                continue
            meta = self._metas[slug][idx].copy()
            meta["distance"] = float(dist)
            results.append(meta)
        return results

    def get_stats(self) -> Dict:
        """统计信息"""
        return {
            slug: {"count": idx.ntotal}
            for slug, idx in self._indices.items()
        }


# 单例
_vector_store: Optional[VectorStore] = None


def get_vector_store() -> VectorStore:
    global _vector_store
    if _vector_store is None:
        _vector_store = VectorStore()
    return _vector_store


if __name__ == "__main__":
    vs = VectorStore()
    vs.add_report("macro", "20260505", "今日宏观：PMI 50.3，制造业扩张...")
    vs.add_report("macro", "20260504", "昨日宏观：PMI 49.8，制造业收缩...")
    results = vs.retrieve_similar("macro", "制造业 PMI 走势", top_k=2)
    print(f"检索结果: {len(results)} 条")
    for r in results:
        print(f"  [{r['date']}] {r['summary'][:60]}... (距离: {r['distance']:.3f})")
