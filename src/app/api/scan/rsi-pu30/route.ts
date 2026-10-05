import { backendRequest } from "@/lib/backend";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  return backendRequest("/api/scan/rsi-pu30" + new URL(request.url).search);
}
