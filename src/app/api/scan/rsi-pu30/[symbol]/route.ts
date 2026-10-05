import { backendRequest } from "@/lib/backend";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return backendRequest(`/api/scan/rsi-pu30/${encodeURIComponent(symbol)}` + new URL(request.url).search);
}
