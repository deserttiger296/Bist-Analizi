# -*- coding: utf-8 -*-
"""
BIST Veri Sağlayıcı ve Temizleme Modülü.

Bu modül:
1. Veri sağlayıcılarını soyut bir `DataProvider` arayüzü arkasına alır.
2. Borsa İstanbul (BIST) seans takvimi ve saatlerine uygun 4 saatlik mum sentezlemesi yapar.
3. Eksik, yinelenen, sırasız, hatalı OHLCV verilerini tespit eder ve temizler.
4. Mumların kapanmış (kesinleşmiş) veya henüz açık (oluşmakta olan) durumunu belirler.
5. Sağlayıcı geçmiş sınırlamalarını (ör. yfinance 1s verisi en fazla 730 gün) belgeler.
"""
from dataclasses import dataclass, field
from datetime import datetime, time as dtime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional, Protocol, Tuple
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import yfinance as yf

ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")

# BIST sürekli müzayede seans saatleri (Türkiye Saati: UTC+3)
BIST_SESSION_START = dtime(10, 0)
BIST_MID_SESSION = dtime(14, 0)
BIST_SESSION_END = dtime(18, 0)
BIST_CLOSING_END = dtime(18, 10)  # Kapanış marjı / tek fiyat seansı sonu

# Sağlayıcı kısıtları belgelendirmesi
PROVIDER_LIMITS: Dict[str, str] = {
    "1d": "yfinance günlük (1d) veri geçmişi çok yıllıktır (genellikle 10+ yıl mevcuttur).",
    "4h": "4 saatlik (4h) veri 1 saatlik veriden BIST seansına göre sentezlenir; yfinance 1h sınırı nedeniyle en fazla geriye dönük 730 gün (yaklaşık 2 yıl) mevcuttur.",
    "1h": "yfinance 1 saatlik (1h) intraday veri geçmişi sağlayıcı tarafından en fazla 730 gün ile sınırlandırılmıştır.",
}


class DataStatus(str, Enum):
    FRESH = "FRESH"
    STALE = "STALE"
    INSUFFICIENT_HISTORY = "INSUFFICIENT_HISTORY"
    ERROR = "ERROR"
    DELISTED = "DELISTED"


@dataclass
class DataResult:
    """Veri sorgusu dönüş nesnesi."""
    symbol: str
    interval: str
    df: Optional[pd.DataFrame] = None
    status: DataStatus = DataStatus.FRESH
    error_message: Optional[str] = None
    updated_at: str = field(default_factory=lambda: datetime.now(ISTANBUL_TZ).isoformat())
    last_bar_time: Optional[str] = None
    bar_count: int = 0
    history_limit_note: str = ""
    is_forming_bar_included: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "interval": self.interval,
            "status": self.status.value,
            "error_message": self.error_message,
            "updated_at": self.updated_at,
            "last_bar_time": self.last_bar_time,
            "bar_count": self.bar_count,
            "history_limit_note": self.history_limit_note,
            "is_forming_bar_included": self.is_forming_bar_included,
        }


class DataProvider(Protocol):
    """Soyut Veri Sağlayıcı Arayüzü."""

    def fetch_ohlcv(
        self,
        symbol: str,
        interval: str = "4h",
        period: Optional[str] = None,
        include_forming_bar: bool = False,
    ) -> DataResult:
        """Belirtilen hisse ve zaman dilimi için OHLCV verisi getirir."""
        ...


def normalize_bist_symbol(symbol: str) -> str:
    """BIST sembolünü yfinance uyumlu ticker formatına çevirir (örn. THYAO -> THYAO.IS)."""
    s = symbol.strip().upper()
    return s if s.endswith(".IS") else f"{s}.IS"


def clean_symbol_display(symbol: str) -> str:
    """Görüntüleme için .IS uzantısını temizler (örn. THYAO.IS -> THYAO)."""
    return symbol.strip().upper().replace(".IS", "")


