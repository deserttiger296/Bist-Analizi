# -*- coding: utf-8 -*-
"""
Institutional-Grade Quantitative Trading Architecture
Phase 2: FinBERT Financial News Sentiment Pipeline
"""

import sys
import re
from typing import Dict, Any, List
from datetime import datetime, timedelta, timezone
import math
from collections import deque
import numpy as np

class FinBertSentimentAnalyzer:
    def __init__(self, use_gpu: bool = False):
        """
        Initialize sentiment analyzer. Loads FinBERT model if transformers are installed;
        otherwise, cascades gracefully to the high-performance local Financial Lexicon engine.
        """
        self.model_loaded = False
        self.pipeline = None
        self.sentiment_memory = deque(maxlen=5000) # Store (timestamp, score, headline)
        
        
        try:
            # Attempt to import huggingface pipelines
            from transformers import AutoTokenizer, AutoModelForSequenceClassification, pipeline
            
            model_name = "ProsusAI/finbert"
            tokenizer = AutoTokenizer.from_pretrained(model_name)
            model = AutoModelForSequenceClassification.from_pretrained(model_name)
            
            device = 0 if use_gpu else -1
            self.pipeline = pipeline("sentiment-analysis", model=model, tokenizer=tokenizer, device=device)
            self.model_loaded = True
            print("[SentimentPipeline] Success: HuggingFace ProsusAI/FinBERT model loaded successfully.")
        except Exception:
            # Graceful cascade to highly optimized institutional financial vocabulary lexicon
            print("[SentimentPipeline] INFO: Transformers library not found or offline. Activating high-performance local Financial Lexicon engine.")
            self._init_financial_lexicon()

    def _init_financial_lexicon(self):
        """
        Load curated dictionaries containing strong market signaling keywords (Turkish & English).
        """
        self.positive_lexicon = {
            # English
            'profit', 'growth', 'dividend', 'surge', 'upgrade', 'outperform', 'acquisition',
            'bullish', 'expansion', 'earnings', 'revenue', 'beat', 'exceed', 'record', 'high',
            'partnership', 'gain', 'buy', 'positive', 'breakthrough', 'rally', 'momentum',
            # Turkish
            'kar', 'kâr', 'büyüme', 'temettü', 'rekor', 'ortaklık', 'yükseliş', 'alım', 'pozitif', 'anlaşma',
            'kazanç', 'ihale', 'sipariş', 'kap', 'yatırım', 'ciro', 'güçlü', 'artış', 'destek', 'aşım'
        }
        
        self.negative_lexicon = {
            # English
            'loss', 'decline', 'drop', 'downgrade', 'underperform', 'deficit', 'decrease', 'bearish', 'sell',
            'miss', 'negative', 'bankruptcy', 'debt', 'risk', 'shrink', 'penalty', 'lawsuit', 'fine', 'crisis',
            # Turkish
            'zarar', 'düşüş', 'kayıp', 'satış', 'negatif', 'risk', 'borç', 'daralma', 'ceza', 'dava',
            'kriz', 'azalış', 'iptal', 'faiz', 'baskı', 'gerileme', 'tahsilat', 'zayıf', 'temerrüt'
        }

    def analyze_headline(self, text: str) -> Dict[str, Any]:
        """
        Analyze a headline/news string and return positive/negative sentiment scores.
        
        :return: Dict containing sentiment label, confidence, and net directional score (-1.0 to +1.0)
        """
        if self.model_loaded and self.pipeline:
            try:
                result = self.pipeline(text)[0]
                label = result['label'].upper() # 'POSITIVE', 'NEGATIVE', or 'NEUTRAL'
                score = result['score']
                
                net_score = 0.0
                if label == 'POSITIVE':
                    net_score = score
                elif label == 'NEGATIVE':
                    net_score = -score
                    
                return {
                    "label": label,
                    "confidence": float(score),
                    "net_score": float(net_score),
                    "engine": "HuggingFace_FinBERT"
                }
            except Exception:
                pass # Cascade to lexicon if pipeline execution fails

        # --- High-Performance Lexicon Engine (Active Cascade) ---
        words = re.findall(r'\b\w+\b', text.lower())
        
        pos_count = 0
        neg_count = 0
        
        for w in words:
            if w in self.positive_lexicon:
                pos_count += 1
            elif w in self.negative_lexicon:
                neg_count += 1
                
        total_matched = pos_count + neg_count
        if total_matched == 0:
            return {"label": "NEUTRAL", "confidence": 1.0, "net_score": 0.0, "engine": "Financial_Lexicon"}
            
        net_score = (pos_count - neg_count) / total_matched
        label = "POSITIVE" if net_score > 0.1 else ("NEGATIVE" if net_score < -0.1 else "NEUTRAL")
        confidence = abs(net_score)
        
        return {
            "label": label,
            "confidence": float(confidence),
            "net_score": float(net_score),
            "engine": "Financial_Lexicon"
        }

    def aggregate_news_sentiment(self, headlines: List[str]) -> float:
        """
        Aggregate a batch of headlines to calculate an absolute Sentiment Score.
        Returns values between -1.0 (Extreme Fear/Bearish) and +1.0 (Extreme Greed/Bullish).
        """
        if not headlines:
            return 0.0
            
        scores = []
        for hl in headlines:
            res = self.analyze_headline(hl)
            scores.append(res['net_score'])
            
        return float(np.mean(scores))

    def ingest_news(self, headline: str, timestamp: datetime = None):
        """
        Analyze and store news in the chronological memory buffer for time-decay processing.
        """
        if timestamp is None:
            timestamp = datetime.now(timezone.utc)
            
        res = self.analyze_headline(headline)
        score = res['net_score']
        
        # Store as tuple
        self.sentiment_memory.append((timestamp, score, headline))
        return score

    def calculate_decayed_sentiment(self, window_hours: float, half_life_hours: float = None) -> float:
        """
        Calculate rolling sentiment over `window_hours` applying an exponential time decay.
        Recent news holds exponentially more weight than old news within the window.
        """
        if not self.sentiment_memory:
            return 0.0
            
        if half_life_hours is None:
            # Default half-life is 30% of the window
            half_life_hours = window_hours * 0.3
            
        decay_lambda = math.log(2) / half_life_hours
        now = datetime.now(timezone.utc)
        window_cutoff = now - timedelta(hours=window_hours)
        
        weighted_sum = 0.0
        total_weight = 0.0
        
        for ts, score, _ in self.sentiment_memory:
            if ts < window_cutoff:
                continue # Out of window
                
            hours_passed = (now - ts).total_seconds() / 3600.0
            
            # Apply Exponential Decay formula
            weight = math.exp(-decay_lambda * hours_passed)
            
            weighted_sum += score * weight
            total_weight += weight
            
        if total_weight == 0.0:
            return 0.0
            
        return float(weighted_sum / total_weight)

