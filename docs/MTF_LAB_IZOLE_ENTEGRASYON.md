# İzole MTF Strateji Laboratuvarı — tam entegrasyon kodları

Güncel mimari: `mtf-lab-v1`. Bu belge önceki MTF entegrasyon rehberinin yerine geçer.

## 1. Klasik sistemin sınırı

`python_bot/engine/signals/rsi_pu30.py`, `python_bot/engine/data/provider.py`, `python_bot/signal_api.py` ve `src/lib/rsiPu30Engine.ts` dosyaları Git'teki MTF öncesi sürümleriyle aynıdır. Klasik tarama/detay yanıtları, PU30/NU70 etiketleri ve lokal Fibonacci korunur. Klasik `public/static/app.js` içindeki radar/kart/grafik fonksiyonları da MTF öncesi koddur. Önceden düzeltilen gezinme ve grafik kapatma davranışı korunmuştur.

MTF'nin gelişmiş dip iptali/eşit saatlik dip/durum matrisi/makro Fibonacci hesapları yalnız `pu30_mtf.py` içinde bulunur. Klasik fonksiyonlar bu modülü çağırmaz. Klasik, kendi özgün kurallarına göre sonuç üretir; laboratuvarın bir çifti iptal etmesi klasik sonucu değiştirmez.

## 2. Endpoint sınırı

| İşlem | Klasik | Laboratuvar |
|---|---|---|
| Tarama | `/api/scan/rsi-pu30` | `/api/mtf-lab` |
| Tek hisse | `/api/scan/rsi-pu30/ISCTR?interval=4h` | `/api/mtf-lab/ISCTR` |
| Sembolle sınırlı tarama | Mevcut davranış | `/api/mtf-lab?symbols=ISCTR,BAGFS` |

Yeni router hem tam FastAPI uygulamasına hem Vercel lite uygulamasına eklenmiştir. Next.js iki yeni route ile backend'e taşır. Hesaplama modülü yalnız laboratuvar isteğinde yüklenir; klasik uygulamanın başlangıcını laboratuvar hesaplarının importuna bağlamaz. 15m veri yalnız laboratuvarda, yfinance'in 60 günlük isteğiyle alınır. Klasik veri sağlayıcısının desteklediği periyotlar değişmez.

## 3. Yeni model

- Fiyat tabanlı MOST: EMA(9), yüzde 1.1 stop. Bu motor mevcut MOSTRSI motorundan ayrıdır. EMA `adjust=False` ve ilk fiyat başlangıcıyla hesaplanır; ilk 9 fiyat tamamlanmadan hazır sayılmaz.
- NU: son 100 kapalı bar içindeki son iki teyitli fiyat tepesi HH yaparken RSI değerleri LH yaparsa baskı kaydedilir. Bu alt-periyot NU için ayrıca 70 eşiği aranmaz.
- RSI düşen trend: son üç veya iki alçalan teyitli RSI tepesi üzerinden doğrusal regresyon kurulur. Uygun RSI pivotları yoksa NU fiyat pivotlarına karşılık gelen RSI noktaları kullanılır; kaynak `PRICE_PIVOT_RSI` olarak belirtilir.
- Trend kırılımı yalnız kapanmış RSI ile teyit edilir. Açık barın fiyat/EMA/MOST değerleri ayrıca geçici olarak gösterilir. İki periyotta da NU varsa tek periyodun kırılması diğerindeki baskıyı kaldırmaz.
- `LOWER_TF_NU_PRESSURE`: güncel alt-periyot veri + kırılmamış NU/RSI baskısı + 4S/günlük uyumsuzluk. Tam uyum varsa mevcut `FULL_CONFIRMATION` korunur. Günlük yapı/veri bilinmiyorsa `DATA_UNAVAILABLE` korunur.
- MOST'un güncel üstünde/altında bayrakları ve seviyeleri döner. Tam EMA/MOST dizileri `calc_most` fonksiyonunda mevcuttur; 100 hisselik HTTP yanıtını büyütmemek için tarama/detay özeti yalnız son değerleri taşır.

## 4. Ayrı sayfalar (güncel)

Klasik `/index.html#rsipu30` adresinde, laboratuvar `/mtf-lab.html` adresindedir. Üstteki bağlantılar gerçek sayfa geçişi yapar; sekme halinde ortak DOM kullanılmaz. Klasik yalnız `app.js`, laboratuvar yalnız `mtf-lab.js` yükler. Laboratuvar taraması düğmeyle başlatılır. Ana uygulama bağlantısı `/` adresindedir. Günlük veto/veri eksikliği üç evreye zorla atanmaz.

