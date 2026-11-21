// Kiểm đường đẩy data của chiến dịch tìm data trong bộ lập lịch (V608, docs/FIND_DATA_PUSH_LINKS_V608.md):
// hàm thật của CampaignScheduler (dựng bằng TypeScript từ mã nguồn) gọi hàm DB thật aka_agent_find_data_push_v1 trên Postgres cục bộ.
// Không kết nối production / Facebook.
//   node scripts/find-data-push/app-smoke.cjs            (PGBIN mặc định /usr/lib/postgresql/16/bin)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const PGBIN = process.env.PGBIN || '/usr/lib/postgresql/16/bin'
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

// ---------------------------------------------------------------- Postgres cục bộ
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'find-data-push-'))
fs.chmodSync(work, 0o777)
const port = String(55000 + Math.floor(Math.random() * 900))
const asPg = (bin, args, options = {}) => {
  const command = [path.join(PGBIN, bin), ...args]
  if (isRoot) {
    const quoted = command.map(part => `'${String(part).replace(/'/g, `'\\''`)}'`).join(' ')
    return execFileSync('su', ['postgres', '-s', '/bin/bash', '-c', `LC_ALL=C ${quoted}`], { encoding: 'utf8', ...options })
  }
  return execFileSync(command[0], command.slice(1), { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, ...options })
}
const sqlFile = (name, text) => {
  const file = path.join(work, name)
  fs.writeFileSync(file, text)
  fs.chmodSync(file, 0o644)
  return file
}
let sqlSeq = 0
const psql = (sql) => asPg('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', work, '-p', port,
  '-U', 'postgres', '-d', 'postgres', '-f', sqlFile(`q${sqlSeq++}.sql`, sql)], { stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function startDb() {
  asPg('initdb', ['-D', path.join(work, 'data'), '-U', 'postgres', '-A', 'trust'], { stdio: 'ignore' })
  asPg('pg_ctl', ['-D', path.join(work, 'data'), '-o', `-p ${port} -k ${work}`, '-l', path.join(work, 'log'), 'start', '-w'], { stdio: 'ignore' })
  for (const file of ['scripts/find-data-push/fixture_v608.sql', 'scripts/find-data-push/seed_v608.sql',
    'migrations/migration_v608_find_data_push_links.sql']) {
    psql(fs.readFileSync(path.join(root, file), 'utf8'))
  }
}
function stopDb() {
  try { asPg('pg_ctl', ['-D', path.join(work, 'data'), '-m', 'immediate', 'stop'], { stdio: 'ignore' }) } catch { /* đã dừng */ }
  fs.rmSync(work, { recursive: true, force: true })
}

// ---------------------------------------------------------------- mã thật
function loadTs(relativePath, modules = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(module, module.exports, id => (id in modules ? modules[id] : require(id)))
  return module.exports
}
const findDataPush = loadTs('src/shared/findDataPush.ts')
const phone = loadTs('src/shared/phone.ts')

function loadSchedulerMethods(names, scope) {
  const file = path.join(root, 'src/main/services/campaignScheduler.ts')
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
  const methods = names.map(name => {
    const method = cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)
    assert.ok(method, `thiếu hàm ${name}`)
    return method.getText(source)
  }).join('\n')
  const compiled = ts.transpileModule(`class Harness { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(scope), `${compiled}; return Harness`)(...Object.values(scope))
}
/** Hằng số cấp module của campaignScheduler.ts (đọc từ mã nguồn, không chép tay). */
function loadSchedulerConstants(names) {
  const file = path.join(root, 'src/main/services/campaignScheduler.ts')
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const decls = []
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const decl of statement.declarationList.declarations) {
      if (names.includes(decl.name.getText(source))) decls.push(`const ${decl.getText(source)};`)
    }
  }
  const compiled = ts.transpileModule(`${decls.join('\n')}\nreturn { ${names.join(', ')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  return new Function(compiled)()
}

class FindDataPushError extends Error {
  constructor(message, code) { super(message); this.code = code }
}

const constants = loadSchedulerConstants([
  'FIND_DATA_SEARCH_ACTION_ID', 'FIND_DATA_INTERNAL_LINK_FIELDS', 'FIND_DATA_PUSH_WARNING_INTERVAL_MS',
  'FIND_DATA_PUSH_CHUNK_SIZE', 'FIND_DATA_KIND_LABELS', 'MESSAGE_UID_ACTION_ID'
])
const METHODS = [
  'buildFindDataUidPushItems', 'buildFindDataPostLinkPushItems', 'buildFindDataFacebookGroupPushItems',
  'buildFindDataPhonePushItems', 'buildFindDataZaloGroupLinkPushItems', 'hasFindDataInternalTargets',
  'getFindDataAllowedTargetActionIds', 'callFindDataPush', 'pushFoundDataToLinkedCampaigns', 'logFindDataPushResults',
  'warnFindDataPushTarget', 'getLegacyFindDataTargetBlockReason', 'warnLegacyFindDataTarget',
  'getFindDataConfiguredTargetCampaignIds', 'pushFoundUidsToTargetCampaigns', 'normalizeUidForCompare',
  'normalizeExternalValueForCompare', 'uniqueExternalValues', 'normalizeVietnamMobilePhone', 'getPhoneProfileNameMap',
  'normalizePostLinkForCompare', 'cleanPostLinkForStorage'
]
let entitled = new Set(findDataPush.FIND_DATA_PUSH_TARGET_ACTION_IDS)
const Harness = loadSchedulerMethods(METHODS, {
  ...constants,
  FIND_DATA_PUSH_MAX_ITEMS: findDataPush.FIND_DATA_PUSH_MAX_ITEMS,
  FIND_DATA_PUSH_TARGET_ACTION_IDS: findDataPush.FIND_DATA_PUSH_TARGET_ACTION_IDS,
  formatFindDataPushBlockReason: findDataPush.formatFindDataPushBlockReason,
  FindDataPushError,
  getErrorMessage: error => (error instanceof Error ? error.message : String(error)),
  normalizeSharedVietnamMobilePhone: phone.normalizeVietnamMobilePhone,
  ensureCurrentUserCanUseCampaignAction: async actionId => {
    if (!entitled.has(actionId)) throw new Error('Gói hiện tại không có tính năng này')
  }
})

// Kho giả: gọi hàm DB thật như phiên Desktop của nhân viên 1; getCampaign đọc thẳng bảng.
function makeScheduler(options = {}) {
  const scheduler = new Harness()
  scheduler.running = true
  scheduler.findDataPushWarnings = new Map()
  scheduler.logs = []
  scheduler.broadcasts = []
  scheduler.rpcCalls = []
  scheduler.legacyCalls = 0
  scheduler.logCampaignProgress = async (campaignOrId, message) => {
    scheduler.logs.push({ campaignId: typeof campaignOrId === 'number' ? campaignOrId : campaignOrId.id, message })
  }
  scheduler.broadcastCampaignUpdate = campaign => scheduler.broadcasts.push(campaign.id)
  scheduler.supabase = {
    pushFindDataToLinkedCampaigns: async request => {
      scheduler.rpcCalls.push(request)
      if (options.unavailable) return null
      if (options.failures && options.failures.length > 0) throw options.failures.shift()
      let raw
      try {
        raw = psql(`BEGIN;
SELECT set_config('test.staff_id', '1', true);
SET LOCAL ROLE aka_agent_desktop;
SELECT public.aka_agent_find_data_push_v1($json$${JSON.stringify(request)}$json$::jsonb);
COMMIT;`)
      } catch (error) {
        const text = String(error.stderr || error.message)
        const code = (text.match(/ERROR:\s+([0-9A-Z]{5}):/) || [])[1] || null
        throw new FindDataPushError(text.split('\n')[0], code)
      }
      const line = raw.split('\n').filter(Boolean).pop()
      const parsed = findDataPush.parseFindDataPushResponse(JSON.parse(line))
      assert.ok(parsed, 'kết quả hàm DB đọc được')
      return parsed
    },
    // Như campaignRepository.getCampaign: chỉ chiến dịch của nhân viên đang đăng nhập, kể cả đã xoá.
    getCampaign: async id => {
      const raw = psql(`SELECT row_to_json(c) FROM (SELECT id, name, action_id AS "actionId", is_delete AS "isDelete",
        data_target_source_mode AS "dataTargetSourceMode", status, staff_id AS "staffId" FROM public.auto_campaigns WHERE id = ${Number(id)} AND staff_id = 1) c;`)
      return raw ? JSON.parse(raw) : null
    },
    createCampaignInputDataBatch: async rows => {
      scheduler.legacyCalls += 1
      return rows.length
    },
    reopenCompletedCampaignAfterInputInsert: async () => null
  }
  return scheduler
}

const sourceA = () => JSON.parse(psql(`SELECT row_to_json(c) FROM (SELECT id, name, action_id AS "actionId", extra_settings AS "extraSettings"
  FROM public.auto_campaigns WHERE id = 10) c;`))
const ctx = { sourceDetailId: 900, sourceInputDataId: 901 }
const results = []
const check = (name, fn) => results.push({ name, fn })

check('dựng data gửi lên: bỏ trùng theo khoá, giữ tên', () => {
  const s = makeScheduler()
  const items = s.buildFindDataUidPushItems(['u1', 'U1/', ' u2 ', ''], new Map([['u1', 'Người 1']]))
  assert.deepEqual(items, [{ value: 'u1', key: 'u1', name: 'Người 1' }, { value: 'u2', key: 'u2', name: null }])
  const phones = s.buildFindDataPhonePushItems(['0912 345 678', '+84912345678', 'abc'], [{ phone: '0912345678', name: 'Khách', uid: '', url: '', source: '' }])
  assert.equal(phones.length, 1)
  assert.equal(phones[0].name, 'Khách')
  assert.equal(phones[0].value, phone.normalizeVietnamMobilePhone('0912345678'))
})

check('đẩy qua DB: thêm vào đích, báo đích không nhận được, mở lại đích hoàn thành', async () => {
  const s = makeScheduler()
  const source = sourceA()
  await s.pushFoundDataToLinkedCampaigns(source, 'facebook_uid',
    s.buildFindDataUidPushItems(['u1', 'u2', 'u3'], new Map()), ctx, async () => { throw new Error('không được gọi cách cũ') })
  assert.equal(s.rpcCalls.length, 1)
  assert.deepEqual(s.rpcCalls[0].allowedTargetActionIds, [...findDataPush.FIND_DATA_PUSH_TARGET_ACTION_IDS])
  assert.equal(s.rpcCalls[0].sourceDetailId, 900)
  const messages = s.logs.map(log => log.message)
  assert.ok(messages.includes('✅ Đã đẩy 2 UID sang chiến dịch "Đích UID" (bỏ qua 1 UID đã có ở chiến dịch đó)'), messages.join('\n'))
  assert.ok(s.logs.some(log => log.campaignId === 11 && log.message === '✅ Đã nhận 2 UID từ chiến dịch "Nguồn A"'))
  assert.ok(messages.includes('⚠️ Không đẩy được UID sang chiến dịch "Đích đã xoá": chiến dịch này đã bị xoá. Hãy bỏ chiến dịch này khỏi mục xử lý data tìm được.'))
  assert.ok(messages.includes('⚠️ Không đẩy được UID sang chiến dịch "Đích Nhóm data": chiến dịch này đang chạy bằng Nhóm data. Hãy chọn "Đẩy UID sang Nhóm data" với nhóm của chiến dịch đó.'))
  assert.ok(messages.includes('⚠️ Không đẩy được UID sang chiến dịch #14: không tìm thấy chiến dịch này.'), 'đích của nhân viên khác không lộ tên')
  assert.deepEqual(s.broadcasts, [11], 'đích "hoàn thành" được mở lại và báo giao diện')
  assert.equal(psql('SELECT status FROM public.auto_campaigns WHERE id = 11'), 'chờ xử lý')

  // Lượt sau cùng data: không thêm, không in lại cảnh báo trong một giờ.
  s.logs = []
  await s.pushFoundDataToLinkedCampaigns(source, 'facebook_uid', s.buildFindDataUidPushItems(['u1'], new Map()), ctx, async () => {})
  assert.deepEqual(s.logs.map(log => log.message), ['ℹ️ UID: 1 UID đã có ở chiến dịch "Đích UID" nên không thêm lại.'])
})

check('DB chưa có V608: dùng cách đẩy cũ', async () => {
  const s = makeScheduler({ unavailable: true })
  let legacy = 0
  await s.pushFoundDataToLinkedCampaigns(sourceA(), 'facebook_uid', [{ value: 'u7', key: 'u7' }], ctx, async () => { legacy += 1 })
  assert.equal(legacy, 1)
})

check('cách đẩy cũ: đích đã xoá / chạy bằng Nhóm data thì báo khách, không thêm', async () => {
  const s = makeScheduler({ unavailable: true })
  await s.pushFoundUidsToTargetCampaigns(sourceA(), ['u8'], new Map())
  const messages = s.logs.map(log => log.message)
  assert.ok(messages.some(m => m.startsWith('⚠️ Không đẩy được UID sang chiến dịch "Đích đã xoá": chiến dịch này đã bị xoá')), messages.join('\n'))
  assert.ok(messages.some(m => m.startsWith('⚠️ Không đẩy được UID sang chiến dịch "Đích Nhóm data": chiến dịch này đang chạy bằng Nhóm data')))
  assert.equal(s.legacyCalls, 1, 'chỉ đích 11 hợp lệ được thêm kiểu cũ')
})

check('lỗi tạm thời: thử lại rồi thành công (hàm không thêm trùng)', async () => {
  const s = makeScheduler({ failures: [new FindDataPushError('fetch failed', null)] })
  await s.pushFoundDataToLinkedCampaigns(sourceA(), 'facebook_uid', [{ value: 'u9', key: 'u9' }], ctx, async () => {})
  assert.equal(s.rpcCalls.length, 2)
  assert.ok(s.logs.some(log => log.message.startsWith('✅ Đã đẩy 1 UID sang chiến dịch "Đích UID"')))
})

check('lỗi cố định: không thử lại, báo khách', async () => {
  const s = makeScheduler({ failures: [new FindDataPushError('find_data_push_source_not_found', 'P0002')] })
  await s.pushFoundDataToLinkedCampaigns(sourceA(), 'facebook_uid', [{ value: 'u10', key: 'u10' }], ctx, async () => {})
  assert.equal(s.rpcCalls.length, 1)
  assert.deepEqual(s.logs.map(log => log.message), ['⚠️ Không đẩy được UID sang chiến dịch khác: find_data_push_source_not_found'])
})

check('nhiều data: chia lượt 2.000, cộng kết quả', async () => {
  const s = makeScheduler()
  const items = Array.from({ length: 4500 }, (_, i) => ({ value: `big${i}`, key: `big${i}` }))
  await s.pushFoundDataToLinkedCampaigns(sourceA(), 'facebook_uid', items, ctx, async () => {})
  assert.equal(s.rpcCalls.length, 3)
  assert.ok(s.logs.some(log => log.message === '✅ Đã đẩy 4500 UID sang chiến dịch "Đích UID"'), s.logs.map(l => l.message).join('\n'))
})

check('không bật loại đầu ra hoặc không có đích: không gọi DB', async () => {
  const s = makeScheduler()
  const source = { ...sourceA(), extraSettings: { ...sourceA().extraSettings, isFindUid: false } }
  await s.pushFoundDataToLinkedCampaigns(source, 'facebook_uid', [{ value: 'x', key: 'x' }], ctx, async () => {})
  await s.pushFoundDataToLinkedCampaigns(sourceA(), 'facebook_group', [{ value: 'https://facebook.com/groups/1', key: 'g1' }], ctx, async () => {})
  assert.equal(s.rpcCalls.length, 0)
})

check('gói không có loại đích: DB báo, không thêm', async () => {
  entitled = new Set(['facebook_message_uid'])
  try {
    const s = makeScheduler()
    await s.pushFoundDataToLinkedCampaigns(sourceA(), 'post_link', s.buildFindDataPostLinkPushItems(['https://facebook.com/p/9']), ctx, async () => {})
    assert.ok(s.logs.some(log => log.message === '⚠️ Không đẩy được link bài post sang chiến dịch "Đích comment bài": gói dịch vụ hiện tại không có loại chiến dịch này.'),
      s.logs.map(l => l.message).join('\n'))
  } finally {
    entitled = new Set(findDataPush.FIND_DATA_PUSH_TARGET_ACTION_IDS)
  }
})

check('mã nguồn: nhánh "Tìm data" không đẩy khi engine dừng giữa lúc báo, gửi id dòng "Tìm data"', () => {
  const code = fs.readFileSync(path.join(root, 'src/main/services/campaignScheduler.ts'), 'utf8')
  assert.match(code, /if \(err instanceof ResultContractError \|\| err instanceof FacebookEngineReportStop\) throw err\n\s+console\.error\('Failed log find data:', err\)/)
  assert.match(code, /const pushContext = \{ sourceDetailId: recordedFindDataDetailId,/)
  for (const kind of ['facebook_uid', 'post_link', 'facebook_group', 'phone', 'zalo_group_link']) {
    assert.match(code, new RegExp(`await this\\.pushFoundDataToLinkedCampaigns\\(campaign, '${kind}',`))
  }
})

check('mã nguồn form: chỉ chiến dịch thuộc gói gửi mã gói khi gắn Nhóm data; đích tạo kèm không chạy bằng Nhóm data', () => {
  for (const file of ['CampaignFormModal.tsx', 'CampaignAgentFormModal.tsx']) {
    const code = fs.readFileSync(path.join(root, 'src/renderer/src/components/CampaignPanels', file), 'utf8')
    assert.match(code, /const campaignBundleId = creationBundle && Number\(campaignPayload\.creationBundleId\) === creationBundle\.id/, file)
    assert.match(code, /usesAtomicProvisioningBarrier = campaignPayload\.dataTargetSourceMode === 'data_group' && campaignBundleId !== null/, file)
    assert.match(code, /bundleId: campaignBundleId\n/, file)
    assert.doesNotMatch(code, /bundleId: creationBundle\?\.id \?\? null/, file)
    assert.match(code, /\}, \{ discardOnFailure: true \}\)/, file)
    assert.match(code, /const canUseDataGroupSource = actionSupportsDataGroup\(formData\.actionId\) && !isFindDataTargetDraft/, file)
    assert.match(code, /linkedDraftCampaignIdsRef\.current\?\.requestId === saveRequestId/, file)
  }
})

;(async () => {
  let failed = 0
  try {
    startDb()
    for (const { name, fn } of results) {
      try {
        await fn()
        console.log(`PASS ${name}`)
      } catch (error) {
        failed += 1
        console.log(`FAIL ${name}\n  ${error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n  ') : error}`)
      }
    }
  } finally {
    stopDb()
  }
  console.log(`${results.length - failed}/${results.length} nhóm đạt`)
  process.exit(failed ? 1 : 0)
})()
