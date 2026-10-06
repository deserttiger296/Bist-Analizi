import { backendRequest } from "@/lib/backend";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return backendRequest(`/api/scan/most-rsi/${encodeURIComponent(symbol)}` + new URL(request.url).search);
}