Aşağıdaki kodlar mevcut dosyalardan alınmış tam fonksiyonlardır. Modülün mevcut importları ve lab'a ait PU30Config/detektör yardımcılarıyla çalışırlar; tam kaynak `python_bot/engine/signals/pu30_mtf.py` dosyasındadır.


## _load_pu30_frames

```python
def _load_pu30_frames(symbol, interval="4h", period=None):
    """One snapshot per timeframe, including forming bars for invalidation."""
    from dataclasses import replace
    from python_bot.engine.data.provider import resample_bist_4h
    frames, results = {}, {}
    for tf in ("1h", "4h", "1d"):
        if tf == "4h" and frames.get("1h") is not None and results.get("1h") is not None:
            session = resample_bist_4h(frames["1h"])
            if len(session) >= MIN_BARS_REQUIRED:
                session.columns = [c.lower() for c in session.columns]
                session["is_closed"] = [is_bar_closed(t, "4h") for t in session.date]
                frames["4h"] = session
                results["4h"] = replace(results["1h"], interval="4h", df=session,
                    bar_count=len(session), last_bar_time=pd.Timestamp(session.date.iloc[-1]).isoformat(),
                    is_forming_bar_included=not bool(session.is_closed.iloc[-1]))
                continue
        try:
            frame, result = _fetch_adjusted_bars(
                symbol, interval=tf, period=period if tf == interval else None,
                include_forming_bar=True)
        except Exception as error:
            frame, result = None, DataResult(symbol=symbol, interval=tf, status=DataStatus.ERROR, error_message=str(error))
        frames[tf] = frame.reset_index(drop=True) if frame is not None else None
        results[tf] = result
    return frames, results
```


## calc_most

```python
def calc_most(closes, length=9, percent=1.1):
    """Price EMA + percentage trailing stop; this is independent of MOSTRSI."""
    if length < 1 or not np.isfinite(percent) or percent <= 0:
        raise ValueError("length >= 1 and percent > 0 required")
    values = np.asarray(closes, dtype=float)
    if values.ndim != 1 or np.any(~np.isfinite(values)) or np.any(values <= 0):
        raise ValueError("closes must contain finite positive prices")
    n = len(values)
    ema = pd.Series(values).ewm(span=length, adjust=False, min_periods=length).mean().to_numpy()
    most = np.full(n, np.nan)
    for i in range(length - 1, n):
        lower, upper = ema[i] * (1 - percent / 100), ema[i] * (1 + percent / 100)
        if i == length - 1:
            most[i] = lower
        elif ema[i] > most[i - 1] and ema[i - 1] > most[i - 1]:
            most[i] = max(most[i - 1], lower)
        elif ema[i] < most[i - 1] and ema[i - 1] < most[i - 1]:
            most[i] = min(most[i - 1], upper)
        else:
            most[i] = lower if ema[i] > most[i - 1] else upper if ema[i] < most[i - 1] else most[i - 1]
    ready = n >= length
    return {"status": "READY" if ready else "INSUFFICIENT_HISTORY", "length": length, "percent": percent,
            "ema": [float(v) if np.isfinite(v) else None for v in ema],
            "most": [float(v) if np.isfinite(v) else None for v in most],
            "current_ema": float(ema[-1]) if ready else None,
            "current_most": float(most[-1]) if ready else None,
            "above_ema": bool(values[-1] > ema[-1]) if ready else None,
            "above_most": bool(values[-1] > most[-1]) if ready else None}
```


## _lower_tf_state