def validate_and_clean_ohlcv(df: pd.DataFrame, interval: str) -> Tuple[pd.DataFrame, List[str]]:
    """
    OHLCV veri setinde veri bütünlüğü ve kalite kontrollerini uygular:
    - Boş satırları ayıklar
    - Yinelenen zaman damgalarını (duplicates) temizler (en son geleni korur)
    - Zaman damgalarını kronolojik olarak artan sırada sıralar
    - Mantıksız fiyat ilişkilerini doğrular: High >= Low, High >= Open, High >= Close,
      Low <= Open, Low <= Close, Close > 0, Volume >= 0
    - Hatalı satırları veri setinden arındırır.
    """
    warnings: List[str] = []
    if df.empty:
        return df, ["Veri seti tamamen boş."]

    # Sütun isimlerini küçük harfe normalize et
    col_map = {c: c.lower() for c in df.columns}
    df = df.rename(columns=col_map)

    required_cols = ["date", "open", "high", "low", "close"]
    missing_cols = [c for c in required_cols if c not in df.columns]
    if missing_cols:
        return pd.DataFrame(), [f"Eksik zorunlu sütunlar: {missing_cols}"]

    if "volume" not in df.columns:
        df["volume"] = 0.0

    # Tarihi Timestamp'e çevir
    df["date"] = pd.to_datetime(df["date"])

    # 1. Yinelenen (Duplicate) zaman damgalarını temizle
    dup_count = df.duplicated(subset=["date"]).sum()
    if dup_count > 0:
        warnings.append(f"{dup_count} adet yinelenen zaman damgası temizlendi.")
        df = df.drop_duplicates(subset=["date"], keep="last")

    # 2. Kronolojik sıralama
    if not df["date"].is_monotonic_increasing:
        warnings.append("Zaman serisi sırasızdı; kronolojik olarak yeniden sıralandı.")
        df = df.sort_values("date").reset_index(drop=True)

    # 3. Sayısal dönüşüm ve NaN temizliği
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    nan_rows = df[["open", "high", "low", "close"]].isna().any(axis=1).sum()
    if nan_rows > 0:
        warnings.append(f"{nan_rows} adet eksik/NaN fiyat satırı silindi.")
        df = df.dropna(subset=["open", "high", "low", "close"])

    # 4. Mantıksal fiyat ilişkisi kontrolleri
    # Fiyatlar pozitif olmalı
    positive_mask = (df["open"] > 0) & (df["high"] > 0) & (df["low"] > 0) & (df["close"] > 0)
    # High en büyük, Low en küçük olmalı
    high_valid = (df["high"] >= df["low"]) & (df["high"] >= df["open"]) & (df["high"] >= df["close"])
    low_valid = (df["low"] <= df["open"]) & (df["low"] <= df["close"])

    valid_mask = positive_mask & high_valid & low_valid
    invalid_count = (~valid_mask).sum()
    if invalid_count > 0:
        warnings.append(f"{invalid_count} adet High<Low veya mantıksız OHLC satırı tespit edilip ayıklandı.")
        df = df[valid_mask]

    # Negatif hacim düzeltmesi
    df["volume"] = df["volume"].clip(lower=0.0)

    return df.reset_index(drop=True), warnings


def is_bar_closed(bar_time: pd.Timestamp, interval: str, now_ist: Optional[datetime] = None) -> bool:
    """
    Bir mumun kapanıp kapanmadığını BIST seans kurallarına göre belirler.
    
    BIST Kuralları:
    - Hafta sonu (Cumartesi=5, Pazar=6): Tüm önceki mumlar kapalıdır.
    - Hafta içi:
      - 1d: Seans 18:10'da tamamen biter. now_ist >= 18:10 ise günün mumu kapalıdır.
      - 4h: 10:00 mumu 14:00'te kapanır; 14:00 mumu 18:10'da kapanır.
      - 1h: Mum başlangıcından 60 dakika sonra kapanır.
    """
    now = now_ist or datetime.now(ISTANBUL_TZ)

    # Bar zamanını Europe/Istanbul zaman dilimine normalize et
    ts = pd.Timestamp(bar_time)
    if ts.tzinfo is None:
        ts = ts.tz_localize(ISTANBUL_TZ)
    else:
        ts = ts.tz_convert(ISTANBUL_TZ)

    bar_date = ts.date()
    today_date = now.date()

    # Geçmiş günlerin mumları kesinlikle kapalıdır
    if bar_date < today_date:
        return True

    # Gelecek bir tarihteyse (anomali) kapalı sayılamaz
    if bar_date > today_date:
        return False

    # Hafta sonu ise bugüne ait mum olamaz ama varsa da kapalıdır
    if now.weekday() >= 5:
        return True

    # Bugünün mumları için seans içi zaman kontrolü:
    now_time = now.time()

    if interval == "1d":
        return now_time >= BIST_CLOSING_END

    if interval == "4h":
        # 10:00 sabah mumu 14:00'te kapanır
        if ts.hour < 14:
            return now_time >= BIST_MID_SESSION
        # 14:00 öğleden sonra mumu 18:10'da kapanır
        return now_time >= BIST_CLOSING_END

    if interval == "1h":
        # 1 saatlik mum: bar zamanı + 60 dakika
        bar_end_time = (ts + timedelta(hours=1)).time()
        return now_time >= bar_end_time

    return True


