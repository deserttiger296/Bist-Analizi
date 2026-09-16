# Compliance Engine Implementation Plan

## Goal
Develop a robust Compliance Engine that evaluates incoming trade requests against configurable risk, regulatory, and portfolio constraints before allowing execution. The engine will be integrated into the existing `quant-core` Python services and expose a REST endpoint for the Next.js dashboard and Flutter app.

## User Review Required
> [!IMPORTANT]
> Review the proposed data model and configuration format. The engine will store rules in a new Firestore collection `compliance_rules`. Confirm if the rule schema meets your regulatory requirements.

## Open Questions
> [!WARNING]
> - Do you need real‑time rule updates without redeploying the service? (If yes, we will implement a Firestore listener.)
> - Should the engine return detailed violation messages or a simple boolean flag?
> - Any specific compliance frameworks (e.g., MiFID II, local market regulations) that must be encoded?

## Proposed Changes
---
### 1. Backend (Python `quant-core`)
- **[NEW] `compliance_engine.py`**: Core logic to load rules from Firestore, evaluate trade payloads, and generate compliance results.
- **[MODIFY] `app.py`**: Add new FastAPI route `/api/compliance/check` that receives a trade JSON, invokes `ComplianceEngine.check(trade)`, and returns `{ allowed: bool, violations: [] }`.
- **[MODIFY] `requirements.txt`**: Add `google-cloud-firestore` dependency.
- **[NEW] Firestore Listener (optional)**: If real‑time rule updates are required, spin up a background thread using `google-cloud-firestore` to listen to `compliance_rules` collection and refresh in‑memory cache.

### 2. Firestore Schema
- **Collection `compliance_rules`**
  - Document ID: rule identifier
  - Fields: `type` (e.g., `max_position`, `max_daily_volume`), `parameters` (JSON), `active` (bool), `description`.
- **Collection `compliance_logs`**
  - Store audit trail of each compliance check with timestamp, trade ID, user, and result.

### 3. Frontend (Next.js)
- **[MODIFY] `pages/api/compliance.ts`**: Wrapper to call the Python endpoint.
- **[MODIFY] UI Component `CompliancePanel.tsx`**: Display rule list, allow admins to toggle/ edit rules, and show latest compliance checks.

### 4. Flutter App
- **[MODIFY] `compliance_service.dart`**: New service class calling `/api/compliance/check` before placing orders.
- **[MODIFY] UI**: Show compliance status (green/red) when user attempts a trade.

---
## Verification Plan
### Automated Tests
- Unit tests for `ComplianceEngine.check` covering each rule type.
- Integration test: mock Firestore rules, send trade request, verify API response.
### Manual Validation
- Use Next.js dashboard to create a rule (e.g., max position = 10). Trigger a trade from Flutter exceeding limit and confirm rejection.
- Review entries in `compliance_logs` for correctness.