```python
def _lower_tf_state(df, interval):
    empty = {"status": "UNAVAILABLE", "nu_pressure": False, "rsi_trend_broken": None,
             "rsi_trend": None, "most": None}
    if df is None or len(df) < 25:
        return empty
    original = df.reset_index(drop=True)
    closed = original[original.is_closed.astype(bool)].reset_index(drop=True)
    if len(closed) < 25:
        return empty
    rsi = wilder_rsi(closed.close.to_numpy(dtype=float))
    price_peaks = find_confirmed_pivot_highs(closed.high.to_numpy(dtype=float), 2, 2)
    price_peaks = [p for p in price_peaks if p >= len(closed) - 100 and np.isfinite(rsi[p])]
    nu = False
    pair = None
    if len(price_peaks) >= 2:
        a, b = price_peaks[-2:]
        nu = bool(closed.high.iloc[b] > closed.high.iloc[a] and rsi[b] < rsi[a])
        if nu:
            pair = {"price1": float(closed.high.iloc[a]), "price2": float(closed.high.iloc[b]),
                    "rsi1": float(rsi[a]), "rsi2": float(rsi[b]),
                    "date1": pd.Timestamp(closed.date.iloc[a]).isoformat(),
                    "date2": pd.Timestamp(closed.date.iloc[b]).isoformat()}
    peaks = find_confirmed_pivot_highs(rsi, 2, 2)
    peaks = [p for p in peaks if p >= len(closed) - 100 and np.isfinite(rsi[p])]
    trend_peaks = []
    for count in (3, 2):
        chosen = peaks[-count:]
        if len(chosen) == count and np.all(np.diff(rsi[chosen]) < 0):
            trend_peaks = chosen
            break
    trend_source = "RSI_PIVOTS"
    if not trend_peaks and nu:
        trend_peaks = price_peaks[-2:]
        trend_source = "PRICE_PIVOT_RSI"
    trend, broken = None, None
    if trend_peaks:
        slope, intercept = np.polyfit(trend_peaks, rsi[trend_peaks], 1)
        projected = float(slope * (len(closed) - 1) + intercept)
        broken = bool(slope < 0 and rsi[-1] > projected)
        trend = {"slope": float(slope), "intercept": float(intercept), "value_now": projected,
                 "source": trend_source, "peak_count": len(trend_peaks),
                 "peaks": [{"date": pd.Timestamp(closed.date.iloc[p]).isoformat(), "rsi": float(rsi[p])} for p in trend_peaks]}
    most = calc_most(original.close.to_numpy(dtype=float))
    # A universe scan needs current status, not thousands of EMA/stop points.
    # calc_most remains available with full arrays for dedicated chart consumers.
    most_summary = {key: value for key, value in most.items() if key not in ("ema", "most")}
    return {"status": "READY", "interval": interval, "nu_pressure": nu, "nu_pair": pair,
            "rsi_trend_broken": broken, "rsi_trend": trend, "current_closed_rsi": float(rsi[-1]),
            "trend_checked_at": pd.Timestamp(closed.date.iloc[-1]).isoformat(),
            "latest_bar_time": pd.Timestamp(original.date.iloc[-1]).isoformat(),
            "latest_bar_closed": bool(original.is_closed.iloc[-1]),
            "most": most_summary}
```


## detect_lower_tf_nu_and_rsi_trend

```python
def detect_lower_tf_nu_and_rsi_trend(df_15m, df_1h):
    states = {"15m": _lower_tf_state(df_15m, "15m"), "1h": _lower_tf_state(df_1h, "1h")}
    pressured = [s for s in states.values() if s["status"] == "READY" and s["nu_pressure"]]
    return {"timeframes": states, "nu_pressure": bool(pressured),
            "rsi_trend_broken": bool(pressured) and all(s["rsi_trend_broken"] is True for s in pressured)}
```


## build_mtf_decision

