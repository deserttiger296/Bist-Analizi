import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL } from "@/lib/backend";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VALID_MODES = ["report", "scan", "wfo", "chart"] as const;
const VALID_INTERVALS = ["15m", "1h", "4h", "1d"] as const;
const VALID_DIRECTIONS = ["all", "bull", "bear", "auto"] as const;
const VALID_SCALES = ["linear", "log"] as const;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = (searchParams.get("mode") || "report").toLowerCase();
  const symbols =
    searchParams.get("symbols") ||
    "VAKBN,ISCTR,GARAN,AKBNK,YKBNK,THYAO,ASELS,TUPRS,PGSUS,SISE,KCHOL,SAHOL,BIMAS";
  const symbol = (searchParams.get("symbol") || "THYAO").trim().toUpperCase();
  const interval = (searchParams.get("interval") || "1h").toLowerCase();
  const direction = (searchParams.get("direction") || (mode === "chart" ? "auto" : "all")).toLowerCase();
  const scale = (searchParams.get("scale") || "linear").toLowerCase();

  if (
    !VALID_MODES.includes(mode as any) ||
    !VALID_INTERVALS.includes(interval as any) ||
    !VALID_DIRECTIONS.includes(direction as any) ||
    !VALID_SCALES.includes(scale as any)
  ) {
    return NextResponse.json({ status: "error", detail: "Geçersiz İtki Lab parametresi." }, { status: 400 });
  }

  if (mode === "report") {
    try {
      const reportPath = path.join(process.cwd(), "public", "impulse-wfo-report.json");
      const raw = await fs.readFile(reportPath, "utf-8");
      return NextResponse.json(JSON.parse(raw), {
        headers: { "Cache-Control": "no-store" },
      });
    } catch {
      return NextResponse.json(
        { status: "error", detail: "Henüz yayınlanmış BIST100 WFO raporu bulunamadı." },
        { status: 404 }
      );
    }
  }

  if (mode === "chart" && !/^[A-Z0-9]{2,12}(?:\.IS)?$/.test(symbol)) {
    return NextResponse.json({ status: "error", detail: "Geçersiz hisse sembolü." }, { status: 400 });
  }

  // 1. FastAPI backend (/api/impulse-lab/...)
  try {
    const qs =
      mode === "chart"
        ? new URLSearchParams({ interval, direction, scale }).toString()
        : new URLSearchParams({ symbols, interval, direction, scale }).toString();
    const endpoint =
      mode === "chart"
        ? `${BACKEND_URL}/api/impulse-lab/chart/${encodeURIComponent(symbol)}?${qs}`
        : `${BACKEND_URL}/api/impulse-lab/${mode}?${qs}`;
    const res = await fetch(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(mode === "wfo" ? 110000 : 45000),
    });
    if (res.ok) {
      return NextResponse.json(await res.json(), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error) {
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {
      return NextResponse.json(
        { status: "error", detail: "İtki Lab süre sınırına ulaştı." },
        { status: 504 }
      );
    }
    // Local .venv fallback if backend server is offline
  }

  // 2. Local Python fallback
  try {
    const rootDir = process.cwd();
    const pyExe =
      process.platform === "win32"
        ? path.join(rootDir, ".venv", "Scripts", "python.exe")
        : path.join(rootDir, ".venv", "bin", "python");

    const symListExpr =
      symbols.trim().toUpperCase() === "ALL"
        ? "None"
        : JSON.stringify(
            symbols
              .split(",")
              .map((s) => s.trim().toUpperCase())
              .filter(Boolean)
          );

    const inlineCode =
      mode === "chart"
        ? `
import json, sys
from python_bot.engine.signals.impulse_wfo import get_symbol_impulse_overlay
if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
res = get_symbol_impulse_overlay(${JSON.stringify(symbol)}, interval=${JSON.stringify(interval)}, direction=${JSON.stringify(direction)}, scale=${JSON.stringify(scale)})
print(json.dumps(res, ensure_ascii=False))
`
        : mode === "wfo"
        ? `
import json, sys
from python_bot.engine.signals.impulse_wfo import run_impulse_wfo
if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
res = run_impulse_wfo(symbols=${symListExpr}, intervals=(${JSON.stringify(interval)},), direction=${JSON.stringify(direction)}, scale=${JSON.stringify(scale)})
print(json.dumps(res, ensure_ascii=False))
`
        : `
import json, sys
from python_bot.engine.signals.impulse_wfo import scan_bidirectional_impulses
if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
res = scan_bidirectional_impulses(symbols=${symListExpr}, interval=${JSON.stringify(interval)}, direction=${JSON.stringify(direction)}, scale=${JSON.stringify(scale)})
print(json.dumps(res, ensure_ascii=False))
`;

    const { stdout } = await execFileAsync(pyExe, ["-c", inlineCode], {
      cwd: rootDir,
      timeout: 110000,
      maxBuffer: 12 * 1024 * 1024,
    });
    const lines = stdout.trim().split(/\r?\n/);
    const data = JSON.parse(lines[lines.length - 1]);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return NextResponse.json(
      { status: "error", detail: err?.message || "İtki Lab çalıştırılamadı." },
      { status: 500 }
    );
  }
}
