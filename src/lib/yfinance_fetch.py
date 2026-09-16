import json
import sys
from typing import Any

import yfinance as yf


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def build_quote(symbol: str) -> dict:
    ticker = yf.Ticker(symbol)
    fast_info = {}
    try:
        fast_info = ticker.fast_info or {}
    except Exception:
        fast_info = {}

    info = {}
    try:
        info = ticker.info or {}
    except Exception:
        info = {}

    current_price = safe_float(
        fast_info.get("last_price")
        or fast_info.get("current_price")
        or info.get("regularMarketPrice")
        or info.get("currentPrice")
    )

    previous_close = safe_float(
        fast_info.get("previous_close")
        or fast_info.get("last_close")
        or info.get("regularMarketPreviousClose")
        or info.get("previousClose")
    )

    volume = safe_int(
        fast_info.get("last_volume")
        or fast_info.get("volume")
        or info.get("volume")
        or info.get("regularMarketVolume")
    )

    avg_volume_10d = safe_int(
        fast_info.get("average_volume_10d")
        or fast_info.get("averageDailyVolume10Day")
        or info.get("averageDailyVolume10Day")
        or info.get("averageDailyVolume10Day")
    )

    avg_volume_3m = safe_int(
        fast_info.get("average_daily_volume_3_month")
        or fast_info.get("averageDailyVolume3Month")
        or info.get("averageDailyVolume3Month")
        or info.get("averageDailyVolume3Month")
    )

    return {
        "symbol": symbol,
        "shortName": info.get("shortName") or info.get("longName") or symbol,
        "longName": info.get("longName") or info.get("shortName") or symbol,
        "currentPrice": current_price,
        "previousClose": previous_close,
        "regularMarketVolume": volume,
        "averageDailyVolume10Day": avg_volume_10d,
        "averageDailyVolume3Month": avg_volume_3m,
    }


def build_chart(symbol: str, period: str, interval: str) -> dict:
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period=period, interval=interval, auto_adjust=False, actions=False)
    closes = []
    try:
        closes = hist["Close"].dropna().tolist()
    except Exception:
        closes = []

    return {"symbol": symbol, "period": period, "interval": interval, "closes": closes}


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Not enough arguments"}))
        return 1

    command = sys.argv[1]
    symbol = sys.argv[2]
    try:
        if command == "quote":
            result = build_quote(symbol)
        elif command == "chart":
            if len(sys.argv) < 5:
                print(json.dumps({"error": "Chart requires symbol, period, interval"}))
                return 1
            period = sys.argv[3]
            interval = sys.argv[4]
            result = build_chart(symbol, period, interval)
        else:
            result = {"error": f"Unknown command {command}"}
        print(json.dumps(result, default=str))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
