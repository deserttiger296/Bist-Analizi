# MTF Lab öğrenme raporu

Otomatik üretilir: `python -m python_bot.research.mtf_learn`. Getiriler aynı 4S bloğundaki evren ortalamasına göre **fazla getiri**, 5 seans ufuk; [] %95 bootstrap aralığı. Walk-forward: her çeyrek yalnız ondan 14 gün önce biten veriden öğrenir.

## BIST30 — 30 hisse, 34206 karar noktası
Dönem 2024-05-15 → 2026-10-15. Kural aynası uyuşmazlığı: 0.

### Tüm dönem, bugünkü lab kuralları (öğrenme yok — sadece tanı)
| Durum | n | Ort. fazla getiri [CI] | İsabet | Ort. MAE5 |
|---|---|---|---|---|
| FULL_CONFIRMATION | 62 | -0.13% [-1.26, +0.92] | 40% | -3.37% |
| EARLY_REACTION | 407 | -0.01% [-0.45, +0.43] | 45% | -3.83% |
| LOWER_TF_NU_PRESSURE | 1334 | +0.02% [-0.22, +0.26] | 47% | -4.11% |
| WAITING_CONFIRMATION | 1897 | +0.11% [-0.06, +0.30] | 48% | -4.05% |
| DAILY_VETO | 640 | +0.31% [-0.03, +0.63] | 52% | -4.17% |

### Görülmemiş dönemler (walk-forward OOS)
| Sinyal | Kurallar | n | Ort. fazla getiri [CI] | İsabet | Ort. MAE5 |
|---|---|---|---|---|---|
| FULL_CONFIRMATION | bugünkü | 48 | -0.44% [-1.51, +0.65] | 38% | -3.30% |
| FULL_CONFIRMATION | öğrenilen | 51 | -0.31% [-1.20, +0.65] | 41% | -3.48% |
| EARLY_REACTION | bugünkü | 273 | +0.10% [-0.45, +0.71] | 44% | -3.69% |
| EARLY_REACTION | öğrenilen | 172 | +0.22% [-0.43, +0.95] | 47% | -3.52% |
| LOWER_TF_NU_PRESSURE | bugünkü | 985 | +0.10% [-0.16, +0.39] | 48% | -4.14% |
| LOWER_TF_NU_PRESSURE | öğrenilen | 977 | +0.10% [-0.18, +0.38] | 47% | -4.08% |

Çeyrek bazında öğrenilen parametreler:

- 2025-01-01: {'hourly_max_age': 20, 'session_pending_max_age': None, 'consumed_after': 20}, ML AUC=0.539
- 2025-04-01: {'hourly_max_age': 40, 'session_pending_max_age': None, 'consumed_after': 5}, ML AUC=0.528
- 2025-07-01: {'hourly_max_age': 20, 'session_pending_max_age': None, 'consumed_after': 5}, ML AUC=0.471
- 2025-10-01: {'hourly_max_age': 20, 'session_pending_max_age': None, 'consumed_after': 5}, ML AUC=0.563
- 2026-01-01: {'hourly_max_age': 20, 'session_pending_max_age': None, 'consumed_after': 5}, ML AUC=0.500
- 2026-04-01: {'hourly_max_age': 20, 'session_pending_max_age': None, 'consumed_after': 5}, ML AUC=0.432
- 2026-07-01: {'hourly_max_age': 40, 'session_pending_max_age': None, 'consumed_after': 5}, ML AUC=0.452
- 2026-10-01: {'hourly_max_age': 20, 'session_pending_max_age': None, 'consumed_after': 5}, ML AUC=0.446

### ML skorlayıcı (OOS)
| Grup | n | Ort. fazla getiri [CI] | İsabet | Ort. MAE5 |
|---|---|---|---|---|
| Tüm PU barları | 7260 | -0.02% [-0.11, +0.06] | 46% | -3.95% |
| Skor beşlisi 1 | 1456 | +0.22% [-0.03, +0.47] | 47% | -4.17% |
| Skor beşlisi 2 | 1450 | -0.31% [-0.54, -0.10] | 43% | -3.70% |
| Skor beşlisi 3 | 1450 | +0.29% [+0.04, +0.53] | 47% | -3.95% |
| Skor beşlisi 4 | 1450 | -0.10% [-0.34, +0.10] | 45% | -4.07% |
| Skor beşlisi 5 | 1454 | -0.20% [-0.40, -0.03] | 47% | -3.84% |
| FULL_CONFIRMATION + ML geçti | 17 | -0.47% [-2.03, +1.04] | 35% | -4.18% |
| FULL_CONFIRMATION + ML kaldı | 31 | -0.43% [-1.80, +1.04] | 39% | -2.82% |
| EARLY_REACTION + ML geçti | 86 | -0.18% [-1.11, +0.78] | 45% | -3.69% |
| EARLY_REACTION + ML kaldı | 187 | +0.22% [-0.43, +0.98] | 43% | -3.70% |

Tüm veriyle öğrenilen kurallar (sonraki dönem için aday): `{'hourly_max_age': 20, 'session_pending_max_age': None, 'consumed_after': 5}`

