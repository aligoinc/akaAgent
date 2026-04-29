import { IBrowserController } from '../../shared/types'
import { FlowData, ExecutionStep, ExecutionRun, FlowNodeSerialized, FlowEdgeSerialized } from '../../shared/types'
import { builtinActions } from '../../shared/actions'
import { SupabaseService } from '../services/supabase'
import { v4 as uuidv4 } from 'uuid'

type ProgressCallback = (step: ExecutionStep) => void

export class FlowRunner {
  private controller: IBrowserController
  private supabase: SupabaseService
  private onProgress: ProgressCallback
  private cancelled = false
  private nodeOutputs: Map<string, Record<string, unknown>> = new Map()
  private elementMap: Map<string, string> = new Map()
  private edges: FlowEdgeSerialized[] = []
  private nodeMap: Map<string, FlowNodeSerialized> = new Map()
  private loopBodyNodeIds: Set<string> = new Set()
  private ifElseBranchNodeIds: Set<string> = new Set()

  constructor(controller: IBrowserController, supabase: SupabaseService, onProgress: ProgressCallback) {
    this.controller = controller
    this.supabase = supabase
    this.onProgress = onProgress
  }

  stop(): void {
    this.cancelled = true
  }

  async run(flowData: FlowData): Promise<ExecutionRun> {
    this.cancelled = false
    this.nodeOutputs.clear()
    this.elementMap.clear()
    this.loopBodyNodeIds.clear()
    this.ifElseBranchNodeIds.clear()
    this.edges = flowData.edges
    this.nodeMap = new Map(flowData.nodes.map(n => [n.id, n]))

    // Pre-load elements to resolve XPaths
    try {
      const elements = await this.supabase.listElements()
      for (const el of elements) {
        this.elementMap.set(el.id, el.xpath)
      }
    } catch (err) {
      console.warn('Failed to load elements for flow run. XPaths may not resolve.', err)
    }

    const run: ExecutionRun = {
      id: uuidv4(),
      flowId: flowData.id,
      status: 'running',
      input: flowData.variables || {},
      output: {},
      steps: [],
      startedAt: new Date().toISOString()
    }

    try {
      await this.supabase.createRun(run)
    } catch (err) {
      console.warn('Failed to insert initial run log:', err)
    }

    const blockOutputs: Record<string, unknown> = {}

    // Pre-scan: identify all loop body nodes so we can skip them in the main execution
    for (const node of flowData.nodes) {
      if (node.data.actionType === 'loop') {
        const bodyNodes = this.collectLoopBody(node.id)
        for (const id of bodyNodes) {
          this.loopBodyNodeIds.add(id)
        }
      }
    }

    // Pre-scan: identify all ifElse branch nodes so we can skip them in the main execution
    for (const node of flowData.nodes) {
      if (node.data.actionType === 'ifElse') {
        const trueBranch = this.collectBranchNodes(node.id, 'if-true')
        const falseBranch = this.collectBranchNodes(node.id, 'if-false')
        for (const id of [...trueBranch, ...falseBranch]) {
          this.ifElseBranchNodeIds.add(id)
        }
      }
    }

    try {
      // Topological sort of nodes based on edges
      const sortedNodes = this.topologicalSort(flowData.nodes, flowData.edges)

      for (const node of sortedNodes) {
        if (this.cancelled) {
          run.status = 'cancelled'
          break
        }

        // Skip nodes that belong to a loop body or ifElse branch (they are executed by their parent)
        if (this.loopBodyNodeIds.has(node.id) || this.ifElseBranchNodeIds.has(node.id)) {
          continue
        }

        // Skip switch for now (Phase 4+)
        if (node.data.actionType === 'switch') {
          continue
        }

        // Handle ifElse execution
        if (node.data.actionType === 'ifElse') {
          await this.executeIfElse(node, flowData, run, blockOutputs)
          continue
        }

        // Handle loop execution
        if (node.data.actionType === 'loop') {
          const loopResult = await this.executeLoop(node, flowData, run, blockOutputs)
          if (!loopResult) {
            throw new Error(run.error || `Loop execution failed on node ${node.id}`)
          }
          continue
        }

        const step: ExecutionStep = {
          nodeId: node.id,
          actionType: node.data.actionType,
          status: 'running',
          input: {},
          output: {},
          executedAt: new Date().toISOString()
        }

        this.onProgress({ ...step })

        // Resolve input values
        const resolvedInput = this.resolveInputs(node)
        step.input = resolvedInput

        // Execute action
        let result: { success: boolean; output: Record<string, unknown>; error?: string; durationMs?: number; screenshotBase64?: string }

        if (node.data.actionType === 'block') {
          const blockId = String(resolvedInput.blockId)
          const blockFlow = await this.supabase.loadFlow(blockId)
          if (!blockFlow) {
            result = { success: false, output: {}, error: 'Block not found in database', durationMs: 0 }
          } else {
            // Recursively execute block flow
            // Merge parent flow variables so campaign-level data (campaignContent, etc.) passes through
            blockFlow.variables = { ...flowData.variables, ...resolvedInput }
            console.log(`[FlowRunner] Executing block "${blockFlow.name}" (${blockId}) with variables:`, JSON.stringify(blockFlow.variables).substring(0, 300))
            const subRunner = new FlowRunner(this.controller, this.supabase, () => {}) // Sub-progress not emitted to avoid overlapping step UI
            
            const startT = Date.now()
            const subRun = await subRunner.run(blockFlow)
            const durationMs = Date.now() - startT
            
            if (subRun.status === 'completed') {
              result = { success: true, output: subRun.output, durationMs }
            } else {
              result = { success: false, output: subRun.output, error: subRun.error || 'Block execution failed', durationMs }
            }
          }
        } else if (node.data.actionType === 'blockInput') {
          const fieldName = String(node.data.config.fieldName || 'input')
          const defaultValue = node.data.config.defaultValue
          let val = flowData.variables?.[fieldName] ?? defaultValue
          
          // Auto-parse if it's a string that looks like JSON and we expect JSON
          if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
            try { val = JSON.parse(val) } catch {}
          }
          
          result = { success: true, output: { value: val }, durationMs: 0 }
        } else if (node.data.actionType === 'blockOutput') {
          const val = resolvedInput.value
          const fieldName = String(node.data.config.fieldName || 'output')
          blockOutputs[fieldName] = val
          result = { success: true, output: { [fieldName]: val }, durationMs: 0 }
        } else if (node.data.actionType === 'updateCampaignStatus') {
          const detailId = flowData.variables?.detailId as number
          const status = String(resolvedInput.status || 'hoàn thành')
          if (detailId) {
            // detailId here references the data_action.id (kept name for flow JSON compat)
            await this.supabase.updateCampaignDataAction(detailId, { status: status as any })
          }
          result = { success: true, output: { status }, durationMs: 0 }
        } else if (node.data.actionType === 'writeCampaignLog') {
          const campaignId = flowData.variables?.campaignId as number
          const message = String(resolvedInput.message || '')
          if (campaignId && message) {
            await this.supabase.appendCampaignLog(campaignId, message)
          }
          result = { success: true, output: { message }, durationMs: 0 }
        } else {
          result = await this.controller.executeAction(
            node.data.actionType,
            resolvedInput
          )
        }

        step.output = result.output
        step.durationMs = result.durationMs
        step.screenshotUrl = result.screenshotBase64
          ? `data:image/png;base64,${result.screenshotBase64}`
          : undefined

        if (result.success) {
          step.status = 'success'
          this.nodeOutputs.set(node.id, result.output)
        } else {
          step.status = 'error'
          step.error = result.error
        }

        this.onProgress({ ...step })
        run.steps.push(step)

        try {
          await this.supabase.createRunStep(run.id, step)
        } catch (err) {
          console.warn('Failed to insert run step log:', err)
        }

        // Stop on error: log and fail workflow execution
        if (!result.success) {
          const errMsg = `Lỗi ở bước "${node.data.label || node.data.actionType}": ${result.error}`
          console.warn(`Action failed on node ${node.id}.`, result.error)
          throw new Error(errMsg)
        }
      }

      if (run.status === 'running') {
        run.status = 'completed'
      }
    } catch (error) {
      run.status = 'failed'
      run.error = error instanceof Error ? error.message : String(error)
    }

