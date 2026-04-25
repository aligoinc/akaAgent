/**
 * Mock window.akabiz API cho preview mode (chạy renderer standalone qua Vite).
 *
 * Tự động kích hoạt khi window.akabiz không tồn tại (= không chạy trong Electron).
 * Trả về fake data để preview UI shape mà không cần Supabase + IPC backend.
 */

interface AnyWindow extends Window {
  akabiz?: unknown
}

const isElectron = (typeof window !== 'undefined') && Boolean((window as AnyWindow).akabiz)

if (!isElectron) {
  console.warn('[mockApi] Running in browser preview mode — IPC backend mocked. Run via Electron for real data.')

  const mockWorkflows = [
    { id: 'wf_demo_1', name: 'FB - Đăng bài lên group', description: 'Demo workflow', is_active: true, is_block: false, current_version: 3, updated_at: new Date().toISOString() },
    { id: 'wf_demo_2', name: 'Telegram - Send notification', description: 'Demo notify workflow', is_active: true, is_block: false, current_version: 1, updated_at: new Date().toISOString() }
  ]
  const mockChannels = [
    { id: 'ch_fb_1', name: 'FB Marketing Acc', channel_type: 'browser_persistent', status: 'idle' },
    { id: '00000000-0000-0000-0000-000000000001', name: 'Headless Node (system)', channel_type: 'headless_node', status: 'idle' }
  ]
  const mockBlocks = [
    { manifestId: 'core.input', name: 'Workflow Input', kind: 'core', runtime: 'control', requires: 'none', ui: { icon: 'LogIn', category: 'workflow', description: 'Entry point' }, inputSchema: [], outputSchema: [], version: '1.0.0' },
    { manifestId: 'core.output', name: 'Workflow Output', kind: 'core', runtime: 'control', requires: 'none', ui: { icon: 'LogOut', category: 'workflow', description: 'Exit point' }, inputSchema: [], outputSchema: [], version: '1.0.0' },
    { manifestId: 'core.click', name: 'Click', kind: 'core', runtime: 'page', requires: 'browser', ui: { icon: 'MousePointerClick', category: 'browser', description: 'Click element' }, inputSchema: [{ name: 'selector', type: 'selector', label: 'Element', required: true }], outputSchema: [], version: '1.0.0' },
    { manifestId: 'core.type', name: 'Type Text', kind: 'core', runtime: 'page', requires: 'browser', ui: { icon: 'Keyboard', category: 'browser', description: 'Type text' }, inputSchema: [{ name: 'selector', type: 'selector', label: 'Element', required: true }, { name: 'text', type: 'string', label: 'Text', required: true }], outputSchema: [], version: '1.0.0' },
    { manifestId: 'core.navigate', name: 'Navigate', kind: 'core', runtime: 'control', requires: 'browser', ui: { icon: 'Globe', category: 'browser', description: 'Navigate URL' }, inputSchema: [{ name: 'url', type: 'string', label: 'URL', required: true }], outputSchema: [], version: '1.0.0' },
    { manifestId: 'core.if', name: 'If / Else', kind: 'core', runtime: 'control', requires: 'none', ui: { icon: 'GitBranch', category: 'control', description: 'Branch on condition' }, inputSchema: [{ name: 'condition', type: 'string', label: 'Condition', required: true }], outputSchema: [], version: '1.0.0' },
    { manifestId: 'core.loop', name: 'Loop', kind: 'core', runtime: 'control', requires: 'none', ui: { icon: 'Repeat', category: 'control', description: 'Loop body' }, inputSchema: [], outputSchema: [], version: '1.0.0' },
    { manifestId: 'core.httpRequest', name: 'HTTP Request', kind: 'core', runtime: 'control', requires: 'none', ui: { icon: 'Globe', category: 'io', description: 'REST API call' }, inputSchema: [{ name: 'url', type: 'string', label: 'URL', required: true }], outputSchema: [], version: '1.0.0' },
    { manifestId: 'core.log', name: 'Log', kind: 'core', runtime: 'control', requires: 'none', ui: { icon: 'FileText', category: 'data', description: 'Emit log' }, inputSchema: [{ name: 'message', type: 'string', label: 'Message', required: true }], outputSchema: [], version: '1.0.0' },
    { manifestId: 'core.delay', name: 'Delay', kind: 'core', runtime: 'control', requires: 'none', ui: { icon: 'Clock', category: 'control', description: 'Sleep ms' }, inputSchema: [{ name: 'ms', type: 'number', label: 'Milliseconds', required: true }], outputSchema: [], version: '1.0.0' }
  ]

  const mockApi = {
    workflows: {
      list: async () => mockWorkflows,
      get: async (id: string) => ({ workflow: mockWorkflows.find(w => w.id === id) ?? mockWorkflows[0], revision: { version: 1, graph: { nodes: [], edges: [] } } }),
      save: async (args: { id: string }) => ({ id: args.id, version: 2 }),
      create: async () => ({ id: 'wf_new_' + Date.now() }),
      delete: async () => ({ ok: true })
    },
    runs: {
      enqueue: async () => ({ runId: 'run_demo_' + Date.now(), status: 'completed' as const, durationMs: 1234, output: { result: 'preview mode' } }),
      list: async () => [
        { id: 'run_1', workflow_id: 'wf_demo_1', workflow_version: 3, channel_id: 'ch_fb_1', status: 'completed', started_at: new Date(Date.now() - 60000).toISOString(), finished_at: new Date(Date.now() - 50000).toISOString(), duration_ms: 10000, error: null },
        { id: 'run_2', workflow_id: 'wf_demo_1', workflow_version: 3, channel_id: 'ch_fb_1', status: 'failed', started_at: new Date(Date.now() - 120000).toISOString(), finished_at: new Date(Date.now() - 115000).toISOString(), duration_ms: 5000, error: 'Element not found' }
      ],
      getSteps: async () => []
    },
    channels: {
      list: async () => mockChannels,
      register: async () => ({ ok: true })
    },
    blocks: {
      list: async () => mockBlocks
    },
    selectors: {
      list: async () => [
        { id: 's1', name: 'fb_group_composer', domain: 'facebook.com', description: 'Ô soạn bài group', selector_type: 'xpath', expression: '//div[@role="textbox"]', fallbacks: null, last_verified_at: null, organization_id: null, created_by: null, created_at: new Date().toISOString(), updated_at: null }
      ],
      getByName: async () => null,
      save: async () => ({ id: 's_new', name: '', domain: null, description: null, selector_type: 'xpath' as const, expression: '', fallbacks: null, last_verified_at: null, organization_id: null, created_by: null, created_at: new Date().toISOString(), updated_at: null }),
      delete: async () => ({ ok: true })
    },
    picker: {
      start: async () => ({ selectorType: 'xpath' as const, expression: '//div[@role="button"]', fallbacks: [], text: 'Demo', tagName: 'div', url: 'https://example.com' }),
      cancel: async () => ({ ok: true })
    },
    datatables: {
      list: async () => [
        { id: 'dt_groups', name: 'FB Groups (demo)', schema: [{ name: 'groupUrl', type: 'string' }, { name: 'content', type: 'string' }], description: '50 group targets', organization_id: null, created_at: new Date().toISOString() }
      ],
      get: async (id: string) => ({ id, name: 'FB Groups (demo)', schema: [], description: null, organization_id: null, created_at: new Date().toISOString() }),
      save: async () => ({ id: 'dt_new', name: '', schema: [], description: null, organization_id: null, created_at: new Date().toISOString() }),
      delete: async () => ({ ok: true }),
      rowsList: async () => [
        { id: 'r1', datatable_id: 'dt_groups', data: { groupUrl: 'https://fb.com/groups/1', content: 'Demo' }, status: 'pending' as const, last_run_id: null, last_run_at: null, retry_count: 0, tags: null, organization_id: null, created_at: new Date().toISOString(), updated_at: null },
        { id: 'r2', datatable_id: 'dt_groups', data: { groupUrl: 'https://fb.com/groups/2', content: 'Demo 2' }, status: 'done' as const, last_run_id: 'run_1', last_run_at: new Date().toISOString(), retry_count: 0, tags: null, organization_id: null, created_at: new Date().toISOString(), updated_at: null }
      ],
      rowSave: async () => ({ id: 'r_new', datatable_id: 'dt_groups', data: {}, status: 'pending' as const, last_run_id: null, last_run_at: null, retry_count: 0, tags: null, organization_id: null, created_at: new Date().toISOString(), updated_at: null }),
      rowDelete: async () => ({ ok: true }),
      rowReset: async () => ({ ok: true })
    },
    triggers: {
      list: async () => [
        { id: 'trg_1', workflow_id: 'wf_demo_1', workflow_version: null, channel_id: 'ch_fb_1', channel_pool: null, channel_assignment: 'round_robin', datatable_id: 'dt_groups', datatable_filter: { where: { status: 'pending' }, limit: 50 }, kind: 'schedule' as const, config: { cron: '0 8 * * *', timezone: 'Asia/Ho_Chi_Minh' }, settings: null, is_active: true, next_run_at: new Date(Date.now() + 86400000).toISOString(), last_run_at: new Date(Date.now() - 86400000).toISOString(), last_run_status: 'completed', consecutive_failures: 0, organization_id: null, created_at: new Date().toISOString() }
      ],
      save: async () => ({ id: 'trg_new', workflow_id: '', workflow_version: null, channel_id: null, channel_pool: null, channel_assignment: null, datatable_id: null, datatable_filter: null, kind: 'manual' as const, config: {}, settings: null, is_active: true, next_run_at: null, last_run_at: null, last_run_status: null, consecutive_failures: 0, organization_id: null, created_at: new Date().toISOString() }),
      delete: async () => ({ ok: true }),
      runNow: async () => ({ ok: true })
    },
    connections: {
      list: async () => [
        { id: 'conn_1', name: 'telegram_bot', conn_type: 'apikey' as const, scope: { account: 'akabiz_bot' }, organization_id: null, created_at: new Date().toISOString() }
      ],
      save: async () => ({ id: 'conn_new', name: '', conn_type: 'apikey' as const, scope: null, organization_id: null, created_at: new Date().toISOString() }),
      delete: async () => ({ ok: true })
    },
    campaignViews: {
      list: async () => [
        { id: 'cv_1', name: 'Marketing tháng 4', description: 'Đăng bài lên 50 group FB hàng ngày', workflow_id: 'wf_demo_1', trigger_id: 'trg_1', datatable_id: 'dt_groups', organization_id: null, created_at: new Date().toISOString() }
      ],
      save: async () => ({ id: 'cv_new', name: '', description: null, workflow_id: null, trigger_id: null, datatable_id: null, organization_id: null, created_at: new Date().toISOString() }),
      delete: async () => ({ ok: true })
    },
    channelsAdmin: {
      save: async () => mockChannels[0],
      delete: async () => ({ ok: true })
    },
    campaignLogs: {
      list: async () => [
        { id: 1, campaign_view_id: 'cv_1', workflow_id: 'wf_demo_1', run_id: 'run_1', datatable_row_id: 'r2', ts: new Date(Date.now() - 60000).toISOString(), level: 'success' as const, icon: '📝', message: 'Đăng bài thành công vào "Cộng đồng A"', meta: { postUrl: 'https://fb.com/post/123' } },
        { id: 2, campaign_view_id: 'cv_1', workflow_id: 'wf_demo_1', run_id: 'run_1', datatable_row_id: 'r2', ts: new Date(Date.now() - 50000).toISOString(), level: 'success' as const, icon: '💬', message: 'Comment: "Inbox tư vấn"', meta: null },
        { id: 3, campaign_view_id: 'cv_1', workflow_id: 'wf_demo_1', run_id: 'run_1', datatable_row_id: 'r2', ts: new Date(Date.now() - 49000).toISOString(), level: 'success' as const, icon: '✅', message: 'Hoàn thành (10000ms)', meta: null }
      ]
    },
    customBlocks: {
      list: async () => [
        { manifest_id: 'user.fb_post_comment', name: 'FB Post Comment', kind: 'composite', runtime: 'composite', requires: 'browser', version: '1.0.0', manifest: { ui: { icon: 'Box', category: 'custom', description: 'Comment vào bài FB' }, inputSchema: [{ name: 'postUrl', type: 'string' }], outputSchema: [{ name: 'success', type: 'boolean' }] }, code: null, workflow_ref: 'wf_demo_2', source: 'user', created_at: new Date().toISOString(), updated_at: null }
      ],
      save: async () => ({ ok: true }),
      delete: async () => ({ ok: true })
    },
    onProgress: () => () => {}
  }

  ;(window as AnyWindow).akabiz = mockApi
}

export {}
