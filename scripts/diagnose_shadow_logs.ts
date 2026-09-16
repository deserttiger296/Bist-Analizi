
import { getAdminDb, ensureTimeSynced } from "../src/lib/firebaseAdmin";

async function diagnose() {
    await ensureTimeSynced();
    const db = getAdminDb();
    if (!db) {
        console.error("No DB");
        return;
    }

    // 1. Check total shadow_logs count (any status)
    console.log("=== SHADOW LOGS DIAGNOSIS ===\n");
    const allShadowSnap = await db.collection("shadow_logs").limit(50).get();
    console.log(`Total shadow_logs documents (up to 50): ${allShadowSnap.size}`);
    
    if (allShadowSnap.size > 0) {
        const statusCounts: Record<string, number> = {};
        allShadowSnap.forEach(doc => {
            const data = doc.data();
            const status = data.status || "NO_STATUS";
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        console.log("Status breakdown:", JSON.stringify(statusCounts, null, 2));
        
        // Show first 5 documents
        console.log("\nFirst 5 shadow_log documents:");
        let count = 0;
        allShadowSnap.forEach(doc => {
            if (count >= 5) return;
            const data = doc.data();
            console.log(`  [${doc.id}] symbol=${data.symbol}, status=${data.status}, timestamp=${data.timestamp}, shadowFilters=${JSON.stringify(data.shadowFilters)}, t5Return=${data.t5Return}`);
            count++;
        });
    }

    // 2. Check scan_results - are scans running?
    console.log("\n=== SCAN RESULTS DIAGNOSIS ===\n");
    const scanSnap = await db.collection("scan_results").orderBy("scanTimestamp", "desc").limit(5).get();
    console.log(`Recent scan_results (up to 5): ${scanSnap.size}`);
    scanSnap.forEach(doc => {
        const data = doc.data();
        const ts = data.scanTimestamp ? new Date(data.scanTimestamp).toISOString() : "N/A";
        console.log(`  [${doc.id}] scanTimestamp=${ts}, recommendation=${data.recommendation}, confluenceScore=${data.confluenceScore}, shadowFilters=${JSON.stringify(data.shadowFilters)}`);
    });

    // 3. Check if calibration has run
    console.log("\n=== CALIBRATION LOG ===\n");
    const calSnap = await db.collection("calibration_log").orderBy("timestamp", "desc").limit(3).get();
    console.log(`Recent calibration_log entries (up to 3): ${calSnap.size}`);
    calSnap.forEach(doc => {
        const data = doc.data();
        const ts = data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : data.timestamp;
        console.log(`  [${doc.id}] timestamp=${ts}`);
    });
}

diagnose().catch(console.error);
