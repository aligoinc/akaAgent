// Đồng bộ lõi engine kết quả v2 từ akaAgent sang akaAgentChatApi (workspace @aka-agent-chat/campaign-engine).
// Nguồn duy nhất là akaAgent: mã lõi, migration V495/V497 và fixture danh mục được chép NGUYÊN VĂN, kèm SOURCE.json
// (sha256 từng file). Phía ChatApi có vendor.test.ts so sha256 nên mọi sửa tay ở đó đều làm test đỏ.
//
//   node scripts/sync-campaign-engine.cjs --to /đường/dẫn/akaAgentChatApi        # chép + ghi manifest
//   node scripts/sync-campaign-engine.cjs --to /đường/dẫn/akaAgentChatApi --check  # chỉ kiểm, thoát 1 nếu lệch
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const toIndex = args.indexOf('--to')
const target = toIndex >= 0 ? path.resolve(args[toIndex + 1] || '') : null
const checkOnly = args.includes('--check')
if (!target || !fs.existsSync(path.join(target, 'package.json'))) {
  console.error('Dùng: node scripts/sync-campaign-engine.cjs --to <akaAgentChatApi> [--check]')
  process.exit(2)
}
const DEST = path.join(target, 'packages/campaign-engine')

const listFiles = dir => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)])
/** Cặp [nguồn trong akaAgent, đích tương đối trong packages/campaign-engine]. */
const pairs = [
  ...listFiles(path.join(ROOT, 'packages/campaign-engine/src')).filter(f => f.endsWith('.ts'))
    .map(f => [f, path.join('src', path.relative(path.join(ROOT, 'packages/campaign-engine/src'), f))]),
  [path.join(ROOT, 'migrations/migration_v495_campaign_outcome_engine.sql'), 'sql/migration_v495_campaign_outcome_engine.sql'],
  [path.join(ROOT, 'migrations/rollback_v495_campaign_outcome_engine.sql'), 'sql/rollback_v495_campaign_outcome_engine.sql'],
  // V497 (định tuyến tài khoản Server theo cờ): ChatApi dựng fixture test từ chính hàm/bảng trong file này.
  [path.join(ROOT, 'migrations/migration_v497_zalo_server_flag_route.sql'), 'sql/migration_v497_zalo_server_flag_route.sql'],
  [path.join(ROOT, 'migrations/rollback_v497_zalo_server_flag_route.sql'), 'sql/rollback_v497_zalo_server_flag_route.sql'],
  // V499 (nhớ theo tài khoản), V500 (chính sách đã duyệt), V501 (lịch chạy, kết thúc lượt), V503 (gửi dạng chia sẻ theo lô),
  // V504 (loại trừ gửi), V505 (lấy data đầu lượt), V506 (group thời gian thực, kiêm SMS), V507 (bỏ nhớ mục tiêu theo tài khoản),
  // V508 (126/127 nhắn group: group chặn riêng tài khoản), V509 (112 nhắn người lạ / bạn bè như 118), V512 (luật tín hiệu lệnh Fly):
  // fixture test của ChatApi apply đủ chuỗi V495 → V499 → … → V509 → V512 như production (V510, V511 không thuộc engine).
  ...['v499_target_memory_per_account', 'v500_zalo_error_policies', 'v501_engine_schedule_completion',
    'v503_engine_share_batch', 'v504_engine_send_exclusion', 'v505_engine_materialize', 'v506_engine_realtime_sms',
    'v507_engine_drop_target_memory', 'v508_zalo_group_126_127_per_group', 'v509_zalo_personal_112_too_long',
    'v512_fly_command_signal_rules'].flatMap(name => [
    [path.join(ROOT, `migrations/migration_${name}.sql`), `sql/migration_${name}.sql`],
    [path.join(ROOT, `migrations/rollback_${name}.sql`), `sql/rollback_${name}.sql`]
  ]),
  [path.join(ROOT, 'scripts/fixtures/campaign-outcome-engine/akachat-catalog-20261106.json'), 'fixtures/akachat-catalog-20261106.json']
].sort((a, b) => a[1].localeCompare(b[1]))
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const git = (...a) => { const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null }
const dirty = (git('status', '--porcelain', '--', 'packages/campaign-engine', 'migrations/migration_v495_campaign_outcome_engine.sql',
  'migrations/rollback_v495_campaign_outcome_engine.sql', 'migrations/migration_v497_zalo_server_flag_route.sql',
  'migrations/rollback_v497_zalo_server_flag_route.sql', 'migrations/migration_v499_target_memory_per_account.sql',
  'migrations/migration_v500_zalo_error_policies.sql', 'migrations/migration_v501_engine_schedule_completion.sql',
  'migrations/migration_v503_engine_share_batch.sql', 'migrations/rollback_v503_engine_share_batch.sql',
  'migrations/migration_v504_engine_send_exclusion.sql', 'migrations/rollback_v504_engine_send_exclusion.sql',
  'migrations/migration_v505_engine_materialize.sql', 'migrations/rollback_v505_engine_materialize.sql',
  'migrations/migration_v506_engine_realtime_sms.sql', 'migrations/rollback_v506_engine_realtime_sms.sql',
  'migrations/migration_v507_engine_drop_target_memory.sql', 'migrations/rollback_v507_engine_drop_target_memory.sql',
  'migrations/migration_v508_zalo_group_126_127_per_group.sql', 'migrations/rollback_v508_zalo_group_126_127_per_group.sql',
  'migrations/migration_v509_zalo_personal_112_too_long.sql', 'migrations/rollback_v509_zalo_personal_112_too_long.sql',
  'migrations/migration_v512_fly_command_signal_rules.sql', 'migrations/rollback_v512_fly_command_signal_rules.sql',
  'scripts/fixtures/campaign-outcome-engine') || '') !== ''
