#!/usr/bin/env python3
"""Compare two Chrome/V8 .heapsnapshot files for soak-test regressions."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def load_nodes(path: Path) -> list:
    text = path.read_text(encoding="utf-8", errors="replace")
    # V8 heap snapshots are JSON with a trailing nodes array in "snapshot" section
    data = json.loads(text)
    return data["nodes"]


def node_field_count(data: dict) -> int:
    meta = data["snapshot"]["meta"]
    return len(meta["node_fields"])


def parse_snapshot(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    data = json.loads(text)
    meta = data["snapshot"]["meta"]
    fields = meta["node_fields"]
    types = meta["node_types"][0]
    strings = data["strings"]
    nodes = data["nodes"]
    stride = len(fields)

    idx_type = fields.index("type")
    idx_name = fields.index("name")
    idx_size = fields.index("self_size")

    type_counts: dict[str, int] = {}
    type_bytes: dict[str, int] = {}
    name_counts: dict[str, int] = {}
    total_bytes = 0
    object_count = 0

    for i in range(0, len(nodes), stride):
        chunk = nodes[i : i + stride]
        ntype = types[chunk[idx_type]]
        name_idx = chunk[idx_name]
        name = strings[name_idx] if 0 <= name_idx < len(strings) else str(name_idx)
        size = chunk[idx_size]
        total_bytes += size
        object_count += 1
        type_counts[ntype] = type_counts.get(ntype, 0) + 1
        type_bytes[ntype] = type_bytes.get(ntype, 0) + size
        key = f"{ntype}:{name}"
        name_counts[key] = name_counts.get(key, 0) + 1

    return {
        "path": str(path),
        "total_mb": total_bytes / (1024 * 1024),
        "object_count": object_count,
        "type_counts": type_counts,
        "type_bytes": type_bytes,
        "name_counts": name_counts,
    }


def fmt_delta(a: float, b: float, suffix: str = "") -> str:
    d = b - a
    sign = "+" if d >= 0 else ""
    return f"{sign}{d:.1f}{suffix}"


def main() -> int:
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <before.heapsnapshot> <after.heapsnapshot>", file=sys.stderr)
        return 1

    before = parse_snapshot(Path(sys.argv[1]))
    after = parse_snapshot(Path(sys.argv[2]))

    print(f"Before: {before['path']}")
    print(f"  total: {before['total_mb']:.1f} MB  objects: {before['object_count']:,}")
    print(f"After:  {after['path']}")
    print(f"  total: {after['total_mb']:.1f} MB  objects: {after['object_count']:,}")
    print()
    print(
        f"Delta:  {fmt_delta(before['total_mb'], after['total_mb'], ' MB')}  "
        f"objects {fmt_delta(before['object_count'], after['object_count'], '')}"
    )
    print()

    print("Type bytes delta (top 10):")
    all_types = set(before["type_bytes"]) | set(after["type_bytes"])
    deltas = []
    for t in all_types:
        deltas.append((after["type_bytes"].get(t, 0) - before["type_bytes"].get(t, 0), t))
    deltas.sort(reverse=True)
    for delta, t in deltas[:10]:
        if delta == 0:
            continue
        b_mb = before["type_bytes"].get(t, 0) / (1024 * 1024)
        a_mb = after["type_bytes"].get(t, 0) / (1024 * 1024)
        print(f"  {t:16} {b_mb:8.1f} -> {a_mb:8.1f} MB  ({fmt_delta(b_mb, a_mb, ' MB')})")

    print()
    print("Named node count delta (top 15 by abs delta):")
    all_names = set(before["name_counts"]) | set(after["name_counts"])
    name_deltas = []
    for k in all_names:
        name_deltas.append((after["name_counts"].get(k, 0) - before["name_counts"].get(k, 0), k))
    name_deltas.sort(key=lambda x: abs(x[0]), reverse=True)
    for delta, k in name_deltas[:15]:
        if delta == 0:
            continue
        print(f"  {delta:+7}  {k}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