## BIST100 — 100 hisse, 117691 karar noktası
Dönem 2024-05-15 → 2026-10-15. Kural aynası uyuşmazlığı: 0.

### Tüm dönem, bugünkü lab kuralları (öğrenme yok — sadece tanı)
| Durum | n | Ort. fazla getiri [CI] | İsabet | Ort. MAE5 |
|---|---|---|---|---|
| FULL_CONFIRMATION | 235 | -0.21% [-0.86, +0.47] | 43% | -4.42% |
| EARLY_REACTION | 1624 | +0.11% [-0.13, +0.36] | 45% | -4.16% |
| LOWER_TF_NU_PRESSURE | 4214 | +0.04% [-0.12, +0.21] | 46% | -4.51% |
| WAITING_CONFIRMATION | 6404 | +0.03% [-0.11, +0.17] | 46% | -4.37% |
| DAILY_VETO | 2616 | -0.37% [-0.59, -0.14] | 42% | -4.55% |

### Görülmemiş dönemler (walk-forward OOS)
| Sinyal | Kurallar | n | Ort. fazla getiri [CI] | İsabet | Ort. MAE5 |
|---|---|---|---|---|---|
| FULL_CONFIRMATION | bugünkü | 174 | -0.36% [-1.04, +0.34] | 43% | -4.42% |
| FULL_CONFIRMATION | öğrenilen | 217 | -0.08% [-0.81, +0.66] | 45% | -4.34% |
| EARLY_REACTION | bugünkü | 1162 | +0.08% [-0.22, +0.42] | 43% | -4.11% |
| EARLY_REACTION | öğrenilen | 927 | +0.07% [-0.27, +0.41] | 44% | -4.08% |
| LOWER_TF_NU_PRESSURE | bugünkü | 3138 | +0.02% [-0.19, +0.20] | 46% | -4.64% |
| LOWER_TF_NU_PRESSURE | öğrenilen | 3070 | +0.01% [-0.19, +0.20] | 46% | -4.64% |

Çeyrek bazında öğrenilen parametreler:

- 2025-01-01: {'hourly_max_age': None, 'session_pending_max_age': None, 'consumed_after': 10}, ML AUC=0.530
- 2025-04-01: {'hourly_max_age': None, 'session_pending_max_age': None, 'consumed_after': 10}, ML AUC=0.504
- 2025-07-01: {'hourly_max_age': 40, 'session_pending_max_age': None, 'consumed_after': 20}, ML AUC=0.505
- 2025-10-01: {'hourly_max_age': 40, 'session_pending_max_age': None, 'consumed_after': 10}, ML AUC=0.529
- 2026-01-01: {'hourly_max_age': 40, 'session_pending_max_age': None, 'consumed_after': 10}, ML AUC=0.484
- 2026-04-01: {'hourly_max_age': 40, 'session_pending_max_age': None, 'consumed_after': 10}, ML AUC=0.564
- 2026-07-01: {'hourly_max_age': None, 'session_pending_max_age': None, 'consumed_after': 10}, ML AUC=0.461
- 2026-10-01: {'hourly_max_age': 10, 'session_pending_max_age': None, 'consumed_after': 10}, ML AUC=0.436

### ML skorlayıcı (OOS)
| Grup | n | Ort. fazla getiri [CI] | İsabet | Ort. MAE5 |
|---|---|---|---|---|
| Tüm PU barları | 26991 | +0.02% [-0.04, +0.08] | 45% | -4.36% |
| Skor beşlisi 1 | 5402 | -0.14% [-0.28, -0.00] | 44% | -4.71% |
| Skor beşlisi 2 | 5396 | -0.15% [-0.29, -0.01] | 44% | -4.20% |
| Skor beşlisi 3 | 5397 | -0.09% [-0.21, +0.05] | 44% | -4.25% |
| Skor beşlisi 4 | 5396 | +0.21% [+0.08, +0.34] | 46% | -4.07% |
| Skor beşlisi 5 | 5400 | +0.29% [+0.13, +0.44] | 45% | -4.57% |
| FULL_CONFIRMATION + ML geçti | 64 | -0.92% [-2.10, +0.36] | 39% | -5.01% |
| FULL_CONFIRMATION + ML kaldı | 110 | -0.04% [-0.96, +0.86] | 45% | -4.09% |
| EARLY_REACTION + ML geçti | 435 | +0.23% [-0.33, +0.77] | 44% | -3.96% |
| EARLY_REACTION + ML kaldı | 727 | -0.01% [-0.41, +0.40] | 42% | -4.20% |

Tüm veriyle öğrenilen kurallar (sonraki dönem için aday): `{'hourly_max_age': 10, 'session_pending_max_age': None, 'consumed_after': 10}`

## Sınırlar
- Yahoo 1S geçmişi ~2-3 yıl; 15D geçmişi 60 gün olduğu için geçmiş testte alt periyot NU yalnız 1S'ten.
- Evrenler bugünkü endeks listeleri (hayatta kalan yanlılığı).
- İşlem maliyeti/kayma düşülmedi; giriş bir sonraki 1S barın açılışı.
- Sonuçlar geçmiş performanstır, gelecek getiriyi garanti etmez.
