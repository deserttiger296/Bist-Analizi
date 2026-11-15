"""Unit tests for scripts/patch_applier.py safe patching, backups, and context extraction."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import patch_applier  # noqa: E402


def test_apply_and_restore_preserves_crlf_and_content(tmp_path: Path) -> None:
    src_dir = tmp_path / "src"
    src_dir.mkdir(parents=True)
    target = src_dir / "demo.ts"
    original_bytes = b"export function greet() {\r\n  return 'broken';\r\n}\r\n"
    target.write_bytes(original_bytes)

    raw_llm = """Here is the minimal fix:
```json
{
  "root_cause": "Wrong string returned",
  "edits": [
    {
      "file": "src/demo.ts",
      "search": "  return 'broken';",
      "replace": "  return 'fixed';",
      "reason": "Return fixed value"
    }
  ]
}
```
"""
    payload = patch_applier.parse_llm_patch_json(raw_llm)
    res = patch_applier.apply_patch_payload(
        repo_root=tmp_path,
        payload=payload,
        backup_root=tmp_path / ".cache" / "backups",
    )

    assert res["ok"] is True
    assert res["changed_files"] == ["src/demo.ts"]
    updated_bytes = target.read_bytes()
    assert b"return 'fixed';" in updated_bytes
    assert b"\r\n" in updated_bytes

    backup_dir = Path(res["backup_dir"])
    assert (backup_dir / ".manifest.json").is_file()

    restored = patch_applier.restore_backup(repo_root=tmp_path, backup_dir=backup_dir)
    assert restored["ok"] is True
    assert restored["restored_files"] == ["src/demo.ts"]
    assert target.read_bytes() == original_bytes


@pytest.mark.parametrize(
    "bad_path",
    [
        "../outside.ts",
        ".env",
        ".env.local",
        ".git/config",
        "node_modules/pkg/index.js",
        "certs/private.key",
    ],
)
def test_blocks_unsafe_paths(tmp_path: Path, bad_path: str) -> None:
    payload = {
        "root_cause": "malicious path test",
        "edits": [
            {
                "file": bad_path,
                "search": "a",
                "replace": "b",
                "reason": "should fail",
            }
        ],
    }
    with pytest.raises(ValueError):
        patch_applier.apply_patch_payload(repo_root=tmp_path, payload=payload)


def test_atomic_abort_on_second_edit_failure(tmp_path: Path) -> None:
    src_dir = tmp_path / "src"
    src_dir.mkdir(parents=True)
    file_a = src_dir / "a.ts"
    file_b = src_dir / "b.ts"
    file_a.write_text("const a = 1;\n", encoding="utf-8")
    file_b.write_text("const b = 1;\nconst b2 = 1;\n", encoding="utf-8")

    payload = {
        "root_cause": "ambiguous second match",
        "edits": [
            {"file": "src/a.ts", "search": "const a = 1;", "replace": "const a = 2;", "reason": "ok"},
            {"file": "src/b.ts", "search": "= 1;", "replace": "= 2;", "reason": "ambiguous"},
        ],
    }

    with pytest.raises(ValueError, match="matched 2 times"):
        patch_applier.apply_patch_payload(repo_root=tmp_path, payload=payload)

    # Ensure first file remained untouched because validation runs before writing
    assert file_a.read_text(encoding="utf-8") == "const a = 1;\n"


def test_extract_context_handles_python_and_ts_traces(tmp_path: Path) -> None:
    py_file = tmp_path / "python_bot" / "sample.py"
    py_file.parent.mkdir(parents=True)
    py_file.write_text("\n".join(f"line_{i} = {i}" for i in range(1, 31)), encoding="utf-8")

    env_file = tmp_path / ".env.local"
    env_file.write_text("SECRET=123\n", encoding="utf-8")

    trace = (
        f'Traceback (most recent call last):\n'
        f'  File "{py_file}", line 20, in run\n'
        f'  secret check at .env.local:1\n'
    )
    snippets = patch_applier.extract_context_snippets(repo_root=tmp_path, error_text=trace, window_lines=10)
    assert len(snippets) == 1
    assert snippets[0]["file"] == "python_bot/sample.py"
    assert snippets[0]["focus_line"] == 20
    assert "20: line_20 = 20" in snippets[0]["content"]
