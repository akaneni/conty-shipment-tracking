// Regras puras do domínio: sem Hono, sem SQL, sem formato de agregador.

export const STATUSES = ["posted", "in_transit", "out_for_delivery", "delivered", "exception"] as const;
export type Status = (typeof STATUSES)[number];

// Usado só para desempate quando dois eventos têm o mesmo occurred_at.
export const RANK: Record<Status, number> = {
  posted: 1,
  in_transit: 2,
  out_for_delivery: 3,
  exception: 4,
  delivered: 5,
};

export interface TrackingEvent {
  occurred_at: string; // ISO UTC
  status: Status;
}

export interface DerivedState {
  status: Status | null;
  delivered_at: string | null;
}

export function deriveState(events: TrackingEvent[]): DerivedState {
  if (events.length === 0) return { status: null, delivered_at: null };

  const delivered = events.filter((e) => e.status === "delivered");
  if (delivered.length > 0) {
    // Entregue é terminal: nada que chegue depois muda o status.
    const first = delivered.map((e) => e.occurred_at).sort((a, b) => Date.parse(a) - Date.parse(b))[0]!;
    return { status: "delivered", delivered_at: first };
  }

  let best = events[0]!;
  for (const e of events) {
    const dt = Date.parse(e.occurred_at) - Date.parse(best.occurred_at);
    if (dt > 0 || (dt === 0 && RANK[e.status] > RANK[best.status])) best = e;
  }
  return { status: best.status, delivered_at: null };
}

export function isDelayed(
  shipment: { status: Status | null; shipped_at: string },
  now: Date,
  limitHours: number,
): boolean {
  if (shipment.status === "delivered") return false;
  return now.getTime() - Date.parse(shipment.shipped_at) > limitHours * 3600_000;
}
