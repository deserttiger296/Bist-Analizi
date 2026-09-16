# -*- coding: utf-8 -*-
"""
Phase 2 Brain: Self-Auditor (Kendi Hatalarını Algılayan Otopsi Modülü)
Sistemin yaptığı geçmiş AI tahminlerini, sonraki piyasa fiyatlarıyla eşleştirerek
doğruluğunu ölçer ve hata yapan tahminleri BigQuery'ye "Prediction Error" olarak etiketler.
"""

import logging
from datetime import datetime
import hashlib
from ..ingest.gcp_bigquery import BigQueryDataPipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] SelfAuditor: %(message)s")
logger = logging.getLogger("SelfAuditor")

class SelfAuditingEngine:
    def __init__(self, project_id: str = None):
        self.bq_pipeline = BigQueryDataPipeline(project_id=project_id)
        self.error_threshold_pct = -1.0  # Fiyat %1'den fazla düşerse hata say
        self.success_threshold_pct = 1.5 # Fiyat %1.5 artarsa başarılı say

    def run_autopsy_on_recent_predictions(self):
        """
        Mock implementation of checking past predictions against real prices.
        In a real scenario, this would execute a BigQuery JOIN query between 
        bist_ai_decisions and bist_ohlcv_1m, calculate the return, and stream back to bist_prediction_errors.
        """
        logger.info("Self-Auditor: Geçmiş kararlar ve piyasa gerçekleşmeleri eşleştiriliyor...")
        
        # Simulating BigQuery results (e.g. comparing prediction vs outcome)
        mock_audit_results = [
            {
                "symbol": "THYAO",
                "predicted_decision": "STRONG_BUY",
                "predicted_score": 85,
                "actual_return_1h": 1.8, # Başarılı (Kâr)
                "actual_return_24h": 2.5
            },
            {
                "symbol": "TUPRS",
                "predicted_decision": "BUY",
                "predicted_score": 68,
                "actual_return_1h": -1.5, # Hatalı (Zarar, Stop Patladı)
                "actual_return_24h": -3.2
            }
        ]
        
        errors_to_stream = []
        for res in mock_audit_results:
            is_error = False
            error_mag = 0.0
            
            if res["predicted_decision"] in ["BUY", "STRONG_BUY"]:
                if res["actual_return_1h"] < self.error_threshold_pct:
                    is_error = True
                    error_mag = abs(res["actual_return_1h"])
            elif res["predicted_decision"] in ["SELL", "STRONG_SELL"]:
                # Short işlem simülasyonu: Fiyat artarsa zarar/hata
                if res["actual_return_1h"] > abs(self.error_threshold_pct):
                    is_error = True
                    error_mag = abs(res["actual_return_1h"])

            # UID for prediction
            raw_id = f"{res['symbol']}_{datetime.utcnow().isoformat()}"
            pred_id = hashlib.md5(raw_id.encode()).hexdigest()

            errors_to_stream.append({
                "prediction_id": pred_id,
                "timestamp": datetime.utcnow().isoformat(),
                "symbol": res["symbol"],
                "predicted_decision": res["predicted_decision"],
                "predicted_score": res["predicted_score"],
                "actual_return_1h": float(res["actual_return_1h"]),
                "actual_return_24h": float(res["actual_return_24h"]),
                "is_prediction_error": is_error,
                "error_magnitude": float(error_mag)
            })

        if errors_to_stream:
            self.bq_pipeline._insert_rows("bist_prediction_errors", errors_to_stream)
            logger.info(f"Self-Auditor: {len(errors_to_stream)} adet tahmin otopsisi BigQuery'ye aktarıldı.")
        
        return errors_to_stream

if __name__ == "__main__":
    auditor = SelfAuditingEngine()
    results = auditor.run_autopsy_on_recent_predictions()
    for r in results:
        print(f"[{r['symbol']}] Error? {r['is_prediction_error']} | Return: {r['actual_return_1h']}%")
