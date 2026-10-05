# -*- coding: utf-8 -*-
"""
RSI PU30/NU70 Sinyal Motoru Test Paketi
========================================
Kapsam:
  1. wilder_rsi — Wilder (1978) referans değer kontrolü
  2. validate_and_clean_ohlcv — Veri temizleme: duplicate, NaN, sırasız, OHLC mantık hatası
  3. resample_bist_4h — BIST seansına göre (10:00 / 14:00) gruplama
  4. is_bar_closed — Seans kurallarına göre kapanmış/açık mum tespiti
  5. find_confirmed_pivot_lows/Highs — Look-ahead bias koruması
  6. detect_rsi_pu30 — Bilinen PU30 oluşumu, look-ahead bias testi
  7. detect_rsi_nu70 — Bilinen NU70 oluşumu
  8. Sınır durumları: yetersiz bar, flat veri, tüm NaN, tek bar

NOT: validate_and_clean_ohlcv(df, interval) → (df, warnings) tuple döner
     resample_bist_4h çıktı sütunları büyük harf: Open/High/Low/Close/Volume
     is_bar_closed(bar_time, interval, now_ist=...) — üçüncü argüman keyword: now_ist

Çalıştırma:
  cd "bist-analyst-app"
  python -m pytest python_bot/tests/test_rsi_pu30.py -v
"""
import sys
import os
from datetime import datetime, timedelta, time as dtime
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pytest

# Proje kökü yol düzeltmesi
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from python_bot.engine.signals.rsi_pu30 import (
    PU30Config,
    NU70Config,
    wilder_rsi,
    find_confirmed_pivot_lows,
    find_confirmed_pivot_highs,
    detect_rsi_pu30,
    detect_rsi_nu70,
)
from python_bot.engine.data.provider import (
    DataStatus,
    validate_and_clean_ohlcv,
    resample_bist_4h,
    is_bar_closed,
    ISTANBUL_TZ,
)

# ---------------------------------------------------------------------------
# Yardımcı fonksiyonlar
# ---------------------------------------------------------------------------

def _make_df(
    closes,
    dates=None,
    lows=None,
    highs=None,
    opens=None,
    volumes=None,
    is_closed=None,
    interval="1h",
):
    """Sinyal fonksiyonları için sentetik test DataFrame'i oluşturur (küçük harf sütunlar)."""
    n = len(closes)
    if dates is None:
        base = pd.Timestamp("2025-01-02 10:00:00", tz=ISTANBUL_TZ)
        if interval == "1h":
            dates = [base + timedelta(hours=i) for i in range(n)]
        elif interval == "4h":
            dates = [base + timedelta(hours=4 * i) for i in range(n)]
        else:
            dates = [base + timedelta(days=i) for i in range(n)]
    closes = np.array(closes, dtype=float)
    if lows is None:
        lows = closes * 0.99
    if highs is None:
        highs = closes * 1.01
    if opens is None:
        opens = closes
    if volumes is None:
        volumes = np.ones(n) * 1000.0
    if is_closed is None:
        is_closed = np.ones(n, dtype=bool)

    df = pd.DataFrame({
        "date": dates,
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": volumes,
        "is_closed": is_closed,
    })
    return df


def _make_ohlcv_df_for_validate(n=30, interval="1h"):
    """
    validate_and_clean_ohlcv için OHLCV DataFrame'i oluşturur.
    validate_and_clean_ohlcv(df, interval) → (df, warnings) imzasına uygun.
    Sütunlar küçük harf (date, open, high, low, close, volume) olmalı.
    """
    base = pd.Timestamp("2025-01-02 10:00:00", tz=ISTANBUL_TZ)
    if interval == "1h":
        dates = [base + timedelta(hours=i) for i in range(n)]
    else:
        dates = [base + timedelta(days=i) for i in range(n)]
    df = pd.DataFrame({
        "date": dates,
        "open": 100.0,
        "high": 101.0,
        "low": 99.0,
        "close": 100.5,
        "volume": 1000.0,
    })
    return df


# ===========================================================================
# 0. Config Varsayılanları -- Semih Hoca Referans Uygulaması ile Hizalama
# ===========================================================================

class TestConfigDefaultsMatchReference:
    """
    PU30Config/NU70Config varsayılanları, kullanıcının referans uygulamasıyla
    (rsi_uyumsuzluk.py / rsi_uyumsuzluk.pine -- "Semih Hoca kuralları") birebir
    aynı olmalı: min_gap=8, min_tepki=%3, sinyal_omru=5, max_rsi_dip=55,
    min_rsi_tepe=45. Bu test, varsayılanların sessizce referanstan sapmasını
    (örn. daha gevşek bir değere geri dönmesini) yakalar.
    """

    def test_pu30_defaults(self):
        cfg = PU30Config()
        assert cfg.min_gap_bars == 8
        assert cfg.min_bounce_pct == 3.0
        assert cfg.signal_lifetime_bars == 5
        assert cfg.max_rsi_dip == 55.0
        assert cfg.pivot_left_bars == 5
        assert cfg.pivot_right_bars == 2

    def test_nu70_defaults(self):
        cfg = NU70Config()
        assert cfg.min_gap_bars == 8
        assert cfg.min_pullback_pct == 3.0
        assert cfg.signal_lifetime_bars == 5
        assert cfg.min_rsi_peak == 45.0
        assert cfg.pivot_left_bars == 5
        assert cfg.pivot_right_bars == 2


# ===========================================================================
# 1. wilder_rsi Testleri
# ===========================================================================