def resample_bist_4h(raw_1h_df: pd.DataFrame) -> pd.DataFrame:
    """
    1 saatlik BIST verisini duvar saati yerine Borsa İstanbul seansına göre
    kesintisiz ve tutarlı iki 4 saatlik seans mumuna (10:00 ve 14:00) sentezler:
    
    1. Seans (Sabah): 10:00 - 14:00 (10:00 öncesi açılış barları dahil 14:00'e kadar olanlar)
    2. Seans (Öğle): 14:00 - 18:10 (14:00 ve sonrası kapanışa kadar olan barlar)
    
    OHLCV Toplama Kuralları:
    - Open: İlk barın Open değeri
    - High: Periyottaki en yüksek High değeri
    - Low: Periyottaki en düşük Low değeri
    - Close: Son barın Close değeri
    - Volume: Periyottaki tüm barların Volume toplamı
    """
    if raw_1h_df.empty:
        return pd.DataFrame()

    df = raw_1h_df.copy()
    if not isinstance(df.index, pd.DatetimeIndex):
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"])
            df = df.set_index("date")
        elif "Datetime" in df.columns:
            df["Datetime"] = pd.to_datetime(df["Datetime"])
            df = df.set_index("Datetime")
        elif "Date" in df.columns:
            df["Date"] = pd.to_datetime(df["Date"])
            df = df.set_index("Date")

    # Timezone'u Europe/Istanbul yap
    if df.index.tzinfo is None:
        df.index = df.index.tz_localize("UTC").tz_convert(ISTANBUL_TZ)
    else:
        df.index = df.index.tz_convert(ISTANBUL_TZ)

    # MultiIndex sütun düzeltmesi
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)

    # Standart sütun eşlemesi
    col_map = {c: c.capitalize() for c in df.columns}
    df = df.rename(columns=col_map)

    # Hafta sonu barlarını filtrele (BIST Cumartesi-Pazar kapalı)
    df = df[df.index.dayofweek < 5]
    if df.empty:
        return pd.DataFrame()

    # BIST seans dilimi belirle: 14:00 öncesi sabah seansı, 14:00 ve sonrası öğle seansı
    def _session_label(dt: pd.Timestamp) -> pd.Timestamp:
        session_time = dtime(10, 0) if dt.hour < 14 else dtime(14, 0)
        return pd.Timestamp.combine(dt.date(), session_time).tz_localize(ISTANBUL_TZ)

    session_keys = df.index.map(_session_label)
    grouped = df.groupby(session_keys)

    resampled = grouped.agg({
        "Open": "first",
        "High": "max",
        "Low": "min",
        "Close": "last",
        "Volume": "sum",
    }).dropna(subset=["Open", "High", "Low", "Close"])

    resampled = resampled.reset_index().rename(columns={"index": "date"})
    return resampled


