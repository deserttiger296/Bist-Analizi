# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 1: GCP BigQuery Integration & Cloud Data Pipeline

Exposes tools to provision tables and stream real-time BIST data (OHLCV, AKD, AI Decisions)
directly into Google BigQuery for petabyte-scale quant analysis and Looker dashboards.
"""

import logging
import os
from typing import Dict, Any, List
from datetime import datetime

# Safe import for google-cloud-bigquery (to be installed via requirements.txt or locally)
try:
    from google.cloud import bigquery
    from google.cloud.exceptions import NotFound
except ImportError:
    bigquery = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] BigQuery: %(message)s")
logger = logging.getLogger("GCP_BigQuery")

class BigQueryDataPipeline:
    def __init__(self, project_id: str = None, dataset_id: str = "bist_quant_dataset"):
        """
        Initialize the BigQuery integration client.
        :param project_id: GCP Project ID (defaults to 'kazananlar-kulubu')
        :param dataset_id: Target BigQuery Dataset ID
        """
        self.project_id = project_id or os.getenv("GCP_PROJECT", "kazananlar-kulubu")
        self.dataset_id = dataset_id
        self.client = bigquery.Client(project=self.project_id) if bigquery else None

        if self.client:
            logger.info(f"BigQuery pipeline initialized for project: {self.project_id}")
            self._ensure_dataset_exists()
        else:
            logger.warning("Google Cloud BigQuery library not loaded. Running in local simulation mode.")

    def _ensure_dataset_exists(self):
        """Ensures the target BigQuery dataset is created in GCP."""
        dataset_ref = bigquery.DatasetReference(self.project_id, self.dataset_id)
        try:
            self.client.get_dataset(dataset_ref)
            logger.info(f"Dataset {self.dataset_id} already exists.")
        except NotFound:
            dataset = bigquery.Dataset(dataset_ref)
            dataset.location = "US"  # Multi-region US or specific region like europe-west3
            dataset.description = "BIST 100 historical price, AKD, and AI XAI decision records"
            self.client.create_dataset(dataset)
            logger.info(f"Successfully created BigQuery Dataset: {self.dataset_id}")

    def provision_tables(self):
        """Creates the necessary BIST tables in BigQuery if they do not exist."""
        if not self.client:
            logger.warning("Simulation Mode: Table provisioning bypassed.")
            return

        tables = {
            # 1. 1-Minute OHLCV Candles
            "bist_ohlcv_1m": [
                bigquery.SchemaField("timestamp", "TIMESTAMP", mode="REQUIRED"),
                bigquery.SchemaField("symbol", "STRING", mode="REQUIRED"),
                bigquery.SchemaField("open", "FLOAT", mode="REQUIRED"),
                bigquery.SchemaField("high", "FLOAT", mode="REQUIRED"),
                bigquery.SchemaField("low", "FLOAT", mode="REQUIRED"),
                bigquery.SchemaField("close", "FLOAT", mode="REQUIRED"),
                bigquery.SchemaField("volume", "FLOAT", mode="REQUIRED"),
                bigquery.SchemaField("vwap", "FLOAT", mode="NULLABLE"),
            ],
            # 2. Broker Distribution (AKD) Flow
            "bist_akd_flow": [
                bigquery.SchemaField("timestamp", "TIMESTAMP", mode="REQUIRED"),
                bigquery.SchemaField("symbol", "STRING", mode="REQUIRED"),
                bigquery.SchemaField("net_lots", "INTEGER", mode="REQUIRED"),
                bigquery.SchemaField("smart_money_ratio", "FLOAT", mode="REQUIRED"),
                bigquery.SchemaField("status", "STRING", mode="REQUIRED"),  # ACCUMULATION / DISTRIBUTION
                bigquery.SchemaField("top_buyer", "STRING", mode="NULLABLE"),
                bigquery.SchemaField("top_seller", "STRING", mode="NULLABLE"),
            ],
            # 3. AI Decisions & XAI Otopsisi
            "bist_ai_decisions": [
                bigquery.SchemaField("timestamp", "TIMESTAMP", mode="REQUIRED"),
                bigquery.SchemaField("symbol", "STRING", mode="REQUIRED"),
                bigquery.SchemaField("score", "INTEGER", mode="REQUIRED"),
                bigquery.SchemaField("confidence", "STRING", mode="REQUIRED"),
                bigquery.SchemaField("decision", "STRING", mode="REQUIRED"),
                bigquery.SchemaField("top_driver_name", "STRING", mode="NULLABLE"),
                bigquery.SchemaField("top_driver_weight", "FLOAT", mode="NULLABLE"),
                bigquery.SchemaField("is_fakeout", "BOOLEAN", mode="REQUIRED"),
            ],
            # 4. Self-Correcting ML Loop: Prediction Errors (Autopsy)
            "bist_prediction_errors": [
                bigquery.SchemaField("prediction_id", "STRING", mode="REQUIRED"),
                bigquery.SchemaField("timestamp", "TIMESTAMP", mode="REQUIRED"),
                bigquery.SchemaField("symbol", "STRING", mode="REQUIRED"),
                bigquery.SchemaField("predicted_decision", "STRING", mode="REQUIRED"),
                bigquery.SchemaField("predicted_score", "INTEGER", mode="REQUIRED"),
                bigquery.SchemaField("actual_return_1h", "FLOAT", mode="NULLABLE"),
                bigquery.SchemaField("actual_return_24h", "FLOAT", mode="NULLABLE"),
                bigquery.SchemaField("is_prediction_error", "BOOLEAN", mode="REQUIRED"),
                bigquery.SchemaField("error_magnitude", "FLOAT", mode="REQUIRED"),
            ]
        }

        for table_name, schema in tables.items():
            table_ref = bigquery.TableReference(
                bigquery.DatasetReference(self.project_id, self.dataset_id), table_name
            )
            try:
                self.client.get_table(table_ref)
                logger.info(f"BigQuery Table {table_name} already exists.")
            except NotFound:
                table = bigquery.Table(table_ref, schema=schema)
                # Partition by timestamp for high performance and low query scan costs!
                table.time_partitioning = bigquery.TimePartitioning(
                    type_=bigquery.TimePartitioningType.DAY,
                    field="timestamp"
                )
                self.client.create_table(table)
                logger.info(f"Successfully created partitioned Table: {table_name}")

    def stream_ohlcv_data(self, rows: List[Dict[str, Any]]) -> bool:
        """
        Streams BIST 1-Minute OHLCV rows directly into BigQuery in real-time (Streaming Inserts).
        :param rows: List of dictionaries matching the bist_ohlcv_1m schema
        """
        return self._insert_rows("bist_ohlcv_1m", rows)

    def stream_akd_flow(self, rows: List[Dict[str, Any]]) -> bool:
        """Streams Broker Distribution metrics in real-time."""
        return self._insert_rows("bist_akd_flow", rows)

    def stream_ai_decisions(self, rows: List[Dict[str, Any]]) -> bool:
        """Streams Explainable AI decision records in real-time."""
        return self._insert_rows("bist_ai_decisions", rows)

    def _insert_rows(self, table_name: str, rows: List[Dict[str, Any]]) -> bool:
        """Internal helper to insert rows into a BigQuery table."""
        if not self.client:
            logger.info(f"Simulation Mode: Successfully streamed {len(rows)} rows to {table_name}.")
            return True

        table_ref = bigquery.TableReference(
            bigquery.DatasetReference(self.project_id, self.dataset_id), table_name
        )
        table = self.client.get_table(table_ref)
        
        # Stream insert
        errors = self.client.insert_rows_json(table, rows)
        if not errors:
            logger.info(f"Successfully streamed {len(rows)} rows into BigQuery table: {table_name}")
            return True
        else:
            logger.error(f"Failed to stream rows into BigQuery {table_name}: {errors}")
            return False

if __name__ == "__main__":
    # Local Test & Simulation Mode
    pipeline = BigQueryDataPipeline()
    pipeline.provision_tables()
    
    # Mock data to test streaming
    mock_timestamp = datetime.utcnow().isoformat()
    
    mock_ohlcv = [{
        "timestamp": mock_timestamp,
        "symbol": "THYAO",
        "open": 285.50,
        "high": 289.25,
        "low": 284.00,
        "close": 288.75,
        "volume": 4500000.0,
        "vwap": 287.12
    }]
    
    mock_akd = [{
        "timestamp": mock_timestamp,
        "symbol": "THYAO",
        "net_lots": 350000,
        "smart_money_ratio": 12.5,
        "status": "ACCUMULATION",
        "top_buyer": "Bank of America",
        "top_seller": "Is Yatirim"
    }]

    mock_decisions = [{
        "timestamp": mock_timestamp,
        "symbol": "THYAO",
        "score": 82,
        "confidence": "HIGH",
        "decision": "STRONG_BUY",
        "top_driver_name": "SUPERTREND",
        "top_driver_weight": 48.4,
        "is_fakeout": False
    }]

    pipeline.stream_ohlcv_data(mock_ohlcv)
    pipeline.stream_akd_flow(mock_akd)
    pipeline.stream_ai_decisions(mock_decisions)
