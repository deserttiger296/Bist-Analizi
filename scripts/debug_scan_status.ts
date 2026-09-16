import { getAdminDb, ensureTimeSynced } from "../src/lib/firebaseAdmin";

async function debugScanData() {
    await ensureTimeSynced();
    const db = getAdminDb();
    if (!db) { console.error("No DB"); return; }

    console.log("=== SCAN RESULTS ===");
    const snap = await db.collection("scan_results").limit(200).get();
    
    const statusCounts: Record<string, number> = {};
    const alertCounts = { true: 0, false: 0 };
    const timestamps = new Set<string>();
    const symbolToTimestamp: Record<string, string> = {};
    
    snap.forEach(doc => {
        const data = doc.data();
        const s = data.status || "NO_STATUS";
        statusCounts[s] = (statusCounts[s] || 0) + 1;
        
        if (data.alert === true) alertCounts.true++;
        else alertCounts.false++;

        if (data.scanTimestamp) {
            const tsStr = new Date(data.scanTimestamp).toISOString();
            timestamps.add(tsStr);
            symbolToTimestamp[doc.id] = tsStr;
        }
    });
    
    console.log(`Total scan_results analyzed: ${snap.size}`);
    console.log(`Status breakdown:`, JSON.stringify(statusCounts, null, 2));
    console.log(`Alert breakdown:`, JSON.stringify(alertCounts));
    console.log(`Unique scanTimestamps in scan_results:`, Array.from(timestamps));
    
    // Check system_status/scanner
    console.log("\n=== SYSTEM STATUS / SCANNER ===");
    const systemStatusDoc = await db.collection("system_status").doc("scanner").get();
    if (systemStatusDoc.exists) {
        console.log("Scanner System Status:", JSON.stringify(systemStatusDoc.data(), null, 2));
    } else {
        console.log("No system_status/scanner document found!");
    }

    // Check qp_scan_1d and qp_scan_1wk
    console.log("\n=== QP SCAN 1D ===");
    const qp1dSnap = await db.collection("qp_scan_1d").limit(10).get();
    console.log(`qp_scan_1d doc count (limit 10): ${qp1dSnap.size}`);
    qp1dSnap.forEach(doc => {
        console.log(`  [${doc.id}]`, JSON.stringify(doc.data()).substring(0, 150));
    });

    console.log("\n=== QP SCAN 1WK ===");
    const qp1wkSnap = await db.collection("qp_scan_1wk").limit(10).get();
    console.log(`qp_scan_1wk doc count (limit 10): ${qp1wkSnap.size}`);
    qp1wkSnap.forEach(doc => {
        console.log(`  [${doc.id}]`, JSON.stringify(doc.data()).substring(0, 150));
    });

    // Also check alarm_history for recent signals
    console.log(`\n=== ALARM HISTORY ===`);
    const alarmSnap = await db.collection("alarm_history").orderBy("syncedAt", "desc").limit(10).get();
    console.log(`Recent alarm_history entries: ${alarmSnap.size}`);
    alarmSnap.forEach(doc => {
        const data = doc.data();
        console.log(`  [${doc.id}] symbol=${data.symbol}, score=${data.confluenceScore}, time=${data.timestamp}, syncedAt=${data.syncedAt?.toDate ? data.syncedAt.toDate().toISOString() : data.syncedAt}`);
    });
}

debugScanData().catch(console.error);
