#!/usr/bin/env node
// Kiểm V616 (đăng bài nhóm ẩn danh; anh chốt 21/11/2026), không chạm DB thật:
//   CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" LC_ALL=C node scripts/engine-v2-facebook/v616-smoke.cjs
// 1. PostgreSQL 17 cục bộ: DB engine như production (bootstrap + V556–V559, V563, V564, V575, V591, V597) cộng workflow 321 / 1 và block if_else
//    đọc 21/11; chạy nguyên văn migration rồi so mọi quyết định chính sách trước / sau (chỉ FB51 mới), đường đi của workflow, bản gỡ trả về như cũ,
//    không apply lại được.
// 2. Chromium: chạy nguyên code block mới trên hộp Tạo bài viết giả dựng theo DOM Facebook đọc 21/11 (công tắc <input role="switch"> có
//    aria-labelledby, bảng giới thiệu có nút aria-label="OK"), với đúng hai XPath anh duyệt.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS, applyV563, applyV575, applyV591, applyV597, readMigration } = require('./fixture.cjs')
const V = require('../build-v616-sql.cjs')

const PORT = Number(process.env.ENGINE_FB_V616_PORT || 55616)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const MIGRATION = readMigration(`${V.NAME}.sql`)
const ROLLBACK = readMigration(`${V.ROLLBACK_NAME}.sql`)
const LIVE = V.LIVE
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}
async function rejects(db, sql, pattern) {
  try { await db.query(sql) } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    assert.match(String(error.message), pattern)
    return
  }
  assert.fail('câu lệnh phải bị từ chối')
}

const FB_ACTIONS = [['fb_post_group', 'facebook_group_post'], ['fb_message_page_inbox_customer', 'facebook_page_to_message'],
  ['fb_comment', 'facebook_comment_seeding'], ['fb_message', 'facebook_message_uid'], ['fb_add_friend', 'facebook_add_friend'],
  ['fb_post_page', 'facebook_page_post'], ['fb_join_group', 'facebook_join_group']]

async function policyGrid(db) {
  const codes = (await db.query(`SELECT error_code FROM public.auto_error WHERE is_active AND NOT is_delete ORDER BY error_code`)).rows.map(r => r.error_code)
  const combos = codes.flatMap(code => FB_ACTIONS.flatMap(([a, ca]) => V.PHASES.map(ph => [code, a, ca, 'desktop', ph])))
  const { rows } = await db.query(`SELECT c->>0 AS code, c->>1 AS action, c->>4 AS phase,
      public.aka_agent_engine_resolve_policy(c->>0, NULL, c->>1, c->>2, c->>3, c->>4) - 'policy_ids' - 'revisions' AS p
    FROM jsonb_array_elements($1::jsonb) c`, [JSON.stringify(combos)])
  return new Map(rows.map(r => [`${r.code}|${r.action}|${r.phase}`, r.p]))
}

async function dump(db) {
  const q = async sql => (await db.query(sql)).rows.map(r => r.row)
  return {
    auto_error: await q(`SELECT to_jsonb(t) - 'updated_at' AS row FROM public.auto_error t ORDER BY id`),
    auto_outcome_policies: await q(`SELECT to_jsonb(t) - 'updated_at' - 'updated_by' - 'revision' AS row FROM public.auto_outcome_policies t ORDER BY id`),
    auto_elements: await q(`SELECT jsonb_build_object('name', name, 'xpath', xpath) AS row FROM public.auto_elements ORDER BY name`),
    blocks: await q(`SELECT jsonb_build_object('id', id, 'name', name, 'md5', md5(code)) AS row FROM public.auto_blocks ORDER BY id`),
    workflows: await q(`SELECT jsonb_build_object('id', id, 'graph', md5(nodes::text || edges::text), 'vars', md5(variables_schema::text || default_variables::text)) AS row
      FROM public.auto_workflows ORDER BY id`)
  }
}

