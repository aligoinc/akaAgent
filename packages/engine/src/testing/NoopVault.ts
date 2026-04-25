import type { IConnectionVault } from '../core/IConnectionVault.js'

/**
 * Test-only NoopVault — luôn trả empty secrets, no mask.
 */
export class NoopVault implements IConnectionVault {
  async resolve(_connectionId: string): Promise<Record<string, string>> { return {} }
  async getMaskValuesForRun(_runId: string): Promise<string[]> { return [] }
}
