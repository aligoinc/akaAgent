import type { Run, RunStep, RunStatus } from '../types/Run.js'
import type { IRunPersistence } from '../core/IRunPersistence.js'

/**
 * Test-only InMemoryPersistence — store runs/steps trong Map cho unit test.
 * KHÔNG dùng prod.
 */
export class InMemoryPersistence implements IRunPersistence {
  public runs = new Map<string, Run>()
  public steps: RunStep[] = []

  async createRun(run: Run): Promise<void> {
    this.runs.set(run.id, { ...run })
  }

  async saveStep(step: RunStep): Promise<void> {
    this.steps.push({ ...step })
  }

  async finishRun(runId: string, status: RunStatus, output?: Record<string, unknown>, error?: string): Promise<void> {
    const run = this.runs.get(runId)
    if (!run) return
    run.status = status
    if (output !== undefined) run.output = output
    if (error !== undefined) run.error = error
    run.finishedAt = new Date().toISOString()
    if (run.startedAt) run.durationMs = Date.now() - new Date(run.startedAt).getTime()
  }

  stepsForRun(runId: string): RunStep[] {
    return this.steps.filter(s => s.runId === runId)
  }
}