/** Thêm vào DB thử đúng phần production mà V616 đọc: workflow 321 / 1, dòng auto_engine_workflows, block if_else engine. */
async function seedWorkflows(db) {
  await db.query(`INSERT INTO public.auto_blocks (id, name, code, category, kind, system_type) VALUES ($1, $2, '', 'logic', 'system', 'ifElse')
    ON CONFLICT (id) DO NOTHING`, [LIVE.ifElse.id, LIVE.ifElse.name])
  const wf = LIVE.workflow
  const lg = LIVE.legacyWorkflow
  await db.query(`INSERT INTO public.auto_workflows (id, name, nodes, edges, variables_schema, default_variables, is_builtin)
    VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, true), ($7, $8, $9::jsonb, $10::jsonb, '[]'::jsonb, '{}'::jsonb, true)`,
    [wf.id, wf.name, wf.nodesText, wf.edgesText, wf.varsText, wf.defaultsText, lg.id, `${lg.name} (bộ cũ)`, lg.nodesText, lg.edgesText])
  await db.query(`INSERT INTO public.auto_engine_workflows (purpose, workflow_id, source_workflow_id) VALUES ('facebook_group_post', $1, $2)
    ON CONFLICT (purpose) DO UPDATE SET workflow_id = excluded.workflow_id, source_workflow_id = excluded.source_workflow_id`, [wf.id, lg.id])
  await db.query(`SELECT setval(pg_get_serial_sequence('public.auto_blocks', 'id'), greatest((SELECT max(id) FROM public.auto_blocks), 3000))`)
}

/** Đường đi trong workflow: con của một node theo nhánh. */
function children(edges, source, handle) {
  return edges.filter(e => e.source === source && (handle === undefined || e.sourceHandle === handle)).map(e => e.target).sort()
}

