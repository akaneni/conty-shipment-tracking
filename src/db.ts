import { DatabaseSync } from "node:sqlite";
import type { NormalizedEvent } from "./provider.ts";
import type { Status } from "./status.ts";

export interface ShipmentRow {
  id: number;
  tracking_code: string;
  carrier: string | null;
  status: Status | null;
  shipped_at: string;
  delivered_at: string | null;
  last_checked_at: string | null;
  delay_alerted_at: string | null;
}

export interface EventRow {
  id: number;
  shipment_id: number;
  occurred_at: string;
  raw_status: string;
  status: Status;
  received_at: string;
}

export function openDb(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracking_code TEXT NOT NULL UNIQUE,
      carrier TEXT,
      status TEXT,
      shipped_at TEXT NOT NULL,
      delivered_at TEXT,
      last_checked_at TEXT,
      delay_alerted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS tracking_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id INTEGER NOT NULL REFERENCES shipments(id),
      occurred_at TEXT NOT NULL,
      raw_status TEXT NOT NULL,
      status TEXT NOT NULL,
      received_at TEXT NOT NULL,
      UNIQUE (shipment_id, occurred_at, raw_status)

    );
  `);
  return db;
}

export function insertShipment(
  db: DatabaseSync,
  s: { tracking_code: string; carrier: string | null; shipped_at: string },
): ShipmentRow {
  const r = db
    .prepare("INSERT INTO shipments (tracking_code, carrier, shipped_at) VALUES (?, ?, ?)")
    .run(s.tracking_code, s.carrier, s.shipped_at);
  return getShipment(db, Number(r.lastInsertRowid))!;
}

export function getShipment(db: DatabaseSync, id: number): ShipmentRow | undefined {
  return db.prepare("SELECT * FROM shipments WHERE id = ?").get(id) as ShipmentRow | undefined;
}

export function findByCode(db: DatabaseSync, code: string): ShipmentRow | undefined {
  return db.prepare("SELECT * FROM shipments WHERE tracking_code = ?").get(code) as ShipmentRow | undefined;
}

export function listShipments(db: DatabaseSync): ShipmentRow[] {
  return db.prepare("SELECT * FROM shipments ORDER BY id").all() as unknown as ShipmentRow[];
}

export function listEvents(db: DatabaseSync, shipmentId: number): EventRow[] {
  return db
    .prepare("SELECT * FROM tracking_events WHERE shipment_id = ? ORDER BY occurred_at, id")
    .all(shipmentId) as unknown as EventRow[];
}

// Devolve quantos eventos eram realmente novos (os repetidos são ignorados pela UNIQUE).
export function insertEvents(db: DatabaseSync, shipmentId: number, events: NormalizedEvent[], receivedAt: string): number {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO tracking_events (shipment_id, occurred_at, raw_status, status, received_at) VALUES (?, ?, ?, ?, ?)",
  );
  let added = 0;
  for (const e of events) {
    added += Number(stmt.run(shipmentId, e.occurred_at, e.raw_status, e.status, receivedAt).changes);
  }
  return added;
}

export function updateShipmentState(
  db: DatabaseSync,
  id: number,
  p: { status: Status | null; delivered_at: string | null; last_checked_at?: string; carrier?: string | null },
): void {
  db.prepare(
    `UPDATE shipments SET status = ?, delivered_at = ?,
       last_checked_at = COALESCE(?, last_checked_at), carrier = COALESCE(carrier, ?) WHERE id = ?`,
  ).run(p.status, p.delivered_at, p.last_checked_at ?? null, p.carrier ?? null, id);
}

export function markDelayAlerted(db: DatabaseSync, id: number, at: string): void {
  db.prepare("UPDATE shipments SET delay_alerted_at = ? WHERE id = ?").run(at, id);
}
