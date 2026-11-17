// Danh mục bước của workflow Facebook chạy bằng engine v2 (V556: auto_engine_block_steps, auto_engine_workflows; phương án mục 3.3).
// Desktop chỉ đọc (SELECT theo RLS của V556). Bản Desktop cũ không đọc hai bảng này.
import { createHash } from 'node:crypto'

export type EngineStepKind = 'delivery' | 'idempotent' | 'result' | 'read' | 'session'
export type EngineCommitLevel = 1 | 2 | 3

export interface EngineBlockStepRow {
  blockId: number
  workflowId: number | null
  nodeId: string | null
  actionCode: string | null
  actionCodeFrom: string | null
  stepKind: EngineStepKind
  commitLevel: EngineCommitLevel
  sendOps: string[]
  resultMode: 'action_result' | 'legacy_output'
  legacyMilestone: string | null
  reviewedCodeMd5: string | null
}

export interface ResolvedEngineStep {
  kind: EngineStepKind
  /** Thao tác của mốc (delivery); null khi không khai được (cấu hình node thiếu khoá action_code_from). */
  actionCode: string | null
  /** Mức cam kết thật sự áp dụng: code block đổi mà chưa duyệt lại (reviewed_code_md5 lệch) thì lùi về 1. */
  commitLevel: EngineCommitLevel
  sendOps: string[]
  resultMode: 'action_result' | 'legacy_output'
  legacyMilestone: string | null
  /** Có dòng danh mục cho block này không (block không có dòng thì engine không coi là mốc gửi). */
  declared: boolean
  /** Code block đã đổi so với lúc duyệt: mức 2/3 bị hạ về 1. */
  downgraded: boolean
}

const KINDS = new Set<EngineStepKind>(['delivery', 'idempotent', 'result', 'read', 'session'])

export function mapEngineBlockStepRow(row: Record<string, unknown>): EngineBlockStepRow | null {
  const blockId = Number(row.block_id)
  const kind = String(row.step_kind ?? '') as EngineStepKind
  if (!Number.isSafeInteger(blockId) || blockId <= 0 || !KINDS.has(kind)) return null
  const level = Number(row.commit_level)
  const sendOps = Array.isArray(row.send_ops) ? (row.send_ops as unknown[]).map(item => String(item)).filter(Boolean) : []
  return {
    blockId,
    workflowId: row.workflow_id == null ? null : Number(row.workflow_id),
    nodeId: row.node_id == null ? null : String(row.node_id),
    actionCode: row.action_code == null ? null : String(row.action_code),
    actionCodeFrom: row.action_code_from == null ? null : String(row.action_code_from),
    stepKind: kind,
    commitLevel: level === 2 || level === 3 ? level : 1,
    sendOps,
    resultMode: row.result_mode === 'legacy_output' ? 'legacy_output' : 'action_result',
    legacyMilestone: row.legacy_milestone == null ? null : String(row.legacy_milestone),
    reviewedCodeMd5: row.reviewed_code_md5 == null ? null : String(row.reviewed_code_md5)
  }
}

export function blockCodeMd5(code: string): string {
  return createHash('md5').update(code, 'utf8').digest('hex')
}

/** Dòng đúng nhất cho một node: (block, workflow, node) → (block, workflow) → (block). */
export function findEngineBlockStep(catalog: readonly EngineBlockStepRow[], blockId: number, workflowId: number | null,
  nodeId: string): EngineBlockStepRow | null {
  let best: EngineBlockStepRow | null = null
  let bestScore = -1
  for (const row of catalog) {
    if (row.blockId !== blockId) continue
    if (row.nodeId !== null && (row.nodeId !== nodeId || row.workflowId !== workflowId)) continue
    if (row.nodeId === null && row.workflowId !== null && row.workflowId !== workflowId) continue
    const score = row.nodeId !== null ? 2 : row.workflowId !== null ? 1 : 0
    if (score > bestScore) { best = row; bestScore = score }
  }
  return best
}

/**
 * Bước của node theo danh mục. Block không có dòng: không phải mốc gửi (kind 'read'), engine chạy như bộ cũ, không ghi dấu. Phương án
 * mục 3.3: "block mới chưa khai thì mặc định mức 1" áp cho block delivery có dòng mà chưa khai cú bấm; block chưa có dòng nào thì do bước
 * duyệt danh mục bắt (script kiểm workflow [engine] mọi block gửi đều có dòng).
 */
export function resolveEngineStep(catalog: readonly EngineBlockStepRow[], input: {
  blockId: number
  workflowId: number | null
  nodeId: string
  config: Record<string, unknown>
  blockCode?: string
}): ResolvedEngineStep {
  const row = findEngineBlockStep(catalog, input.blockId, input.workflowId, input.nodeId)
  if (!row) {
    return { kind: 'read', actionCode: null, commitLevel: 1, sendOps: [], resultMode: 'action_result', legacyMilestone: null,
      declared: false, downgraded: false }
  }
  const fromConfig = row.actionCodeFrom ? input.config[row.actionCodeFrom] : undefined
  const actionCode = typeof fromConfig === 'string' && fromConfig.trim() ? fromConfig.trim() : row.actionCode
  const reviewed = row.reviewedCodeMd5 === null || input.blockCode === undefined || blockCodeMd5(input.blockCode) === row.reviewedCodeMd5
  const commitLevel: EngineCommitLevel = reviewed ? row.commitLevel : 1
  return {
    kind: row.stepKind,
    actionCode,
    commitLevel,
    sendOps: commitLevel === 2 ? row.sendOps : [],
    resultMode: row.resultMode,
    legacyMilestone: row.legacyMilestone,
    declared: true,
    downgraded: !reviewed && row.commitLevel !== 1
  }
}

export interface EngineWorkflowRow { purpose: string; workflowId: number }

export function mapEngineWorkflowRow(row: Record<string, unknown>): EngineWorkflowRow | null {
  const workflowId = Number(row.workflow_id)
  const purpose = String(row.purpose ?? '')
  if (!purpose || !Number.isSafeInteger(workflowId) || workflowId <= 0) return null
  return { purpose, workflowId }
}
