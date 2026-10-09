export interface DelayAlert {
  shipment_id: number;
  tracking_code: string;
  shipped_at: string;
}

export interface Notifier {
  notifyDelay(alert: DelayAlert): void;
}

// Sem envio real: guarda em memória (usado em testes e no dev).
export class InMemoryNotifier implements Notifier {
  readonly sent: DelayAlert[] = [];
  notifyDelay(alert: DelayAlert): void {
    this.sent.push(alert);
  }
}
