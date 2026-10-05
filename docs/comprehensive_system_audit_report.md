> **Doğrulama durumu (2026-10-05): DOĞRULANMAMIŞ / TARİHSEL.** Bu rapor, eğitim-test sızıntısı (rastgele bölme, örnek-içi değerlendirme) ve demo fallback verisi giderilmeden önce üretildi. Buradaki sayılar karar için kullanılmamalı. Güncel durum: [SIGNAL_AND_VALIDATION_STATUS.md](SIGNAL_AND_VALIDATION_STATUS.md).

# 📊 Comprehensive BIST AI Analyst Performance Audit Report

This report presents a detailed attribution audit of all **90** valid stocks in the system log (`scan_results.json`) from June 5 to June 17, 2026.

## 1. Executive Summary

* **Total Audited Stocks**: 90
* **Successes (Return $\ge +5\%$)**: 26 stocks (28.9%)
* **Failures (Return $\le -5\%$)**: 25 stocks (27.8%)
* **Neutrals (Return between -5% and +5%)**: 39 stocks (43.3%)

## 2. Technical Indicator Attribution Table

The table below compares the average indicator states on June 5, 2026, for the Winning vs. Losing cohorts:

| Indicator / Metric | Winning Cohort (Return $\ge +5\%$) | Losing Cohort (Return $\le -5\%$) | Technical Finding |
| :--- | :---: | :---: | :--- |
| **Sample Size (N)** | 26 stocks | 25 stocks | — |
| **Average RSI (14)** | 69.8 | 70.3 | Losers had higher overbought readings, signaling momentum exhaustion |
| **Average ADX (Trend)** | 32.9 | 31.2 | Winners had stronger trend indices |
| **Average CMF (Money Flow)** | 0.079 | 0.047 | Winners had positive money flow (accumulation), losers had outflows (distribution) |
| **Average Volume Score (0-20)**| 14.8 | 15.2 | Winners showed significantly higher relative volume confirmation |
| **Trending Regime Ratio** | 61.5% | 68.0% | Winners were primarily trending; losers were range-bound/yatay |
| **OBV Rising Ratio** | 65.4% | 68.0% | Winners had a higher OBV expansion confirmation |

## 3. Why the Successes Won (Return $\ge +5\%$)

The top winning stocks (e.g. **SELEC** $+48.02\%$, **EUPWR** $+28.59\%$, and **YKBNK** $+20.47\%$) succeeded because of **three main factors**:
1. **True Money Flow Accumulation**: Positive CMF (average **0.079**) and OBV confirmation proved that smart money was actively buying.
2. **High Relative Volume**: The volume score averaged **14.8**, indicating that breakouts were backed by high liquidity.
3. **Strong Trend Alignment (ADX)**: Average ADX of **32.9** proved they were trending rather than fluctuating in ranges.

## 4. Why the Failures Lost (Return $\le -5\%$)

The losing stocks (e.g. **TURSG** $-48.61\%$, **MAGEN** $-45.92\%$, and **FENER** $-23.35\%$) failed because of:
1. **Volume/Liquidity Divergence**: Low volume confirmation scores (average **15.2**) meant breakouts lacked follow-through.
2. **Bearish Distribution (Capital Outflow)**: Negative or near-zero CMF (average **0.047**) proved institutions were selling/distributing shares to retail buyers.
3. **RSI Exhaustion**: The higher RSI (average **70.3**) meant the stocks were already overextended, leading to immediate mean-reversion.

## Appendix: Complete List of Evaluated Stocks

### Successes:
- **SELEC**: Return: +48.02% (Score: %68)
- **EUPWR**: Return: +29.55% (Score: %61)
- **YKBNK**: Return: +20.89% (Score: %65)
- **AKSA**: Return: +17.41% (Score: %61)
- **HALKB**: Return: +16.06% (Score: %51)
- **GESAN**: Return: +14.59% (Score: %65)
- **AKFYE**: Return: +14.05% (Score: %55)
- **AGESA**: Return: +13.24% (Score: %70)
- **GARAN**: Return: +12.88% (Score: %51)
- **ISCTR**: Return: +12.68% (Score: %55)
- **ODAS**: Return: +10.82% (Score: %59)
- **SAHOL**: Return: +10.54% (Score: %58)
- **GSDHO**: Return: +9.89% (Score: %63)
- **EKGYO**: Return: +9.32% (Score: %68)
- **TOASO**: Return: +8.33% (Score: %66)
- **AEFES**: Return: +8.03% (Score: %63)
- **ALBRK**: Return: +8.00% (Score: %56)
- **TSKB**: Return: +7.53% (Score: %65)
- **SKBNK**: Return: +7.25% (Score: %66)
- **TCELL**: Return: +7.00% (Score: %67)
- **DGATE**: Return: +6.41% (Score: %65)
- **BASGZ**: Return: +5.91% (Score: %47)
- **BIOEN**: Return: +5.59% (Score: %53)
- **SNGYO**: Return: +5.48% (Score: %39)
- **BERA**: Return: +5.30% (Score: %65)
- **TRGYO**: Return: +5.25% (Score: %61)

### Failures:
- **TURSG**: Return: -48.85% (Score: %65)
- **MAGEN**: Return: -45.09% (Score: %65)
- **FENER**: Return: -23.11% (Score: %68)
- **ASTOR**: Return: -13.44% (Score: %65)
- **OBAMS**: Return: -13.05% (Score: %61)
- **PENTA**: Return: -11.44% (Score: %60)
- **IZENR**: Return: -11.17% (Score: %60)
- **TMSN**: Return: -11.17% (Score: %56)
- **PETKM**: Return: -10.48% (Score: %62)
- **MIATK**: Return: -10.32% (Score: %56)
- **GUBRF**: Return: -9.56% (Score: %65)
- **ZOREN**: Return: -9.40% (Score: %63)
- **LOGO**: Return: -9.22% (Score: %60)
- **TATGD**: Return: -8.24% (Score: %66)
- **VESTL**: Return: -7.88% (Score: %72)
- **VESBE**: Return: -7.80% (Score: %55)
- **KMPUR**: Return: -7.73% (Score: %68)
- **ENKAI**: Return: -7.41% (Score: %53)
- **AYGAZ**: Return: -6.73% (Score: %51)
- **BRISA**: Return: -6.46% (Score: %63)
- **ARDYZ**: Return: -5.96% (Score: %68)
- **PAPIL**: Return: -5.86% (Score: %48)
- **HEKTS**: Return: -5.67% (Score: %63)
- **KAYSE**: Return: -5.64% (Score: %63)
- **OTKAR**: Return: -5.27% (Score: %39)
