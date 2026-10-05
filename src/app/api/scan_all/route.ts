import { backendRequest } from "@/lib/backend";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return backendRequest("/api/scan_all" + new URL(request.url).search);
}
