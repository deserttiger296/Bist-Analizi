"""BIST100 scan universe, shared by the full engine (main_api.py) and the
lightweight Vercel function (api/index.py).

Oct 2026: Yahoo returns no data for the renamed Koza tickers and a typo;
KOZAL->TRALT, KOZAA->TRMET, IPEKE->TRENJ, CWCME->CWENE (CW Enerji)."""
BIST100_SYMBOLS = [
    "AGHOL", "AKBNK", "AKCNS", "AKFGY", "AKSA", "AKSEN", "ALARK", "ALBRK", "ALFAS", "ARCLK",
    "ASELS", "ASTOR", "ASUZU", "AYDEM", "BAGFS", "BERA", "BIMAS", "BRISA", "BRSAN", "BUCIM",
    "CANTE", "CCOLA", "CEMAS", "CIMSA", "CWENE", "DOAS", "DOHOL", "ECILC", "EGEEN", "EKGYO",
    "ENJSA", "ENKAI", "ERBOS", "EREGL", "EUPWR", "EUREN", "FROTO", "GARAN", "GENIL", "GESAN",
    "GLYHO", "GUBRF", "GWIND", "HALKB", "HEKTS", "HLGYO", "ISCTR", "ISDMR", "ISGYO", "ISMEN",
    "IZMDC", "KARSN", "KCAER", "KCHOL", "KMPUR", "KONTR", "KONYA", "KORDS", "KRDMD", "KZBGY",
    "MAVI", "MGROS", "MIATK", "ODAS", "OTKAR", "OYAKC", "PENTA", "PETKM", "PGSUS", "PSGYO",
    "QUAGR", "SAHOL", "SASA", "SELEC", "SISE", "SMRTG", "SNGYO", "SOKM", "TABGD", "TAVHL",
    "TCELL", "THYAO", "TKFEN", "TOASO", "TRALT", "TRENJ", "TRMET", "TSKB", "TTKOM", "TTRAK",
    "TUKAS", "TUPRS", "ULKER", "VAKBN", "VESBE", "VESTL", "YEOTK", "YKBNK", "YYLGD", "ZOREN"
]
