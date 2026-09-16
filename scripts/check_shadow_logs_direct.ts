
import { getAdminDb, ensureTimeSynced } from "../src/lib/firebaseAdmin";

async function checkShadowLogsDirectly() {
    await ensureTimeSynced();
    const db = getAdminDb();
    if (!db) { console.error("No DB"); return; }

    // Check ALL shadow_logs - no filter at all
    console.log("=== Checking shadow_logs collection (no filter) ===");
    const allSnap = await db.collection("shadow_logs").limit(20).get();
    console.log(`shadow_logs total docs (limit 20): ${allSnap.size}`);
    allSnap.forEach(doc => {
        console.log(`  [${doc.id}]`, JSON.stringify(doc.data()).substring(0, 200));
    });
    
    // Try to manually create a test shadow_log
    console.log("\n=== Attempting to manually write a test shadow_log ===");
    try {
        const testRef = db.collection("shadow_logs").doc("TEST_MANUAL_CHECK");
        await testRef.set({
            symbol: "TEST",
            entryPrice: 100,
            entryTime: new Date(),
            scanTimestamp: Date.now(),
            shadowFilters: {
                isAboveWeeklyEma26: true,
                isCmfPositive: false,
                isCmfAboveThreshold: false,
                isRsiWithinCeiling: true,
                isAtrStopOk: true,
            },
            compositeScore: 99,
            outcomeT5: null,
            outcomeTime: null,
            status: "ACTIVE"
        });
        console.log("✅ Successfully wrote test shadow_log!");
        
        // Read it back
        const readBack = await testRef.get();
        console.log("Read back:", JSON.stringify(readBack.data()));
        
        // Delete the test doc
        await testRef.delete();
        console.log("✅ Cleaned up test doc.");
    } catch (err) {
        console.error("❌ Failed to write shadow_log:", err);
    }
    
    // List collections to confirm shadow_logs exists
    console.log("\n=== Listing root collections ===");
    const collections = await db.listCollections();
    for (const col of collections) {
        const snap = await col.limit(1).get();
        console.log(`  ${col.id}: ${snap.size > 0 ? 'has docs' : 'empty'}`);
    }
}

checkShadowLogsDirectly().catch(console.error);
