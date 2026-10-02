import csv
import os
import threading
from datetime import datetime

LOG_FILE = "predictions_log.csv"

# /api/scan_all fans out predictions across a thread pool, so concurrent
# approved signals can call this at once -- without a lock, two threads can
# both see a missing file and each write a header row.
_log_lock = threading.Lock()

def log_prediction(symbol, entry_price, target_price_tl, target_price_usd, usd_rate, confidence, sniper_label):
    with _log_lock:
        file_exists = os.path.isfile(LOG_FILE)

        with open(LOG_FILE, mode='a', newline='', encoding='utf-8') as file:
            writer = csv.writer(file)
            if not file_exists:
                writer.writerow(["Timestamp", "Symbol", "Entry_Price_TL", "Target_Price_TL", "Target_Price_USD", "USD_Rate", "Confidence", "Sniper_Label", "Status"])

            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            writer.writerow([timestamp, symbol, entry_price, target_price_tl, target_price_usd, usd_rate, confidence, sniper_label, "PENDING"])