# ====================================================================
# Sentiment Analyzer Sandbox
# ====================================================================
if __name__ == "__main__":
    analyzer = FinBertSentimentAnalyzer(use_gpu=False)
    
    # Turkish & English announcement mix
    news_headlines = [
        "THY (THYAO) 2026 1. çeyrekte rekor kâr (profit) açıkladı, temettü oranı artırıldı!",
        "Central Bank downgrades economic growth forecast amid rising inflation crisis.",
        "ASELSAN yeni bir dev askeri ortaklık anlaşmasına (partnership) imza attı.",
        "KAP: Şirketimiz aleyhine yüksek tutarlı vergi cezası (fine) tebliğ edildi."
    ]
    
    print("\nProcessing Real-Time Market Sentiments:")
    
    # Simulate news coming in at different times
    now = datetime.now(timezone.utc)
    
    # 7 hours ago: Positive news
    analyzer.ingest_news(news_headlines[0], timestamp=now - timedelta(hours=7))
    # 5 hours ago: Positive news
    analyzer.ingest_news(news_headlines[2], timestamp=now - timedelta(hours=5))
    # 30 minutes ago: VERY Negative breaking news
    analyzer.ingest_news(news_headlines[1], timestamp=now - timedelta(minutes=30))
    analyzer.ingest_news(news_headlines[3], timestamp=now - timedelta(minutes=10))
    
    sent_8h = analyzer.calculate_decayed_sentiment(window_hours=8.0)
    sent_4h = analyzer.calculate_decayed_sentiment(window_hours=4.0)
    sent_1h = analyzer.calculate_decayed_sentiment(window_hours=1.0)
    
    print(f"\n--- Sentiment Divergence Analysis ---")
    print(f"8-Hour Sentiment (Macro Trend) : {sent_8h:+.4f}")
    print(f"4-Hour Sentiment (Mid Trend)   : {sent_4h:+.4f}")
    print(f"1-Hour Sentiment (Breaking)    : {sent_1h:+.4f}")
    
    if sent_8h > 0 and sent_1h < 0:
        print("🚨 ALERT: Negative Sentiment Divergence Detected! Short-term panic overriding bullish macro trend.")