async function sqlChecks() {
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v616-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    for (const name of FACEBOOK_POLICY_MIGRATIONS) await db.query(readMigration(name))
    await applyV563(db)
    await applyV575(db)
    await applyV591(db)
    await applyV597(db)
    await seedWorkflows(db)

    await check('DB thử khớp các điểm migration kiểm trước (workflow 321 / 1 đúng md5 production, mã FB lớn nhất FB50)', async () => {
      const w = (await db.query(`SELECT md5(nodes::text || edges::text) AS g, md5(variables_schema::text || default_variables::text) AS v FROM public.auto_workflows WHERE id = 321`)).rows[0]
      assert.deepEqual([w.g, w.v], [LIVE.workflow.md5, LIVE.workflow.varsMd5])
      assert.equal((await db.query(`SELECT md5(nodes::text || edges::text) AS g FROM public.auto_workflows WHERE id = 1`)).rows[0].g, LIVE.legacyWorkflow.md5)
      assert.equal((await db.query(`SELECT max(substring(public_code from 3)::int) AS n FROM public.auto_error WHERE public_code ~ '^FB[0-9]+$'`)).rows[0].n, 50)
      // FB40 trên DB thử có chính sách như production đọc 21/11 (FB51 chép hành vi FB40 trừ data tạm dừng).
      for (const ph of V.PHASES) {
        const p = (await db.query(`SELECT public.aka_agent_engine_resolve_policy($1, NULL, 'fb_post_group', 'facebook_group_post', 'desktop', $2)
          - 'policy_ids' - 'revisions' AS p`, [V.FB40_CODE, ph])).rows[0].p
        assert.deepEqual(p, LIVE.fb40Resolved[ph], ph)
      }
    })

    const before = await dump(db)
    const gridBefore = await policyGrid(db)
    await check('bản gỡ từ chối khi V616 chưa apply', async () => { await rejects(db, ROLLBACK, /Gỡ V616: không thấy block/) })

    await db.query(MIGRATION)
    const after = await dump(db)
    const gridAfter = await policyGrid(db)

    await check('apply: chỉ FB51 có chính sách mới, mọi quyết định khác giữ nguyên; FB51 = FB40 trừ data tạm dừng / bỏ bước còn lại / câu', async () => {
      const changed = []
      for (const [key, p] of gridAfter) {
        if (!gridBefore.has(key) || JSON.stringify(p) !== JSON.stringify(gridBefore.get(key))) changed.push(key)
      }
      const expected = FB_ACTIONS.flatMap(([a]) => V.PHASES.map(ph => `${V.FB51.code}|${a}|${ph}`))
      assert.deepEqual(changed.sort(), expected.sort())
      for (const ph of V.PHASES) {
        const p51 = gridAfter.get(`${V.FB51.code}|fb_post_group|${ph}`)
        const p40 = gridAfter.get(`${V.FB40_CODE}|fb_post_group|${ph}`)
        const strip = p => { const { target_effect, remaining_steps, log_template, campaign_note_template, ...rest } = p; return rest }
        assert.deepEqual(strip(p51), strip(p40), `FB51 ~ FB40 (${ph})`)
        assert.deepEqual([p51.target_effect, p51.remaining_steps, p51.log_template, p51.campaign_note_template ?? null],
          ['hold', 'skip', V.FB51.title, null])
      }
    })

    await check('apply: dữ liệu đổi đúng chỗ (2 element, 1 block mới, workflow 321, 1 mã, 1 chính sách; workflow 1 không đổi)', async () => {
      assert.deepEqual(after.auto_elements.filter(e => !before.auto_elements.some(b => b.name === e.name)),
        V.ELEMENTS.map(e => ({ name: e.name, xpath: e.xpath })).sort((a, b) => a.name.localeCompare(b.name)))
      assert.equal(after.auto_elements.length, before.auto_elements.length + 2)
      assert.deepEqual(after.blocks.slice(0, before.blocks.length), before.blocks)
      assert.deepEqual(after.blocks.slice(before.blocks.length).map(b => [b.name, b.md5]), [[V.BLOCK_NAME, V.BLOCK_MD5]])
      assert.deepEqual(after.workflows.find(w => w.id === 1), before.workflows.find(w => w.id === 1))
      const newErrors = after.auto_error.filter(e => !before.auto_error.some(b => b.id === e.id))
      assert.deepEqual(newErrors.map(e => [e.error_code, e.public_code, e.customer_title, e.customer_help, e.error_class, e.is_active]),
        [[V.FB51.code, 'FB51', 'Nhóm này không cho đăng bài ẩn danh', null, 'target_permanent', true]])
      assert.deepEqual(after.auto_error.filter(e => before.auto_error.some(b => b.id === e.id)), before.auto_error)
      assert.equal(after.auto_outcome_policies.length, before.auto_outcome_policies.length + 1)
      assert.deepEqual(after.auto_outcome_policies.slice(0, before.auto_outcome_policies.length), before.auto_outcome_policies)
    })

    await check('apply: workflow 321 đi qua node bật ẩn danh trước khi gõ nội dung; nhánh sai về merge_join; node / cạnh khác giữ nguyên', async () => {
      const w = (await db.query(`SELECT nodes, edges, variables_schema, default_variables FROM public.auto_workflows WHERE id = 321`)).rows[0]
      const blockId = Number((await db.query(`SELECT id FROM public.auto_blocks WHERE name = $1`, [V.BLOCK_NAME])).rows[0].id)
      assert.deepEqual(w.nodes.slice(0, V.NODES.length), V.NODES)
      assert.deepEqual(w.nodes.slice(V.NODES.length), [{ ...V.NEW_NODES[0], blockId }, V.NEW_NODES[1]])
      assert.deepEqual(w.edges.filter(e => !V.NEW_EDGES.some(n => n.id === e.id)), V.EDGES.filter(e => !V.OLD_EDGE_IDS.includes(e.id)))
      assert.deepEqual(children(w.edges, 'if_composer_opened', 'true'), ['enable_anonymous'])
      assert.deepEqual(children(w.edges, 'if_composer_opened', 'false'), ['merge_join'])
      assert.deepEqual(children(w.edges, 'enable_anonymous'), ['if_anonymous_ready'])
      assert.deepEqual(children(w.edges, 'if_anonymous_ready', 'true'), ['select_group_share_targets', 'sleep1'])
      assert.deepEqual(children(w.edges, 'if_anonymous_ready', 'false'), ['merge_join'])
      // sleep1 / chọn nhóm chia sẻ chỉ còn một cha (đường gõ nội dung luôn đi qua bước bật ẩn danh).
      for (const t of ['sleep1', 'select_group_share_targets']) assert.deepEqual(w.edges.filter(e => e.target === t).map(e => e.source), ['if_anonymous_ready'])
      assert.equal(w.default_variables.groupPostAnonymous, false)
      assert.ok(w.variables_schema.some(v => v.name === 'groupPostAnonymous' && v.type === 'boolean'))
    })

    await check('apply: tín hiệu có mã FB51 từ block ra đúng mã ở đăng nhóm', async () => {
      for (const ph of V.PHASES) {
        const r = (await db.query(`SELECT c.error_code FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', $1, $2::jsonb) c`,
          [ph, JSON.stringify({ kind: 'block', code: V.FB51.code, errorCode: V.FB51.code, message: V.FB51.title })])).rows[0]
        assert.equal(r.error_code, V.FB51.code, ph)
      }
    })

    await check('apply lần hai bị từ chối (block đã có / workflow đã đổi), sổ migration có V616 cũng bị từ chối', async () => {
      await rejects(db, MIGRATION, /V616: workflow 321 khác bản đã đọc/)
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261121999616', '${V.NAME}')`)
      await rejects(db, MIGRATION, /V616: sổ migration đã có V616/)
      await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261121999616'`)
    })

    await db.query(ROLLBACK)
    const restored = await dump(db)
    await check('bản gỡ: workflow, block, element về đúng bản trước; mã và chính sách chỉ bị tắt; mọi quyết định khác như trước', async () => {
      assert.deepEqual(restored.workflows, before.workflows)
      assert.deepEqual(restored.blocks, before.blocks)
      assert.deepEqual(restored.auto_elements, before.auto_elements)
      assert.deepEqual(restored.auto_error.filter(e => before.auto_error.some(b => b.id === e.id)), before.auto_error)
      assert.deepEqual(restored.auto_error.filter(e => !before.auto_error.some(b => b.id === e.id)).map(e => [e.error_code, e.is_active]), [[V.FB51.code, false]])
      assert.deepEqual(restored.auto_outcome_policies.slice(before.auto_outcome_policies.length).map(p => [p.error_code, p.is_active]), [[V.FB51.code, false]])
      const gridRestored = await policyGrid(db)
      for (const [key, p] of gridBefore) assert.deepEqual(gridRestored.get(key), p, key)
    })
  } finally {
    await db.end().catch(() => undefined)
    cluster.stop()
  }
}