    run.completedAt = new Date().toISOString()

    // Collect final output: prefer block outputs, otherwise fallback to last node
    if (Object.keys(blockOutputs).length > 0) {
      run.output = blockOutputs
    } else {
      const lastStep = run.steps[run.steps.length - 1]
      if (lastStep) {
        run.output = lastStep.output
      }
    }

    try {
      await this.supabase.updateRun(run.id, run.status, run.output, run.error, run.completedAt)
    } catch (err) {
      console.warn('Failed to update run log:', err)
    }

    return run
  }

  /**
   * Collect all nodes in the loop body (connected from the loop node's `loop-body` handle).
   * Stops when it encounters a node that is connected to the loop's `loop-done` handle.
   */
  private collectLoopBody(loopNodeId: string): string[] {
    // Find nodes connected from the `loop-done` handle (these are NOT part of loop body)
    const doneTargetIds = new Set<string>()
    for (const edge of this.edges) {
      if (edge.source === loopNodeId && edge.sourceHandle === 'loop-done') {
        doneTargetIds.add(edge.target)
      }
    }

    // BFS from `loop-body` handle edges
    const bodyNodeIds: string[] = []
    const visited = new Set<string>()
    const queue: string[] = []

    for (const edge of this.edges) {
      if (edge.source === loopNodeId && edge.sourceHandle === 'loop-body') {
        if (!doneTargetIds.has(edge.target)) {
          queue.push(edge.target)
        }
      }
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (visited.has(nodeId) || doneTargetIds.has(nodeId)) continue
      visited.add(nodeId)
      bodyNodeIds.push(nodeId)

      // Follow downstream edges from this node
      for (const edge of this.edges) {
        if (edge.source === nodeId && !visited.has(edge.target) && !doneTargetIds.has(edge.target)) {
          queue.push(edge.target)
        }
      }
    }

    return bodyNodeIds
  }

  /**
   * Collect all downstream nodes from a specific source handle of a node.
   * Used for ifElse branches (if-true / if-false) and similar branching patterns.
   * Collects nodes by BFS, stopping at nodes that are also reachable from sibling handles.
   */
  private collectBranchNodes(nodeId: string, handleId: string): string[] {
    // Find all sibling handle target IDs (nodes reachable from OTHER handles of the same node)
    const siblingTargetIds = new Set<string>()
    const siblingQueue: string[] = []

    for (const edge of this.edges) {
      if (edge.source === nodeId && edge.sourceHandle !== handleId) {
        siblingQueue.push(edge.target)
      }
    }

    while (siblingQueue.length > 0) {
      const nid = siblingQueue.shift()!
      if (siblingTargetIds.has(nid)) continue
      siblingTargetIds.add(nid)

      for (const edge of this.edges) {
        if (edge.source === nid && !siblingTargetIds.has(edge.target)) {
          siblingQueue.push(edge.target)
        }
      }
    }

    // BFS from the specified handle
    const branchNodeIds: string[] = []
    const visited = new Set<string>()
    const queue: string[] = []

    // Exclude convergence nodes (reachable from sibling handles) even at initial push.
    // Those post-ifElse nodes must run in the main loop, not as part of this branch.
    for (const edge of this.edges) {
      if (edge.source === nodeId && edge.sourceHandle === handleId && !siblingTargetIds.has(edge.target)) {
        queue.push(edge.target)
      }
    }

    while (queue.length > 0) {
      const nid = queue.shift()!
      if (visited.has(nid)) continue
      visited.add(nid)
      branchNodeIds.push(nid)

      // Follow downstream edges, but stop at nodes that belong to sibling branches
      for (const edge of this.edges) {
        if (edge.source === nid && !visited.has(edge.target) && !siblingTargetIds.has(edge.target)) {
          queue.push(edge.target)
        }
      }
    }

    return branchNodeIds
  }

  /**
   * Execute an ifElse node: evaluate condition, then execute the matching branch.
   * Handles: 'if-true' for truthy, 'if-false' for falsy.
   */
  private async executeIfElse(
    ifElseNode: FlowNodeSerialized,
    flowData: FlowData,
    run: ExecutionRun,
    blockOutputs: Record<string, unknown>
  ): Promise<void> {
    const resolvedInput = this.resolveInputs(ifElseNode)
    const conditionStr = String(resolvedInput.condition || 'false')

    // Evaluate condition using the same evaluator as while loops
    const conditionResult = this.evaluateCondition(conditionStr)

    // Log the ifElse step
    const ifStep: ExecutionStep = {
      nodeId: ifElseNode.id,
      actionType: 'ifElse',
      status: 'success',
      input: resolvedInput,
      output: { result: conditionResult },
      executedAt: new Date().toISOString()
    }
    this.onProgress({ ...ifStep })
    run.steps.push(ifStep)
    this.nodeOutputs.set(ifElseNode.id, { result: conditionResult })

    try {
      await this.supabase.createRunStep(run.id, ifStep)
    } catch (err) {
      console.warn('Failed to insert ifElse step log:', err)
    }

    // Determine which branch to execute
    const handleId = conditionResult ? 'if-true' : 'if-false'
    const branchNodeIds = this.collectBranchNodes(ifElseNode.id, handleId)

    if (branchNodeIds.length === 0) {
      console.log(`[FlowRunner] ifElse node ${ifElseNode.id} condition=${conditionResult}, no nodes on ${handleId} branch`)
      return
    }

    console.log(`[FlowRunner] ifElse node ${ifElseNode.id} condition=${conditionResult}, executing ${handleId} branch (${branchNodeIds.length} nodes)`)

    // Get branch nodes in topological order
    const allNodes = Array.from(this.nodeMap.values())
    const branchNodes = this.topologicalSort(
      allNodes.filter(n => branchNodeIds.includes(n.id)),
      this.edges.filter(e => branchNodeIds.includes(e.source) && branchNodeIds.includes(e.target))
    )

    // Execute branch nodes (reuse the loop body executor since same logic applies)
    const success = await this.executeLoopBodyNodes(branchNodes, ifElseNode, flowData, run, blockOutputs)
    if (!success) {
      throw new Error(run.error || `ifElse ${handleId} branch failed`)
    }
  }

  /**
   * Execute a loop node: iterate over items, count, or while condition,
   * and execute the loop body nodes for each iteration.
   */
  private async executeLoop(
    loopNode: FlowNodeSerialized,
    flowData: FlowData,
    run: ExecutionRun,
    blockOutputs: Record<string, unknown>
  ): Promise<boolean> {
    const resolvedInput = this.resolveInputs(loopNode)
    const loopType = String(resolvedInput.loopType || 'count')

    // Build loop items based on type
    let items: unknown[] = []

    if (loopType === 'forEach') {
      let rawItems = resolvedInput.items
      // Parse JSON string if needed
      if (typeof rawItems === 'string') {
        try { rawItems = JSON.parse(rawItems) } catch {}
      }
      if (Array.isArray(rawItems)) {
        items = rawItems
      } else {
        // Not a valid array
        const step: ExecutionStep = {
          nodeId: loopNode.id,
          actionType: 'loop',
          status: 'error',
          input: resolvedInput,
          output: {},
          error: `Loop items is not an array. Got: ${typeof rawItems}`,
          executedAt: new Date().toISOString()
        }
        this.onProgress({ ...step })
        run.steps.push(step)
        run.status = 'failed'
        run.error = step.error
        return false
      }
    } else if (loopType === 'count') {
      const count = Number(resolvedInput.count) || 0
      items = Array.from({ length: count }, (_, i) => i)
    }
    // 'while' is handled differently below

    // Emit loop start step
    const loopStep: ExecutionStep = {
      nodeId: loopNode.id,
      actionType: 'loop',
      status: 'running',
      input: resolvedInput,
      output: { totalItems: items.length },
      executedAt: new Date().toISOString()
    }
    this.onProgress({ ...loopStep })

    // Collect loop body node IDs in topological order
    const bodyNodeIds = this.collectLoopBody(loopNode.id)
    const allNodes = Array.from(this.nodeMap.values())
    const bodyNodes = this.topologicalSort(
      allNodes.filter(n => bodyNodeIds.includes(n.id)),
      this.edges.filter(e => bodyNodeIds.includes(e.source) && bodyNodeIds.includes(e.target))
    )

    // Execute iterations
    if (loopType === 'while') {
      // While loop
      let index = 0
      const maxIterations = 10000 // Safety limit
      while (index < maxIterations) {
        if (this.cancelled) {
          run.status = 'cancelled'
          return false
        }

        // Evaluate condition
        const condition = String(resolvedInput.condition || 'false')
        const condResult = this.evaluateCondition(condition)
        if (!condResult) break

        // Set loop output for this iteration
        this.nodeOutputs.set(loopNode.id, { index, iteration: index + 1, item: index, completed: false })

        const success = await this.executeLoopBodyNodes(bodyNodes, loopNode, flowData, run, blockOutputs)
        if (!success) return false

        index++
      }

      this.nodeOutputs.set(loopNode.id, { index: index - 1, iteration: index, item: index - 1, completed: true })
    } else {
      // forEach and count loops
      for (let i = 0; i < items.length; i++) {
        if (this.cancelled) {
          run.status = 'cancelled'
          return false
        }

        const item = items[i]

        // Set loop output for this iteration (child nodes can map from loop node's output)
        this.nodeOutputs.set(loopNode.id, { index: i, iteration: i + 1, item, completed: false })

        const success = await this.executeLoopBodyNodes(bodyNodes, loopNode, flowData, run, blockOutputs)
        if (!success) return false
      }

      const lastIndex = items.length > 0 ? items.length - 1 : 0
      this.nodeOutputs.set(loopNode.id, {
        index: lastIndex,
        iteration: items.length,
        item: items.length > 0 ? items[lastIndex] : null,
        completed: true
      })
    }

    // Mark loop step as success
    loopStep.status = 'success'
    loopStep.output = this.nodeOutputs.get(loopNode.id) || {}
    this.onProgress({ ...loopStep })
    run.steps.push(loopStep)

    try {
      await this.supabase.createRunStep(run.id, loopStep)
    } catch (err) {
      console.warn('Failed to insert loop step log:', err)
    }

    return true
  }

  /**
   * Execute all nodes in the loop body for a single iteration.
   */
  private async executeLoopBodyNodes(
    bodyNodes: FlowNodeSerialized[],
    loopNode: FlowNodeSerialized,
    flowData: FlowData,
    run: ExecutionRun,
    blockOutputs: Record<string, unknown>
  ): Promise<boolean> {
    const skippedNodes = new Set<string>()

    for (const bodyNode of bodyNodes) {
      if (this.cancelled) {
        run.status = 'cancelled'
        return false
      }

      if (skippedNodes.has(bodyNode.id)) {
        continue
      }

      // Nested loops
      if (bodyNode.data.actionType === 'loop') {
        const innerLoopBodyIds = this.collectLoopBody(bodyNode.id)
        innerLoopBodyIds.forEach(id => skippedNodes.add(id))

        const success = await this.executeLoop(bodyNode, flowData, run, blockOutputs)
        if (!success) return false
        continue
      }

      // Handle ifElse in loop body
      if (bodyNode.data.actionType === 'ifElse') {
        const innerBranchIdsTrue = this.collectBranchNodes(bodyNode.id, 'if-true')
        const innerBranchIdsFalse = this.collectBranchNodes(bodyNode.id, 'if-false')
        innerBranchIdsTrue.forEach(id => skippedNodes.add(id))
        innerBranchIdsFalse.forEach(id => skippedNodes.add(id))

        await this.executeIfElse(bodyNode, flowData, run, blockOutputs)
        continue
      }

      // Skip switch in loop body
      if (bodyNode.data.actionType === 'switch') {
        continue
      }

      const step: ExecutionStep = {
        nodeId: bodyNode.id,
        actionType: bodyNode.data.actionType,
        status: 'running',
        input: {},
        output: {},
        executedAt: new Date().toISOString()
      }
      this.onProgress({ ...step })

      const resolvedInput = this.resolveInputs(bodyNode)
      step.input = resolvedInput

      let result: { success: boolean; output: Record<string, unknown>; error?: string; durationMs?: number; screenshotBase64?: string }

      if (bodyNode.data.actionType === 'block') {
        const blockId = String(resolvedInput.blockId)
        const blockFlow = await this.supabase.loadFlow(blockId)
        if (!blockFlow) {
          result = { success: false, output: {}, error: 'Block not found in database', durationMs: 0 }
        } else {
          // Merge parent flow variables so campaign-level data passes through
          blockFlow.variables = { ...flowData.variables, ...resolvedInput }
          const subRunner = new FlowRunner(this.controller, this.supabase, () => {})
          const startT = Date.now()
          const subRun = await subRunner.run(blockFlow)
          const durationMs = Date.now() - startT
          if (subRun.status === 'completed') {
            result = { success: true, output: subRun.output, durationMs }
          } else {
            result = { success: false, output: subRun.output, error: subRun.error || 'Block execution failed', durationMs }
          }
        }
      } else if (bodyNode.data.actionType === 'blockInput') {
        const fieldName = String(bodyNode.data.config.fieldName || 'input')
        const defaultValue = bodyNode.data.config.defaultValue
        let val = flowData.variables?.[fieldName] ?? defaultValue
        if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
          try { val = JSON.parse(val) } catch {}
        }
        result = { success: true, output: { value: val }, durationMs: 0 }
      } else if (bodyNode.data.actionType === 'blockOutput') {
        const val = resolvedInput.value
        const fieldName = String(bodyNode.data.config.fieldName || 'output')
        blockOutputs[fieldName] = val
        result = { success: true, output: { [fieldName]: val }, durationMs: 0 }
      } else if (bodyNode.data.actionType === 'updateCampaignStatus') {
        const detailId = flowData.variables?.detailId as number
        const status = String(resolvedInput.status || 'hoàn thành')
        if (detailId) {
          await this.supabase.updateCampaignDataAction(detailId, { status: status as any })
        }
        result = { success: true, output: { status }, durationMs: 0 }
      } else if (bodyNode.data.actionType === 'writeCampaignLog') {
        const campaignId = flowData.variables?.campaignId as number
        const message = String(resolvedInput.message || '')
        if (campaignId && message) {
          await this.supabase.appendCampaignLog(campaignId, message)
        }
        result = { success: true, output: { message }, durationMs: 0 }
      } else {
        result = await this.controller.executeAction(
          bodyNode.data.actionType,
          resolvedInput
        )
      }

      step.output = result.output
      step.durationMs = result.durationMs
      step.screenshotUrl = result.screenshotBase64
        ? `data:image/png;base64,${result.screenshotBase64}`
        : undefined

      if (result.success) {
        step.status = 'success'
        this.nodeOutputs.set(bodyNode.id, result.output)
      } else {
        step.status = 'error'
        step.error = result.error
      }

      this.onProgress({ ...step })
      run.steps.push(step)

      try {
        await this.supabase.createRunStep(run.id, step)
      } catch (err) {
        console.warn('Failed to insert run step log:', err)
      }

      if (!result.success) {
        run.status = 'failed'
        run.error = result.error
        return false
      }
    }

    return true
  }

  /**
   * Simple condition evaluator for while loops and ifElse.
   * Replaces {{nodeId.field}} with actual values from nodeOutputs.
   * Node IDs can contain hyphens (e.g. node-input-images).
   */
  private evaluateCondition(condition: string): boolean {
    try {
      // Replace {{nodeId.field}} patterns — nodeId can contain hyphens
      const resolved = condition.replace(/\{\{([\w-]+)\.([\w-]+)\}\}/g, (_, nodeId, field) => {
        const output = this.nodeOutputs.get(nodeId)
        if (output && field in output) {
          const val = output[field]
          return JSON.stringify(val)
        }
        return 'undefined'
      })

      // eslint-disable-next-line no-eval
      return !!eval(resolved)
    } catch {
      return false
    }
  }

  private resolveInputs(node: FlowNodeSerialized): Record<string, unknown> {
    const config = { ...node.data.config }
    const mapping = node.data.inputMapping || {}

    // Override config values with mapped values from previous node outputs
    for (const [inputField, source] of Object.entries(mapping)) {
      const sourceOutput = this.nodeOutputs.get(source.sourceNodeId)
      if (sourceOutput && source.sourceField in sourceOutput) {
        let value = sourceOutput[source.sourceField]
        
        // Handle nested paths for JSON objects
        if (source.sourcePath) {
          // If value is a string that looks like JSON, try to parse it before resolving path
          if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
            try { value = JSON.parse(value) } catch {}
          }

          if (value && typeof value === 'object') {
            const nested = this.getNestedValue(value, source.sourcePath)
            value = nested !== undefined ? nested : ''
          } else {
            // Path was specified but value is a primitive string. Just use the original string.
            // This handles cases where older visual flows added sourcePath="content" to plain strings.
            // i.e., fallback to the full primitive value.
          }
        }
        
        config[inputField] = value ?? ''
      } else {
        console.log(`[FlowRunner] mapping source ${source.sourceNodeId}.${source.sourceField} NOT FOUND for field ${inputField}`)
      }
    }

    console.log(`[FlowRunner] node ${node.data.actionType} (${node.id}) resolved inputs:`, config)

    // Resolve Element IDs to XPaths and perform {{var}} string interpolation
    const actionDef = builtinActions.find(a => a.type === node.data.actionType)
    if (actionDef) {
      for (const field of actionDef.inputSchema) {
        if (typeof config[field.name] === 'string') {
          let strVal = config[field.name] as string

          // 1. Resolve Element IDs to XPaths
          if (field.type === 'element') {
            const xpath = this.elementMap.get(strVal)
            if (xpath) strVal = xpath
          }

          // 2. String interpolation for {{nodeId.field}}
          // Arrays/objects → JSON.stringify so they stay valid as JS literals (for ifElse / loop conditions)
          // and as serialized text for display. Primitives use String() so plain interpolation
          // like "Đã đăng: {{node.value}}" doesn't add extra quotes.
          strVal = strVal.replace(/\{\{([\w-]+)\.([\w-]+)\}\}/g, (match, srcNodeId, srcField) => {
            const output = this.nodeOutputs.get(srcNodeId)
            if (output && srcField in output) {
              const val = output[srcField]
              if (val !== null && typeof val === 'object') {
                return JSON.stringify(val)
              }
              return String(val)
            }
            return match // leave unresolved
          })

          config[field.name] = strVal
        }
      }
    }

    return config
  }

  private topologicalSort(
    nodes: FlowNodeSerialized[],
    edges: FlowEdgeSerialized[]
  ): FlowNodeSerialized[] {
    const nodeMap = new Map(nodes.map(n => [n.id, n]))
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()

    for (const node of nodes) {
      inDegree.set(node.id, 0)
      adjacency.set(node.id, [])
    }

    for (const edge of edges) {
      adjacency.get(edge.source)?.push(edge.target)
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1)
    }

    const queue: string[] = []
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id)
    }

    const sorted: FlowNodeSerialized[] = []
    while (queue.length > 0) {
      const id = queue.shift()!
      const node = nodeMap.get(id)
      if (node) sorted.push(node)

      for (const neighbor of (adjacency.get(id) || [])) {
        const newDeg = (inDegree.get(neighbor) || 0) - 1
        inDegree.set(neighbor, newDeg)
        if (newDeg === 0) queue.push(neighbor)
      }
    }

    return sorted
  }

  private getNestedValue(obj: any, path: string): any {
    if (!path || !path.trim()) return obj
    return path.split('.').reduce((acc, part) => {
      const key = part.trim()
      if (acc && typeof acc === 'object' && key in acc) {
        return acc[key]
      }
      return undefined
    }, obj)
  }
}

