// Bản cũ còn chạy được sau migration engine Facebook không (kiểm trước khi apply V556–V559): chạy lại bộ kiểm danh mục lúc bắt đầu chạy
// chiến dịch của các bản Desktop khách đang dùng (actionResultRuntime.beginActionResultRun, đúng ActionStatusCatalog của từng bản lấy bằng
// git show) và của chat-sync trên Fly (CampaignActionResults.begin), trên DB thử như production TRƯỚC và SAU V556–V559.
// V559 thêm 4 mã 'engine v2' (FB42–FB45), sửa dòng FB04 của bộ cũ, ghi câu cho khách (customer_title / customer_help, bộ cũ không đọc) và
// một dòng thiết lập (facebook.error_signs, bộ cũ không đọc). V560 (chép block / workflow "[engine]") không đụng bảng nào bộ kiểm này đọc
// và preflight của nó đòi code block production nên không apply ở đây (copy-smoke kiểm riêng).
// Bản chép vòng kiểm lỗi lấy từ scripts/legacy-catalog-validator-smoke.cjs (bài đó tự kiểm nguồn chưa trôi).
// Chạy: node scripts/engine-v2-facebook/legacy-catalog-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { ROOT, buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS } = require('./fixture.cjs')
const { desktopBegin, chatBegin, loadCatalogModule, gitShow, CHAT_REPO } = require('../legacy-catalog-validator-smoke.cjs')

const PORT = Number(process.env.FB_LEGACY_TEST_PORT || 55562)
// Bản Desktop khách đang dùng (presence 16–17/11/2026): 8.2.0, 9.3.0 và các bản phát hành gần nhất 9.7.0, 9.8.0 (build chưa phát hành), cộng bản đang làm.
const BUILDS = [
  { label: 'Desktop 8.2.0', ref: '9be854d7503e1cdaa88636e28e6d1fd9b8048c2e' },
  { label: 'Desktop 9.3.0', ref: '646ddd981f37f4aa6fce68f3253cd39fb9dc3225' },
  { label: 'Desktop 9.7.0', ref: '17d94bde' },
  { label: 'Desktop 9.8.0', ref: '7707bacc' },
  { label: 'Desktop nhánh FB', ref: null }
]
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function main() {
  const builds = BUILDS.map(b => {
    const source = b.ref ? gitShow(b.ref, 'src/shared/actionStatusPolicy.ts') : fs.readFileSync(path.join(ROOT, 'src/shared/actionStatusPolicy.ts'), 'utf8')
    assert.ok(source, `không đọc được ActionStatusCatalog của ${b.label}`)
    return { ...b, M: loadCatalogModule(source) }
  })
  const chat = CHAT_REPO ? loadCatalogModule(fs.readFileSync(path.join(CHAT_REPO, 'packages/database/src/result-policy/actionStatusPolicy.ts'), 'utf8')) : null
  pass(`nạp bộ kiểm danh mục của ${builds.map(b => b.label).join(', ')}${chat ? ' và chat-sync' : ''}`)

  const cluster = startCluster({ port: PORT, label: 'aka-fb-legacy-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  try {
    await buildFacebookFixture(db)
    const readDesktop = async () => {
      const q = t => db.query(`SELECT * FROM public.${t} ORDER BY id`).then(r => r.rows)
      return { statuses: await q('auto_status'), policies: await q('auto_account_action_status_policies'), errors: await q('auto_error'), actions: await q('auto_account_actions') }
    }
    const readChat = async () => (await db.query(`SELECT
      (SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM public.auto_status s) statuses,
      (SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public.auto_account_action_status_policies p) policies,
      (SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) FROM public.auto_error e WHERE e.is_active AND NOT e.is_delete) errors,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('code',a.code,'is_active',a.is_active,'is_delete',a.is_delete)),'[]'::jsonb) FROM public.auto_account_actions a) actions`)).rows[0]
    const campaigns = (await db.query(`SELECT id, flatform_type, limit_check_action_codes FROM public.auto_campaign_actions
      WHERE is_active AND NOT is_delete AND flatform_type IN ('zalo', 'facebook', 'email') AND cardinality(limit_check_action_codes) > 0 ORDER BY id`)).rows
    const fbCampaigns = campaigns.filter(c => c.flatform_type === 'facebook')
    // 9 loại Facebook có thao tác tính hạn mức (danh mục 16/11); tìm data không có thao tác nên bộ kiểm của bản cũ không chạy cho loại đó.
    assert.ok(fbCampaigns.length >= 9, `DB thử chỉ có ${fbCampaigns.length} loại chiến dịch Facebook`)

    const sweep = (rows, chatRows) => {
      const counts = {}
      for (const b of builds) for (const c of campaigns) counts[`${b.label}/${c.id}`] = desktopBegin(b.M, rows, c.flatform_type, c.limit_check_action_codes)
      if (chat) for (const c of campaigns.filter(c => c.flatform_type === 'zalo')) counts[`chat/${c.id}`] = chatBegin(chat, chatRows, c.limit_check_action_codes)
      return counts
    }
    const before = sweep(await readDesktop(), await readChat())
    pass(`trước V556: ${campaigns.length} loại chiến dịch (${fbCampaigns.length} Facebook) × ${builds.length} bản Desktop${chat ? ' + chat-sync' : ''} đạt bộ kiểm`)

    await applyFacebookMigrations(db)
    await applyFacebookMigrations(db, FACEBOOK_POLICY_MIGRATIONS)
    const after = sweep(await readDesktop(), await readChat())
    assert.deepEqual(after, before, 'số mã lỗi mà bản cũ kiểm phải giữ nguyên (mã engine v2 không lọt vào, dòng FB04 sửa không làm hỏng)')
    // Mã mới là 'engine v2': bộ kiểm của bản cũ bỏ qua; dòng FB04 vẫn là 'external facebook' với trạng thái hợp lệ.
    const added = (await db.query(`SELECT error_code, error_type FROM public.auto_error WHERE public_code IN ('FB42','FB43','FB44','FB45') ORDER BY public_code`)).rows
    assert.deepEqual(added.map(r => r.error_type), ['engine v2', 'engine v2', 'engine v2', 'engine v2'])
    pass('sau V556–V559: mọi bản Desktop và chat-sync kiểm đúng số mã như trước; 4 mã mới là engine v2 nên bản cũ bỏ qua')

    // Đối chứng âm: một dòng Facebook sai thật sự bị bộ kiểm của bản cũ chặn; cùng dòng đó là 'engine v2' thì bỏ qua.
    await db.query(`INSERT INTO public.auto_error(error_type, error_code, error_name, detail_status, zalo_action_codes)
      VALUES ('external facebook', 'err_fixture_bad_fb_status', 'Fixture', 'trạng thái không có', '{}')`)
    const bad = await readDesktop()
    for (const b of builds) assert.throws(() => desktopBegin(b.M, bad, 'facebook', fbCampaigns[0].limit_check_action_codes), err => err.reason === 'status_unknown', b.label)
    await db.query(`UPDATE public.auto_error SET error_type = 'engine v2' WHERE error_code = 'err_fixture_bad_fb_status'`)
    const clean = await readDesktop()
    for (const b of builds) desktopBegin(b.M, clean, 'facebook', fbCampaigns[0].limit_check_action_codes)
    pass('đối chứng: dòng "external facebook" với trạng thái sai bị bản cũ chặn; cùng dòng đó với "engine v2" thì bản cũ bỏ qua')
    console.log(`\n${checks} nhóm kiểm tra đạt`)
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
