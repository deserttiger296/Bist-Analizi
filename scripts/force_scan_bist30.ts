import { runBackgroundScan } from "../src/lib/backgroundScanner";
import { getAdminDb, ensureTimeSynced } from "../src/lib/firebaseAdmin";

async function forceScanBist30() {
    console.log("Forcing a background scan for BIST-30 now...");
    await ensureTimeSynced();
    const db = getAdminDb();
    if (db) {
        // Reset the stuck scanning flags
        await db.collection("system_status").doc("scanner").set({
            isScanning: false,
            isScanning_all: false,
            isScanning_bist30: false
        }, { merge: true });
        console.log("Reset isScanning flags in Firestore.");
    }
    
    console.log("Running background scan for index bist30...");
    const results = await runBackgroundScan("bist30");
    console.log(`Scan completed successfully! Total BIST-30 results synced: ${results.length}`);
    
    // Check top results
    const sorted = results.sort((a, b) => (b.confluenceScore || 0) - (a.confluenceScore || 0));
    console.log("\nTop BIST-30 results:");
    sorted.slice(0, 10).forEach(r => {
        console.log(`  - ${r.symbol}: score=${r.confluenceScore}, status=${r.status}, signal=${r.quote?.ruleSignal}, price=${r.quote?.lastClose}`);
    });
}

forceScanBist30().catch(console.error);
