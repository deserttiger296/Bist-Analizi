import { getAdminDb, ensureTimeSynced } from "../src/lib/firebaseAdmin";

async function checkShadowLogs() {
    await ensureTimeSynced();
    const db = getAdminDb();
    if (!db) { console.error("No DB"); return; }
    
    const snap = await db.collection("shadow_logs").get();
    console.log(`Total documents in shadow_logs: ${snap.size}`);
    
    const statuses: Record<string, number> = {};
    const sampleRecords: any[] = [];
    
    snap.forEach(doc => {
        const data = doc.data();
        const s = data.status || "NO_STATUS";
        statuses[s] = (statuses[s] || 0) + 1;
        if (sampleRecords.length < 5) {
            sampleRecords.push({
                id: doc.id,
                symbol: data.symbol,
                status: data.status,
                entryPrice: data.entryPrice,
                entryTime: data.entryTime?.toDate ? data.entryTime.toDate().toISOString() : data.entryTime,
                outcomeT5: data.outcomeT5
            });
        }
    });
    
    console.log("Status counts:", JSON.stringify(statuses, null, 2));
    console.log("Sample records:");
    console.log(JSON.stringify(sampleRecords, null, 2));
}

checkShadowLogs().catch(console.error);
