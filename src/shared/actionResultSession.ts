import {
  ActionStatusCatalog, type ActionResultOutput, type EffectiveResult, ResultContractError,
  type ResultErrorOverride, type ResultExecutionGuards, aggregateResultEffects
} from './actionStatusPolicy'

/** Process-owned state for one claimed unit. Never persisted as campaign config. */
export class ActionResultSession {
  private readonly nextSlots = new Map<string, number>()
  private readonly results = new Map<string, Map<string, { id: string | null; effective: EffectiveResult }>>()
  private readonly closedTargets = new Set<string>()
  private readonly prepared = new Map<string, { output: string; effective: EffectiveResult; slotKey: string; nextOrdinal?: number }>()

  constructor(readonly catalog: ActionStatusCatalog, readonly unitKey: string) {}

  prepare(inputId: string | null, output: ActionResultOutput, error: ResultErrorOverride | null,
    guards: ResultExecutionGuards = {}, sourceKey?: string): { key: string; effective: EffectiveResult } {
    const target = inputId ?? '0'
    if (this.closedTargets.has(target)) throw new ResultContractError('target_settled', output.actionCode, output.statusCode)
    const slotKey = JSON.stringify([target, output.actionCode])
    const ordinal = this.nextSlots.get(slotKey) ?? 0
    const slot = sourceKey ?? String(ordinal)
    const key = JSON.stringify(['action-result-v1', this.unitKey, target, output.actionCode, slot])
    const prior = this.prepared.get(key)
    const signature = JSON.stringify(output)
    if (prior) {
      if (prior.output !== signature) throw new ResultContractError('result_key_conflict', output.actionCode, output.statusCode)
      return { key, effective: prior.effective }
    }
    const effective = this.catalog.resolve(output, error, guards)
    // Keep the same key while the INSERT acknowledgement is uncertain. Advancing
    // at prepare time would let a retry increment quota with a different key.
    this.prepared.set(key, { output: signature, effective, slotKey, ...(sourceKey == null ? { nextOrdinal: ordinal + 1 } : {}) })
    return { key, effective }
  }

  record(inputId: string | null, key: string, id: string | null, effective: EffectiveResult): void {
    const target = inputId ?? '0'
    const rows = this.results.get(target) ?? new Map()
    const previous = rows.get(key)
    if (previous && previous.id !== id) throw new ResultContractError('result_key_conflict', '', key)
    rows.set(key, { id, effective })
    this.results.set(target, rows)
    const pending = this.prepared.get(key)
    if (pending?.nextOrdinal !== undefined) this.nextSlots.set(pending.slotKey, Math.max(this.nextSlots.get(pending.slotKey) ?? 0, pending.nextOrdinal))
  }

  target(inputId: string | null) {
    const rows = Array.from(this.results.get(inputId ?? '0')?.values() ?? [])
    return {
      detailIds: rows.flatMap(r => r.id == null ? [] : [r.id]),
      results: rows.map(r => r.effective),
      ...aggregateResultEffects(rows.map(r => r.effective))
    }
  }

  targets(): string[] { return Array.from(this.results.keys()) }
  close(inputId: string | null): void { this.closedTargets.add(inputId ?? '0') }
}

/** Explicit producer contract. A sub-status is never guessed from missing policy. */
export function parseActionResultOutput(value: unknown): ActionResultOutput | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!('statusCode' in row)) return null
  if (typeof row.actionCode !== 'string' || !row.actionCode.trim()
    || typeof row.statusCode !== 'string' || !row.statusCode.trim()
    || (row.subStatusCode != null && (typeof row.subStatusCode !== 'string' || !row.subStatusCode.trim()))
    || (row.errorCode != null && typeof row.errorCode !== 'string')
    || !['not_committed', 'committed', 'unknown'].includes(String(row.operationState))) {
    throw new ResultContractError('output_invalid', String(row.actionCode ?? ''), String(row.statusCode ?? ''))
  }
  return row as unknown as ActionResultOutput
}