```python
def build_mtf_decision(frames, statuses=None):
    statuses = statuses or {}
    states = {tf: timeframe_state(frames.get(tf), tf, statuses.get(tf, "ERROR")) for tf in ("1h", "4h", "1d")}
    states["4h"] = invalidate_session_from_hourly(frames.get("1h"), states["4h"])
    daily = daily_structure(frames.get("1d"), states["1d"])
    hourly, session = states["1h"], states["4h"]
    four = session.get("pu30")
    # A closed 1h bar or a closed 4h bar must clear the BETWEEN-DIPS resistance.
    resistance, resistance_broken, breakout_at = None, False, None
    if session["valid_pu30"]:
        resistance = four["guven_tazeleyen_tepe"]["price"]
        confirmations = []
        for tf in ("1h", "4h"):
            frame = frames.get(tf)
            if frame is None or states[tf]["data_status"] != "FRESH": continue
            eligible = frame[frame.is_closed.astype(bool)]
            if len(eligible):
                row = eligible.iloc[-1]
                close_at = bar_close_time(row.date, tf)
                if close_at >= pd.Timestamp(four["knowable_at"]):
                    confirmations.append((close_at, float(row.close)))
        if confirmations:
            close_at, price = max(confirmations, key=lambda item: item[0])
            resistance_broken = price > resistance
            breakout_at = close_at.isoformat() if resistance_broken else None
    fresh = all(s["data_status"] == "FRESH" for s in states.values())
    price_frame = frames.get("1h")
    current_price = float(price_frame.close.iloc[-1]) if price_frame is not None and len(price_frame) else None
    above = bool(current_price is not None and resistance is not None and current_price > resistance)
    state = classify_pu30_state(data_fresh=fresh, daily_status=daily["status"],
        hourly_pu=hourly["valid_pu30"], session_pu=session["valid_pu30"],
        closed_breakout=resistance_broken, price_above_resistance=above)
    if state == "DATA_UNAVAILABLE":
        label = "VERİ / GÜNLÜK YAPI TEYİDİ BEKLENİYOR"
        action = "Eksik veya gecikmiş veriyle ana alım onayı verilmez."
    elif state == "DAILY_VETO":
        label = "GÜNLÜK YAPI BOZUK — ALIM ONAYI YOK"
        action = daily["reason"]
    elif state == "FULL_CONFIRMATION":
        label = "TAM ONAYLI ALIM (1S+4S+1G UYUMLU — YÜKSEK MARJ POTANSİYELİ)"
        action = "Teyitli 4S PU30, direnç üzerinde kapanış, direnç üstünde güncel fiyat ve günlük yapı koşulları sağlandı."
    elif state == "EARLY_REACTION":
        label = "TEPKİ ÇIKIŞI — SEANSLIKTA SON BİR DİP DAHA BEKLENİYOR"
        action = "Saatlik PU tepkisi: hafif bir tepki sonrası 4S'de yeni dip olasılığı var. Ana alım için geçerli 4S PU30 ve direnç üzerinde kapanış beklenmeli."
    else:
        state, label = "WAITING_CONFIRMATION", "DİP OLUŞUM / TEYİT BEKLENİYOR"
        action = "Geçerli 4S PU30, güven tazeleyen direnç üzerinde kapanış ve direnç üstünde güncel fiyat bekleniyor."
    macro = macro_fibonacci(frames["4h"], four) if state == "FULL_CONFIRMATION" else {"status": "NOT_CONFIRMED", "levels": []}
    result = {"state": state, "label": label, "action": action,
            "is_active_buy": state == "FULL_CONFIRMATION", "timeframes": states,
            "daily_structure": daily, "resistance": resistance,
            "resistance_broken": resistance_broken, "breakout_at": breakout_at,
            "current_price": current_price, "price_above_resistance": above,
            "layer_flags": {"1G_Saglam": daily["status"] == "INTACT",
                            "1S_PU": hourly["valid_pu30"], "4S_PU": session["valid_pu30"]},
            "macro_fibonacci": macro}
    if "15m" in frames:
        lower = detect_lower_tf_nu_and_rsi_trend(frames.get("15m"), frames.get("1h"))
        result["lower_timeframes"] = lower
        aligned = session["valid_pu30"] and daily["status"] == "INTACT"
        lower_fresh = statuses.get("15m") == "FRESH" and statuses.get("1h") == "FRESH"
        if fresh and lower_fresh and daily["status"] != "UNKNOWN" and lower["nu_pressure"] and not lower["rsi_trend_broken"] and not aligned:
            result.update(state="LOWER_TF_NU_PRESSURE", is_active_buy=False,
                label="SEANSLIK VE GÜNLÜK UYUM SAĞLAMIYOR — KISA VADELİ TEPKİ / NU BASKISI",
                action="15D/1S negatif uyumsuzluk baskısı var; RSI düşen trend kırılımı ve 4S/1G uyumu bekleniyor.",
                macro_fibonacci={"status": "NOT_CONFIRMED", "levels": []})
    return result
```


## get_symbol_mtf_lab_data

```python
def get_symbol_mtf_lab_data(symbol):
    frames, quality = _load_pu30_frames(symbol)
    statuses = {tf: result.status.value if result else "ERROR" for tf, result in quality.items()}
    frames["15m"], statuses["15m"] = _fetch_lab_15m(symbol)
    decision = build_mtf_decision(frames, statuses)
    return {"symbol": clean_symbol_display(symbol), "engine": "mtf-lab-v1",
            "decision": decision, "data_statuses": statuses,
            "calculated_at": pd.Timestamp.now(tz="UTC").isoformat()}
```


## scan_universe_mtf_lab

```python
def scan_universe_mtf_lab(symbols, max_workers=8):
    from concurrent.futures import ThreadPoolExecutor
    rows, errors = [], []
    def one(symbol):
        try:
            return get_symbol_mtf_lab_data(symbol), None
        except Exception as error:
            return None, {"symbol": clean_symbol_display(symbol), "error": str(error)}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        for row, error in pool.map(one, symbols):
            if row is not None:
                rows.append(row)
                unavailable = [tf for tf, status in row["data_statuses"].items() if status != "FRESH"]
                if unavailable:
                    errors.append({"symbol": row["symbol"], "error": "Veri eksik/gecikmiş: " + ", ".join(unavailable)})
            if error: errors.append(error)
    groups = {key: [r for r in rows if r["decision"]["state"] == key] for key in
              ("EARLY_REACTION", "FULL_CONFIRMATION", "LOWER_TF_NU_PRESSURE")}
    return {"engine": "mtf-lab-v1", "status": "error" if errors and not rows else "partial" if errors else "success",
            "rows": rows, "groups": groups, "errors": errors, "scanned": len(rows),
            "calculated_at": pd.Timestamp.now(tz="UTC").isoformat()}
```


