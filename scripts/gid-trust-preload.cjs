// Nạp trước (node -r) cho các bộ kiểm V657 có sẵn: GID_TRUST_PROPOSAL=1 thì sau khi apply V657, fixture nạp thêm SQL đề xuất của
// scripts/build-gid-trust-proposal-sql.cjs (kiểm Global ID theo nguồn gốc dòng zalo_users). Không sửa file kiểm nào.
//   (production đã có V666: thêm SX_WITH_V666=1, SQL đề xuất kiểm md5 thân hàm sau V666)
//   PG_MODULE_DIR=<thư mục có node_modules/pg> SX_WITH_V666=1 GID_TRUST_PROPOSAL=1 LC_ALL=C node -r ./scripts/gid-trust-preload.cjs scripts/send-exclusion-v657-smoke.cjs
'use strict'
const fx = require('./send-exclusion-v657-fixture.cjs')
const orig = fx.buildDb
fx.buildDb = async (...args) => {
  const T = await orig(...args)
  // GID_TRUST_PROPOSAL=1: SQL đề xuất; =migration: file V668 p1 + p2 đúng như apply (scripts/gid-trust-apply-migration.cjs).
  if (process.env.GID_TRUST_PROPOSAL === '1' || process.env.GID_TRUST_PROPOSAL === 'migration') {
    const apply = T.applyV657
    T.applyV657 = async () => {
      await apply()
      if (process.env.GID_TRUST_PROPOSAL === 'migration') await require('./gid-trust-apply-migration.cjs')(T.db)
      else await T.db.query(require('./build-gid-trust-proposal-sql.cjs').sql)
    }
    // Gỡ đề xuất trước (V666 chỉ gỡ khi hàm so khớp đúng bản V666).
    const rollback = T.rollbackV657
    T.rollbackV657 = async () => {
      if (process.env.GID_TRUST_PROPOSAL === 'migration') {
        const fs = require('node:fs'); const path = require('node:path'); const dir = path.join(__dirname, '..', 'migrations')
        await T.db.query(fs.readFileSync(path.join(dir, 'rollback_v668_zalo_users_global_id_guard_p2.sql'), 'utf8'))
        await T.db.query(fs.readFileSync(path.join(dir, 'rollback_v668_zalo_users_global_id_guard_p1.sql'), 'utf8'))
        await T.db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v668_%'`)
      } else await T.db.query(require('./build-gid-trust-proposal-sql.cjs').rollbackSql)
      await rollback()
    }
  }
  return T
}
