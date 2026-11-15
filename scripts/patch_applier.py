#!/usr/bin/env python3
"""Safe targeted context extractor, JSON patch applier, and backup restorer for agentic autofix."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BLOCKED_DIR_PARTS = {
    ".git",
    "node_modules",
    ".next",
    ".venv",
    "venv",
    ".cache",
    "__pycache__",
    "dist",
    "build",
}

BLOCKED_FILE_EXTENSIONS = {".pem", ".key", ".pfx", ".p12", ".jks"}

DEFAULT_MAX_FILES = 4
DEFAULT_WINDOW_LINES = 40

# Matches file paths with extensions optionally followed by :line(:col) or Python ', line N'
PATH_LINE_RE = re.compile(
    r"""(?P<path>(?:[A-Za-z]:[\\/]|[./\\]{1,2})?[A-Za-z0-9_.\-/\\]+?\.(?:ts|tsx|js|jsx|mjs|cjs|py|ps1|json|css|scss))(?::(?P<line>\d+)(?::\d+)?|["'],\s*line\s+(?P<pyline>\d+))?""",
    re.IGNORECASE,
)


def _is_blocked_relative_path(rel_path: Path) -> str | None:
    """Returns a rejection reason if the relative path points to a forbidden location or secret."""
    parts = rel_path.parts
    if not parts:
        return "Empty path is not allowed"
    for part in parts:
        lower = part.lower()
        if lower in BLOCKED_DIR_PARTS:
            return f"Blocked directory component: {part}"
        if lower.startswith(".env"):
            return f"Blocked secret/env file: {part}"
    if rel_path.suffix.lower() in BLOCKED_FILE_EXTENSIONS:
        return f"Blocked sensitive file extension: {rel_path.suffix}"
    return None


def resolve_safe_repo_path(repo_root: Path, candidate: str) -> tuple[Path, Path]:
    """Resolves a candidate path strictly inside repo_root and validates safety rules."""
    cleaned = candidate.strip().replace("\\", "/")
    cleaned = re.sub(r"^webpack-internal:///(\([^)]+\)/)?", "", cleaned)
    if cleaned.startswith("./"):
        cleaned = cleaned[2:]

    root_resolved = repo_root.resolve()
    raw_path = Path(candidate.strip())
    if raw_path.is_absolute():
        target_resolved = raw_path.resolve()
    else:
        target_resolved = (root_resolved / cleaned).resolve()

    try:
        rel_path = target_resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise ValueError(f"Path escapes repository root: {candidate}") from exc

    reason = _is_blocked_relative_path(rel_path)
    if reason:
        raise ValueError(f"{reason} ({rel_path.as_posix()})")

    return target_resolved, rel_path


def _extract_candidate_locations(error_text: str, repo_root: Path) -> list[tuple[Path, Path, int | None]]:
    """Finds unique existing repository files (and optional 1-based line numbers) in error text."""
    seen: dict[str, tuple[Path, Path, int | None]] = {}
    root_resolved = repo_root.resolve()

    for match in PATH_LINE_RE.finditer(error_text):
        raw = match.group("path")
        line_str = match.group("line") or match.group("pyline")
        line_num = int(line_str) if line_str else None

        # Strip URL/webpack prefixes if present before trying resolution
        candidates = [raw]
        norm = raw.replace("\\", "/")
        for anchor in ("src/", "python_bot/", "scripts/", "public/", "bist_agent_core/"):
            idx = norm.find(anchor)
            if idx != -1:
                candidates.insert(0, norm[idx:])
                break

        for cand in candidates:
            try:
                target, rel = resolve_safe_repo_path(root_resolved, cand)
            except ValueError:
                continue
            if not target.is_file():
                continue
            key = rel.as_posix()
            if key not in seen:
                seen[key] = (target, rel, line_num)
            elif seen[key][2] is None and line_num is not None:
                seen[key] = (target, rel, line_num)
            break

    return list(seen.values())


def extract_context_snippets(
    repo_root: Path,
    error_text: str,
    window_lines: int = DEFAULT_WINDOW_LINES,
    max_files: int = DEFAULT_MAX_FILES,
) -> list[dict[str, Any]]:
    """Extracts small line-numbered code snippets around files referenced in error_text."""
    locations = _extract_candidate_locations(error_text, repo_root)[:max_files]
    snippets: list[dict[str, Any]] = []
    half = max(5, window_lines // 2)

    for target, rel, line_num in locations:
        try:
            text = target.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        lines = text.splitlines()
        total = len(lines)
        if total == 0:
            continue

        if line_num is not None and line_num > 0:
            start = max(1, line_num - half)
            end = min(total, start + window_lines - 1)
            start = max(1, end - window_lines + 1)
        else:
            start = 1
            end = min(total, window_lines)

        rendered = "\n".join(f"{idx}: {lines[idx - 1]}" for idx in range(start, end + 1))
        snippets.append(
            {
                "file": rel.as_posix(),
                "start_line": start,
                "end_line": end,
                "focus_line": line_num,
                "content": rendered,
            }
        )

    return snippets


def parse_llm_patch_json(raw_text: str) -> dict[str, Any]:
    """Parses JSON patch payload even if wrapped in markdown code fences or explanatory prose."""
    text = raw_text.strip()
    if not text:
        raise ValueError("Empty LLM response")

    # Prefer fenced json block if present
    fenced = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    candidates = list(fenced)
    candidates.append(text)

    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        candidates.append(text[first_brace : last_brace + 1])

    last_err: Exception | None = None
    for cand in candidates:
        try:
            parsed = json.loads(cand)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError as exc:
            last_err = exc

    raise ValueError(f"Could not parse JSON patch payload: {last_err}")


def _apply_single_edit(content: str, search: str, replace: str) -> str:
    """Replaces an exact unique match, normalizing CRLF/LF cleanly while preserving original line endings."""
    if not search:
        raise ValueError("Edit 'search' block cannot be empty")

    exact_count = content.count(search)
    if exact_count == 1:
        return content.replace(search, replace, 1)
    if exact_count > 1:
        raise ValueError(f"Edit 'search' matched {exact_count} times (must match uniquely)")

    # Fallback: normalize CRLF to LF for comparison on Windows repos
    had_crlf = "\r\n" in content
    norm_content = content.replace("\r\n", "\n")
    norm_search = search.replace("\r\n", "\n")
    norm_replace = replace.replace("\r\n", "\n")

    norm_count = norm_content.count(norm_search)
    if norm_count == 0:
        raise ValueError("Edit 'search' block not found in target file")
    if norm_count > 1:
        raise ValueError(f"Edit 'search' matched {norm_count} times after newline normalization")

    updated = norm_content.replace(norm_search, norm_replace, 1)
    if had_crlf:
        updated = updated.replace("\n", "\r\n")
    return updated


def apply_patch_payload(
    repo_root: Path,
    payload: dict[str, Any],
    backup_root: Path | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Validates and atomically applies search/replace edits with automatic backup creation."""
    edits = payload.get("edits")
    if not isinstance(edits, list) or len(edits) == 0:
        raise ValueError("JSON payload must contain a non-empty 'edits' array")

    root_cause = str(payload.get("root_cause") or "").strip()
    root_resolved = repo_root.resolve()

    # Stage 1: Validate and compute all file states in memory before writing anything
    pending_contents: dict[Path, str] = {}
    rel_map: dict[Path, Path] = {}
    original_bytes: dict[Path, bytes] = {}
    reasons: list[dict[str, str]] = []

    for idx, edit in enumerate(edits):
        if not isinstance(edit, dict):
            raise ValueError(f"Edit #{idx} is not an object")
        file_arg = str(edit.get("file") or "").strip()
        search = edit.get("search")
        replace = edit.get("replace")
        reason = str(edit.get("reason") or "").strip()

        if not file_arg:
            raise ValueError(f"Edit #{idx} is missing 'file'")
        if not isinstance(search, str) or not isinstance(replace, str):
            raise ValueError(f"Edit #{idx} must have string 'search' and 'replace'")

        target, rel = resolve_safe_repo_path(root_resolved, file_arg)
        if not target.is_file():
            raise ValueError(f"Target file does not exist: {rel.as_posix()}")

        if target not in pending_contents:
            raw_bytes = target.read_bytes()
            original_bytes[target] = raw_bytes
            pending_contents[target] = raw_bytes.decode("utf-8")
            rel_map[target] = rel

        updated = _apply_single_edit(pending_contents[target], search, replace)
        pending_contents[target] = updated
        reasons.append({"file": rel.as_posix(), "reason": reason})

    changed_targets = [
        target for target, new_text in pending_contents.items() if new_text.encode("utf-8") != original_bytes[target]
    ]
    if not changed_targets:
        raise ValueError("Edits produced no effective file changes")

    changed_rel_paths = [rel_map[t].as_posix() for t in changed_targets]
    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "root_cause": root_cause,
            "changed_files": changed_rel_paths,
            "reasons": reasons,
        }

    # Stage 2: Create backup snapshot
    backup_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"_{os.getpid()}"
    base_backup_root = (backup_root or (root_resolved / ".cache" / "autofix_backups")).resolve()
    backup_dir = base_backup_root / backup_id
    backup_dir.mkdir(parents=True, exist_ok=True)

    manifest_entries: list[dict[str, Any]] = []
    for target in changed_targets:
        rel = rel_map[target]
        backup_rel = rel.as_posix()
        backup_file = (backup_dir / rel).resolve()
        backup_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, backup_file)
        sha_before = hashlib.sha256(original_bytes[target]).hexdigest()
        manifest_entries.append(
            {
                "file": rel.as_posix(),
                "backup_file": backup_rel,
                "sha256_before": sha_before,
            }
        )

    manifest = {
        "backup_id": backup_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "repo_root": str(root_resolved),
        "root_cause": root_cause,
        "files": manifest_entries,
        "reasons": reasons,
    }
    manifest_path = backup_dir / ".manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    # Stage 3: Write updated contents
    for target in changed_targets:
        with open(target, "w", encoding="utf-8", newline="") as handle:
            handle.write(pending_contents[target])

    return {
        "ok": True,
        "dry_run": False,
        "backup_id": backup_id,
        "backup_dir": str(backup_dir),
        "root_cause": root_cause,
        "changed_files": changed_rel_paths,
        "reasons": reasons,
    }


def restore_backup(repo_root: Path, backup_dir: Path) -> dict[str, Any]:
    """Restores files from a backup directory containing .manifest.json."""
    root_resolved = repo_root.resolve()
    backup_resolved = backup_dir.resolve()
    manifest_path = backup_resolved / ".manifest.json"
    if not manifest_path.is_file():
        raise ValueError(f"Backup manifest not found: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest.get("files")
    if not isinstance(files, list):
        raise ValueError("Invalid backup manifest format")

    restored: list[str] = []
    for entry in files:
        rel_str = str(entry["file"])
        backup_rel = str(entry.get("backup_file") or rel_str)
        target, rel = resolve_safe_repo_path(root_resolved, rel_str)
        src_backup = (backup_resolved / backup_rel).resolve()
        try:
            src_backup.relative_to(backup_resolved)
        except ValueError as exc:
            raise ValueError(f"Backup path escapes backup directory: {backup_rel}") from exc
        if not src_backup.is_file():
            raise ValueError(f"Missing backup snapshot file: {src_backup}")

        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_backup, target)
        restored.append(rel.as_posix())

    return {
        "ok": True,
        "backup_id": manifest.get("backup_id"),
        "restored_files": restored,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Targeted context & safe patch applier")
    sub = parser.add_subparsers(dest="command", required=True)

    p_ctx = sub.add_parser("extract-context", help="Extract line-numbered snippets from error paths")
    p_ctx.add_argument("--repo-root", default=".")
    p_ctx.add_argument("--error-text", default="")
    p_ctx.add_argument("--error-file", default="")
    p_ctx.add_argument("--window", type=int, default=DEFAULT_WINDOW_LINES)
    p_ctx.add_argument("--max-files", type=int, default=DEFAULT_MAX_FILES)
    p_ctx.add_argument("--format", choices=("json", "text"), default="text")

    p_apply = sub.add_parser("apply", help="Validate and apply JSON patch response with backup")
    p_apply.add_argument("--repo-root", default=".")
    p_apply.add_argument("--response-file", required=True)
    p_apply.add_argument("--backup-root", default="")
    p_apply.add_argument("--dry-run", action="store_true")

    p_restore = sub.add_parser("restore", help="Restore files from an autofix backup directory")
    p_restore.add_argument("--repo-root", default=".")
    p_restore.add_argument("--backup-dir", required=True)

    args = parser.parse_args(argv)
    repo_root = Path(args.repo_root).resolve()

    try:
        if args.command == "extract-context":
            err_text = args.error_text
            if args.error_file:
                err_text = Path(args.error_file).read_text(encoding="utf-8", errors="replace")
            snippets = extract_context_snippets(
                repo_root=repo_root,
                error_text=err_text,
                window_lines=args.window,
                max_files=args.max_files,
            )
            if args.format == "json":
                print(json.dumps({"ok": True, "snippets": snippets}, indent=2, ensure_ascii=False))
            else:
                for item in snippets:
                    focus = f" (focus line {item['focus_line']})" if item["focus_line"] else ""
                    print(f"=== {item['file']} (L{item['start_line']}-L{item['end_line']}){focus} ===")
                    print(item["content"])
                    print()
            return 0

        if args.command == "apply":
            raw = Path(args.response_file).read_text(encoding="utf-8", errors="replace")
            payload = parse_llm_patch_json(raw)
            backup_root = Path(args.backup_root).resolve() if args.backup_root else None
            result = apply_patch_payload(
                repo_root=repo_root,
                payload=payload,
                backup_root=backup_root,
                dry_run=args.dry_run,
            )
            print(json.dumps(result, indent=2, ensure_ascii=False))
            return 0

        if args.command == "restore":
            result = restore_backup(repo_root=repo_root, backup_dir=Path(args.backup_dir))
            print(json.dumps(result, indent=2, ensure_ascii=False))
            return 0

    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1

    return 1


if __name__ == "__main__":
    sys.exit(main())
