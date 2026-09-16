"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="inline-flex items-center justify-center rounded-full bg-cyan-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 print:hidden shadow-lg shadow-cyan-900/50"
    >
      🖨️ PDF İndir (Yazdır)
    </button>
  );
}
