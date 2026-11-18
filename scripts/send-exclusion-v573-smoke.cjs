#!/usr/bin/env node
// Kiểm V573 trên PostgreSQL 17 cục bộ với thân 4 hàm loại trừ đang chạy trên production (đọc 18/11/2026) và dữ liệu giả
// dựng theo ca thật (chiến dịch 48267: nhóm loại trừ còn chọn 2 tag Zalo khách đã xoá). Không chạm DB thật.
// Chạy: node scripts/send-exclusion-v573-smoke.cjs   (cần postgresql@17 Homebrew và module pg của akaAgentChatApi, xem pg-fixture.cjs)
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')

const ROOT = path.resolve(__dirname, '..')
const LIVE = require('./fixtures/send-exclusion-v573/live-20261118.json')
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/migration_v573_send_exclusion_deleted_zalo_tags.sql'), 'utf8')
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'migrations/rollback_v573_send_exclusion_deleted_zalo_tags.sql'), 'utf8')
const SCHEMA = fs.readFileSync(path.join(__dirname, 'fixtures/send-exclusion-schema.sql'), 'utf8')
const FN = 'aka_agent_internal_validate_send_exclusion_rules'
const md5 = text => crypto.createHash('md5').update(text).digest('hex')

let passed = 0
const ok = (name) => { passed += 1; console.log(`  ✓ ${name}`) }

