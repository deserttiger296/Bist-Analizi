import { redirect } from "next/navigation";

export default async function RsiPu30SymbolPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  redirect(`/index.html?symbol=${encodeURIComponent(symbol)}#rsipu30`);
}
