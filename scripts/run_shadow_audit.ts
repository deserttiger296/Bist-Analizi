
import { getAdminDb, ensureTimeSynced } from "../src/lib/firebaseAdmin";

function stdDev(arr: number[]): number {
    if (arr.length <= 1) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (arr.length - 1);
    return Math.sqrt(variance);
}

function mean(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function erfc(x: number): number {
    const z = Math.abs(x);
    const t = 1.0 / (1.0 + 0.5 * z);
    const ans = t * Math.exp(-z * z - 1.26551223 +
        t * (1.00002368 +
            t * (0.37409196 +
                t * (0.09678418 +
                    t * (-0.18628806 +
                        t * (0.27886807 +
                            t * (-1.13520398 +
                                t * (1.48851587 +
                                    t * (-0.82215223 +
                                        t * 0.17087277)))))))));
    return x >= 0 ? ans : 2.0 - ans;
}

function normalCdf(x: number): number {
    return 0.5 * erfc(-x / Math.SQRT2);
}

function computeTTestPValue(t: number): number {
    return 2 * (1 - normalCdf(Math.abs(t)));
}

async function run() {
    await ensureTimeSynced();
    const db = getAdminDb();
    if (!db) {
        console.error("No DB");
        return;
    }
    const snap = await db.collection("shadow_logs").where("status", "==", "COMPLETED").get();
    const records: any[] = [];
    let minDate = new Date();
    let maxDate = new Date(0);
    const uniqueDays = new Set<string>();

    snap.forEach(doc => {
        const data = doc.data();
        records.push(data);
        const d = new Date(data.timestamp);
        if (d < minDate) minDate = d;
        if (d > maxDate) maxDate = d;
        uniqueDays.add(d.toISOString().split('T')[0]);
    });

    const N = records.length;
    const daysSpan = N > 0 ? (maxDate.getTime() - minDate.getTime()) / (1000 * 3600 * 24) : 0;
    
    console.log(`Sample Size: ${N} signals`);
    console.log(`Calendar Days Spanned: ${daysSpan.toFixed(1)} days`);
    console.log(`Distinct Market Sessions: ${uniqueDays.size}`);
    
    if (N < 150 || daysSpan < 28) {
        console.log(`\nWARNING: Sample size is under 150-200 signals or covers less than 4-6 weeks. Findings are PRELIMINARY and NOT ACTIONABLE.`);
    }

    const filters = ["isAboveWeeklyEma26", "isCmfPositive", "isCmfAboveThreshold", "isRsiWithinCeiling", "isAtrStopOk"];
    
    for (const filter of filters) {
        const passed = records.filter(r => r.shadowFilters && r.shadowFilters[filter] === true);
        const failed = records.filter(r => r.shadowFilters && r.shadowFilters[filter] === false);
        
        const passedReturns = passed.map(r => r.t5Return);
        const failedReturns = failed.map(r => r.t5Return);
        
        const passedWins = passedReturns.filter(r => r > 0).length;
        const failedWins = failedReturns.filter(r => r > 0).length;
        
        const pWinRate = passed.length > 0 ? passedWins / passed.length : 0;
        const fWinRate = failed.length > 0 ? failedWins / failed.length : 0;
        
        const pMean = mean(passedReturns);
        const fMean = mean(failedReturns);
        const pStd = stdDev(passedReturns);
        const fStd = stdDev(failedReturns);
        
        // Welch's t-test
        let tStat = 0;
        let pValueT = 1;
        if (passed.length > 1 && failed.length > 1) {
            const se2 = (pStd * pStd) / passed.length + (fStd * fStd) / failed.length;
            if (se2 > 0) {
                tStat = (pMean - fMean) / Math.sqrt(se2);
                pValueT = computeTTestPValue(tStat);
            }
        }
        
        // Two-proportion z-test
        let zStat = 0;
        let pValueZ = 1;
        if (passed.length > 0 && failed.length > 0) {
            const pPool = (passedWins + failedWins) / (passed.length + failed.length);
            const se = Math.sqrt(pPool * (1 - pPool) * (1 / passed.length + 1 / failed.length));
            if (se > 0) {
                zStat = (pWinRate - fWinRate) / se;
                pValueZ = computeTTestPValue(zStat);
            }
        }

        console.log(`\n--- Filter: ${filter} ---`);
        console.log(`PASSED: N=${passed.length}, WinRate=${(pWinRate*100).toFixed(1)}%, AvgReturn=${(pMean*100).toFixed(2)}%`);
        console.log(`FAILED: N=${failed.length}, WinRate=${(fWinRate*100).toFixed(1)}%, AvgReturn=${(fMean*100).toFixed(2)}%`);
        console.log(`Return Diff (T-test): t=${tStat.toFixed(2)}, p=${pValueT.toFixed(4)}`);
        console.log(`WinRate Diff (Z-test): z=${zStat.toFixed(2)}, p=${pValueZ.toFixed(4)}`);
    }
}

run().catch(console.error);
