import { backendRequest } from "@/lib/backend";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return backendRequest("/api/scan/most-rsi" + new URL(request.url).search);
}