## Yeni FastAPI router

```python
"""Opt-in laboratory endpoints. The classic signal router is unchanged."""
import re

from fastapi import APIRouter, HTTPException, Response

from python_bot.engine.universe import BIST100_SYMBOLS

router = APIRouter(prefix="/api/mtf-lab", tags=["MTF laboratory"])


def scan_universe_mtf_lab(symbols):
    # Loading the classic app must not load or initialize lab calculations.
    from python_bot.engine.signals.pu30_mtf import scan_universe_mtf_lab as run
    return run(symbols)


def get_symbol_mtf_lab_data(symbol):
    from python_bot.engine.signals.pu30_mtf import get_symbol_mtf_lab_data as run
    return run(symbol)


def _symbol(value):
    value = value.strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{2,12}(?:\.IS)?", value):
        raise HTTPException(status_code=400, detail="Geçersiz hisse sembolü")
    return value


@router.get("")
def scan_mtf_lab(response: Response, symbols: str = ""):
    selected = list(dict.fromkeys(_symbol(s) for s in symbols.split(","))) if symbols else BIST100_SYMBOLS
    if len(selected) > 100:
        raise HTTPException(status_code=400, detail="En fazla 100 sembol taranabilir")
    response.headers["Cache-Control"] = "no-store"
    result = scan_universe_mtf_lab(selected)
    return {"status": result["status"], "data": result}


@router.get("/{symbol}")
def detail_mtf_lab(symbol: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    result = get_symbol_mtf_lab_data(_symbol(symbol))
    return {"status": "success", "data": result}

```


## Next.js tarama route

```typescript
import { backendRequest } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  return backendRequest("/api/mtf-lab" + new URL(request.url).search);
}

```


## Next.js detay route

```typescript
import { backendRequest } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(_: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return backendRequest("/api/mtf-lab/" + encodeURIComponent(symbol));
}

```


## Tam izole UI kodu

