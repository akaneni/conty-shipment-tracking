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

// Leitura pura: calcula `delayed` sem gravar nada nem notificar.
function computeDelayed(deps: Deps, s: ShipmentRow): boolean {
  return isDelayed(s, deps.clock(), deps.transitAlertHours);
}

// Emite o alerta uma única vez (delay_alerted_at). Só refresh e check-delays chamam.
function alertIfDelayed(deps: Deps, s: ShipmentRow): boolean {
  if (s.delay_alerted_at || !computeDelayed(deps, s)) return false;
  deps.notifier.notifyDelay({ shipment_id: s.id, tracking_code: s.tracking_code, shipped_at: s.shipped_at });
  repo.markDelayAlerted(deps.db, s.id, deps.clock().toISOString());
  return true;
}

export function view(deps: Deps, id: number): ShipmentView | undefined {
  const s = repo.getShipment(deps.db, id);
  if (!s) return undefined;
  return { ...s, delayed: computeDelayed(deps, s), events: repo.listEvents(deps.db, id) };
}

export function listDelayed(deps: Deps): ShipmentView[] {
  return repo
    .listShipments(deps.db)
    .filter((s) => computeDelayed(deps, s))
    .map((s) => view(deps, s.id)!);
}

// Ponto de entrada para um job periódico. Devolve os envios alertados nesta chamada.
export function checkDelays(deps: Deps): ShipmentView[] {
  return repo
    .listShipments(deps.db)
    .filter((s) => alertIfDelayed(deps, s))
    .map((s) => view(deps, s.id)!);
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
  alertIfDelayed(deps, repo.getShipment(deps.db, id)!);
  return view(deps, id);
}
