import { backendRequest } from "@/lib/backend";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.symbol !== "string" || !/^[A-Za-z0-9.]{1,16}$/.test(body.symbol)) return Response.json({ status: "invalid_request", detail: "Geçerli sembol gerekli" }, { status: 400 });
    return backendRequest("/api/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: body.symbol.toUpperCase() }) });
  } catch { return Response.json({ status: "invalid_request" }, { status: 400 }); }
}
