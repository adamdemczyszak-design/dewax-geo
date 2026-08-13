import type { AuditEntry } from '../types'

/**
 * Dziennik audytu. Rejestruje kazde odpytanie uslugi PGI, promien wyszukiwania,
 * liczbe znalezionych otworow oraz decyzje o rozszerzeniu promienia.
 * Dziennik jest zwracany do klienta i stanowi czesc dowodowa raportu.
 */
export class AuditLog {
  private entries: AuditEntry[] = []

  constructor(private readonly now: () => Date = () => new Date()) {}

  add(entry: Omit<AuditEntry, 'ts'>): void {
    this.entries.push({ ts: this.now().toISOString(), ...entry })
  }

  all(): AuditEntry[] {
    return [...this.entries]
  }

  count(): number {
    return this.entries.length
  }
}