// ---------------------------------------------------------------- Chromium: chạy code block mới trên hộp Tạo bài viết giả
// Dựng theo DOM Facebook đọc 21/11: công tắc là <input role="switch" aria-labelledby="…"> cạnh <span id="…">Đăng ẩn danh</span>; bấm công tắc thì
// bảng giới thiệu (cùng hộp thoại) hiện sau một lúc với nút <div aria-label="OK" role="button">; bấm OK thì công tắc aria-checked="true".
function composerHtml({ switchState = 'off', behavior = 'intro', introDelayMs = 300, okDelayMs = 200 } = {}) {
  const sw = switchState === 'missing' ? '' : `<div><div><span dir="auto" id="_r_ab_">Đăng ẩn danh</span></div><div><input dir="ltr" aria-labelledby="_r_ab_"
    aria-checked="${switchState === 'on'}" role="switch" type="checkbox" ${switchState === 'on' ? 'checked=""' : ''}></div></div>`
  return `<!doctype html><html><body>
  <div role="main"><div role="button" tabindex="0">Bạn viết gì đi...</div></div>
  <div role="dialog" id="composer"><h2>Tạo bài viết</h2>${sw}
    <div id="author">Lee Danh</div>
    <div contenteditable="true" role="textbox" aria-label="Bạn viết gì đi..." aria-placeholder="Bạn viết gì đi..."></div>
    <div aria-label="Đăng" role="button" tabindex="0">Đăng</div>
  </div>
  <div role="dialog" aria-label="Tạo bài viết"></div>
  <script>(function () {
    window.__clicks = { switch: 0, ok: 0 };
    const input = document.querySelector('input[role="switch"]');
    if (!input) return;
    const setOn = () => { input.setAttribute('aria-checked', 'true'); input.setAttribute('checked', '');
      document.getElementById('author').textContent = 'Thành viên ẩn danh'; };
    input.addEventListener('click', ev => {
      ev.preventDefault(); window.__clicks.switch++;
      if (${JSON.stringify(behavior)} === 'direct') { setOn(); return; }
      if (${JSON.stringify(behavior)} !== 'intro' && ${JSON.stringify(behavior)} !== 'ok_dead') return;
      setTimeout(() => {
        if (document.getElementById('intro')) return;
        const panel = document.createElement('div'); panel.id = 'intro';
        panel.innerHTML = '<h2>Bài viết ẩn danh</h2><span>Bài viết ẩn danh đăng trong nhóm sẽ không bao gồm tên hay ảnh đại diện của bạn.</span>' +
          '<div aria-label="OK" role="button" tabindex="0"><span>OK</span></div>';
        document.getElementById('composer').appendChild(panel);
        panel.querySelector('[aria-label="OK"]').addEventListener('click', () => {
          window.__clicks.ok++;
          if (${JSON.stringify(behavior)} === 'ok_dead') return;
          setTimeout(setOn, ${okDelayMs});
        });
      }, ${introDelayMs});
    });
  })();</script></body></html>`
}