```javascript
// Opt-in laboratory: no references to classic card/chart objects or scan handlers.
window.initMtfLab = function () {
    const lab = document.getElementById('mtf-lab-container');
    if (!lab || lab.dataset.initialized) return;
    lab.dataset.initialized = 'true';
    const list = lab.querySelector('[data-lab-list]');
    const message = lab.querySelector('[data-lab-status]');
    const filters = lab.querySelectorAll('[data-lab-filter]');
    const scan = lab.querySelector('[data-lab-scan]');
    const detail = lab.querySelector('[data-lab-detail]');
    let rows = [], selected = 'EARLY_REACTION', controller = null;
    const labels = {
        EARLY_REACTION: '🟡 EVRE 1 · Saatlik Tepki / 4S Son Dip Bekleniyor',
        FULL_CONFIRMATION: '🟢 EVRE 2 · Tam Onaylı Ralli / Makro Fibo',
        LOWER_TF_NU_PRESSURE: '🔴 EVRE 3 · Alt Periyot NU Baskısı',
    };
    const money = value => value == null ? '—' : Number(value).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
    function line(parent, text, tag = 'p') {
        const element = document.createElement(tag);
        element.textContent = text;
        parent.appendChild(element);
        return element;
    }
    function dailySummary(d) {
        const daily = d.daily_structure;
        const pu = value => value == null ? 'bilinmiyor' : value ? 'var' : 'yok';
        return `1S PU: ${pu(d.layer_flags['1S_PU'])} · 4S PU: ${pu(d.layer_flags['4S_PU'])} · Günlük: ${daily.status} (${daily.source || daily.support_source || 'bilinmiyor'}) · Günlük RSI: ${money(daily.current_rsi)} · Önceki dip RSI: ${money(daily.d1_rsi)} · Destek: ${money(daily.support)} ₺ · Son günlük Low: ${money(daily.current_low)} ₺ · Gerekçe: ${daily.reason || 'bilinmiyor'}`;
    }
    function renderDetail(row) {
        detail.replaceChildren();
        const d = row.decision;
        line(detail, `${row.symbol} · ${d.label}`, 'h3');
        line(detail, d.action);
        line(detail, dailySummary(d));
        line(detail, `Ana direnç: ${money(d.resistance)} ₺`);
        const lower = d.lower_timeframes?.timeframes || {};
        for (const tf of ['15m', '1h']) {
            const s = lower[tf], most = s?.most;
            const answer = value => value == null ? 'bilinmiyor' : value ? 'evet' : 'hayır';
            line(detail, `${tf === '15m' ? '15D' : '1S'} · NU: ${answer(s?.nu_pressure)} · RSI düşen trend kırıldı: ${answer(s?.rsi_trend_broken)}`);
            line(detail, `Fiyat EMA(9) üstünde: ${answer(most?.above_ema)} (${money(most?.current_ema)}) · MOST %1,1 üstünde: ${answer(most?.above_most)} (${money(most?.current_most)})`);
            if (s?.latest_bar_time) line(detail, `Son mum: ${s.latest_bar_time} · ${s.latest_bar_closed ? 'kapalı' : 'oluşuyor; MOST değerleri geçici'}`);
        }
        if (d.macro_fibonacci.status === 'AVAILABLE') {
            for (const level of d.macro_fibonacci.levels) line(detail, `${level.label}: ${money(level.price)} ₺`);
        }
        line(detail, `Veri: ${Object.entries(row.data_statuses).map(([tf, status]) => `${tf}: ${status}`).join(' · ')}`);
        detail.hidden = false;
    }
    function render() {
        list.replaceChildren();
        for (const button of filters) {
            const count = rows.filter(r => r.decision.state === button.dataset.labFilter).length;
            button.textContent = `${labels[button.dataset.labFilter]} (${count})`;
            button.setAttribute('aria-pressed', String(button.dataset.labFilter === selected));
        }
        const otherList = lab.querySelector('[data-lab-other-list]');
        if (otherList) {
            otherList.replaceChildren();
            for (const row of rows.filter(r => !labels[r.decision.state])) {
                const card = document.createElement('article');
                card.className = 'lab-card';
                line(card, `${row.symbol} · ${row.decision.label}`, 'h3');
                line(card, dailySummary(row.decision));
                const button = line(card, 'Laboratuvar detayı', 'button');
                button.type = 'button';
                button.addEventListener('click', () => renderDetail(row));
                otherList.appendChild(card);
            }
        }
        const visible = rows.filter(r => r.decision.state === selected);
        if (!visible.length) line(list, 'Bu kategoride hisse yok. Veri eksikliği veya günlük veto durumları alım onayı sayılmaz.');
        for (const row of visible) {
            const card = document.createElement('article');
            card.className = 'lab-card';
            card.dataset.state = selected;
            line(card, `${row.symbol} · ${labels[selected]}`, 'h3');
            line(card, row.decision.action);
            line(card, dailySummary(row.decision));
            if (row.decision.macro_fibonacci.status === 'AVAILABLE') line(card, `İlk ana hedef · Makro Fibo 0.382: ${money(row.decision.macro_fibonacci.target_0382)} ₺`);
            if (selected === 'LOWER_TF_NU_PRESSURE') {
                for (const [tf, s] of Object.entries(row.decision.lower_timeframes?.timeframes || {})) {
                    const above = value => value == null ? 'bilinmiyor' : value ? 'üstünde' : 'üstünde değil';
                    line(card, `${tf} · EMA(9): ${money(s.most?.current_ema)} (${above(s.most?.above_ema)}) · MOST %1,1: ${money(s.most?.current_most)} (${above(s.most?.above_most)}) · RSI trend kırılımı: ${s.rsi_trend_broken == null ? 'bilinmiyor' : s.rsi_trend_broken ? 'var' : 'yok'}`);
                }
            }
            const button = line(card, 'Laboratuvar detayı', 'button');
            button.type = 'button';
            button.addEventListener('click', () => renderDetail(row));
            list.appendChild(card);
        }
    }
    async function request(symbol) {
        controller?.abort();
        const own = new AbortController();
        controller = own;
        message.textContent = 'Laboratuvar verisi hesaplanıyor…';
        scan.disabled = true;
        const timer = setTimeout(() => own.abort(), 280000);
        try {
            const url = symbol ? `/api/mtf-lab/${encodeURIComponent(symbol)}` : '/api/mtf-lab';
            const response = await fetch(url, { cache: 'no-store', signal: own.signal });
            const body = await response.json();
            if (!response.ok || !body.data || body.status === 'error') throw new Error(body.detail || 'Laboratuvar yanıt vermedi');
            if (own !== controller || lab.hidden) return;
            rows = symbol ? [body.data] : body.data.rows;
            if (symbol && labels[body.data.decision.state]) selected = body.data.decision.state;
            render();
            const other = rows.filter(r => !labels[r.decision.state]).length;
            message.textContent = `${rows.length} hisse incelendi · ${other} hisse bekleme / günlük veto / eksik veri durumunda.` + (body.data.errors?.length ? ` ${body.data.errors.length} veri uyarısı var.` : '');
            if (symbol) renderDetail(body.data);
        } catch (error) {
            if (own === controller && !lab.hidden) message.textContent = error.name === 'AbortError' ? 'İstek iptal edildi veya süre sınırına ulaştı. Tek hisseyle tekrar deneyebilirsin.' : error.message;
        } finally {
            clearTimeout(timer);
            if (own === controller) scan.disabled = false;
        }
    }
    for (const button of filters) button.addEventListener('click', () => { selected = button.dataset.labFilter; render(); });
    scan.addEventListener('click', () => request());
    lab.querySelector('[data-lab-symbol-form]').addEventListener('submit', event => {
        event.preventDefault();
        const symbol = lab.querySelector('[data-lab-symbol]').value.trim().toUpperCase();
        if (symbol) request(symbol);
    });
};

document.addEventListener("DOMContentLoaded", () => window.initMtfLab());

```


