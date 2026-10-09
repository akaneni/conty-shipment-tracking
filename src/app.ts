import { Hono } from "hono";
import * as repo from "./db.ts";
import { ProviderError } from "./provider.ts";
import * as svc from "./shipments.ts";

export function createApp(deps: svc.Deps) {
  const app = new Hono();

  app.post("/shipments", async (c) => {
    const body = await c.req.json().catch(() => null);
    const code = body?.tracking_code;
    if (typeof code !== "string" || code.trim() === "") {
      return c.json({ error: "tracking_code é obrigatório" }, 400);
    }
    if (body.carrier !== undefined && typeof body.carrier !== "string") {
      return c.json({ error: "carrier deve ser texto" }, 400);
    }
    let shippedAt = deps.clock().toISOString();
    if (body.shipped_at !== undefined) {
      const ms = typeof body.shipped_at === "string" ? Date.parse(body.shipped_at) : NaN;
      if (Number.isNaN(ms)) return c.json({ error: "shipped_at deve ser uma data ISO válida" }, 400);
      shippedAt = new Date(ms).toISOString();
    }
    const trackingCode = code.trim();
    if (repo.findByCode(deps.db, trackingCode)) {
      return c.json({ error: "Código de rastreio já cadastrado" }, 409);
    }
    const row = repo.insertShipment(deps.db, {
      tracking_code: trackingCode,
      carrier: body.carrier ?? null,
      shipped_at: shippedAt,
    });
    return c.json(svc.view(deps, row.id), 201);
  });

  // Antes de /:id para não ser capturada como id.
  app.get("/shipments/delayed", (c) => c.json(svc.listDelayed(deps)));

  // Job periódico: emite os alertas pendentes (uma vez por pacote).
  app.post("/shipments/check-delays", (c) => c.json(svc.checkDelays(deps)));

  // Job periódico: emite os alertas pendentes (uma vez por pacote).
  app.post("/shipments/check-delays", (c) => c.json(svc.checkDelays(deps)));

  const parseId = (raw: string) => (/^\d+$/.test(raw) ? Number(raw) : null);

  app.get("/shipments/:id", (c) => {
    const id = parseId(c.req.param("id"));
    const v = id === null ? undefined : svc.view(deps, id);
    return v ? c.json(v) : c.json({ error: "Envio não encontrado" }, 404);
  });

  app.post("/shipments/:id/refresh", async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: "Envio não encontrado" }, 404);
    try {
      const v = await svc.refresh(deps, id);
      return v ? c.json(v) : c.json({ error: "Envio não encontrado" }, 404);
    } catch (e) {
      if (e instanceof ProviderError) return c.json({ error: `Falha ao consultar o agregador: ${e.message}` }, 502);
      throw e;
    }
  });

  return app;
}