class YFinanceDataProvider:
    """
    yfinance kütüphanesini kullanan BIST Veri Sağlayıcısı.
    Hata yakalama, BIST seans hizalaması ve veri doğrulaması içerir.
    """

    def __init__(self, timeout_sec: int = 15):
        self.timeout_sec = timeout_sec

    def fetch_ohlcv(
        self,
        symbol: str,
        interval: str = "4h",
        period: Optional[str] = None,
        include_forming_bar: bool = False,
    ) -> DataResult:
        clean_sym = clean_symbol_display(symbol)
        norm_sym = normalize_bist_symbol(symbol)
        limit_note = PROVIDER_LIMITS.get(interval, "Standart geçmiş veri sınırı geçerlidir.")

        if interval not in ("1d", "4h", "1h"):
            return DataResult(
                symbol=clean_sym,
                interval=interval,
                status=DataStatus.ERROR,
                error_message=f"Desteklenmeyen zaman dilimi: {interval}. Desteklenenler: 1d, 4h, 1h",
                history_limit_note=limit_note,
            )

        try:
            # 4h için yfinance'ten 1h çekip BIST seansına göre sentezliyoruz (max 730d)
            fetch_interval = "1h" if interval == "4h" else interval
            fetch_period = period or ("730d" if interval in ("1h", "4h") else "1y")

            raw = yf.download(
                norm_sym,
                period=fetch_period,
                interval=fetch_interval,
                auto_adjust=True,
                progress=False,
                timeout=self.timeout_sec,
            )

            if raw is None or raw.empty:
                return DataResult(
                    symbol=clean_sym,
                    interval=interval,
                    status=DataStatus.ERROR,
                    error_message=f"{clean_sym} için yfinance'ten veri alınamadı (Hisse kottan çıkmış veya sembol geçersiz olabilir).",
                    history_limit_note=limit_note,
                )

            # MultiIndex sütunları düzelt
            if isinstance(raw.columns, pd.MultiIndex):
                raw.columns = raw.columns.droplevel(1)

            # 4h ise BIST seansına göre sentezle
            if interval == "4h":
                df = resample_bist_4h(raw)
            else:
                date_col = "Datetime" if "Datetime" in raw.columns else ("Date" if "Date" in raw.columns else None)
                if date_col:
                    df = raw.reset_index()
                else:
                    df = raw.reset_index().rename(columns={"index": "date"})

            # Kolon isimlerini normalize et
            date_col_name = "date"
            for candidate in ["date", "Datetime", "Date", "index"]:
                if candidate in df.columns:
                    date_col_name = candidate
                    break

            df = df[[date_col_name, "Open", "High", "Low", "Close", "Volume"]].copy()
            df.columns = ["date", "open", "high", "low", "close", "volume"]

            # Kalite doğrulaması ve temizleme
            df, warnings = validate_and_clean_ohlcv(df, interval)

            if len(df) < 25:
                return DataResult(
                    symbol=clean_sym,
                    interval=interval,
                    status=DataStatus.INSUFFICIENT_HISTORY,
                    error_message=f"{clean_sym} için hesaplama yapılabilecek yeterli mum yok (Mevcut: {len(df)}, Gerekli: 25).",
                    history_limit_note=limit_note,
                    bar_count=len(df),
                )

            # Mumların kapanmış / oluşmakta olan durumunu etiketle
            now_ist = datetime.now(ISTANBUL_TZ)
            df["is_closed"] = df["date"].apply(lambda t: is_bar_closed(t, interval, now_ist))

            last_bar_is_closed = bool(df["is_closed"].iloc[-1])
            is_forming = not last_bar_is_closed

            # Eğer kullanıcı oluşmakta olan mumu istemiyorsa ve son mum kapanmamışsa son mumu filtrele
            if not include_forming_bar and is_forming:
                df = df.iloc[:-1].copy()

            if df.empty:
                return DataResult(
                    symbol=clean_sym,
                    interval=interval,
                    status=DataStatus.INSUFFICIENT_HISTORY,
                    error_message="Kapanmış mum kalmadı.",
                    history_limit_note=limit_note,
                )

            last_bar_time_str = df["date"].iloc[-1].strftime("%Y-%m-%d %H:%M" if interval != "1d" else "%Y-%m-%d")

            # Veri bayatlık (Stale) kontrolü: Son mum 5 takvim gününden eskiyse STALE olarak işaretle
            last_ts = pd.Timestamp(df["date"].iloc[-1])
            if last_ts.tzinfo is None:
                last_ts = last_ts.tz_localize(ISTANBUL_TZ)
            else:
                last_ts = last_ts.tz_convert(ISTANBUL_TZ)

            age_days = (now_ist.date() - last_ts.date()).days
            status = DataStatus.STALE if age_days > 5 else DataStatus.FRESH

            return DataResult(
                symbol=clean_sym,
                interval=interval,
                df=df,
                status=status,
                last_bar_time=last_bar_time_str,
                bar_count=len(df),
                history_limit_note=limit_note,
                is_forming_bar_included=include_forming_bar and is_forming,
            )

        except Exception as e:
            return DataResult(
                symbol=clean_sym,
                interval=interval,
                status=DataStatus.ERROR,
                error_message=f"Veri çekme hatası: {str(e)}",
                history_limit_note=limit_note,
            )


# Varsayılan sağlayıcı tekil örneği (Singleton)
_DEFAULT_PROVIDER: Optional[DataProvider] = None


def get_default_provider() -> DataProvider:
    global _DEFAULT_PROVIDER
    if _DEFAULT_PROVIDER is None:
        _DEFAULT_PROVIDER = YFinanceDataProvider()
    return _DEFAULT_PROVIDER
