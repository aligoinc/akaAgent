// Used to build the data-only migration from a fresh linked-production snapshot
// and to smoke-test the exact graph before applying it. No DOM implementation here.
const PREFIX = 'page_identity_'
const STATE_BLOCK_NAME = 'fb_campaign_page_identity_state'
const STATE_BLOCK_CODE = `
const mode = String(input.pageIdentityStateOperation || '')
if (mode === 'ready' || mode === 'restored') {
  if (input.ok !== true) throw new Error(String(input.message || (mode === 'ready' ? 'Không chuyển được sang Page đã chọn' : 'Không chuyển về được danh tính ban đầu')))
  vars.pageIdentityReady = mode === 'ready'
  return { ok: true, identityName: input.identityName }
}
if (mode === 'capture_result') { vars.pageIdentityResult = { ...input }; delete vars.pageIdentityResult.pageIdentityStateOperation; return vars.pageIdentityResult }
if (mode === 'result') return vars.pageIdentityResult || {}
throw new Error('Cấu hình trạng thái phiên Page không hợp lệ')
`.trim()

function wrapWorkflow(row, blocks) {
  if (row.nodes.some(node => node.id.startsWith(PREFIX))) throw new Error('Workflow already has Page identity nodes')
  const roots = row.nodes.filter(node => !row.edges.some(edge => edge.target === node.id))
  if (roots.length !== 1) throw new Error(`Expected one top-level root for ${row.id}`)
  // Loop-body leaves are executed by the loop executor; never connect them to
  // the top-level restore branch or the engine will absorb cleanup into the loop.
  const bodyIds = new Set()
  const visit = id => {
    if (bodyIds.has(id)) return
    bodyIds.add(id)
    for (const edge of row.edges.filter(edge => edge.source === id)) visit(edge.target)
  }
  for (const node of row.nodes.filter(node => node.systemType === 'loop')) {
    for (const edge of row.edges.filter(edge => edge.source === node.id && edge.sourceHandle === 'body')) visit(edge.target)
  }
  const leaves = row.nodes.filter(node => !bodyIds.has(node.id) && !row.edges.some(edge => edge.source === node.id))
  if (leaves.length !== 1) throw new Error(`Expected one top-level terminal for ${row.id}`)
  const bottom = Math.max(...row.nodes.map(node => node.position.y)) + 260
  const top = Math.min(...row.nodes.map(node => node.position.y)) - 920
  const x = roots[0].position.x
  const node = (id, blockName, config, label, dx, y) => ({ id: PREFIX + id,
    blockId: blocks[blockName], blockName, config, label, position: { x: x + dx, y },
    ...(blockName === 'if_else' ? { systemType: 'ifElse' } : blockName === 'merge' ? { systemType: 'merge' } : {}) })
  const added = [
    node('restore_only', 'if_else', { condition: 'vars.runAsPage === true && vars.pageIdentityRestoreOnly === true' }, 'Chỉ chuyển về danh tính ban đầu?', 0, top),
    node('needs_switch', 'if_else', { condition: 'vars.runAsPage === true && vars.pageIdentityReady !== true' }, 'Cần chuyển sang Page?', 0, top + 130),
    node('original', 'fb_get_current_identity_name', {}, 'Nhớ danh tính ban đầu', -220, top + 260),
    node('switch', 'fb_switch_identity_by_name', { identityNameFromVars: 'runAsPageName' }, 'Chuyển sang Page đã chọn', -220, top + 390),
    node('ready', STATE_BLOCK_NAME, { pageIdentityStateOperation: 'ready' }, 'Kiểm tra đã chuyển Page', -220, top + 520),
    node('enter', 'merge', { mode: 'any' }, 'Chạy hành động chiến dịch', 0, top + 680),
    node('capture_result', STATE_BLOCK_NAME, { pageIdentityStateOperation: 'capture_result' }, 'Giữ kết quả hành động', 0, bottom),
    node('restore_join', 'merge', { mode: 'any' }, 'Kết thúc phần hành động', 400, bottom + 130),
    node('needs_restore', 'if_else', { condition: 'vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)' }, 'Cần chuyển về danh tính ban đầu?', 400, bottom + 260),
    node('restore', 'fb_switch_identity_by_name', { useOriginalIdentity: true }, 'Chuyển về danh tính ban đầu', 180, bottom + 390),
    node('restored', STATE_BLOCK_NAME, { pageIdentityStateOperation: 'restored' }, 'Kiểm tra đã chuyển về', 180, bottom + 520),
    node('result_join', 'merge', { mode: 'any' }, 'Kết thúc phiên Page', 400, bottom + 650),
    node('result', STATE_BLOCK_NAME, { pageIdentityStateOperation: 'result' }, 'Trả kết quả hành động', 400, bottom + 780)
  ]
  const edges = []
  const edge = (source, target, sourceHandle) => edges.push({ id: `e-${source}-${target}${sourceHandle ? '-' + sourceHandle : ''}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) })
  const link = (source, target, handle) => edge(PREFIX + source, PREFIX + target, handle)
  link('restore_only', 'restore_join', 'true'); link('restore_only', 'needs_switch', 'false')
  link('needs_switch', 'original', 'true'); link('needs_switch', 'enter', 'false')
  link('original', 'switch'); link('switch', 'ready'); link('ready', 'enter')
  // The original-name step is also a recovery path if a later prepare step fails.
  link('original', 'restore_join')
  edge(PREFIX + 'enter', roots[0].id)
  edge(leaves[0].id, PREFIX + 'capture_result')
  link('capture_result', 'restore_join'); link('restore_join', 'needs_restore')
  link('needs_restore', 'restore', 'true'); link('needs_restore', 'result_join', 'false')
  link('restore', 'restored'); link('restored', 'result_join'); link('result_join', 'result')
  const schema = [
    ['runAsPage', 'boolean', 'Chạy bằng Page', false], ['runAsPageUid', 'string', 'ID Page', ''],
    ['runAsPageName', 'string', 'Tên Page', ''], ['pageIdentityReady', 'boolean', 'Đã chuyển Page trong lượt', false],
    ['originalIdentityName', 'string', 'Danh tính ban đầu', ''], ['pageIdentityRestoreOnly', 'boolean', 'Chỉ chuyển về danh tính ban đầu', false],
    ['pageIdentityRestoreAfterTarget', 'boolean', 'Chuyển về sau target (chạy thử)', true]
  ]
  return { ...row, nodes: [...row.nodes, ...added], edges: [...row.edges, ...edges],
    variables_schema: [...row.variables_schema, ...schema.map(([name, type, label, value]) => ({ name, type, label, default: value }))],
    default_variables: { ...row.default_variables, ...Object.fromEntries(schema.map(([name, , , value]) => [name, value])) } }
}

module.exports = { PREFIX, STATE_BLOCK_NAME, STATE_BLOCK_CODE, wrapWorkflow }
