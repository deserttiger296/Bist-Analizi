// scripts/test_user_analysis.ts
import { fetchBistLiveQuote } from "../src/lib/bist";
import { detectMarketRegime } from "../src/lib/quant/regime";
import { getLiveBistHistoricalBars } from "../src/lib/bist";
import { ensureTimeSynced } from "../src/lib/firebaseAdmin";

async function testUserAnalysis() {
    await ensureTimeSynced();
    const symbols = ["BAGFS.IS", "PETKM.IS", "TUPRS.IS"];
    
    console.log("=====================================================================");
    console.log("=== CANLI BIST ANALİZ MOTORU: TEST ANALİZ RAPORU (BAGFS, PETKM, TUPRS) ===");
    console.log("=====================================================================\n");
    
    for (const symbol of symbols) {
        console.log(`>>> ANALİZ EDİLİYOR: ${symbol}`);
        console.log("-".repeat(50));
        try {
            // 1. Canlı fiyat, hibrit skor ve kural sinyallerini hesapla
            const quote = await fetchBistLiveQuote(symbol, false);
            
            // 2. Tarihsel barları çekip HMM Rejim tespiti yap
            const dailyBars = await getLiveBistHistoricalBars(symbol, 'daily', 100);
            const closePrices = dailyBars.map(b => b.close);
            const regimeResult = detectMarketRegime(closePrices, 20);
            
            console.log(`💰 Fiyat: ${quote.lastClose} TL (${quote.change > 0 ? '+' : ''}${quote.change.toFixed(2)}%)`);
            console.log(`📈 Orijinal Teknik Skor: ${quote.score}/100`);
            console.log(`🧬 Hibrit Kompozit Skor (FSI): ${quote.compositeScore}/100`);
            console.log(`🎯 Kural Motoru Sinyali: ${quote.ruleSignal}`);
            console.log(`📊 Piyasa Rejimi (HMM): ${regimeResult.regime} (Volatilite: ${(regimeResult.volatility * 100).toFixed(1)}%, Momentum: ${(regimeResult.momentum * 100).toFixed(1)}%, Güven: ${(regimeResult.confidence * 100).toFixed(0)}%)`);
            console.log(`📋 Öneri Metni:\n   "${quote.recommendation}"`);
            
            if (quote.ruleResults && quote.ruleResults.length > 0) {
                const passed = quote.ruleResults.filter((r: any) => r.passed);
                const failed = quote.ruleResults.filter((r: any) => !r.passed);
                console.log(`\n✅ Geçen Önemli Kurallar (${passed.length} adet):`);
                passed.slice(0, 8).forEach((r: any) => {
                    console.log(`   [${r.ruleId}] ${r.reason}`);
                });
                
                console.log(`\n❌ Kalan/Başarısız Önemli Kurallar (${failed.length} adet):`);
                failed.slice(0, 8).forEach((r: any) => {
                    console.log(`   [${r.ruleId}] ${r.reason}`);
                });
            } else {
                console.log("⚠️ Kural detayları bulunamadı.");
            }
        } catch (err: any) {
            console.error(`❌ ${symbol} analizi başarısız oldu:`, err.message);
        }
        console.log("\n" + "="*70 + "\n");
    }
}

testUserAnalysis().catch(console.error);
