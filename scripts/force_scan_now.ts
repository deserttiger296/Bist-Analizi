import { runBackgroundScan } from "../src/lib/backgroundScanner";
import { getAdminDb, ensureTimeSynced } from "../src/lib/firebaseAdmin";

async function forceScan() {
    console.log("Forcing a background scan now...");
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
    
    console.log("Running background scan...");
    const results = await runBackgroundScan("all");
    console.log(`Scan completed successfully! Total results synced: ${results.length}`);
    
    // Check top 5 results
    const sorted = results.sort((a, b) => (b.confluenceScore || 0) - (a.confluenceScore || 0));
    console.log("\nTop 5 results:");
    sorted.slice(0, 5).forEach(r => {
        console.log(`  - ${r.symbol}: score=${r.confluenceScore}, status=${r.status}, price=${r.quote?.lastClose}`);
    });
}

forceScan().catch(console.error);
