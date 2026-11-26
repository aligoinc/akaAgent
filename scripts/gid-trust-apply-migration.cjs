// Nạp V668 p1 + p2 (file migration đúng như sẽ apply) vào DB thử đã có V657 (+ V666): dòng sổ chèn trước COMMIT như
// make-migration-ledger-apply.cjs; tắt trigger p1 để bộ kiểm còn dựng được dữ liệu cũ ghi sai (trigger kiểm riêng ở
// zalo-users-gid-guard-smoke.cjs). Dùng bởi gid-trust-preload.cjs / send-exclusion-gid-trust-smoke.cjs khi GID_TRUST_PROPOSAL=migration.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ROOT = path.resolve(__dirname, '..')
module.exports = async function applyV668(db) {
  for (const [part, version] of [['p1', '20261126113403'], ['p2', '20261126999997']]) {
    const name = `migration_v668_zalo_users_global_id_guard_${part}`
    const text = fs.readFileSync(path.join(ROOT, 'migrations', name + '.sql'), 'utf8')
    const i = text.lastIndexOf('COMMIT;')
    await db.query(text.slice(0, i) + `INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('${version}', '${name}', '{}');\n` + text.slice(i))
    if (part === 'p1') {
      await db.query('ALTER TABLE public.zalo_users DISABLE TRIGGER trg_zalo_users_guard_global_id_ins')
      await db.query('ALTER TABLE public.zalo_users DISABLE TRIGGER trg_zalo_users_guard_global_id_upd')
    }
  }
}