/** page giống PageController: evaluate bọc thân trong hàm async có __args; click bắn pointer / mouse rồi el.click() (bản engine). */
function pageApi(pw) {
  const resolve = `function resolveSelector(sel) { return document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue }`
  return {
    evaluate: (body, ...args) => pw.evaluate(`(async function() { var __args = ${JSON.stringify(args)}; ${body} })()`),
    $: async sel => (await pw.evaluate(`(function(){ ${resolve}; return !!resolveSelector(${JSON.stringify(sel)}) })()`)) ? { xpath: sel } : null,
    click: sel => pw.evaluate(`(function(){ ${resolve}; var el = resolveSelector(${JSON.stringify(sel)});
      if (!el) throw new Error('Element not found: ' + ${JSON.stringify(sel)});
      var init = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' })));
      el.dispatchEvent(new MouseEvent('mousedown', init));
      el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, init, { pointerId: 1, pointerType: 'mouse' })));
      el.dispatchEvent(new MouseEvent('mouseup', init));
      el.click(); return true })()`)
  }
}

async function runBlock(pw, kase, code = V.BLOCK_CODE) {
  await pw.setContent(composerHtml(kase.page))
  const elements = new Map(V.ELEMENTS.map(e => [e.name, e.xpath]))
  // Đồng hồ giả: helpers.sleep tiến thời gian theo đúng số ms block chờ (thật chỉ chờ ≤ 200 ms) để ca "không bật được" không mất 15 giây.
  let fakeNow = Date.now()
  const FakeDate = { now: () => fakeNow }
  const helpers = {
    element: async n => { if (!elements.has(n)) throw new Error(`Element không tìm thấy: ${n}`); return elements.get(n) },
    sleep: async ms => { fakeNow += Number(ms) || 0; await new Promise(r => setTimeout(r, Math.min(Number(ms) || 0, 200))) },
    log: () => undefined
  }
  const vars = { groupPostAnonymous: kase.anonymous !== false, inputDataId: 77 }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  let out
  try {
    out = await new AsyncFunction('page', 'helpers', 'vars', 'input', 'signal', 'Date', code)(pageApi(pw), helpers, vars, { opened: true },
      { aborted: false }, FakeDate)
  } catch (error) {
    out = { thrown: error.message }
  }
  const dom = await pw.evaluate(`({ clicks: window.__clicks, author: document.getElementById('author').textContent,
    checked: document.querySelector('input[role="switch"]')?.getAttribute('aria-checked') ?? null })`)
  return { out, dom }
}

