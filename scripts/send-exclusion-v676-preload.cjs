// Nạp trước (node -r) cho các bộ kiểm loại trừ V657 có sẵn: dựng DB như production 27/11/2026 (V657 + V666 + V668 p1/p2) rồi nạp V676
// đúng như file migration. Không sửa file kiểm nào.
//   PG_MODULE_DIR=<thư mục có node_modules/pg> LC_ALL=C node -r ./scripts/send-exclusion-v676-preload.cjs scripts/send-exclusion-v657-smoke.cjs
'use strict'
process.env.SX_WITH_V666 ??= '1'
process.env.GID_TRUST_PROPOSAL ??= 'migration'
require('./gid-trust-preload.cjs')
const fx = require('./send-exclusion-v657-fixture.cjs')
const V676 = require('./build-v676-sql.cjs')
const orig = fx.buildDb
fx.buildDb = async (...args) => {
  const T = await orig(...args)
  const apply = T.applyV657
  let applied = false
  T.applyV657 = async () => {
    await apply()
    // Bộ kiểm dựng biến thể không có V668 (send-exclusion-gid-trust-smoke: "V657 đang chạy") thì thân hàm không phải bản V676 thay: bỏ qua.
    const now = (await T.db.query(`SELECT md5(pg_get_functiondef(to_regprocedure($1))) m`, [V676.SIG])).rows[0].m
    if (now !== V676.OLD_MD5) return
    applied = true
    const i = V676.migration.lastIndexOf('COMMIT;')
    await T.db.query(V676.migration.slice(0, i) +
      `INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('20261127999990', '${V676.NAME}', '{}');\n` + V676.migration.slice(i))
  }
  const rollback = T.rollbackV657
  T.rollbackV657 = async () => {
    if (applied) {
      await T.db.query(V676.rollback)
      await T.db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE name = $1`, [V676.NAME])
    }
    await rollback()
  }
  return T
}
