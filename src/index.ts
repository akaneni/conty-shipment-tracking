import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { InMemoryNotifier } from "./notifier.ts";
import { ParcelTrackProvider } from "./providers/parceltrack.ts";

const dbPath = process.env.DB_PATH ?? "data/tracking.sqlite";
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

const app = createApp({
  db: openDb(dbPath),
  clock: () => new Date(),
  provider: new ParcelTrackProvider({ baseUrl: process.env.AGGREGATOR_URL ?? "http://localhost:4000" }),
  notifier: new InMemoryNotifier(),
  transitAlertHours: Number(process.env.TRANSIT_ALERT_HOURS ?? 120),
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => console.log(`API em http://localhost:${port}`));
