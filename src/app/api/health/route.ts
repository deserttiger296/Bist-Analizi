import { backendRequest } from "@/lib/backend";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return backendRequest("/api/health");
}
