import type { DatabaseSync } from "node:sqlite";
import * as repo from "./db.ts";
import type { EventRow, ShipmentRow } from "./db.ts";
import type { Notifier } from "./notifier.ts";
import type { TrackingProvider } from "./provider.ts";
import { deriveState, isDelayed } from "./status.ts";

export interface Deps {
  db: DatabaseSync;
  clock: () => Date;
  provider: TrackingProvider;
  notifier: Notifier;
  transitAlertHours: number;
}

export interface ShipmentView extends ShipmentRow {
  delayed: boolean;
  events: EventRow[];
}

// Avalia atraso e dispara o alerta uma única vez (delay_alerted_at).
function evaluateDelay(deps: Deps, s: ShipmentRow): boolean {
  const now = deps.clock();
  const delayed = isDelayed(s, now, deps.transitAlertHours);
  if (delayed && !s.delay_alerted_at) {
    deps.notifier.notifyDelay({ shipment_id: s.id, tracking_code: s.tracking_code, shipped_at: s.shipped_at });
    repo.markDelayAlerted(deps.db, s.id, now.toISOString());
  }
  return delayed;
}

export function view(deps: Deps, id: number): ShipmentView | undefined {
  const s = repo.getShipment(deps.db, id);
  if (!s) return undefined;
  const delayed = evaluateDelay(deps, s);
  const fresh = repo.getShipment(deps.db, id)!;
  return { ...fresh, delayed, events: repo.listEvents(deps.db, id) };
}

export function listDelayed(deps: Deps): ShipmentView[] {
  const out: ShipmentView[] = [];
  for (const s of repo.listShipments(deps.db)) {
    if (!evaluateDelay(deps, s)) continue;
    out.push(view(deps, s.id)!);
  }
  return out;
}

export async function refresh(deps: Deps, id: number): Promise<ShipmentView | undefined> {
  const s = repo.getShipment(deps.db, id);
  if (!s) return undefined;
  // Rede fora da transação; ProviderError sobe para a camada HTTP.
  const tracking = deps.provider.normalize(await deps.provider.fetch(s.tracking_code));
  const now = deps.clock().toISOString();

  deps.db.exec("BEGIN");
  try {
    repo.insertEvents(deps.db, id, tracking.events, now);
    const state = deriveState(repo.listEvents(deps.db, id));
    repo.updateShipmentState(deps.db, id, { ...state, last_checked_at: now, carrier: tracking.carrier });
    deps.db.exec("COMMIT");
  } catch (e) {
    deps.db.exec("ROLLBACK");
    throw e;
  }
  return view(deps, id);
}
