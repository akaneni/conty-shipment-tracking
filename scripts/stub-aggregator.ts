// Agregador fictício só para demonstração local. Códigos:
//   BR-DEMO-1   -> postado, em trânsito (fora de ordem), entregue
//   BR-DEMO-2   -> status inventado "ENTREGUE_QUASE"
//   outros      -> postado
import { serve } from "@hono/node-server";
import { Hono } from "hono";

const data: Record<string, unknown[]> = {
  "BR-DEMO-1": [
    { timestamp: "2026-10-03T15:00:00-03:00", status_code: "DL", status_text: "Entregue" },
    { timestamp: "2026-10-01T09:30:00-03:00", status_code: "PO", status_text: "Objeto postado" },
    { timestamp: "2026-10-02T10:00:00-03:00", status_code: "TR", status_text: "Em trânsito" },
    { timestamp: "2026-10-02T10:00:00-03:00", status_code: "TR", status_text: "Em trânsito" },
  ],
  "BR-DEMO-2": [
    { timestamp: "2026-10-01T09:30:00-03:00", status_code: "PO", status_text: "Objeto postado" },
    { timestamp: "2026-10-02T11:00:00-03:00", status_code: "ENTREGUE_QUASE", status_text: "Quase lá" },
  ],
};

const app = new Hono();
app.get("/v1/trackings/:code", (c) => {
  const code = c.req.param("code");
  const events = data[code] ?? [{ timestamp: "2026-10-01T09:30:00-03:00", status_code: "PO", status_text: "Objeto postado" }];
  return c.json({ tracking_number: code, carrier: "correios", events });
});

const port = Number(process.env.STUB_PORT ?? 4000);
serve({ fetch: app.fetch, port }, () => console.log(`Agregador fake em http://localhost:${port}`));
