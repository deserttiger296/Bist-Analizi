// scripts/test_scan_rules.ts
import { fetchBistLiveQuote } from "../src/lib/bist";
import { ensureTimeSynced } from "../src/lib/firebaseAdmin";

async function testScanRules() {
    await ensureTimeSynced();
    const testSymbols = ["THYAO.IS", "ASELS.IS", "AKBNK.IS", "EREGL.IS", "BIMAS.IS"];
    
    console.log("=== RUNNING LIVE TEST SCAN WITH 101 TRADING RULES ===");
    
    for (const symbol of testSymbols) {
        console.log(`\nScanning ${symbol}...`);
        try {
            const quote = await fetchBistLiveQuote(symbol, false);
            
            console.log(`- Price: ${quote.lastClose} TL`);
            console.log(`- Original Composite Score: ${quote.score}`);
            console.log(`- Hybrid Composite Score: ${quote.compositeScore}`);
            console.log(`- Rule Engine Signal: ${quote.ruleSignal}`);
            console.log(`- Meets Buy Criteria: ${quote.meetsBuyCriteria}`);
            console.log(`- Recommendation: ${quote.recommendation}`);
            
            if (quote.ruleResults && quote.ruleResults.length > 0) {
                const passedRules = quote.ruleResults.filter((r: any) => r.passed);
                console.log(`- Passed Rules Count: ${passedRules.length}/${quote.ruleResults.length}`);
                console.log(`- Sample Passed Rules:`);
                passedRules.slice(0, 5).forEach((r: any) => {
                    console.log(`  [${r.ruleId}] ${r.reason}`);
                });
            } else {
                console.log(`⚠️ No rule results returned!`);
            }
        } catch (err: any) {
            console.error(`❌ Failed to scan ${symbol}:`, err.message);
        }
    }
}

testScanRules().catch(console.error);
