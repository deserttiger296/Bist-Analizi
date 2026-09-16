/**
 * Runs the exact same production scan + calibration pipeline that
 * /api/bist/cron/scan and /api/bist/cron/calibrate run in production,
 * directly against the real Firestore project, for local scheduling
 * (see scripts/register_windows_task.sh) since no QStash schedule has
 * ever actually been provisioned for those routes (confirmed empty
 * calibration_alerts / shadow_logs collections).
 *
 * This does NOT replace setting up real QStash schedules -- it is a
 * stopgap so the feedback loop finally starts collecting real
 * signal -> outcome data while that infra decision is made.
 */
import { runBackgroundScan } from "../src/lib/backgroundScanner";
import { detectAnalysisMismatches, recalibrateWeightsAndRegime, trackShadowLogOutcomes } from "../src/lib/calibrationEngine";

async function run() {
  const startedAt = new Date().toISOString();
  console.log(`[scheduled-run] Starting at ${startedAt}`);

  try {
    console.log("[scheduled-run] 1/4 Running full BIST scan...");
    const results = await runBackgroundScan("all");
    console.log(`[scheduled-run] Scan complete: ${Array.isArray(results) ? results.length : "?"} results.`);
  } catch (e) {
    console.error("[scheduled-run] Scan step failed:", e);
  }

  try {
    console.log("[scheduled-run] 2/4 Detecting analysis mismatches (5 days ago)...");
    await detectAnalysisMismatches(5);
  } catch (e) {
    console.error("[scheduled-run] Mismatch detection failed:", e);
  }

  try {
    console.log("[scheduled-run] 3/4 Recalibrating weights and regime...");
    await recalibrateWeightsAndRegime();
  } catch (e) {
    console.error("[scheduled-run] Recalibration failed:", e);
  }

  try {
    console.log("[scheduled-run] 4/4 Tracking shadow log outcomes...");
    await trackShadowLogOutcomes();
  } catch (e) {
    console.error("[scheduled-run] Shadow log tracking failed:", e);
  }

  console.log(`[scheduled-run] Finished at ${new Date().toISOString()} (started ${startedAt}).`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[scheduled-run] Fatal error:", e);
    process.exit(1);
  });
