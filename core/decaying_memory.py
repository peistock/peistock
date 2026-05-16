"""
core/decaying_memory.py
Decaying memory with tombstone mechanism
"""
import sqlite3
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

class DecayingMemoryStore:
    def __init__(self, db_path: str = "data/memory.db", decay_config: Dict = None):
        self.db_path = db_path
        self.decay_config = decay_config or {
            "narrative_based": 0.70,
            "earnings_based": 0.95,
            "macro_based": 0.85,
            "technical": 0.60,
            "min_confidence": 30
        }
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init_tables()

    def _init_tables(self):
        cursor = self.conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS claims (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                claim_id TEXT UNIQUE,
                content TEXT,
                claim_type TEXT,
                original_confidence REAL,
                current_confidence REAL,
                created_at TEXT,
                last_decayed TEXT,
                is_tombstoned INTEGER DEFAULT 0,
                tombstone_reason TEXT,
                metadata TEXT
            )
        """)
        self.conn.commit()

    def add_claim(self, content: str, claim_type: str, confidence: float, metadata: Dict = None):
        claim_id = "claim_" + datetime.now().strftime("%Y%m%d%H%M%S")
        cursor = self.conn.cursor()
        cursor.execute("""
            INSERT INTO claims (claim_id, content, claim_type, original_confidence, current_confidence, created_at, last_decayed, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (claim_id, content, claim_type, confidence, confidence, datetime.now().isoformat(), datetime.now().isoformat(), json.dumps(metadata or {})))
        self.conn.commit()
        return claim_id

    def _calculate_current_confidence(self, claim: sqlite3.Row) -> float:
        if claim["is_tombstoned"]:
            return 0.0
        age_days = (datetime.now() - datetime.fromisoformat(claim["created_at"])).days
        decay_rate = self.decay_config.get(claim["claim_type"], 0.80)
        current = claim["original_confidence"] * (decay_rate ** age_days)
        return max(current, 0)

    def decay_all(self):
        """Run decay on all active claims, tombstone those below threshold"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM claims WHERE is_tombstoned = 0")
        min_conf = self.decay_config.get("min_confidence", 30)

        for row in cursor.fetchall():
            current = self._calculate_current_confidence(row)
            if current < min_conf:
                # Tombstone
                cursor.execute("""
                    UPDATE claims SET current_confidence = 0, is_tombstoned = 1, tombstone_reason = 'Decay below threshold'
                    WHERE id = ?
                """, (row["id"],))
            else:
                cursor.execute("""
                    UPDATE claims SET current_confidence = ?, last_decayed = ?
                    WHERE id = ?
                """, (current, datetime.now().isoformat(), row["id"]))
        self.conn.commit()

    def search_active(self, keyword: str, limit: int = 5) -> List[Dict]:
        """Search only active (non-tombstoned) claims with current confidence"""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM claims WHERE is_tombstoned = 0 AND content LIKE ?
            ORDER BY current_confidence DESC
            LIMIT ?
        """, ("%" + keyword + "%", limit))
        results = []
        for row in cursor.fetchall():
            current = self._calculate_current_confidence(row)
            if current >= self.decay_config.get("min_confidence", 30):
                results.append({
                    "claim_id": row["claim_id"],
                    "content": row["content"][:100],
                    "type": row["claim_type"],
                    "current_confidence": round(current, 1),
                    "age_days": (datetime.now() - datetime.fromisoformat(row["created_at"])).days
                })
        return results

    def tombstone_claim(self, claim_id: str, reason: str):
        """Manually tombstone a claim when proven wrong"""
        cursor = self.conn.cursor()
        cursor.execute("""
            UPDATE claims SET is_tombstoned = 1, tombstone_reason = ?, current_confidence = 0
            WHERE claim_id = ?
        """, (reason, claim_id))
        self.conn.commit()

    def stats(self) -> Dict:
        cursor = self.conn.cursor()
        cursor.execute("SELECT COUNT(*) as total FROM claims")
        total = cursor.fetchone()["total"]
        cursor.execute("SELECT COUNT(*) as active FROM claims WHERE is_tombstoned = 0")
        active = cursor.fetchone()["active"]
        cursor.execute("SELECT COUNT(*) as dead FROM claims WHERE is_tombstoned = 1")
        dead = cursor.fetchone()["dead"]
        return {"total": total, "active": active, "tombstoned": dead}
