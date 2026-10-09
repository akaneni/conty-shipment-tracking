# Tarefas: shipment-tracking

- [x] T1 Esqueleto (package, tsconfig, vitest). Verifica: `npm install`.
- [x] T2 `src/status.ts` puro: ranks, `deriveState`, `isDelayed`. Teste primeiro. (TRK-03/04/05/08) Dep: T1.
- [x] T3 `src/provider.ts` + `src/providers/parceltrack.ts` (normalize, status desconhecido). Teste primeiro. (TRK-02/06) Dep: T1.
- [x] T4 `src/db.ts` + `src/shipments.ts` (cadastro, refresh, dedupe, atraso, alerta). (TRK-01/07/09) Dep: T2, T3.
- [x] T5 `src/app.ts` + `src/index.ts` (rotas, erros). (TRK-10) Dep: T4.
- [x] T6 Teste do segundo adaptador fake. (TRK-02) Dep: T4.
- [x] T7 Stub do agregador, subida real com curl, README. (TRK-11) Dep: T5.
- [x] T8 Mutações de verificação (inverter `>`, status desconhecido -> delivered, ordem do evento, terminal, dedupe, trim/caixa no código, fuso, rank de exception, GET gravando).
- [x] T9 Ajustes do autor: match exato do código, GET sem escrita, `POST /shipments/check-delays`, nunca consultado não atrasa, `engines >=22.13`.
