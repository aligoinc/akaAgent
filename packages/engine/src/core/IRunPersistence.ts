import type { Run, RunStep, RunStatus } from '../types/Run.js'

/**
 * App layer implement interface này để engine persist runs/steps vào DB.
 * Engine không trực tiếp đụng Supabase — qua interface này.
 *
 * Phase 2 mock: in-memory Map. Phase 6 thật: Supabase repo.
 */
export interface IRunPersistence {
  createRun(run: Run): Promise<void>
  saveStep(step: RunStep): Promise<void>
  finishRun(runId: string, status: RunStatus, output?: Record<string, unknown>, error?: string): Promise<void>
}
