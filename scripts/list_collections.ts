import { getAdminDb, ensureTimeSynced } from "../src/lib/firebaseAdmin";

async function listCollections() {
    await ensureTimeSynced();
    const db = getAdminDb();
    if (!db) { console.error("No DB"); return; }
    
    console.log("Listing Firestore collections...");
    const collections = await db.listCollections();
    for (const col of collections) {
        const snap = await col.limit(1).get();
        console.log(`- Collection: "${col.id}", Doc Count (estimated): ${snap.size > 0 ? ">= 1" : "0"}`);
    }
}

listCollections().catch(console.error);