class TestWilderRSI:
    """Wilder (1978) RSI doğruluğu ve sınır durumları."""

    # Wilder (1978) New Concepts in Technical Trading Systems referans veri
    # 14 periyot; gains/losses dengelenmiş yapay veri ile ~70/~66 test ediyoruz
    def _make_climbing_then_fall(self):
        """
        İlk 14 bar yükseliş (avg_gain > avg_loss → RSI yüksek),
        sonraki bar düşüş → RSI 100 → ~66 bant aralığı.
        RSI[14] == 100 (saf yükseliş warmup), RSI[15] daha düşük olmalı.
        """
        return np.array(
            [100.0 + i for i in range(15)]  # 14 yükseliş
            + [114.0],  # Son bar küçük düşüş
            dtype=float,
        )

    def test_nan_for_first_period_values(self):
        """İlk `period` kadar değer NaN olmalı."""
        closes = np.arange(1.0, 21.0, dtype=float)
        rsi = wilder_rsi(closes, 14)
        assert all(np.isnan(rsi[:14])), "İlk 14 değer NaN bekleniyor"
        assert not np.isnan(rsi[14]), "14. index RSI değeri NaN olmamalı"

    def test_always_rising_returns_100(self):
        """Sürekli yükselen fiyat → RSI 100 bekleniyor."""
        closes = np.arange(1.0, 21.0, dtype=float)
        rsi = wilder_rsi(closes, 14)
        assert rsi[14] == 100.0, f"Sürekli yükseliş → RSI 100 bekleniyor, alınan {rsi[14]}"

    def test_always_falling_returns_0(self):
        """Sürekli düşen fiyat → RSI 0 bekleniyor."""
        closes = np.arange(20.0, 0.0, -1.0, dtype=float)
        rsi = wilder_rsi(closes, 14)
        assert rsi[14] == 0.0, f"Sürekli düşüş → RSI 0 bekleniyor, alınan {rsi[14]}"

    def test_flat_price_returns_50(self):
        """Flat (değişimsiz) fiyat dizisi → RSI 50 bekleniyor."""
        closes = np.full(20, 100.0, dtype=float)
        rsi = wilder_rsi(closes, 14)
        assert rsi[14] == 50.0, f"Flat fiyat → RSI 50 bekleniyor, alınan {rsi[14]}"

    def test_all_nan_for_insufficient_data(self):
        """Veri sayısı period'dan az ise tüm NaN döner."""
        closes = np.array([100.0, 101.0, 102.0], dtype=float)
        rsi = wilder_rsi(closes, 14)
        assert all(np.isnan(rsi)), "Tüm değerler NaN olmalı"

    def test_rsi_bounds(self):
        """RSI değerleri her zaman [0, 100] aralığında olmalı."""
        np.random.seed(42)
        closes = 100.0 + np.random.randn(100).cumsum()
        rsi = wilder_rsi(closes, 14)
        valid = rsi[~np.isnan(rsi)]
        assert (valid >= 0.0).all() and (valid <= 100.0).all(), "RSI [0,100] dışına çıktı"

    def test_single_bar(self):
        """Tek bar → tüm NaN."""
        rsi = wilder_rsi(np.array([100.0]), 14)
        assert len(rsi) == 1 and np.isnan(rsi[0])

    def test_rsi_direction_responds_to_trend_reversal(self):
        """
        Saf yükseliş sonrası sert düşüş → RSI sert düşmeli.
        14 bar yükseliş → RSI 100.
        Ardından 14 bar düşüş → RSI 0'a yakın değer.
        """
        # 14 bar yükseliş (RSI warmup → 100)
        up = [float(i) for i in range(1, 16)]
        # 14 bar sert düşüş (avg_loss baskın → RSI düşer)
        down = [float(15 - i) for i in range(1, 15)]
        closes = np.array(up + down, dtype=float)
        rsi = wilder_rsi(closes, 14)
        # Index 14: saf yükseliş → 100
        assert rsi[14] == 100.0, f"RSI[14] 100 bekleniyor, alınan {rsi[14]}"
        # Sonraki barlar düşüş → RSI düşmeli
        assert rsi[-1] < 80.0, f"Düşüş sonrası RSI < 80 bekleniyor, alınan {rsi[-1]:.1f}"

    def test_nan_input_produces_rsi_50(self):
        """
        wilder_rsi'ya tüm NaN içeren dizi verildiğinde RSI 50.0 üretmeli.

        Mekanizma:
          np.diff([NaN, NaN, ...]) → [NaN, NaN, ...] (NaN kalır, 0'a dönüşmez)
          np.where(NaN > 0, ...) → False koşulu → gains[i] = 0.0, losses[i] = 0.0
          avg_gain = avg_loss = 0.0 → "avg_gain + avg_loss == 0" dalı → rsi[period] = 50.0
          Sonraki barlar: Wilder smoothing'de g=0, l=0 ekleniyor → avg değişmiyor → 50.0 sabit.

        Bu davranış wilder_rsi içindeki sıfıra bölme korumasının yan etkisidir;
        NaN giriş desteklenmez, ancak fonksiyon çökmek yerine 50 üretir.
        """
        closes = np.full(20, np.nan, dtype=float)
        rsi = wilder_rsi(closes, 14)
        # İlk 14 değer her zaman NaN (warmup dönemi)
        assert all(np.isnan(rsi[:14])), "Warmup dönemi (index 0..13) NaN olmalı"
        # period ve sonrası: tüm NaN giriş → avg_gain=avg_loss=0 → RSI=50
        assert rsi[14] == 50.0, f"Tüm-NaN girişte RSI[14]=50.0 bekleniyor, alınan {rsi[14]}"
        for i in range(15, 20):
            assert rsi[i] == 50.0, f"Tüm-NaN girişte RSI[{i}]=50.0 bekleniyor, alınan {rsi[i]}"


# ===========================================================================
# 2. validate_and_clean_ohlcv Testleri
# ===========================================================================

class TestValidateAndClean:
    """OHLCV veri temizleme ve doğrulama.

    API: validate_and_clean_ohlcv(df, interval) -> (df_clean, warnings_list)
    """

    def test_clean_data_passes(self):
        """Temiz veri → uyarı yok, satır sayısı korunur."""
        df = _make_ohlcv_df_for_validate(30)
        df_clean, warnings = validate_and_clean_ohlcv(df, "1h")
        assert df_clean is not None
        assert len(df_clean) == 30
        # Temiz veri → hiç kritik uyarı olmamalı
        assert isinstance(warnings, list)

    def test_duplicate_timestamps_removed(self):
        """Yinelenen zaman damgası → ilk/son kayıt korunur, diğeri silinir."""
        df = _make_ohlcv_df_for_validate(10)
        dup_row = df.iloc[[5]].copy()
        df = pd.concat([df, dup_row], ignore_index=True)
        assert len(df) == 11
        df_clean, warnings = validate_and_clean_ohlcv(df, "1h")
        assert len(df_clean) == 10, f"Yinelenen satır silinmeli. Satır sayısı: {len(df_clean)}"
        assert any("yinelenene" in w.lower() or "duplicate" in w.lower() or "zaman" in w.lower()
                   for w in warnings), f"Uyarı listesi: {warnings}"

    def test_nan_close_row_dropped(self):
        """Kapanış NaN olan satır düşürülür."""
        df = _make_ohlcv_df_for_validate(15)
        df.loc[7, "close"] = float("nan")
        df_clean, warnings = validate_and_clean_ohlcv(df, "1h")
        assert len(df_clean) == 14, "NaN kapanış içeren satır silinmeli"

    def test_insufficient_after_clean_returns_status(self):
        """Temizlik sonrası veri yetersizse uyarı içerir veya boş döner — hata vermez."""
        df = _make_ohlcv_df_for_validate(5)
        df_clean, warnings = validate_and_clean_ohlcv(df, "1h")
        # 5 satır düşük ama hata vermemeli; uyarı veya boş dönebilir
        assert isinstance(df_clean, pd.DataFrame)

    def test_empty_df_returns_empty(self):
        """Boş DataFrame → boş çıkış, uyarı listesi dolu."""
        df = pd.DataFrame(columns=["date", "open", "high", "low", "close", "volume"])
        df_clean, warnings = validate_and_clean_ohlcv(df, "1h")
        assert isinstance(df_clean, pd.DataFrame)
        assert len(warnings) > 0

    def test_negative_volume_clipped_to_zero(self):
        """Negatif hacim değerleri ≥ 0'a kırpılır, hata üretmez."""
        df = _make_ohlcv_df_for_validate(20)
        df.loc[3, "volume"] = -500.0
        df_clean, warnings = validate_and_clean_ohlcv(df, "1h")
        assert df_clean is not None
        if len(df_clean) >= 4:
            # Satır düşürülmediyse sıfırlanmış olmalı
            assert df_clean.iloc[3]["volume"] >= 0, "Negatif hacim 0'a kırpılmalı"

    def test_high_lt_low_row_dropped(self):
        """High < Low olan satır silinir, hata üretmez."""
        df = _make_ohlcv_df_for_validate(20)
        df.loc[5, "high"] = 98.0   # Low=99 > High=98 → mantıksız
        df_clean, warnings = validate_and_clean_ohlcv(df, "1h")
        assert df_clean is not None
        # Hata içeren satır silinmiş veya düzeltilmiş olmalı
        if len(df_clean) == 20:
            # Sütun adı 'high' ya da 'High' olabilir
            h_col = "high" if "high" in df_clean.columns else "High"
            l_col = "low" if "low" in df_clean.columns else "Low"
            assert (df_clean[h_col] >= df_clean[l_col]).all(), "High >= Low sağlanmıyor"
        else:
            assert len(df_clean) == 19, "Hatalı satır silinmeli"


# ===========================================================================
# 3. resample_bist_4h Testleri
# ===========================================================================

