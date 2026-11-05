import { NextRequest, NextResponse } from "next/server";
import { SNIPER_ENGINE_URL } from "@/lib/backend";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") || "impulse";
  const symbols = searchParams.get("symbols") || "VAKBN,ISCTR,GARAN,AKBNK,YKBNK,THYAO,ASELS,TUPRS";
  const interval = searchParams.get("interval") || "1h";
  const suite = searchParams.get("suite") || "pu30";

  // 1. Önce çalışan Python FastAPI motoruna (/api/lab) bağlanmayı dene
  try {
    const qs = new URLSearchParams({ mode, symbols, interval, suite }).toString();
    const res = await fetch(`${SNIPER_ENGINE_URL}/api/lab?${qs}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // FastAPI sunucusu kapalıysa doğrudan yerel .venv Python motoru üzerinden çalıştır
  }

  // 2. Fallback: Doğrudan yerel Python (.venv) üzerinden çalıştır
  try {
    const rootDir = process.cwd();
    const pyExe = process.platform === "win32"
      ? path.join(rootDir, ".venv", "Scripts", "python.exe")
      : path.join(rootDir, ".venv", "bin", "python");

    const inlineCode = `
import json, sys
from python_bot.signal_api import run_lab_suite
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
res = run_lab_suite(mode=${JSON.stringify(mode)}, symbols=${JSON.stringify(symbols)}, interval=${JSON.stringify(interval)}, suite=${JSON.stringify(suite)})
print(json.dumps(res, ensure_ascii=False))
`;
    const { stdout } = await execFileAsync(pyExe, ["-c", inlineCode], {
      cwd: rootDir,
      timeout: 90000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const lines = stdout.trim().split(/\r?\n/);
    const lastJsonLine = lines[lines.length - 1];
    return NextResponse.json(JSON.parse(lastJsonLine));
  } catch (err: any) {
    return NextResponse.json(
      { status: "error", detail: err?.message || "Lab çalıştırılamadı" },
      { status: 500 }
    );
  }
}