const CASES = [
  { id: 'chiến dịch không bật ẩn danh: không đụng gì, không có khoá actionResult', anonymous: false, page: { switchState: 'off' },
    expect: ({ out, dom }) => { assert.deepEqual(out, { anonymousReady: true }); assert.deepEqual(dom.clicks, { switch: 0, ok: 0 }) } },
  { id: 'nhóm cho ẩn danh: bấm công tắc, bảng giới thiệu hiện, bấm OK, công tắc bật', page: { switchState: 'off', behavior: 'intro' },
    expect: ({ out, dom }) => {
      assert.deepEqual(out, { anonymousReady: true, anonymousEnabled: true })
      assert.deepEqual([dom.checked, dom.author, dom.clicks.switch], ['true', 'Thành viên ẩn danh', 1])
      assert.ok(dom.clicks.ok >= 1)
    } },
  { id: 'bảng giới thiệu hiện chậm (3 giây) vẫn bật được', page: { switchState: 'off', behavior: 'intro', introDelayMs: 3000 },
    expect: ({ out, dom }) => { assert.deepEqual(out, { anonymousReady: true, anonymousEnabled: true }); assert.equal(dom.checked, 'true') } },
  { id: 'Facebook bật luôn không hỏi OK', page: { switchState: 'off', behavior: 'direct' },
    expect: ({ out, dom }) => { assert.deepEqual(out, { anonymousReady: true, anonymousEnabled: true }); assert.deepEqual(dom.clicks, { switch: 1, ok: 0 }) } },
  { id: 'công tắc đã bật sẵn: không bấm', page: { switchState: 'on' },
    expect: ({ out, dom }) => { assert.deepEqual(out, { anonymousReady: true, anonymousEnabled: true }); assert.deepEqual(dom.clicks, { switch: 0, ok: 0 }) } },
  { id: 'nhóm không cho ẩn danh (không có công tắc): trả FB51, không bấm gì', page: { switchState: 'missing' },
    expect: ({ out }) => {
      assert.equal(out.anonymousReady, false)
      assert.deepEqual(out.actionResult, { actionCode: 'fb_post_group', statusCode: 'campaign_detail_error', errorCode: V.FB51.code, inputDataId: 77,
        operationState: 'not_committed', message: 'Nhóm này không cho đăng bài ẩn danh',
        data: { source: 'fb_enable_group_anonymous_post', selector: V.ELEMENTS[0].xpath } })
    } },
  { id: 'bấm công tắc mà Facebook không phản hồi: ném lỗi, không đi tiếp tới nút Đăng', page: { switchState: 'off', behavior: 'none' },
    expect: ({ out, dom }) => { assert.deepEqual(out, { thrown: 'Không bật được chế độ đăng bài ẩn danh' }); assert.equal(dom.checked, 'false') } },
  { id: 'bấm OK mà công tắc vẫn tắt: ném lỗi', page: { switchState: 'off', behavior: 'ok_dead' },
    expect: ({ out, dom }) => { assert.deepEqual(out, { thrown: 'Không bật được chế độ đăng bài ẩn danh' }); assert.ok(dom.clicks.ok >= 1) } }
]

async function chromiumChecks() {
  const { chromium } = require('playwright')
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
  const pw = await browser.newPage()
  try {
    await check('XPath anh duyệt: khớp đúng 1 công tắc / 1 nút OK trên hộp giả, không khớp khi không có công tắc', async () => {
      const count = xp => pw.evaluate(`document.evaluate(${JSON.stringify(xp)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength`)
      await pw.setContent(composerHtml({ switchState: 'off' }))
      assert.equal(await count(V.ELEMENTS[0].xpath), 1)
      assert.equal(await count(V.ELEMENTS[1].xpath), 0)
      await pw.click('input[role="switch"]', { force: true })
      await pw.waitForSelector('[aria-label="OK"]')
      assert.equal(await count(V.ELEMENTS[1].xpath), 1)
      await pw.setContent(composerHtml({ switchState: 'missing' }))
      assert.equal(await count(V.ELEMENTS[0].xpath), 0)
    })
    for (const kase of CASES) await check(`block trên hộp Tạo bài viết giả: ${kase.id}`, async () => kase.expect(await runBlock(pw, kase)))
  } finally {
    await browser.close()
  }
}

async function main() {
  await check('file migration / bản gỡ khớp bộ sinh', async () => {
    assert.equal(md5(MIGRATION), md5(V.migration))
    assert.equal(md5(ROLLBACK), md5(V.rollback))
  })
  await sqlChecks()
  await chromiumChecks()
  console.log(`\n${passed} đạt, ${failed} lỗi (md5 migration ${md5(MIGRATION)})`)
  if (failed) process.exit(1)
}
module.exports = { FB_ACTIONS, policyGrid, dump, seedWorkflows, children, composerHtml, pageApi, runBlock, CASES }
if (require.main === module) main().catch(error => { console.error(error); process.exit(1) })
