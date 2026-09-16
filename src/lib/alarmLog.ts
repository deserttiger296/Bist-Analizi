// Alarm log persistence — uses localStorage (client-side only)

export interface AlarmRecord {
  id: string;
  symbol: string;
  name: string;
  timestamp: string; // ISO string
  price: number;
  change: number;
  confluenceScore: number;
  passCount: number;
  rsi: number;
  adxValue: number;
  volumeMultiple: number;
  stochK: number;
  supertrendUp: boolean;
  hullBreakout?: boolean;
  sarBullish: boolean;
  inSqueeze: boolean;
  momentumPhase?: number;
  reasons: string[];
}

const STORAGE_KEY = "bist_alarm_log";
const MAX_RECORDS = 500;

export function loadAlarmLog(): AlarmRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveAlarmLog(records: AlarmRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
  } catch {}
}

export function addAlarmRecord(record: Omit<AlarmRecord, "id">): AlarmRecord {
  const existing = loadAlarmLog();
  const newRecord: AlarmRecord = {
    ...record,
    id: `${record.symbol}-${Date.now()}`,
  };
  // De-duplicate: remove old entry for same symbol if exists (keep latest)
  const filtered = existing.filter((r) => r.symbol !== record.symbol);
  const updated = [newRecord, ...filtered].slice(0, MAX_RECORDS);
  saveAlarmLog(updated);
  return newRecord;
}

export function clearAlarmLog(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
