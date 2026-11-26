// Nạp trước (node -r) cho các bộ kiểm V657 có sẵn: GID_TRUST_PROPOSAL=1 thì sau khi apply V657, fixture nạp thêm SQL đề xuất của
// scripts/build-gid-trust-proposal-sql.cjs (kiểm Global ID theo nguồn gốc dòng zalo_users). Không sửa file kiểm nào.
//   (production đã có V666: thêm SX_WITH_V666=1, SQL đề xuất kiểm md5 thân hàm sau V666)
//   PG_MODULE_DIR=<thư mục có node_modules/pg> SX_WITH_V666=1 GID_TRUST_PROPOSAL=1 LC_ALL=C node -r ./scripts/gid-trust-preload.cjs scripts/send-exclusion-v657-smoke.cjs
'use strict'
const fx = require('./send-exclusion-v657-fixture.cjs')
const orig = fx.buildDb
fx.buildDb = async (...args) => {
  const T = await orig(...args)
  if (process.env.GID_TRUST_PROPOSAL === '1') {
    const apply = T.applyV657
    T.applyV657 = async () => { await apply(); await T.db.query(require('./build-gid-trust-proposal-sql.cjs').sql) }
    // Gỡ đề xuất trước (V666 chỉ gỡ khi hàm so khớp đúng bản V666).
    const rollback = T.rollbackV657
    T.rollbackV657 = async () => { await T.db.query(require('./build-gid-trust-proposal-sql.cjs').rollbackSql); await rollback() }
  }
  return T
}
