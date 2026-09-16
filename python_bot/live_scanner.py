import time
import logging
from datetime import datetime
import pandas as pd
from trading_bot import AdvancedQuantBot

# Configure Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("LiveScanner")

# Define BIST 100 Basket
BIST_BASKET = [
    "THYAO", "TCELL", "ISCTR", "AKBNK", "YKBNK", 
    "GARAN", "KCHOL", "SAHOL", "TUPRS", "SISE",
    "ASELS", "BIMAS", "FROTO", "EREGL", "PGSUS"
]

def scan_market():
    logger.info("=== STARTING LIVE BIST-100 SCANNER ===")
    today_str = datetime.today().strftime('%Y-%m-%d')
    live_signals = []

    for symbol in BIST_BASKET:
        logger.info(f"Scanning {symbol}...")
        try:
            # Look back 1 year to build enough data for 200 SMA and 50 SMA
            bot = AdvancedQuantBot(symbol=symbol, start_date="2023-01-01", end_date=None)
            
            # Suppress individual bot logs to keep scanner output clean
            logging.getLogger("BIST_QuantEngine_V2").setLevel(logging.ERROR)
            
            orders = bot.run_pipeline()
            
            if not orders:
                continue
                
            last_order = orders[-1]
            
            # Check if the signal is fresh (generated within the last 3 days)
            order_date = datetime.strptime(last_order['Date'], '%Y-%m-%d')
            days_ago = (datetime.today() - order_date).days
            
            if days_ago <= 3:
                # We found a live/recent signal!
                live_signals.append((symbol, days_ago, last_order))
                
        except Exception as e:
            logger.error(f"Failed to scan {symbol}: {e}")
            
    # Report Results
    print("\n" + "="*50)
    print(">>> LIVE MARKET SIGNALS DETECTED <<<")
    print("="*50)
    
    if not live_signals:
        print("\nNo fresh high-probability signals detected in the basket today.")
    else:
        for symbol, age, order in sorted(live_signals, key=lambda x: x[1]):
            status = "*** TODAY ***" if age == 0 else f"{age} Days Ago"
            print(f"\n[{status}] TICKER: {symbol}")
            print(f"  -> Horizon: {order['Horizon_Profile']} | Confidence: {order['Composite_Confidence']}")
            print(f"  -> Entry: {order['Entry_TRY']} TL")
            print(f"  -> Stop Loss: {order['Stop_Loss_TRY']} TL")
            print(f"  -> Target (Dynamic Live): {order['Target_TRY_LIVE']} TL (USD: {order['Target_USD']} $)")
            print(f"  -> RR Ratio: {order['Projected_RR_Ratio']}x")
            
    print("\n" + "="*50)
    print("Scan Complete. Scheduled to re-run in 1 hour.")

if __name__ == "__main__":
    # Live execution loop
    while True:
        scan_market()
        # Sleep for 1 hour (3600 seconds)
        time.sleep(3600)