const manifest = {
  note: 'Chép nguyên văn từ akaAgent bằng scripts/sync-campaign-engine.cjs. Không sửa ở đây: sửa ở akaAgent rồi đồng bộ lại.',
  sourceRepo: 'aligoinc/akaAgent',
  sourceCommit: git('rev-parse', 'HEAD'),
  sourceDirty: dirty,
  files: Object.fromEntries(pairs.map(([src, rel]) => [rel.split(path.sep).join('/'), sha(src)]))
}

if (checkOnly) {
  const current = fs.existsSync(path.join(DEST, 'SOURCE.json')) ? JSON.parse(fs.readFileSync(path.join(DEST, 'SOURCE.json'), 'utf8')) : null
  const drift = []
  for (const [rel, hash] of Object.entries(manifest.files)) {
    const file = path.join(DEST, rel)
    if (!fs.existsSync(file)) drift.push(`thiếu ${rel}`)
    else if (sha(file) !== hash) drift.push(`khác nguồn ${rel}`)
    if (current && current.files?.[rel] !== hash) drift.push(`manifest cũ ${rel}`)
  }
  if (drift.length) { console.error(drift.join('\n')); process.exit(1) }
  console.log(`Khớp nguồn: ${Object.keys(manifest.files).length} file`)
  process.exit(0)
}

// Dọn cả ba thư mục chép: file đổi tên ở nguồn (vd migration đổi số) không được sót lại bản cũ.
for (const dir of ['src', 'sql', 'fixtures']) fs.rmSync(path.join(DEST, dir), { recursive: true, force: true })
for (const [src, rel] of pairs) {
  fs.mkdirSync(path.dirname(path.join(DEST, rel)), { recursive: true })
  fs.copyFileSync(src, path.join(DEST, rel))
}
fs.writeFileSync(path.join(DEST, 'SOURCE.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Đã chép ${pairs.length} file vào ${path.relative(process.cwd(), DEST) || DEST}${dirty ? ' (nguồn chưa commit)' : ''}`)