## İzole CSS

```css
#mtf-lab-container { min-width: 0; }
#mtf-lab-container h2, #mtf-lab-container h3 { margin-bottom: 0.75rem; }
#mtf-lab-container p { margin: 0.5rem 0; overflow-wrap: anywhere; }
#mtf-lab-container .lab-controls, #mtf-lab-container .lab-filters { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 1rem 0; }
#mtf-lab-container form { display: flex; flex-wrap: wrap; gap: 0.5rem; min-width: 0; }
#mtf-lab-container input { min-width: 0; max-width: 100%; }
#mtf-lab-container button { background: #27272a; color: #f4f4f5; border: 1px solid #52525b; }
#mtf-lab-container button[aria-pressed="true"] { outline: 2px solid #a78bfa; }
#mtf-lab-container [data-lab-filter="EARLY_REACTION"] { color: #fbbf24; }
#mtf-lab-container [data-lab-filter="FULL_CONFIRMATION"] { color: #34d399; }
#mtf-lab-container [data-lab-filter="LOWER_TF_NU_PRESSURE"] { color: #fb7185; }
#mtf-lab-container .lab-card, #mtf-lab-container [data-lab-detail] { margin: 1rem 0; padding: 1rem; border: 1px solid #52525b; border-radius: 12px; background: #18181b; }
#mtf-lab-container .lab-card[data-state="EARLY_REACTION"] { border-color: #fbbf24; }
#mtf-lab-container .lab-card[data-state="FULL_CONFIRMATION"] { border-color: #34d399; }
#mtf-lab-container .lab-card[data-state="LOWER_TF_NU_PRESSURE"] { border-color: #fb7185; }
#mtf-lab-container [data-lab-status] { color: #c4b5fd; }

```


## Ayrı HTML sayfaları

Klasik sayfanın tam kodu: `public/index.html`. Laboratuvarın tam kodu: `public/mtf-lab.html`. Ortak sayfa bağlantılarının CSS'i `public/static/strategy-pages.css` içindedir. Klasik `app.js` içinde laboratuvar başlatıcısı yoktur. Laboratuvar kendi DOMContentLoaded olayında başlatılır ve taramayı kullanıcı düğmeyle başlatır. İki sayfa hem Next/Vercel'de hem yerel FastAPI'de sunulur.

## Kontrol

`node --test scripts/test_mtf_lab_ui.cjs` ayrı script/container yüklemesini, klasik açılışı, dönüş hedefini ve laboratuvar isteğini doğrular.

## Günlük PU oluşum adayı düzeltmesi

Son canlı günlük RSI esas alınır. Destek kırılırken RSI önceki dip RSI değerinden yüksek ve en az 30 ise aday günlük yapıyı sağlam tutar. Teyitli günlük PU bayrağı değiştirilmez; NU70 bağımsız veto olarak korunur.