async function main() {
  const cluster = startCluster({ port: 55473, label: 'aka-v573-' })
  const db = await cluster.connect()
  try {
    await db.query(SCHEMA)
    await db.query(`
      CREATE TABLE public.auto_filter_fields (id bigint PRIMARY KEY, code text, options_source text, is_active boolean);
      CREATE TABLE public.auto_filter_operators (id bigint PRIMARY KEY, code text, is_active boolean);
      CREATE TABLE public.auto_filter_field_operators (field_id bigint, operator_id bigint, value_type text, min_values int, max_values int, validation_config jsonb);
      CREATE TABLE public.auto_filter_field_options (field_id bigint, code text, label text, value jsonb, is_active boolean);
      CREATE TABLE public.auto_campaign_send_exclusion_groups (id bigint PRIMARY KEY, staff_id bigint, organization_id bigint, account_id bigint,
        name text, match_mode text, revision bigint, create_request_id uuid, is_delete boolean DEFAULT false);
      CREATE TABLE public.auto_campaign_send_exclusion_rules (id bigserial PRIMARY KEY, group_id bigint, field_id bigint, operator_id bigint,
        value jsonb, is_enabled boolean, sort_order int);
      CREATE UNIQUE INDEX uq_auto_account_contacts_account_type_uid ON public.auto_account_contacts (account_id, contact_type, uid);`)
    const cat = LIVE.catalog
    for (const f of cat.fields) await db.query('INSERT INTO auto_filter_fields VALUES ($1,$2,$3,$4)', [f.id, f.code, f.options_source, f.is_active])
    for (const o of cat.operators) await db.query('INSERT INTO auto_filter_operators VALUES ($1,$2,$3)', [o.id, o.code, o.is_active])
    for (const m of cat.fieldOperators) await db.query('INSERT INTO auto_filter_field_operators VALUES ($1,$2,$3,$4,$5,$6)',
      [m.field_id, m.operator_id, m.value_type, m.min_values, m.max_values, JSON.stringify(m.validation_config ?? {})])
    for (const o of cat.fieldOptions) await db.query('INSERT INTO auto_filter_field_options VALUES ($1,$2,$3,$4,$5)', [o.field_id, o.code, o.label, JSON.stringify(o.value), o.is_active])
    await db.query(`INSERT INTO category_type(id,namespace,code) VALUES (1,'common','zalo_friend_status')`)
    for (const [i, s] of cat.friendStatus.entries()) await db.query('INSERT INTO category_item(id,category_type_id,code,name,is_active) VALUES ($1,1,$2,$3,$4)', [i + 1, s.code, s.name, s.is_active])
    // Ca thật: tài khoản 100 có tag Zalo 1..8, khách xoá 2/4/5 trong Zalo (đồng bộ đánh is_delete), tạo mới 8.
    // Tài khoản 200 (nhân viên khác cùng tổ chức) có tag 9 đã xoá: không được tính là tag của tài khoản 100.
    await db.query(`INSERT INTO auto_accounts(id,staff_id,organization_id,flatform_type,is_delete) VALUES (100,1,10,'zalo',false),(200,2,10,'zalo',false);
      INSERT INTO auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,uid,name,is_delete)
        SELECT n, 100, 1, 10, 'zalo_tag', n::text, 'tag '||n, n IN (2,4,5) FROM generate_series(1,8) n;
      INSERT INTO auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,uid,name,is_delete) VALUES (9,200,2,10,'zalo_tag','9','tag 9',true);
      INSERT INTO auto_contact_tags(id,name,is_delete,staff_id,organization_id,auto_account_id) VALUES (289,'a',false,1,10,NULL),(297,'b',false,1,10,NULL),(300,'c',true,1,10,NULL);`)
    const fields = Object.fromEntries(cat.fields.map(f => [f.code, f.id]))
    const ops = Object.fromEntries(cat.operators.map(o => [o.code, o.id]))
    const rule = (code, op, value, isEnabled = true, sortOrder = 0) => ({ fieldId: fields[code], operatorId: ops[op], value, isEnabled, sortOrder })
    // Đúng hình dạng nhóm 46 trên production (giá trị, toán tử, bật/tắt).
    const realRules = [rule('zalo_friend_status', 'equals', 'friend', false, 10), rule('zalo_tag', 'contains', ['3', '6', '2', '1', '5'], true, 20),
      rule('akabiz_tag', 'contains', ['289', '297'], true, 30), rule('recent_delivery', Object.keys(ops).find(k => cat.fieldOperators.some(m => m.field_id === fields.recent_delivery && m.operator_id === ops[k])), 2, false, 40)]
    await db.query(`INSERT INTO auto_campaign_send_exclusion_groups(id,staff_id,organization_id,account_id,name,match_mode,revision) VALUES (46,1,10,100,'Khách đã gửi tin lần 1','and',5)`)
    for (const r of realRules) await db.query('INSERT INTO auto_campaign_send_exclusion_rules(group_id,field_id,operator_id,value,is_enabled,sort_order) VALUES (46,$1,$2,$3,$4,$5)',
      [r.fieldId, r.operatorId, JSON.stringify(r.value), r.isEnabled, r.sortOrder])

    // Thân hàm production, quyền như production (chỉ postgres EXECUTE).
    for (const [name, fn] of Object.entries(LIVE.functions)) {
      await db.query(fn.def)
      const { rows: [{ sig }] } = await db.query(`SELECT p.oid::regprocedure::text AS sig FROM pg_proc p WHERE p.proname = $1`, [name])
      await db.query(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC`)
      const { rows: [{ m }] } = await db.query('SELECT md5(pg_get_functiondef(p.oid)) AS m FROM pg_proc p WHERE p.proname = $1', [name])
      assert.equal(m, fn.md5, `${name}: thân dựng lại phải trùng md5 production`)
    }
    ok('4 hàm dựng lại trùng md5 production')

    const rules = (value, account = 100, staff = 1, org = 10) =>
      db.query(`SELECT public.${FN}($1::jsonb,$2,$3,$4)`, [JSON.stringify(value), staff, org, account])
    const selection = (map, account = 100) =>
      db.query('SELECT public.aka_agent_internal_validate_send_exclusion_selection($1::jsonb,1,10,$2)', [JSON.stringify(map), account])
    const fnMd5 = async () => (await db.query('SELECT md5(pg_get_functiondef(p.oid)) AS m FROM pg_proc p WHERE p.proname = $1', [FN])).rows[0].m

    // Trước V573: tái hiện đúng lỗi production.
    await assert.rejects(rules(realRules), /send_exclusion_option_unavailable/)
    await assert.rejects(selection({ 100: { groupId: 46, blocklistIds: [] } }), /send_exclusion_option_unavailable/)
    ok('trước V573: nhóm 46 bị chặn send_exclusion_option_unavailable (đúng lỗi production)')

    // Sổ migration đã có v573 thì không chạy.
    await db.query(`CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text, name text);
      INSERT INTO supabase_migrations.schema_migrations VALUES ('1','migration_v573_khac')`)
    await assert.rejects(db.query(MIGRATION), /sổ migration đã có một bản v573/)
    await db.query('ROLLBACK').catch(() => {})
    await db.query('DELETE FROM supabase_migrations.schema_migrations')
    assert.equal(await fnMd5(), LIVE.functions[FN].md5)
    ok('sổ đã có v573 thì migration từ chối, hàm giữ nguyên')

    await db.query(MIGRATION)
    const builder = require('./build-v573-sql.cjs')
    assert.equal(await fnMd5(), builder.NEW_MD5, 'md5 sau migration trùng md5 bộ sinh tính')
    const { rows: [meta] } = await db.query(`SELECT pg_get_userbyid(proowner) AS owner, proacl::text AS acl, prosecdef, proconfig FROM pg_proc WHERE proname = $1`, [FN])
    assert.deepEqual([meta.owner, meta.acl, meta.prosecdef, meta.proconfig], ['postgres', '{postgres=X/postgres}', true, ['search_path=pg_catalog, public']])
    ok('migration chạy được; md5, owner, quyền, SECURITY DEFINER, search_path đúng')

    await rules(realRules)
    await selection({ 100: { groupId: 46, blocklistIds: [] } })
    ok('sau V573: nhóm 46 qua cả kiểm rule lẫn kiểm cấu hình chiến dịch (đường snapshot / engine / trigger lưu)')
    await rules([rule('zalo_tag', 'contains', ['2', '5'])])
    await rules([rule('zalo_tag', 'not_contains', ['4'])])
    ok('sau V573: điều kiện chỉ còn tag đã xoá vẫn hợp lệ (lúc chạy bộ lọc bỏ qua điều kiện đó)')

    await assert.rejects(rules([rule('zalo_tag', 'contains', ['3', '99'])]), /send_exclusion_option_unavailable/)
    ok('tag Zalo chưa từng có vẫn bị chặn')
    await assert.rejects(rules([rule('zalo_tag', 'contains', ['9'])]), /send_exclusion_option_unavailable/)
    await assert.rejects(rules([rule('zalo_tag', 'contains', ['2'])], 100, 2, 10), /send_exclusion_option_unavailable/)
    await assert.rejects(rules([rule('zalo_tag', 'contains', ['2'])], 100, 1, 20), /send_exclusion_option_unavailable/)
    ok('tag đã xoá của tài khoản / nhân viên / tổ chức khác vẫn bị chặn')
    await assert.rejects(rules([rule('zalo_tag', 'contains', [2])]), /send_exclusion_option_unavailable/)
    ok('giá trị tag sai kiểu (số thay vì chuỗi) vẫn bị chặn')
    await assert.rejects(rules([rule('akabiz_tag', 'contains', ['300'])]), /send_exclusion_option_unavailable/)
    await assert.rejects(rules([rule('zalo_friend_status', 'equals', 'blocked')]), /send_exclusion_option_unavailable/)
    ok('tag akaBiz đã xoá và trạng thái bạn bè lạ giữ hành vi cũ (bị chặn)')
    await assert.rejects(rules([rule('zalo_tag', 'contains', [])]), /send_exclusion_value_count/)
    await assert.rejects(rules([rule('zalo_tag', 'contains', ['3'], false)]), /send_exclusion_rules_required/)
    ok('các kiểm khác không đổi (số giá trị, cần ít nhất một điều kiện bật)')

    await assert.rejects(db.query(MIGRATION), /preflight: thân/)
    await db.query('ROLLBACK').catch(() => {})
    ok('chạy lại migration bị preflight từ chối')

    // Gỡ: cần dòng sổ v573 khi có sổ.
    await assert.rejects(db.query(ROLLBACK), /sổ migration chưa có V573/)
    await db.query('ROLLBACK').catch(() => {})
    await db.query(`INSERT INTO supabase_migrations.schema_migrations VALUES ('2','migration_v573_send_exclusion_deleted_zalo_tags')`)
    await db.query(ROLLBACK)
    assert.equal(await fnMd5(), LIVE.functions[FN].md5)
    await assert.rejects(rules(realRules), /send_exclusion_option_unavailable/)
    await assert.rejects(db.query(ROLLBACK), /rollback preflight: thân/)
    await db.query('ROLLBACK').catch(() => {})
    ok('bản gỡ trả đúng thân production, chạy lại bị từ chối')

    assert.equal(md5(MIGRATION), md5(fs.readFileSync(path.join(ROOT, 'migrations/migration_v573_send_exclusion_deleted_zalo_tags.sql'), 'utf8')))
    console.log(`\nV573 smoke: ${passed} nhóm đạt`)
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
}
main().catch(err => { console.error(err); process.exit(1) })
