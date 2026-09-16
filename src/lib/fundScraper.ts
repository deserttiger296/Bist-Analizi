// src/lib/fundScraper.ts — Orchestrator
// Combines all scraper modules into a unified enriched fundamentals response

import { fetchIsYatirimData, type IsYatirimData } from "./scrapers/isYatirimScraper";
import { fetchKapData, type KapData, type KapDisclosure, type DividendInfo } from "./scrapers/kapScraper";
import { fetchConsensusTargetPrice, type ConsensusData, type BrokerTarget } from "./scrapers/hedeffiyatScraper";
import { fetchTefasData, type TefasData, type FundInfo, type FundPerformance } from "./scrapers/tefasScraper";

// ─── UNIFIED INTERFACE ─────────────────────────────────────────────────────────

export interface EnrichedFundamentals {
  symbol: string;
  fetchedAt: string;

  // İş Yatırım
  isYatirim: IsYatirimData | null;

  // Hedef Fiyat — Consensus
  consensusData: ConsensusData | null;

  // KAP — Public disclosures
  disclosures: KapDisclosure[];
  dividends: DividendInfo[];

  // TEFAS — Fund holdings & top funds
  fundsHolding: FundInfo[];
  topBistFunds: FundPerformance[];

  // Source status
  sources: {
    isYatirim: 'success' | 'failed';
    kap: 'success' | 'failed';
    hedeffiyat: 'success' | 'failed';
    tefas: 'success' | 'failed';
  };

  errors: string[];
}

// Re-export types
export type {
  IsYatirimData,
  KapData,
  KapDisclosure,
  DividendInfo,
  ConsensusData,
  BrokerTarget,
  TefasData,
  FundInfo,
  FundPerformance,
};

// ─── ORCHESTRATOR ──────────────────────────────────────────────────────────────

export async function fetchEnrichedFundamentals(symbol: string): Promise<EnrichedFundamentals> {
  const cleanSym = symbol.replace('.IS', '').toUpperCase();
  const errors: string[] = [];

  // Launch all scrapers in parallel
  const [isRes, kapRes, hfRes, tefRes] = await Promise.allSettled([
    fetchIsYatirimData(cleanSym),
    fetchKapData(cleanSym),
    fetchConsensusTargetPrice(cleanSym),
    fetchTefasData(cleanSym),
  ]);

  // Process results
  let isYatirim: IsYatirimData | null = null;
  if (isRes.status === 'fulfilled') {
    isYatirim = isRes.value;
  } else {
    errors.push(`İş Yatırım: ${isRes.reason?.message || 'Hata'}`);
  }

  let kapData: KapData | null = null;
  if (kapRes.status === 'fulfilled') {
    kapData = kapRes.value;
  } else {
    errors.push(`KAP: ${kapRes.reason?.message || 'Hata'}`);
  }

  let consensusData: ConsensusData | null = null;
  if (hfRes.status === 'fulfilled') {
    consensusData = hfRes.value;
  } else {
    errors.push(`Hedef Fiyat: ${hfRes.reason?.message || 'Hata'}`);
  }

  let tefasData: TefasData | null = null;
  if (tefRes.status === 'fulfilled') {
    tefasData = tefRes.value;
  } else {
    errors.push(`TEFAS: ${tefRes.reason?.message || 'Hata'}`);
  }

  return {
    symbol: cleanSym,
    fetchedAt: new Date().toISOString(),
    isYatirim,
    consensusData,
    disclosures: kapData?.disclosures || [],
    dividends: kapData?.dividends || [],
    fundsHolding: tefasData?.fundsHolding || [],
    topBistFunds: tefasData?.topFunds || [],
    sources: {
      isYatirim: isYatirim ? 'success' : 'failed',
      kap: kapData ? 'success' : 'failed',
      hedeffiyat: consensusData ? 'success' : 'failed',
      tefas: tefasData ? 'success' : 'failed',
    },
    errors,
  };
}