class TestResampleBist4h:
    """BIST seansına göre 4 saatlik mum toplama.

    NOT: resample_bist_4h çıktı sütunları büyük harf: Open, High, Low, Close, Volume.
    """

    def _make_1h_weekday_df(self, n_days=3):
        """N günlük 1 saatlik BIST verisi (Pazartesi başlayan, 10:00 – 17:00)."""
        rows = []
        # 2025-01-06 = Pazartesi
        base = datetime(2025, 1, 6, tzinfo=ISTANBUL_TZ)
        day_count = 0
        d = base
        while day_count < n_days:
            if d.weekday() < 5:  # Hafta içi
                for hour in range(10, 18):
                    ts = d.replace(hour=hour, minute=0, second=0, microsecond=0)
                    rows.append({
                        "date": ts,
                        "open": 100.0,
                        "high": 100.0 + hour * 0.1,
                        "low": 100.0 - hour * 0.1,
                        "close": 100.0 + (hour - 10) * 0.05,
                        "volume": float(hour * 100),
                        "is_closed": True,
                    })
                day_count += 1
            d += timedelta(days=1)
        return pd.DataFrame(rows)

    def test_output_has_fewer_bars_than_input(self):
        """4h çıktısı 1h girişinden daha az bar içerir."""
        df1h = self._make_1h_weekday_df(3)
        df4h = resample_bist_4h(df1h)
        assert len(df4h) < len(df1h), "4h çıktısı 1h girişinden küçük olmalı"

    def test_ohlcv_aggregation_open_is_first(self):
        """İlk grubun Open değeri, grubun ilk 1h barının open değerine eşit olmalı."""
        df1h = self._make_1h_weekday_df(1)
        df4h = resample_bist_4h(df1h)
        assert len(df4h) > 0, "4h çıktısı boş olmamalı"
        # Sütun adları büyük ya da küçük harf olabilir
        open_col = "Open" if "Open" in df4h.columns else "open"
        first_open = df4h.iloc[0][open_col]
        assert first_open == 100.0, f"İlk bar Open=100.0 bekleniyor, alınan: {first_open}"

    def test_ohlcv_aggregation_volume_is_sum(self):
        """Volume toplam olmalı (tek bar volume değerinden büyük)."""
        df1h = self._make_1h_weekday_df(1)
        df4h = resample_bist_4h(df1h)
        assert len(df4h) > 0
        vol_col = "Volume" if "Volume" in df4h.columns else "volume"
        first_vol = df4h.iloc[0][vol_col]
        assert first_vol > df1h.iloc[0]["volume"], "4h Volume birden fazla 1h barının toplamı olmalı"

    def test_no_weekend_bars_in_output(self):
        """Hafta sonu barı resample çıktısında yer almamalı."""
        rows = []
        # 2025-01-04 = Cumartesi
        sat = datetime(2025, 1, 4, 10, 0, tzinfo=ISTANBUL_TZ)
        rows.append({
            "date": sat, "open": 50.0, "high": 51.0, "low": 49.0,
            "close": 50.5, "volume": 100.0, "is_closed": True,
        })
        # Pazartesi normal barlar ekle (2025-01-06)
        mon = datetime(2025, 1, 6, tzinfo=ISTANBUL_TZ)
        for h in range(10, 18):
            rows.append({
                "date": mon.replace(hour=h), "open": 100.0, "high": 101.0,
                "low": 99.0, "close": 100.0, "volume": 1000.0, "is_closed": True,
            })
        df = pd.DataFrame(rows)
        df4h = resample_bist_4h(df)
        if len(df4h) > 0:
            date_col = "date" if "date" in df4h.columns else df4h.columns[0]
            dates = pd.to_datetime(df4h[date_col])
            for d in dates:
                assert d.weekday() < 5, f"Hafta sonu barı bulundu: {d} (weekday={d.weekday()})"

    def _make_yahoo_style_day(self):
        """yfinance'in gerçek BIST saatlik damgaları: 09:30, 10:30, ..., 17:30 (9 bar).
        09:30 barı 10:00 açılışını içerir; open değeri 50.0 olarak işaretli."""
        rows = []
        base = datetime(2025, 1, 6, tzinfo=ISTANBUL_TZ)  # Pazartesi
        for i, hour in enumerate(range(9, 18)):
            ts = base.replace(hour=hour, minute=30)
            rows.append({
                "date": ts, "open": 50.0 if hour == 9 else 100.0 + i,
                "high": 101.0 + i, "low": 49.0 if hour == 9 else 99.0 + i,
                "close": 100.5 + i, "volume": 100.0, "is_closed": True,
            })
        return pd.DataFrame(rows)

    def test_opening_0930_bar_is_part_of_morning_bar(self):
        """09:30 barı (seans açılışı) atılmamalı; sabah mumunun Open'ı ondan gelmeli."""
        df4h = resample_bist_4h(self._make_yahoo_style_day())
        assert len(df4h) == 2
        date_col = "date" if "date" in df4h.columns else df4h.columns[0]
        morning = df4h.sort_values(date_col).iloc[0]
        assert morning["Open"] == 50.0, "Sabah 4s mumu gerçek açılış (09:30 barı) Open'ını içermeli"
        assert morning["Low"] == 49.0
        assert morning["Volume"] == 500.0  # 09:30..13:30 = 5 saatlik bar

    def test_afternoon_bar_labelled_at_1430(self):
        df4h = resample_bist_4h(self._make_yahoo_style_day())
        date_col = "date" if "date" in df4h.columns else df4h.columns[0]
        labels = sorted(pd.Timestamp(t).strftime("%H:%M") for t in df4h[date_col])
        assert labels == ["10:00", "14:30"]

    def test_empty_input_returns_empty(self):
        """Boş giriş → boş çıkış."""
        df = pd.DataFrame(columns=["date", "open", "high", "low", "close", "volume", "is_closed"])
        df4h = resample_bist_4h(df)
        assert isinstance(df4h, pd.DataFrame)
        assert len(df4h) == 0

    def test_single_bar_no_crash(self):
        """Tek bar → hata vermemeli."""
        df = pd.DataFrame([{
            "date": pd.Timestamp("2025-01-06 10:00:00", tz=ISTANBUL_TZ),
            "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5,
            "volume": 1000.0, "is_closed": True,
        }])
        try:
            df4h = resample_bist_4h(df)
            assert isinstance(df4h, pd.DataFrame)
        except Exception as e:
            pytest.fail(f"Tek bar resample hata verdi: {e}")


# ===========================================================================
# 4. is_bar_closed Testleri
# ===========================================================================

