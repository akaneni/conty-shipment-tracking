# conty-shipment-tracking

API que acompanha o produto físico enviado ao criador. Consulta um agregador de rastreio (fictício), traduz o dialeto de cada transportadora para cinco status estáveis, guarda o histórico sem duplicar e avisa quando o pacote passa do tempo limite em trânsito.

## Como rodar

```bash
npm install
npm test
npm run typecheck
npm run stub   # agregador fictício em :4000 (só para demonstração)
npm run dev    # API em :3000 (variáveis em .env.example)
```

Node 22+. Stack: Hono, `node:sqlite`, vitest.

## Status normalizados

| Status | Rótulo |
|---|---|
| `posted` | postado |
| `in_transit` | em trânsito |
| `out_for_delivery` | saiu para entrega |
| `delivered` | entregue |
| `exception` | exceção |

## Exemplo: payload bruto e normalizado

Bruto (formato do agregador fictício "ParcelTrack", só existe em `src/providers/parceltrack.ts`):

```json
{
  "tracking_number": "BR-DEMO-2",
  "carrier": "correios",
  "events": [
    { "timestamp": "2026-10-01T09:30:00-03:00", "status_code": "PO", "status_text": "Objeto postado" },
    { "timestamp": "2026-10-02T11:00:00-03:00", "status_code": "ENTREGUE_QUASE", "status_text": "Quase lá" }
  ]
}
```

Normalizado (`NormalizedTracking`, o que o domínio enxerga e grava):

```json
{
  "carrier": "correios",
  "events": [
    { "occurred_at": "2026-10-01T12:30:00.000Z", "raw_status": "PO", "status": "posted" },
    { "occurred_at": "2026-10-02T14:00:00.000Z", "raw_status": "ENTREGUE_QUASE", "status": "exception" }
  ]
}
```

O segundo evento é um código que a transportadora inventou: vira `exception` (nunca `delivered`) e o texto original fica em `raw_status`.

## API

```bash
# cadastrar (carrier e shipped_at são opcionais; shipped_at padrão = agora)
curl -X POST localhost:3000/shipments -H 'content-type: application/json' \
  -d '{"tracking_code":"BR-DEMO-1","carrier":"correios","shipped_at":"2026-10-01T09:00:00-03:00"}'

# consultar o agregador e atualizar status/histórico
curl -X POST localhost:3000/shipments/1/refresh

# status, histórico e "delayed"
curl localhost:3000/shipments/1

# pacotes atrasados
curl localhost:3000/shipments/delayed
```

Resposta de `GET /shipments/1` (após o refresh com o stub):

```json
{
  "id": 1, "tracking_code": "BR-DEMO-1", "carrier": "correios",
  "status": "delivered", "shipped_at": "2026-10-01T12:00:00.000Z",
  "delivered_at": "2026-10-03T18:00:00.000Z", "last_checked_at": "...",
  "delay_alerted_at": null, "delayed": false,
  "events": [
    { "occurred_at": "2026-10-01T12:30:00.000Z", "raw_status": "PO", "status": "posted", "...": "..." },
    { "occurred_at": "2026-10-02T13:00:00.000Z", "raw_status": "TR", "status": "in_transit", "...": "..." },
    { "occurred_at": "2026-10-03T18:00:00.000Z", "raw_status": "DL", "status": "delivered", "...": "..." }
  ]
}
```

Erros: 400 corpo inválido, 404 envio inexistente, 409 código repetido, 502 agregador fora do ar ou resposta mal formada. Corpo `{ "error": "..." }`.

## Regras

**Status atual.** É o evento de maior `occurred_at` (empate: maior rank, `delivered` > `exception` > `out_for_delivery` > `in_transit` > `posted`). A ordem de chegada não importa, então evento antigo que chega depois não regride nada. `delivered` é terminal: depois dele o status não muda (o evento tardio só entra no histórico). Uma `exception` pode ser seguida de novo status.

**Histórico sem duplicata.** `UNIQUE (shipment_id, occurred_at, raw_status)` com `INSERT OR IGNORE`. A data é normalizada para UTC antes, então o mesmo instante em fusos diferentes é o mesmo evento. Reconsultar não duplica.

**Atraso.** `atrasado = status != delivered E agora - shipped_at > TRANSIT_ALERT_HOURS` (padrão 120 h, comparação estrita: no limite exato ainda não é atraso, 1 ms depois é). Entregue nunca é atraso, por maior que seja o tempo desde o envio. Pacote nunca consultado (sem status) conta como não entregue. O relógio é injetado, então os testes controlam a data. O alerta é emitido uma vez por pacote (`delay_alerted_at`) pela interface `Notifier`, na primeira vez que `GET /shipments/:id`, `GET /shipments/delayed` ou o refresh enxerga o atraso. Não há envio real: só a implementação em memória.

**Troca de agregador.** O domínio só conhece `TrackingProvider { fetch(code); normalize(raw) }`. `fetch` devolve algo opaco, `normalize` devolve `NormalizedTracking`. O formato bruto não sai de `src/providers/parceltrack.ts`; `test/swap-provider.test.ts` roda um segundo adaptador de formato diferente sem alterar o domínio.

### Evolução: SLA por transportadora

Hoje o limite é um só. O passo natural é uma tabela `carrier_sla(carrier, route, max_transit_hours)`; `isDelayed` passaria a receber o limite resolvido por transportadora/rota (com o global como fallback). A função já é pura e recebe o limite como argumento, então a mudança fica na camada que monta a chamada.

## Decisões e limites

- `shipped_at` vem do cadastro (ou do relógio no cadastro); não é inferido do evento `posted`.
- Data de evento sem fuso explícito é rejeitada (502), para não depender do fuso da máquina.
- Os dados de exemplo do stub são de outubro de 2026; com o relógio real, podem aparecer como atrasados.

## Fora de escopo

- Envio real de notificação (e-mail, push); persistência dos alertas além do `delay_alerted_at`.
- Atualização automática periódica (o refresh é chamado sob demanda), webhooks do agregador, autenticação.
- SLA por transportadora (só a nota acima), paginação e filtros.
- Cliente do agregador real: o `ParcelTrackProvider` fala com um contrato fictício.

## Uso de IA
- **Feito com IA:** especificação, código e testes escritos com Claude Code (Claude Sonnet 5.5), a partir de decisões do autor tomadas em entrevista (grill) e registradas em `.specs/`.
- **Revisado pelo autor:** TODO(preencher após a revisão humana do diff).
- **Revisão independente:** TODO(preencher após a revisão por agente de contexto limpo).
