// Official BIST Index components (KAP Q4 2026: Oct-Dec 2026)
// BIST 30 components (30)
export const BIST_30 = [
  "AEFES", "AKBNK", "ASELS", "ASTOR", "BIMAS", "EKGYO", "ENKAI", "EREGL",
  "FROTO", "GARAN", "GUBRF", "ISCTR", "KCHOL", "KRDMD", "MGROS", "PETKM",
  "PGSUS", "SAHOL", "SASA", "SISE", "TAVHL", "TCELL", "THYAO", "TOASO",
  "TRALT", "TRMET", "TTKOM", "TUPRS", "VAKBN", "YKBNK",
];

// BIST 50 components (Includes BIST 30, total 50)
export const BIST_50 = [
  ...BIST_30,
  "AKSEN", "ALARK", "BRSAN", "BTCIM", "CANTE", "CCOLA", "CIMSA", "CVKMD",
  "CWENE", "DOAS", "ECILC", "ENERY", "GLRMK", "HALKB", "HEKTS", "MAVI",
  "OYAKC", "TSKB", "TURSG", "ULKER",
];

// BIST 100 components (Includes BIST 50, total 100)
export const BIST_100 = [
  ...BIST_50,
  "AGHOL", "AHGAZ", "AKCNS", "AKFYE", "AKSA", "ALBRK", "ALTNY", "ANHYT",
  "ANSGR", "ARCLK", "AYGAZ", "BERA", "BINHO", "BRYAT", "DOHOL", "ECZYT",
  "EGEEN", "EGGUB", "ENJSA", "ENTRA", "EUREN", "FENER", "GLYHO", "GRSEL",
  "GWIND", "ISDMR", "ISMEN", "KARSN", "KATMR", "KCAER", "KORDS", "LMKDC",
  "MPARK", "OBAMS", "ODAS", "OTKAR", "PAHOL", "RGYAS", "RYSAS", "SNGYO",
  "SOKM", "TABGD", "TCKRC", "TKFEN", "TRENJ", "TRGYO", "TTRAK", "TUKAS",
  "VESTL", "ZOREN",
];

/**
 * Determines the primary index tag for a given symbol.
 */
export function getIndexTag(symbol: string): string {
  const cleanSymbol = symbol.replace('.IS', '').toUpperCase();

  if (BIST_30.includes(cleanSymbol)) return "BIST 30";
  if (BIST_50.includes(cleanSymbol)) return "BIST 50";
  if (BIST_100.includes(cleanSymbol)) return "BIST 100";

  return "BIST TÜM"; // Not in top 100, so it's a smaller cap / broad market stock
}