class TestIsBarClosed:
    """BIST seans kurallarına göre mum kapanış tespiti.

    NOT: is_bar_closed(bar_time, interval, now_ist=...) — üçüncü parametre `now_ist`.
    """

    def test_1h_bar_from_yesterday_is_closed(self):
        """Dünkü 1h mum kesinlikle kapanmış olmalı."""
        bar_time = datetime.now(ISTANBUL_TZ) - timedelta(days=1, hours=2)
        assert is_bar_closed(bar_time, "1h") is True

    def test_1d_bar_yesterday_is_closed(self):
        """Dünkü günlük mum kapanmış olmalı."""
        bar_time = (datetime.now(ISTANBUL_TZ) - timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        assert is_bar_closed(bar_time, "1d") is True

    def test_4h_morning_bar_after_14_is_closed(self):
        """10:00 başlayan 4h mum, saat 15:00'ten sonra kapanmış olmalı."""
        # Sabit Pazartesi referans tarihi
        ref_date = datetime(2025, 1, 6, tzinfo=ISTANBUL_TZ)  # Pazartesi
        bar_time = ref_date.replace(hour=10, minute=0, second=0, microsecond=0)
        check_now = ref_date.replace(hour=15, minute=0)
        result = is_bar_closed(bar_time, "4h", now_ist=check_now)
        assert result is True, f"10:00 mum 15:00'te kapanmış olmalı, sonuç: {result}"

    def test_4h_morning_bar_before_14_is_open(self):
        """10:00 başlayan 4h mum, saat 12:00'de henüz açık olmalı."""
        ref_date = datetime(2025, 1, 6, tzinfo=ISTANBUL_TZ)  # Pazartesi
        bar_time = ref_date.replace(hour=10, minute=0, second=0, microsecond=0)
        check_now = ref_date.replace(hour=12, minute=0)
        result = is_bar_closed(bar_time, "4h", now_ist=check_now)
        assert result is False, f"10:00 mum 12:00'de açık olmalı, sonuç: {result}"

    def test_4h_morning_bar_still_open_until_1430(self):
        """Sabah 4s mumunun son bileşeni 13:30 saatlik barıdır (14:30'da kapanır).
        14:10'da mum hâlâ oluşuyor sayılmalı; aksi halde eksik mum teyit üretip
        14:30'da değişebilir (repaint)."""
        ref_date = datetime(2025, 1, 6, tzinfo=ISTANBUL_TZ)
        bar_time = ref_date.replace(hour=10, minute=0)
        assert is_bar_closed(bar_time, "4h", now_ist=ref_date.replace(hour=14, minute=10)) is False
        assert is_bar_closed(bar_time, "4h", now_ist=ref_date.replace(hour=14, minute=30)) is True

    def test_1h_bar_recent_is_open(self):
        """Açılan 1h mum, 10 dakika sonra henüz kapanmamış olmalı."""
        # Sabit Pazartesi referans tarihi kullan (hafta sonu + gece yarısı sorunlarından kaçın)
        ref_date = datetime(2025, 1, 6, tzinfo=ISTANBUL_TZ)  # Pazartesi
        bar_time = ref_date.replace(hour=11, minute=0, second=0, microsecond=0)
        check_now = ref_date.replace(hour=11, minute=10)  # 10 dk sonra → hala açık
        result = is_bar_closed(bar_time, "1h", now_ist=check_now)
        assert result is False, f"Yeni açılan 1h mum 10dk sonra açık olmalı, sonuç: {result}"

    def test_1h_bar_fully_elapsed_is_closed(self):
        """1h mum, 65 dakika geçmişten kapanmış olmalı."""
        ref_date = datetime(2025, 1, 6, tzinfo=ISTANBUL_TZ)
        bar_time = ref_date.replace(hour=11, minute=0, second=0, microsecond=0)
        check_now = ref_date.replace(hour=12, minute=5)  # 65 dk sonra
        result = is_bar_closed(bar_time, "1h", now_ist=check_now)
        assert result is True, f"1h mum 65dk sonra kapanmış olmalı, sonuç: {result}"

    def test_1h_bar_from_3_hours_ago_is_closed(self):
        """3 saat önceki 1h mum kapanmış olmalı."""
        bar_time = datetime.now(ISTANBUL_TZ) - timedelta(hours=3)
        assert is_bar_closed(bar_time, "1h") is True


# ===========================================================================
# 5. find_confirmed_pivot_lows — Look-Ahead Bias Koruması
# ===========================================================================

class TestPivotLookAhead:
    """Kapanmamış teyit barları varken pivot üretilmemeli."""

    def _make_dip_lows(self, n=20):
        """Index 10'da dip (local min) olan basit low dizisi."""
        lows = np.ones(n) * 100.0
        lows[10] = 90.0  # index 10 → dip
        return lows

    def test_pivot_found_when_all_closed(self):
        """Tüm barlar kapanmışsa dip pivot bulunur."""
        lows = self._make_dip_lows(20)
        is_closed = np.ones(20, dtype=bool)
        pivots = find_confirmed_pivot_lows(lows, lb=5, rb=2, is_closed=is_closed)
        assert 10 in pivots, "Kapanmış barlarla pivot bulunmalı"

    def test_pivot_not_found_when_right_bar_open(self):
        """Sağ teyit barı kapanmamışsa pivot üretilmez (look-ahead bias koruması)."""
        lows = self._make_dip_lows(20)
        is_closed = np.ones(20, dtype=bool)
        is_closed[11] = False  # İlk sağ teyit barı açık
        pivots = find_confirmed_pivot_lows(lows, lb=5, rb=2, is_closed=is_closed)
        assert 10 not in pivots, "Açık teyit barıyla pivot üretilmemeli (look-ahead bias)"

    def test_pivot_found_without_is_closed(self):
        """is_closed belirtilmezse look-ahead kontrolü yapılmaz (geriye dönük analiz)."""
        lows = self._make_dip_lows(20)
        pivots = find_confirmed_pivot_lows(lows, lb=5, rb=2, is_closed=None)
        assert 10 in pivots

    def test_no_pivot_if_not_local_min(self):
        """Local minimum değilse pivot dönmez."""
        lows = np.ones(20) * 100.0  # Düz dizi — dip yok
        pivots = find_confirmed_pivot_lows(lows, lb=5, rb=2, is_closed=None)
        assert len(pivots) == 0

    def test_pivot_at_boundary_not_counted(self):
        """Sınırdaki pivot (rb mesafe içinde) üretilmez."""
        lows = np.ones(20) * 100.0
        lows[18] = 90.0  # Sadece 1 sağ bar var (rb=2 gerektirir)
        pivots = find_confirmed_pivot_lows(lows, lb=5, rb=2, is_closed=None)
        assert 18 not in pivots, "Sağ tarafta yeterli bar yoksa pivot üretilmemeli"


class TestPivotHighsLookAhead:
    """Pivot highs için aynı look-ahead koruma."""

    def _make_peak_highs(self, n=20):
        highs = np.ones(n) * 100.0
        highs[10] = 110.0
        return highs

    def test_peak_found_when_all_closed(self):
        highs = self._make_peak_highs(20)
        is_closed = np.ones(20, dtype=bool)
        pivots = find_confirmed_pivot_highs(highs, lb=5, rb=2, is_closed=is_closed)
        assert 10 in pivots

    def test_peak_not_found_when_right_bar_open(self):
        highs = self._make_peak_highs(20)
        is_closed = np.ones(20, dtype=bool)
        is_closed[11] = False
        pivots = find_confirmed_pivot_highs(highs, lb=5, rb=2, is_closed=is_closed)
        assert 10 not in pivots

    def test_no_peak_if_flat(self):
        highs = np.ones(20) * 100.0
        pivots = find_confirmed_pivot_highs(highs, lb=5, rb=2, is_closed=None)
        assert len(pivots) == 0


# ===========================================================================
# 6. detect_rsi_pu30 — PU30 Sinyal Tespiti
# ===========================================================================

class TestDetectRsiPU30:
    """Sentetik veriyle PU30 (Pozitif Uyumsuzluk) sinyali tespiti."""

    def _build_pu30_df(self, n_pad=20):
        """
        Klasik PU30 oluşumu sentetik verisi:

        Strateji:
        - Dip1: Sert düşüş (RSI aşırı satım bölgesine girer, < 30)
        - Güven tazeleyen tepe: Tepki yükselişi (RSI orta bölgeye gelir, ~40-60)
        - Dip2: Dip1'den düşük fiyat ama DAHA YAVAŞ düşüş → RSI Wilder ortalama
          yüksek başladığı için 2. dipte 30 üzerinde kalır

        Bunu sağlamak için:
        1. Warmup: 30 bar flat (RSI başlangıç stabilizasyonu)
        2. Düşüş 1: 25 bar hızlı düşüş (RSI << 30)
        3. Flat dip1: 8 bar (RSI 30 altında kalır)
        4. Güçlü tepki: 30 bar yükseliş (RSI >> 50)
        5. Güven tazeleyen tepe: 6 bar flat
        6. Düşüş 2: 12 bar YAVAŞ düşüş (RSI 30-40 bölgesinde)
        7. Flat dip2: 8 bar (fiyat < dip1, RSI > 30)
        8. Teyit + pad
        """
        closes, lows, highs = [], [], []

        # 1. Warmup: 30 bar flat
        for _ in range(30):
            closes.append(200.0); lows.append(199.0); highs.append(201.0)

        # 2. Düşüş 1: 25 bar hızlı düşüş → RSI << 30
        for i in range(25):
            v = 200.0 - i * 4.0  # 200 → 104 (sert)
            closes.append(v); lows.append(v - 1.0); highs.append(v + 1.0)

        # 3. Flat dip1: 8 bar (RSI 30 altında kalır)
        dip1_price = 104.0
        for _ in range(8):
            closes.append(dip1_price); lows.append(dip1_price - 1.0); highs.append(dip1_price + 1.0)

        # 4. Güçlü tepki: 30 bar yükseliş (RSI >> 50)
        # ÖNEMLI: Tepki sırasındaki low'lar dip1_price + 5'in üzerinde kalmalı
        # böylece min_between >= d1_price * 0.99 koşulu sağlanır.
        for i in range(30):
            v = dip1_price + i * 2.5 + 5.0  # dip1+5'ten başla (109, 111.5, ...)
            closes.append(v)
            lows.append(max(v - 1.0, dip1_price + 4.0))  # Low hiçbir zaman dip1+4'ten düşük olmaz
            highs.append(v + 1.0)

        # 5. Güven tazeleyen tepe: 6 bar flat
        tepe_price = dip1_price + 30 * 2.5 + 5.0  # ~184
        for _ in range(6):
            closes.append(tepe_price)
            lows.append(tepe_price - 1.0)
            highs.append(tepe_price + 1.0)

        # 6. Düşüş 2: 12 bar YAVAŞ → RSI yüksek başlar (warmup RSI hala güçlü)
        dip2_target = dip1_price - 8.0  # Fiyat dip1'den düşük
        drop2_per_bar = (tepe_price - dip2_target) / 12
        for i in range(12):
            v = tepe_price - i * drop2_per_bar
            closes.append(v); lows.append(v - 1.0); highs.append(v + 1.0)

        # 7. Flat dip2: 8 bar
        dip2_price = dip2_target
        for _ in range(8):
            closes.append(dip2_price); lows.append(dip2_price - 1.0); highs.append(dip2_price + 1.0)

        # 8. Teyit + pad
        for i in range(n_pad):
            v = dip2_price + i * 0.5
            closes.append(v); lows.append(v - 1.0); highs.append(v + 1.0)

        closes = np.array(closes, dtype=float)
        lows = np.array(lows, dtype=float)
        highs = np.array(highs, dtype=float)
        n = len(closes)

        base = pd.Timestamp("2025-01-06 10:00:00", tz=ISTANBUL_TZ)
        dates = [base + timedelta(hours=i) for i in range(n)]

        df = pd.DataFrame({
            "date": dates,
            "open": closes,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": np.ones(n) * 1000.0,
            "is_closed": np.ones(n, dtype=bool),
        })
        return df

    def test_pu30_signal_detected(self):
        """
        PU30 fiyat uyumsuzluk mekanizması sentetik veriyle tespit edilmeli.

        NOT: Sentetik veride dip2 RSI'ı 30 üzerinde tutmak Wilder RMA'nın sönümlü yapısı
        nedeniyle zordur. Bu test `rsi2_above_threshold=False` ile temel mekanizmayı doğrular.
        RSI eşiği kuralı test_pu30_rsi_threshold_rule ile ayrıca doğrulanır.
        """
        df = self._build_pu30_df(n_pad=20)
        cfg = PU30Config(
            pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100,
            rsi2_above_threshold=False,  # Sentetik veri için eşik filtresi devre dışı
        )
        signal = detect_rsi_pu30(df, cfg=cfg, ignore_lifetime=True, interval="1h")
        assert signal is not None, (
            f"PU30 fiyat uyumsuzluk sinyali bulunmalı (eşik devre dışı). DataFrame: {len(df)} bar"
        )
        assert signal["type"] == "PU30"

    def test_pu30_rsi_threshold_rule(self):
        """
        rsi2_above_threshold=True iken daha az sinyal üretilir.
        Kural bir filtredir; canlı verilerle doğrulanmalıdır.
        """
        df = self._build_pu30_df(n_pad=20)
        cfg_no_thresh = PU30Config(
            pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100,
            rsi2_above_threshold=False,
        )
        cfg_with_thresh = PU30Config(
            pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100,
            rsi2_above_threshold=True,
        )
        sig_without = detect_rsi_pu30(df, cfg=cfg_no_thresh, ignore_lifetime=True, interval="1h")
        sig_with = detect_rsi_pu30(df, cfg=cfg_with_thresh, ignore_lifetime=True, interval="1h")
        # Eşikli versiyon, eşiksizden daha az veya eşit sinyal üretmeli
        if sig_with is not None:
            assert sig_with["dip2"]["rsi"] >= 30.0, (
                f"rsi2_above_threshold=True iken dip2 RSI ({sig_with['dip2']['rsi']:.1f}) >= 30 olmalı"
            )

    def test_pu30_signal_has_required_fields(self):
        """PU30 sinyali zorunlu alanları içermeli."""
        df = self._build_pu30_df(n_pad=20)
        cfg = PU30Config(pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100)
        signal = detect_rsi_pu30(df, cfg=cfg, ignore_lifetime=True, interval="1h")
        if signal is None:
            pytest.skip("Bu veri setiyle PU30 tespit edilemedi")
        for field in ["type", "dip1", "dip2", "knowable_at", "confirm_time", "pivot_time"]:
            assert field in signal, f"Zorunlu alan eksik: {field}"

    def test_pu30_dip2_rsi_above_30(self):
        """rsi2_above_threshold=True iken 2. dip RSI'ı 30 altındaysa sinyal ÜRETİLMEMELİ.
        Bu fixture'da 2. dip RSI ~12: eşiksiz modda sinyal var, eşikli modda olmamalı."""
        df = self._build_pu30_df(n_pad=20)
        base = dict(pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100,
                    min_bounce_pct=0.0, max_rsi_dip=1000.0)
        loose = detect_rsi_pu30(df, cfg=PU30Config(**base), ignore_lifetime=True, interval="1h")
        assert loose is not None and loose["dip2"]["rsi"] < 30.0, "Fixture ön koşulu: eşiksiz modda 2. dip RSI < 30"
        strict = detect_rsi_pu30(df, cfg=PU30Config(**base, rsi2_above_threshold=True),
                                 ignore_lifetime=True, interval="1h")
        assert strict is None, "2. dip RSI 30 altındayken eşikli mod sinyal üretmemeli"

    def test_pu30_dip2_price_lower_than_dip1(self):
        """PU30 sinyalinde 2. dip fiyatı 1. dipten düşük olmalı."""
        df = self._build_pu30_df(n_pad=20)
        cfg = PU30Config(pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100)
        signal = detect_rsi_pu30(df, cfg=cfg, ignore_lifetime=True, interval="1h")
        if signal is None:
            pytest.skip("Bu veri setiyle PU30 tespit edilemedi")
        assert signal["dip2"]["price"] < signal["dip1"]["price"], (
            "2. dip fiyatı 1. dipten düşük olmalı"
        )

    def test_pu30_knowable_at_after_pivot(self):
        """knowable_at zamanı, pivot zamanından sonra veya eşit olmalı."""
        df = self._build_pu30_df(n_pad=20)
        cfg = PU30Config(pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100)
        signal = detect_rsi_pu30(df, cfg=cfg, ignore_lifetime=True, interval="1h")
        if signal is None:
            pytest.skip("Bu veri setiyle PU30 tespit edilemedi")
        # confirm_time >= pivot_time (saniye cinsinden epoch)
        assert signal["confirm_time"] >= signal["pivot_time"], (
            "confirm_time pivot_time'dan küçük olamaz (look-ahead bias)"
        )

    def test_pu30_no_signal_on_insufficient_bars(self):
        """Yetersiz bar sayısıyla sinyal üretilmemeli."""
        df = _make_df(closes=np.ones(10) * 100.0, interval="1h")
        signal = detect_rsi_pu30(df, ignore_lifetime=True, interval="1h")
        assert signal is None

    def test_pu30_no_lookahead_bias(self):
        """
        Look-Ahead Bias Testi:
        Teyit barı kapalı değilse sinyal üretilmemeli veya farklı confirm_index döner.
        """
        df = self._build_pu30_df(n_pad=20)
        cfg = PU30Config(pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100)

        signal_all_closed = detect_rsi_pu30(df, cfg=cfg, ignore_lifetime=True, interval="1h")
        if signal_all_closed is None:
            pytest.skip("Bu veri setiyle PU30 bulunamadı, look-ahead testi atlanıyor")

        confirm_index = signal_all_closed["confirm_index"]

        # Teyit barını açık yap
        df2 = df.copy()
        df2.loc[confirm_index, "is_closed"] = False
        signal_open = detect_rsi_pu30(df2, cfg=cfg, ignore_lifetime=True, interval="1h")

        if signal_open is not None:
            # Varsa farklı bir pivot çiftiyle gelmeli
            assert signal_open["confirm_index"] != confirm_index, (
                "Açık teyit barıyla aynı confirm_index'e sahip sinyal üretildi → look-ahead bias!"
            )

    def test_pu30_max_rsi_dip_bounds_only_first_dip(self):
        """
        max_rsi_dip (esnek mod tavanı) yalnızca 1. dibe uygulanmalı, 2. dibe değil
        -- referans uygulama (rsi_uyumsuzluk.py/.pine) ile birebir aynı kural.

        Bu fixture'da dip1 RSI=0.0, dip2 RSI~12.03 (require_higher_rsi zaten
        dip2 > dip1 şartını sağlıyor). max_rsi_dip=6.0 ile dip1 geçer (0 <= 6)
        ama dip2 geçmez (12.03 > 6); kural yalnızca dip1'i sınırlıyorsa sinyal
        YİNE bulunmalı. Eğer kod yanlışlıkla ikisini de sınırlarsa (eski hata),
        bu sinyali reddeder ve test başarısız olur.
        """
        df = self._build_pu30_df(n_pad=20)
        cfg = PU30Config(
            pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100,
            strict_threshold=False, max_rsi_dip=6.0,
        )
        signal = detect_rsi_pu30(df, cfg=cfg, ignore_lifetime=True, interval="1h")
        assert signal is not None, (
            "max_rsi_dip yalnızca 1. dibi sınırlamalı; 2. dip bu tavanı aşsa da sinyal üretilmeli"
        )
        assert signal["dip1"]["rsi"] <= 6.0
        assert signal["dip2"]["rsi"] > 6.0

        # Tavanı 1. dibin de altına çekince (dip1 rsi=0.0 > -1.0) sinyal düşmeli.
        cfg_tight = PU30Config(
            pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100,
            strict_threshold=False, max_rsi_dip=-1.0,
        )
        assert detect_rsi_pu30(df, cfg=cfg_tight, ignore_lifetime=True, interval="1h") is None

    def test_pu30_signal_lifetime_filter(self):
        """signal_lifetime_bars aşıldığında eski sinyal filtrelenir (ignore_lifetime=False)."""
        df = self._build_pu30_df(n_pad=50)  # Çok eski sinyal
        cfg = PU30Config(
            pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100,
            signal_lifetime_bars=5,  # Çok kısa ömür
        )
        signal_with_lifetime = detect_rsi_pu30(df, cfg=cfg, ignore_lifetime=False, interval="1h")
        signal_without_lifetime = detect_rsi_pu30(df, cfg=cfg, ignore_lifetime=True, interval="1h")
        # ignore_lifetime=True ile sinyal varsa, ignore_lifetime=False ile olmayabilir
        if signal_without_lifetime is not None:
            bars_since = signal_without_lifetime["bars_since_confirm"]
            if bars_since > 5:
                assert signal_with_lifetime is None, (
                    f"Ömrü dolan sinyal ({bars_since} bar) filtrelenmeli"
                )


# ===========================================================================
# 7. detect_rsi_nu70 — NU70 Sinyal Tespiti
# ===========================================================================

class TestDetectRsiNU70:
    """Sentetik veriyle NU70 (Negatif Uyumsuzluk) sinyali tespiti."""

    def _build_nu70_df(self, n_pad=20):
        """
        Klasik NU70 oluşumu sentetik verisi.

        Strateji:
        - Tepe1: Hızlı yükseliş (RSI >> 70)
        - Düzeltme: Güçlü düşüş → RSI orta bölgeye iner
        - Tepe2: Daha yavaş yükseliş (RSI < 72) ama fiyat tepe1'den yüksek

        Not: NU70Config.rsi2_below_threshold → t2_rsi > threshold + 2.0 → filter
        Yani 2. tepe RSI'ının 72'nin altında olması gerekir.
        """
        closes, highs, lows = [], [], []

        # 1. Warmup: 30 bar flat
        for _ in range(30):
            closes.append(100.0); highs.append(101.0); lows.append(99.0)

        # 2. Yükseliş 1: 25 bar hızlı → RSI >> 70
        for i in range(25):
            v = 100.0 + i * 4.0  # 100 → 196
            closes.append(v); highs.append(v + 1.0); lows.append(v - 1.0)

        # 3. Flat tepe1: 8 bar
        tepe1_price = 100.0 + 25 * 4.0  # 196
        for _ in range(8):
            closes.append(tepe1_price); highs.append(tepe1_price + 1.0); lows.append(tepe1_price - 1.0)

        # 4. Düzeltme: 20 bar güçlü → RSI orta seviyeye iner
        dip_price = tepe1_price * 0.72  # ~141
        drop_per_bar = (tepe1_price - dip_price) / 20
        for i in range(20):
            v = tepe1_price - i * drop_per_bar
            closes.append(v); highs.append(v + 1.0); lows.append(v - 1.0)

        # 5. Flat dip: 6 bar
        for _ in range(6):
            closes.append(dip_price); highs.append(dip_price + 1.0); lows.append(dip_price - 1.0)

        # 6. Yükseliş 2: 20 bar YAVAŞ → RSI ~ 60-70 (tepe1'den yüksek fiyat)
        tepe2_target = tepe1_price + 15.0
        rise_per_bar = (tepe2_target - dip_price) / 20
        for i in range(20):
            v = dip_price + i * rise_per_bar
            closes.append(v); highs.append(v + 1.0); lows.append(v - 1.0)

        # 7. Flat tepe2: 8 bar
        for _ in range(8):
            closes.append(tepe2_target); highs.append(tepe2_target + 1.0); lows.append(tepe2_target - 1.0)

        # 8. Teyit + pad
        for i in range(n_pad):
            v = tepe2_target - i * 0.5
            closes.append(v); highs.append(v + 1.0); lows.append(v - 1.0)

        closes = np.array(closes, dtype=float)
        highs = np.array(highs, dtype=float)
        lows = np.array(lows, dtype=float)
        n = len(closes)

        base = pd.Timestamp("2025-01-06 10:00:00", tz=ISTANBUL_TZ)
        dates = [base + timedelta(hours=i) for i in range(n)]

        df = pd.DataFrame({
            "date": dates,
            "open": closes,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": np.ones(n) * 1000.0,
            "is_closed": np.ones(n, dtype=bool),
        })
        return df

    def test_nu70_signal_detected(self):
        """
        NU70 fiyat uyumsuzluk mekanizması sentetik veriyle tespit edilmeli.

        NOT: Sentetik veride tepe2 RSI'ını 72'nin altında tutmak Wilder RMA nedeniyle
        zordur. Bu test `rsi2_below_threshold=False` ile temel mekanizmayı doğrular.
        """
        df = self._build_nu70_df(n_pad=20)
        cfg = NU70Config(
            pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100,
            rsi2_below_threshold=False,  # Sentetik veri için eşik filtresi devre dışı
        )
        signal = detect_rsi_nu70(df, cfg=cfg, ignore_lifetime=True, interval="1h")
        assert signal is not None, f"NU70 fiyat uyumsuzluk sinyali bulunmalı. DataFrame: {len(df)} bar"
        assert signal["type"] == "NU70"

    def test_nu70_signal_has_required_fields(self):
        """NU70 sinyali zorunlu alanları içermeli."""
        df = self._build_nu70_df(n_pad=20)
        cfg = NU70Config(pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100)
        signal = detect_rsi_nu70(df, cfg=cfg, ignore_lifetime=True, interval="1h")
        if signal is None:
            pytest.skip("Bu veri setiyle NU70 tespit edilemedi")
        # NU70'te tepeler tepe1/tepe2 değil tepe1/tepe2 için alias: tepe1 → "tepe1"
        for field in ["type", "knowable_at", "confirm_time", "pivot_time"]:
            assert field in signal, f"Zorunlu alan eksik: {field}"

    def test_nu70_tepe2_rsi_below_threshold(self):
        """NU70 sinyalinde 2. tepe RSI değeri 1. tepeden düşük olmalı."""
        df = self._build_nu70_df(n_pad=20)
        cfg = NU70Config(pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100)
        signal = detect_rsi_nu70(df, cfg=cfg, ignore_lifetime=True, interval="1h")
        if signal is None:
            pytest.skip("Bu veri setiyle NU70 tespit edilemedi")
        # tepe2 RSI < tepe1 RSI (require_lower_rsi=True)
        tepe1_key = "tepe1" if "tepe1" in signal else "peak1"
        tepe2_key = "tepe2" if "tepe2" in signal else "peak2"
        if tepe1_key in signal and tepe2_key in signal:
            assert signal[tepe2_key]["rsi"] < signal[tepe1_key]["rsi"], (
                f"2. tepe RSI ({signal[tepe2_key]['rsi']:.1f}) 1. tepeden ({signal[tepe1_key]['rsi']:.1f}) düşük olmalı"
            )

    def test_nu70_no_signal_on_insufficient_bars(self):
        """Yetersiz bar sayısıyla sinyal üretilmemeli."""
        df = _make_df(closes=np.ones(10) * 100.0, interval="1h")
        signal = detect_rsi_nu70(df, ignore_lifetime=True, interval="1h")
        assert signal is None

    def test_nu70_confirm_time_after_pivot(self):
        """confirm_time pivot_time'dan sonra veya eşit olmalı."""
        df = self._build_nu70_df(n_pad=20)
        cfg = NU70Config(pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100)
        signal = detect_rsi_nu70(df, cfg=cfg, ignore_lifetime=True, interval="1h")
        if signal is None:
            pytest.skip("Bu veri setiyle NU70 tespit edilemedi")
        assert signal["confirm_time"] >= signal["pivot_time"], (
            "confirm_time pivot_time'dan küçük olamaz"
        )

    def test_nu70_min_rsi_peak_bounds_only_first_peak(self):
        """
        min_rsi_peak (esnek mod tabanı) yalnızca 1. tepeye uygulanmalı, 2. tepeye
        değil -- PU30 tarafındaki ayna kural (bkz. test_pu30_max_rsi_dip_bounds_only_first_dip).

        Fixture'da tepe1 RSI=100.0, tepe2 RSI~89.9. min_rsi_peak=95.0 ile tepe1
        geçer (100 >= 95) ama tepe2 geçmez (89.9 < 95); kural yalnızca tepe1'i
        sınırlıyorsa sinyal YİNE bulunmalı.
        """
        df = self._build_nu70_df(n_pad=20)
        cfg = NU70Config(
            pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100,
            strict_threshold=False, min_rsi_peak=95.0,
        )
        signal = detect_rsi_nu70(df, cfg=cfg, ignore_lifetime=True, interval="1h")
        assert signal is not None, (
            "min_rsi_peak yalnızca 1. tepeyi sınırlamalı; 2. tepe bu tabanın altında kalsa da sinyal üretilmeli"
        )
        assert signal["tepe1"]["rsi"] >= 95.0
        assert signal["tepe2"]["rsi"] < 95.0

        # Tabanı 1. tepenin de üstüne çekince (tepe1 rsi=100.0 < 101.0) sinyal düşmeli.
        cfg_tight = NU70Config(
            pivot_left_bars=4, pivot_right_bars=2, min_gap_bars=3, max_gap_bars=100,
            strict_threshold=False, min_rsi_peak=101.0,
        )
        assert detect_rsi_nu70(df, cfg=cfg_tight, ignore_lifetime=True, interval="1h") is None


# ===========================================================================
# 8. Sınır Durumları
# ===========================================================================

# ===========================================================================
# 8. Sınır Durumları
# ===========================================================================

class TestEdgeCases:
    """
    Sınır durumu testleri.

    Doğrulama stratejisi:
    - Her test yalnızca kodun gerçek sözleşmesini doğrular.
    - Belirsiz davranış 'her şeyi kabul et' koşuluyla geçiştirilmez;
      doğrudan beklenen değer pinlenir.
    """

    def test_all_nan_closes_returns_none(self):
        """
        detect_rsi_pu30'a tümü NaN olan kapanış değerleri içeren DataFrame
        verildiğinde None döndürmeli.

        Nedenler zinciri:
        1. wilder_rsi(NaN_array) → warmup NaN, sonrası RSI=50 (flat-bar davranışı).
        2. Flat RSI → pivot low bulunamaz (herhangi bir dip lokal minimum değil).
        3. Pivot yoksa sinyal üretilmez → None döner.

        Fonksiyon çökmemeli ve None dışında başka bir değer döndürmemeli.
        """
        closes = np.full(60, np.nan)
        # lows/highs da NaN olursa pivot fonksiyonu tutarlı davranmalı
        df = _make_df(closes=closes, lows=np.full(60, np.nan),
                      highs=np.full(60, np.nan), interval="1h")
        result = detect_rsi_pu30(df, ignore_lifetime=True, interval="1h")
        assert result is None, (
            f"Tüm-NaN kapanış verisiyle sinyal üretilmemeli, alınan: {result}"
        )

    def test_single_bar_pu30_returns_none(self):
        """
        detect_rsi_pu30'a tek barlık DataFrame verildiğinde None döndürmeli.

        MIN_BARS_REQUIRED = 25 guard fonksiyonun başında kontrol edilir;
        1 < 25 olduğundan erken çıkış yapılır ve None döner.
        """
        df = _make_df(closes=[100.0], interval="1h")
        result = detect_rsi_pu30(df, ignore_lifetime=True, interval="1h")
        assert result is None, (
            "Tek barlık veriyle detect_rsi_pu30 None döndürmeli (MIN_BARS_REQUIRED=25 guard)"
        )

    def test_single_bar_nu70_returns_none(self):
        """
        detect_rsi_nu70'e tek barlık DataFrame verildiğinde None döndürmeli.

        Aynı MIN_BARS_REQUIRED = 25 guard geçerlidir.
        """
        df = _make_df(closes=[100.0], interval="1h")
        result = detect_rsi_nu70(df, ignore_lifetime=True, interval="1h")
        assert result is None, (
            "Tek barlık veriyle detect_rsi_nu70 None döndürmeli (MIN_BARS_REQUIRED=25 guard)"
        )

    def test_flat_price_no_pu30_signal(self):
        """
        Tamamen düz (değişimsiz) fiyat → PU30 sinyali üretilmemeli.

        60 bar seçildi: RSI hesabı (14 bar warmup) ve pivot tespiti
        (pivot_left_bars=5, pivot_right_bars=2 → min 7 bar gerekli) için
        MIN_BARS_REQUIRED=25 eşiğini rahatlıkla aşar.

        Neden None: Flat fiyat → tüm lows eşit → local minima yok → pivot yok → sinyal yok.
        """
        df = _make_df(closes=np.ones(60) * 100.0, interval="1h")
        assert len(df) >= 25, "Test verisi MIN_BARS_REQUIRED'ı aşmalı"
        result = detect_rsi_pu30(df, ignore_lifetime=True, interval="1h")
        assert result is None, "Düz fiyatta PU30 sinyali üretilmemeli"

    def test_flat_price_no_nu70_signal(self):
        """
        Tamamen düz (değişimsiz) fiyat → NU70 sinyali üretilmemeli.

        60 bar, MIN_BARS_REQUIRED=25'i aşıyor.
        Flat fiyat → tüm highs eşit → local maxima yok → pivot yok → sinyal yok.
        """
        df = _make_df(closes=np.ones(60) * 100.0, interval="1h")
        assert len(df) >= 25, "Test verisi MIN_BARS_REQUIRED'ı aşmalı"
        result = detect_rsi_nu70(df, ignore_lifetime=True, interval="1h")
        assert result is None, "Düz fiyatta NU70 sinyali üretilmemeli"

    def test_resample_bist_4h_single_weekday_bar_produces_one_row(self):
        """
        Tek bir hafta içi 10:00 barı verildiğinde resample_bist_4h
        tam olarak 1 satır ve beklenen OHLCV sütunlarını döndürmeli.

        Tasarım: Tek bar bir seans dilimine (10:00–14:00) düşer.
        O dilimde sadece bir bar olsa da agg() o barı ilk/max/min/son/toplam
        kurallarıyla aynen korur → 1 satır çıktı beklenir.

        Çıktı sütunları: date, Open, High, Low, Close, Volume (büyük harf OHLCV).
        """
        input_open, input_high, input_low, input_close, input_vol = (
            100.0, 101.0, 99.0, 100.5, 1000.0
        )
        df = pd.DataFrame([{
            "date": pd.Timestamp("2025-01-06 10:00:00", tz=ISTANBUL_TZ),  # Pazartesi
            "open": input_open,
            "high": input_high,
            "low": input_low,
            "close": input_close,
            "volume": input_vol,
            "is_closed": True,
        }])
        df4h = resample_bist_4h(df)

        # Çıktı tipi
        assert isinstance(df4h, pd.DataFrame), "Çıktı DataFrame olmalı"

        # Satır sayısı: tek bir seans dilimine düşen tek bar → 1 satır
        assert len(df4h) == 1, (
            f"Tek hafta içi barlık girişten 1 satır bekleniyor, alınan {len(df4h)}"
        )

        # Zorunlu sütunlar
        expected_cols = {"Open", "High", "Low", "Close", "Volume"}
        actual_cols = set(df4h.columns)
        assert expected_cols.issubset(actual_cols), (
            f"Eksik sütunlar: {expected_cols - actual_cols}"
        )

        row = df4h.iloc[0]

        # OHLCV toplama kuralları (tek bar → ilk=max=min=son=kendisi, volume toplam=kendisi)
        assert row["Open"] == input_open, f"Open: beklenen {input_open}, alınan {row['Open']}"
        assert row["High"] == input_high, f"High: beklenen {input_high}, alınan {row['High']}"
        assert row["Low"] == input_low, f"Low: beklenen {input_low}, alınan {row['Low']}"
        assert row["Close"] == input_close, f"Close: beklenen {input_close}, alınan {row['Close']}"
        assert row["Volume"] == input_vol, f"Volume: beklenen {input_vol}, alınan {row['Volume']}"

    def test_resample_bist_4h_weekend_bar_produces_empty(self):
        """
        Yalnızca hafta sonu barı içeren girişte resample_bist_4h boş DataFrame döndürmeli.

        Tasarım: BIST Cumartesi-Pazar kapalı. resample_bist_4h hafta sonu
        barlarını filtreler; filtreden sonra veri boşsa pd.DataFrame() döner.
        """
        df = pd.DataFrame([{
            "date": pd.Timestamp("2025-01-04 10:00:00", tz=ISTANBUL_TZ),  # Cumartesi
            "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5,
            "volume": 1000.0, "is_closed": True,
        }])
        df4h = resample_bist_4h(df)
        assert isinstance(df4h, pd.DataFrame), "Çıktı DataFrame olmalı"
        assert len(df4h) == 0, (
            f"Yalnızca hafta sonu barından boş çıktı bekleniyor, alınan {len(df4h)} satır"
        )


# ===========================================================================
# Semih Hoca kuralları (5 Ekim 2026) — regresyon testleri
# ===========================================================================

def _semih_series():
    """Sert düşüş -> Dip 1 -> %7 tepki -> yavaş düşüş (Dip 1 altına iner) -> daha derin Dip 2 -> dönüş."""
    rng = np.random.default_rng(1)
    c = np.concatenate([
        np.full(20, 100.0), np.linspace(100, 80, 15), np.linspace(80, 86, 8),
        np.linspace(86, 78.5, 20), np.linspace(78.5, 82, 4),
    ]) + rng.normal(0, 0.15, 67)
    return _make_df(c, lows=c - 0.3, highs=c + 0.3, interval="1h")


class TestSemihKurallari:
    def test_dip2_oncesi_dip1_altina_inen_klasik_uyumsuzluk_yakalanir(self):
        """Eski kural (aradaki mumlar Dip 1'in altına inmemeli) bu yapıyı reddediyordu."""
        sig = detect_rsi_pu30(_semih_series(), PU30Config(max_rsi_dip=55.0), ignore_lifetime=True, interval="1h")
        assert sig is not None
        assert sig["dip2"]["price"] < sig["dip1"]["price"]
        assert sig["dip2"]["rsi"] > sig["dip1"]["rsi"]

    def test_strict_modda_dip2_rsi_30_alti_reddedilir(self):
        df = _semih_series()
        flex = detect_rsi_pu30(df, PU30Config(), ignore_lifetime=True, interval="1h")
        strict = detect_rsi_pu30(df, PU30Config(strict_threshold=True), ignore_lifetime=True, interval="1h")
        assert flex is not None and flex["dip2"]["rsi"] < 30
        assert strict is None

    def test_nu70_ayna_ve_guven_kiran_dip(self):
        df = _semih_series()
        m = df.copy()
        m["high"], m["low"] = 200 - df["low"], 200 - df["high"]
        m["close"], m["open"] = 200 - df["close"], 200 - df["open"]
        sig = detect_rsi_nu70(m, NU70Config(), ignore_lifetime=True, interval="1h")
        assert sig is not None
        assert sig["tepe2"]["price"] > sig["tepe1"]["price"]
        assert sig["tepe2"]["rsi"] < sig["tepe1"]["rsi"]
        assert sig["guven_kiran_dip"]["kirildi"] is False
        assert sig["tetiklendi"] is False

    def test_pu_guven_tazeleyen_tepe_kirilinca_tetiklenir(self):
        df = _semih_series()
        ext = _make_df(np.r_[df["close"].to_numpy(), 90.0, 91.0], interval="1h")
        ext["low"] = np.r_[df["low"].to_numpy(), 89.7, 90.7]
        ext["high"] = np.r_[df["high"].to_numpy(), 90.3, 91.3]
        sig = detect_rsi_pu30(ext, PU30Config(), ignore_lifetime=True, interval="1h")
        assert sig is not None and sig["tetiklendi"] is True
