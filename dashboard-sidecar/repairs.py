import json
import os
import sys
from pathlib import Path


class RepairsLogReader:
    """Tail /tmp/tool_repairs.jsonl, returning new request_ids since last read.

    Uses byte-offset tracking so we do not re-parse the full file on every poll.
    Handles: missing file (returns empty set), malformed lines (skipped),
    and file truncation (offset reset to 0).
    """

    def __init__(self, path: str):
        self.path = path
        self._offset = 0

    def read_new(self) -> set[str]:
        if not os.path.exists(self.path):
            return set()
        size = os.path.getsize(self.path)
        if size < self._offset:
            # File was truncated/rotated — start over
            self._offset = 0
        if size == self._offset:
            return set()
        ids: set[str] = set()
        with open(self.path, "r") as f:
            f.seek(self._offset)
            for raw in f:
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    print(f"repairs: skipping malformed line: {raw[:80]!r}", file=sys.stderr)
                    continue
                if obj.get("repaired") is True and obj.get("request_id"):
                    ids.add(obj["request_id"])
            self._offset = f.tell()
        return ids
