// Snapshot of BIST Index components to categorize stocks
// BIST 30 components
export const BIST_30 = [
  "AKBNK", "ALARK", "ARCLK", "ASELS", "ASTOR", "BIMAS", "BRSAN", 
  "CCOLA", "CWENE", "ENKAI", "EREGL", "EUPWR", "FROTO", "GARAN", 
  "GUBRF", "HEKTS", "ISCTR", "KCHOL", "KONTR", "KRDMD", "ODAS", 
  "PGSUS", "PETKM", "SAHOL", "SASA", "SISE", "TCELL", "THYAO", 
  "TOASO", "TUPRS", "YKBNK", "TTKOM"
];

// BIST 50 components (Includes BIST 30)
export const BIST_50 = [
  ...BIST_30,
  "AEFES", "AGHOL", "AHGAZ", "AKCNS", "AKSA", "AKSEN", "ALFAS", 
  "ARASE", "AYDEM", "BERA", "BRYAT", "CANTE", "CIMSA", "DOAS", 
  "DOHOL", "ECILC", "EGEEN", "EKGYO", "ENJSA", "GESAN", "GWIND", 
  "HALKB", "ISMEN", "KORDS", "KOZAA", "KOZAL", "LOGO", "MGROS", 
  "MIATK", "OYAKC", "QUAGR", "SKBNK", "SMRTG", "SOKM", "TAVHL", 
  "TKFEN", "TSKB", "TUKAS", "ULKER", "VAKBN", "VESBE", "VESTL"
];

// BIST 100 components (Includes BIST 50)
// Rather than listing all 100, we'll provide the additional prominent ones
// In practice, this list should be updated periodically.
export const BIST_100 = [
  ...BIST_50,
  "ADESE", "AFYON", "AGROT", "AKFGY", "AKFYE", "AKSGY", "ALBRK", 
  "ALCAR", "ALKLC", "ANELE", "ANSGR", "ASUZU", "ATATP", "AYEN", 
  "AYGAZ", "BAKAB", "BANVT", "BASGZ", "BEYAZ", "BIENY", "BIOEN", 
  "BLCYT", "BOBET", "BOSSA", "BRISA", "BTCIM", "BUCIM", "CATES", 
  "CEMTS", "CLEBI", "CRFSA", "DEVA", "DGNMO", "DOGUB", "ECZYT", 
  "EDATA", "EGGUB", "EGPRO", "ENERY", "ERBOS", "ESEN", "EUREN", 
  "FENER", "FLAP", "FONET", "GENIL", "GLYHO", "GOLTS", "GOODY", 
  "GOZDE", "GRSEL", "GSDHO", "GSRAY", "HLGYO", "HUNER", "ICBCT", 
  "IHLAS", "INDES", "INFO", "INVEO", "ISFIN", "ISGYO", "JANTS", 
  "KAREL", "KARSN", "KATMR", "KAYSE", "KCAER", "KLKIM", "KLSER", 
  "KMPUR", "KONYA", "KOTON", "KRDMA", "KRDMB", "KZBGY", "LIDER", 
  "MAVI", "MEGAP", "MPARK", "NATEN", "NETAS", "NTHOL", "NUHCM", 
  "OBAMS", "ORCAY", "OTKAR", "OYYAT", "PENTA", "PETUN", "PINSU", 
  "PNLSN", "PNSUT", "POLHO", "PRKAB", "PRKME", "PSGYO", "QNBFK", 
  "QNBTR", "RALYH", "RYGYO", "RYSAS", "SANKO", "SARKY", "SELEC", 
  "SMART", "SNGYO", "SUWEN", "TATGD", "TEKTU", "TRCAS", "TRGYO", 
  "TRILC", "TTRAK", "TURGG", "TURSG", "ULUUN", "YATAS", "YGGYO", 
  "YYLGD", "ZOREN"
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
