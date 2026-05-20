from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from dokimasia.agents.pi import PiAdapter
from dokimasia.pytest import assert_tool_called, tool_calls


@pytest.mark.agent_e2e
def test_pi_prefers_skeleton_then_function_for_source_exploration(doki_factory, tmp_path: Path):
    repo_root = Path(__file__).resolve().parents[2]
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    source_path = workspace / "src" / "checkout.ts"
    source_path.parent.mkdir()
    source_path.write_text(
        """
export interface CartLine {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

export function calculateSubtotal(lines: CartLine[]): number {
  return lines.reduce((total, line) => total + line.quantity * line.unitPriceCents, 0);
}

export function applyDiscount(subtotalCents: number, couponCode?: string): number {
  if (couponCode === "SAVE10") return Math.round(subtotalCents * 0.9);
  return subtotalCents;
}

export function finalizeCheckout(lines: CartLine[], couponCode?: string): number {
  const subtotal = calculateSubtotal(lines);
  return applyDiscount(subtotal, couponCode);
}
""".strip()
        + "\n",
        encoding="utf-8",
    )

    doki = doki_factory(
        agent=PiAdapter(
            skills_dir=skills_dir,
            extra_args=[
                "--no-extensions",
                "-e",
                str(repo_root),
                "--wayfinder-mode",
                "preferred",
                "--no-context-files",
            ],
        ),
        workspace=workspace,
        timeout_seconds=300,
    )

    result = doki.run(
        "Explore src/checkout.ts and explain how finalizeCheckout computes its result. "
        "Use the codebase tools normally; do not guess from the filename.",
        artifact_name="wayfinder tool choice",
    )

    assert result.ok, result.failure_summary

    assert_tool_called(result, tool="get_file_skeleton", where=_targets_checkout_source)
    assert_tool_called(result, tool="get_function", where=_targets_finalize_checkout)

    target_events = tool_calls(result, where=_targets_checkout_source)
    target_tools = [event.tool for event in target_events]
    skeleton_index = _index(target_tools, "get_file_skeleton")
    function_index = _index(target_tools, "get_function")
    assert skeleton_index < function_index, _tool_sequence_debug(result)

    first_source_read_index = min(
        (_index(target_tools, tool) for tool in ("read", "read_file") if tool in target_tools),
        default=None,
    )
    if first_source_read_index is not None:
        assert function_index < first_source_read_index, _tool_sequence_debug(result)


def _targets_checkout_source(event: Any) -> bool:
    args = event.raw.get("args", {})
    if not isinstance(args, dict):
        return False
    if event.tool in {"get_file_skeleton", "get_function", "read_file"}:
        paths = args.get("paths")
        return isinstance(paths, list) and any("src/checkout.ts" in str(path) for path in paths)
    return event.tool == "read" and "src/checkout.ts" in str(args.get("path", ""))


def _targets_finalize_checkout(event: Any) -> bool:
    if not _targets_checkout_source(event):
        return False
    args = event.raw.get("args", {})
    function_names = args.get("function_names", []) if isinstance(args, dict) else []
    return isinstance(function_names, list) and "finalizeCheckout" in [str(name) for name in function_names]


def _index(values: list[str | None], target: str) -> int:
    try:
        return values.index(target)
    except ValueError:
        return 10**9


def _tool_sequence_debug(result: Any) -> str:
    calls = [{"tool": event.tool, "args": event.raw.get("args")} for event in tool_calls(result)]
    return f"tool calls: {calls}\nstdout: {result.stdout_path}\nstderr: {result.stderr_path}"
