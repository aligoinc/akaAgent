import type { WorkflowNode, WorkflowEdge } from '../types/Workflow.js'

/**
 * Topological sort cho graph nodes + edges. Phase 2 dùng cho preflight check
 * (detect cycles), runtime execution dùng ActivationQueue (event-driven).
 *
 * Throw nếu phát hiện cycle.
 */
export function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const adj = new Map<string, string[]>()
  const inDegree = new Map<string, number>()

  for (const n of nodes) {
    adj.set(n.id, [])
    inDegree.set(n.id, 0)
  }

  for (const e of edges) {
    if (!adj.has(e.source) || !inDegree.has(e.target)) continue
    adj.get(e.source)!.push(e.target)
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id)
  }

  const sorted: WorkflowNode[] = []
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  while (queue.length > 0) {
    const id = queue.shift()!
    const node = nodeMap.get(id)
    if (node) sorted.push(node)

    for (const next of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, newDeg)
      if (newDeg === 0) queue.push(next)
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error(`Workflow graph has a cycle (sorted ${sorted.length}/${nodes.length} nodes)`)
  }

  return sorted
}

/**
 * Tìm các node "entry" (không có incoming edge nào).
 * Thường là core.input hoặc node đầu tiên.
 */
export function findEntryNodes(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const hasIncoming = new Set(edges.map(e => e.target))
  return nodes.filter(n => !hasIncoming.has(n.id))
}

/**
 * Lookup map nodes by id.
 */
export function buildNodeMap(nodes: WorkflowNode[]): Map<string, WorkflowNode> {
  return new Map(nodes.map(n => [n.id, n]))
}

/**
 * Lookup map edges grouped by source nodeId + sourceHandle.
 * key = `${sourceId}::${sourceHandle ?? 'main'}`
 */
export function buildOutgoingEdgeMap(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const map = new Map<string, WorkflowEdge[]>()
  for (const e of edges) {
    const handle = e.sourceHandle ?? 'main'
    const key = `${e.source}::${handle}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e)
  }
  return map
}

/**
 * Edges incoming theo target node.
 */
export function buildIncomingEdgeMap(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const map = new Map<string, WorkflowEdge[]>()
  for (const e of edges) {
    if (!map.has(e.target)) map.set(e.target, [])
    map.get(e.target)!.push(e)
  }
  return map
}