```python
def daily_structure(df, state):
    """Daily support may form a live PU candidate before right-pivot confirmation."""
    if df is None or state["data_status"] != "FRESH":
        return {"status": "UNKNOWN", "reason": "Günlük veri eksik veya güncel değil"}
    df = df.reset_index(drop=True)
    closed = df.is_closed.to_numpy(dtype=bool)
    lows = df.low.to_numpy(dtype=float)
    historical = state.get("pu30") if state.get("valid_pu30") else None
    if historical:
        p = historical["dip2"]["index"]
        support = historical["dip2"]["price"]
        source = "DAILY_PU30_LOW"
    else:
        pivots = find_confirmed_pivot_lows(lows, 5, 2, closed)
        if not pivots:
            return {"status": "UNKNOWN", "reason": "Teyitli günlük dip yok"}
        p, source = pivots[-1], "DAILY_CONFIRMED_LOW"
        support = float(lows[p])
    rsi = state.get("current_rsi")
    history_rsi = wilder_rsi(df.close.to_numpy(dtype=float))
    d1_rsi = float(history_rsi[p]) if np.isfinite(history_rsi[p]) else None
    support_broken = bool(np.any(lows[p + 1:] < support))
    info = {"support": float(support), "support_source": source, "source": source,
            "support_date": pd.Timestamp(df.date.iloc[p]).isoformat(),
            "current_rsi": rsi, "d1_rsi": d1_rsi, "support_broken": support_broken,
            "current_low": float(lows[-1]), "forming_pu": False}
    if rsi is None or not np.isfinite(rsi):
        return dict(info, status="UNKNOWN", reason="Günlük RSI hesaplanamadı")
    negative = detect_rsi_nu70(df, interval="1d") is not None
    info["negative_divergence"] = negative
    # Latest live daily RSI is intentional: no two-day right pivot is required.
    forming = bool(support_broken and d1_rsi is not None and rsi > d1_rsi and rsi >= 30)
    if negative:
        return dict(info, status="BROKEN", reason="Günlük NU70 negatif uyumsuzluk veto koşulu")
    if rsi < 30:
        return dict(info, status="BROKEN", reason="Günlük RSI 30 altında")
    if support_broken:
        if d1_rsi is None:
            return dict(info, status="UNKNOWN", reason="Önceki günlük dip RSI değeri hesaplanamadı")
        if forming:
            return dict(info, status="INTACT", source="DAILY_FORMING_PU",
                        support_source="DAILY_FORMING_PU", forming_pu=True,
                        reason="Günlükte PU oluşumu aktif (Fiyat yeni dipte ama RSI daha yüksek ve >= 30)")
        return dict(info, status="BROKEN", reason="Günlük destek kırıldı ve RSI önceki dip RSI değerinin üzerinde değil")
    return dict(info, status="INTACT", reason="Günlük dip korunuyor, RSI ≥30 ve NU70 yok")
```

## 16 Ekim 2026 düzeltmeleri (yalnız laboratuvar)

- **Tüketilmiş 4S PU:** Bir 4S PU'nun direnci ilk kapanışla kırması üzerinden
  `SESSION_BREAKOUT_LIFETIME_BARS` (5, klasik sinyal ömrüyle aynı sayı — deneysel
  varsayım, hocaya atfedilmez) kapanmış 4S bardan fazla geçtiyse seanslık uyum
  sayılmaz (`timeframes.4h.consumed`, `first_breakout_at`, `bars_since_breakout`).
  Örnek: ISCTR'nin Ağustos 4S PU'su 26 Ağustos'ta kırılmıştı; 15 Ekim'de hâlâ
  FULL_CONFIRMATION görünüyor ve 1S NU baskısını gizliyordu. Artık
  LOWER_TF_NU_PRESSURE. `breakout_at` son barı değil ilk kapanış kırılımını gösterir.
- **Gece NaN günlük satırı:** Yahoo bitmiş seansın günlük satırını gece yarısından
  sonra fiyatsız gönderebiliyor; sağlayıcı satırı silince günlük STALE olup tüm
  lab DATA_UNAVAILABLE dönüyordu (16 Ekim 00:05'te 100/100). Lab artık yalnız o
  eksik seansı, 17:30 barı dahil tamamı kapanmış 1S barlarından kurar ve
  `data_notes` ile belirtir. Eksik/açık seans uydurulmaz; klasik sağlayıcı değişmedi.

## Öğrenen test mekanizması (16 Ekim 2026)

Repo kökünden:

```
.venv/bin/python -m python_bot.research.mtf_backtest --universe all   # veri + geçmiş karar tekrarı (~35 dk, 4 çekirdek)
.venv/bin/python -m python_bot.research.mtf_learn                     # BIST30 + BIST100 walk-forward öğrenme ve rapor (~30 sn)
```

- `mtf_backtest`: her hisse ve her kapanmış 4S blok için lab'ın kendi `build_mtf_decision`
  fonksiyonunu o ana kadarki veriyle çalıştırır (geleceğe bakış testi: `test_mtf_research.py`).
  Son karar noktası canlı lab ile BIST30'da 30/30 aynı çıktı.
- `mtf_learn`: getirileri aynı bloktaki evren ortalamasına göre ölçer; sinyal yaşı parametrelerini
  ve bir gradient boosting skorlayıcısını çeyrek çeyrek, yalnız geçmişten öğrenip görülmemiş çeyrekte
  test eder. Rapor `docs/MTF_LAB_OGRENME_RAPORU.md`, öğrenilenler
  `python_bot/research/learned/mtf_lab_params.json` (`adopt` yalnız OOS kanıtla `true` olur; lab bu
  dosyayı henüz okumaz). Veri yenilendikçe yeniden çalıştırmak sistemi yeniden öğretir.
