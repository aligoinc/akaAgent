// V574 (số tạm): bộ tạo việc "kiểm lỗi chiến dịch Facebook" cho Claude Code, trên PostgreSQL 17 cục bộ, không chạm DB thật:
//   node scripts/engine-v2-facebook/error-watch-smoke.cjs
// DB engine như production (V495 → V532 + V556–V558 + V564), thêm bản giả của nền Hỏi đáp AI (bảng ai_*, aka_agent_ai_chat_insert với đúng
// các luật mà hàm tick dựa vào: một câu mở hội thoại mới đang chờ cho mỗi nhân viên + agent, mã yêu cầu chống trùng, agent tắt thì từ chối) và
// bảng presence. Kiểm: gom ca lỗi, không đếm trùng, mã đã biết không thành ca, lượt dừng chiến dịch, lượt bỏ dở, tăng bất thường, chèn việc
// có trần, báo lại khi tăng gấp 3, gửi lại câu quá hạn, xin ảnh và hỏi tiếp khi ảnh về, thiết lập sai không làm hàm lỗi, bản gỡ.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, readMigration } = require('./fixture.cjs')

const PORT = Number(process.env.ENGINE_FB_ERROR_WATCH_PORT || 55574)
const MIGRATION = 'migration_v574_engine_error_watch.sql'
const ROLLBACK = 'rollback_v574_engine_error_watch.sql'
const AGENT = 'kiem-loi-chien-dich-facebook'
const ORG = 1, STAFF = 4, CUSTOMER_ORG = 701, CUSTOMER_STAFF = 7001, CUSTOMER_STAFF_2 = 7002
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

/** Bản giả của nền Hỏi đáp AI: cột và luật đủ cho hàm tick (đọc thân hàm production 18/11/2026). */
const AI_STUBS = `
CREATE TABLE public.ai_project_group (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL,
  description text NOT NULL DEFAULT '', rules text NOT NULL DEFAULT '', sort_order integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ai_project (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, group_id bigint NOT NULL REFERENCES public.ai_project_group(id),
  code text NOT NULL UNIQUE, name text NOT NULL, description text NOT NULL DEFAULT '', rules text NOT NULL DEFAULT '' CHECK (char_length(rules) <= 20000),
  output_schema jsonb, intake_schema jsonb NOT NULL DEFAULT '[]', default_question text NOT NULL DEFAULT '', suggested_questions jsonb NOT NULL DEFAULT '[]',
  output_webhook_url text, applies_to jsonb NOT NULL DEFAULT '{}', requires_campaign boolean NOT NULL DEFAULT true,
  audience text NOT NULL DEFAULT 'admin_akabiz' CHECK (audience IN ('off', 'admin_akabiz', 'all')),
  timeout_seconds integer NOT NULL DEFAULT 300 CHECK (timeout_seconds BETWEEN 30 AND 3600), sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), answer_mode text NOT NULL DEFAULT 'claude_code', model_id bigint, fallback_model_id bigint, form_config_id bigint);
CREATE TABLE public.ai_message_thread (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, project_id bigint NOT NULL REFERENCES public.ai_project(id),
  first_question text, organization_id bigint, org_staff_id bigint, campaign_id bigint, intake_data jsonb NOT NULL DEFAULT '{}', source text,
  status text NOT NULL DEFAULT 'đang mở', request_id uuid, last_message_seq integer NOT NULL DEFAULT 0, last_message_status text, last_read_seq integer NOT NULL DEFAULT 0,
  is_delete boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ai_message (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, thread_id bigint NOT NULL REFERENCES public.ai_message_thread(id),
  seq integer NOT NULL, request_id uuid NOT NULL UNIQUE, question text NOT NULL, answer text, answer_json jsonb, status text NOT NULL,
  asked_at timestamptz NOT NULL DEFAULT now(), deadline_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION private.aka_agent_ai_chat_active() RETURNS text[] LANGUAGE sql IMMUTABLE
  AS $f$ SELECT ARRAY['chờ câu trả lời', 'đang lấy thông tin câu hỏi', 'đang tìm câu trả lời', 'đã có câu trả lời'] $f$;
CREATE FUNCTION public.aka_agent_ai_chat_insert(p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_request uuid := (p_payload ->> 'requestId')::uuid;
  v_staff bigint := (p_payload ->> 'staffId')::bigint;
  v_thread bigint := (p_payload ->> 'threadId')::bigint;
  pr public.ai_project%ROWTYPE; t public.ai_message_thread%ROWTYPE; m public.ai_message%ROWTYPE; v_seq integer; v_count integer;
BEGIN
  IF coalesce(btrim(p_payload ->> 'question'), '') = '' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_question_required'; END IF;
  IF char_length(p_payload ->> 'question') > 4000 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_question_too_long'; END IF;
  SELECT * INTO m FROM public.ai_message WHERE request_id = v_request;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'inserted', false, 'threadId', m.thread_id, 'messageId', m.id, 'status', m.status);
  END IF;
  IF v_thread IS NOT NULL THEN
    SELECT * INTO t FROM public.ai_message_thread WHERE id = v_thread AND NOT is_delete AND org_staff_id = v_staff;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_thread_not_found'; END IF;
    SELECT * INTO pr FROM public.ai_project WHERE id = t.project_id;
  ELSE
    SELECT * INTO pr FROM public.ai_project WHERE code = p_payload ->> 'projectCode';
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ai_chat_agent_not_found'; END IF;
  END IF;
  IF NOT pr.is_active OR pr.audience = 'off' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ai_chat_agent_unavailable'; END IF;
  -- Hết hạn lười như lõi thật.
  UPDATE public.ai_message x SET status = 'lỗi' WHERE x.status = ANY (private.aka_agent_ai_chat_active()) AND x.deadline_at <= clock_timestamp();
  UPDATE public.ai_message_thread s SET last_message_status = 'lỗi'
   WHERE s.last_message_status = ANY (private.aka_agent_ai_chat_active())
     AND NOT EXISTS (SELECT 1 FROM public.ai_message x WHERE x.thread_id = s.id AND x.seq = s.last_message_seq AND x.status = ANY (private.aka_agent_ai_chat_active()));
  -- Lõi thật đọc lại hội thoại sau bước hết hạn.
  IF v_thread IS NOT NULL THEN SELECT * INTO t FROM public.ai_message_thread WHERE id = v_thread; END IF;
  IF v_thread IS NULL THEN
    -- Đang có câu chờ của cùng nhân viên + agent (+ chiến dịch): lõi trả hội thoại đó, không chèn.
    SELECT * INTO t FROM public.ai_message_thread s WHERE s.org_staff_id = v_staff AND s.project_id = pr.id AND NOT s.is_delete
       AND s.last_message_status = ANY (private.aka_agent_ai_chat_active()) ORDER BY id DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', false, 'inserted', false, 'code', 'ai_chat_message_pending', 'threadId', t.id);
    END IF;
  ELSE
    IF t.status <> 'đang mở' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_thread_closed'; END IF;
    IF t.last_message_status = ANY (private.aka_agent_ai_chat_active()) THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_message_pending'; END IF;
  END IF;
  SELECT count(*) INTO v_count FROM public.ai_message_thread s WHERE s.org_staff_id = v_staff AND NOT s.is_delete
     AND s.last_message_status = ANY (private.aka_agent_ai_chat_active());
  IF v_count >= 3 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ai_chat_too_many_pending'; END IF;
  IF v_thread IS NULL THEN
    INSERT INTO public.ai_message_thread (project_id, first_question, organization_id, org_staff_id, intake_data, source, request_id, last_message_seq, last_message_status)
    VALUES (pr.id, p_payload ->> 'question', (p_payload ->> 'organizationId')::bigint, v_staff, coalesce(p_payload -> 'intake', '{}'), p_payload ->> 'source', v_request, 1, 'chờ câu trả lời')
    RETURNING * INTO t;
    v_seq := 1;
  ELSE
    v_seq := t.last_message_seq + 1;
    UPDATE public.ai_message_thread SET last_message_seq = v_seq, last_message_status = 'chờ câu trả lời' WHERE id = t.id;
  END IF;
  INSERT INTO public.ai_message (thread_id, seq, request_id, question, status, deadline_at)
  VALUES (t.id, v_seq, v_request, p_payload ->> 'question', 'chờ câu trả lời', clock_timestamp() + make_interval(secs => pr.timeout_seconds)) RETURNING * INTO m;
  RETURN jsonb_build_object('ok', true, 'inserted', true, 'threadId', t.id, 'messageId', m.id, 'status', m.status);
END $f$;
CREATE TABLE public.auto_staff_device_presence (instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id bigint NOT NULL, last_seen_at timestamptz NOT NULL);
`

async function main() {
  const cluster = startCluster({ port: PORT, label: 'aka-fb-error-watch-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const all = async (sql, args = []) => (await db.query(sql, args)).rows
  const tick = async () => (await one('SELECT public.aka_agent_engine_error_watch_tick_v1() AS r')).r
  const setCfg = patch => db.query(`UPDATE public.auto_system_settings SET value = (value::jsonb || $1::jsonb)::text WHERE key = 'engine.error_watch'`, [JSON.stringify(patch)])
  /**
   * Kết quả giả được dựng ở "30 giây trước" để nằm trong khoảng tick đọc (tick chừa 15 giây cuối). mark() ghi mốc ngay trước khi dựng một đợt,
   * rewind() lùi mốc đã đọc về đúng mốc đó: lượt tick kế chỉ thấy đợt vừa dựng, không đọc lại đợt trước.
   */
  let marker = null
  const mark = async () => {
    await new Promise(resolve => setTimeout(resolve, 60))
    marker = (await one(`SELECT (clock_timestamp() - interval '30 seconds 20 milliseconds')::text AS t`)).t
  }
  const rewind = () => db.query(`UPDATE private.auto_engine_error_watch_state SET cursor_at = $1::timestamptz`, [marker])
  const cases = () => all(`SELECT * FROM private.auto_engine_error_cases ORDER BY case_key`)
  const caseLike = async part => (await cases()).find(c => c.case_key.includes(part))
  let nextId = 880000
  let fbCampaign, zaloCampaign, fbAccount

  /** Một lượt data đã đóng kèm một kết quả lỗi. ago: tuổi của kết quả (mặc định 30 giây, nằm trong khoảng tick đọc sau rewind). */
  const outcome = async ({ campaign = fbCampaign, staff = CUSTOMER_STAFF, code, action = 'fb_post_group', step = 'nav', message, pub = null, ok = false,
    screenshot = false, ago = '30 seconds', pause = false, close = 'reported', finalCode = null, startedAgo = null }) => {
    const data = ++nextId
    await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, uid, status, is_delete) OVERRIDING SYSTEM VALUE
      VALUES ($1, $2, 'nhóm', 'g', 'hoàn thành', false)`, [data, campaign])
    const run = await one(`INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token, runner_id,
        runtime_target, started_at, completed_at, close_reason, final_error_code, final_response)
      VALUES ($1, $2, $3, $4, $5, $6, 'desktop:test', 'desktop', clock_timestamp() - coalesce($11::interval, $7::interval + interval '20 seconds'),
        clock_timestamp() - $7::interval, $8, $9, $10)
      RETURNING id`, [data, campaign, fbAccount, staff, CUSTOMER_ORG, crypto.randomUUID(), ago, close, finalCode ?? code ?? null,
      JSON.stringify({ ok: true, campaign: { effect: pause ? 'pause' : 'none', note: null } }), startedAgo])
    if (code || ok) {
      const signal = { kind: 'block', message, ...(screenshot ? { screenshotId: crypto.randomUUID() } : {}) }
      await db.query(`INSERT INTO public.auto_engine_outcomes (result_key, target_run_id, input_data_id, campaign_id, account_id, action_code, phase, ok, error_code,
          delivery_state, decision, signal, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'before_send', $7, $8, 'not_delivered', $9, $10, clock_timestamp() - $11::interval)`,
        [`v2:${run.id}:${step}:error`, run.id, data, campaign, fbAccount, action, ok, ok ? null : code,
          JSON.stringify({ result: { publicCode: pub }, contrib: { campaignEffect: 'pause' } }), JSON.stringify(signal), ago])
    }
    return Number(run.id)
  }
  const answer = id => db.query(`UPDATE public.ai_message SET status = 'hoàn thành', answer = 'xong', answer_json = '{"tom_tat":"xong"}' WHERE id = $1`, [id])
    .then(() => db.query(`UPDATE public.ai_message_thread t SET last_message_status = 'hoàn thành' FROM public.ai_message m WHERE m.id = $1 AND t.id = m.thread_id`, [id]))
  const pendingMessages = () => all(`SELECT m.* FROM public.ai_message m WHERE m.status = 'chờ câu trả lời' ORDER BY m.id`)

  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await db.query(AI_STUBS)
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'akaBiz'), ($2, 'Khách') ON CONFLICT DO NOTHING`, [ORG, CUSTOMER_ORG])
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password) VALUES ($1, $2, 'nhutlq', 'pw'), ($3, $4, 'khach', 'pw'), ($5, $4, 'khach2', 'pw')`,
      [STAFF, ORG, CUSTOMER_STAFF, CUSTOMER_ORG, CUSTOMER_STAFF_2])
    fbAccount = ++nextId; fbCampaign = ++nextId; zaloCampaign = ++nextId
    await db.query(`INSERT INTO public.auto_accounts (id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server,
        is_zalo_show_web) OVERRIDING SYSTEM VALUE VALUES ($1, 'FB', 'facebook', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false, false)`,
      [fbAccount, CUSTOMER_STAFF, CUSTOMER_ORG])
    for (const [id, action] of [[fbCampaign, 'facebook_group_post'], [zaloCampaign, 'zalo_message_phone']]) {
      await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, schedule_type,
          extra_settings) OVERRIDING SYSTEM VALUE VALUES ($1, 'cd', $2, $3, 'chờ xử lý', now(), false, $4, $5, 'daily', '{}')`,
        [id, action, fbAccount, CUSTOMER_STAFF, CUSTOMER_ORG])
    }
    const migration = readMigration(MIGRATION)
    const rollback = readMigration(ROLLBACK)

    await check('apply: tạo đủ đối tượng, đang tắt, không ghi gì; chạy lại bị từ chối', async () => {
      await db.query(migration)
      const r = await tick()
      assert.deepEqual(r, { ok: true, enabled: false })
      assert.equal((await cases()).length, 0)
      const agent = await one(`SELECT p.*, g.code AS group_code FROM public.ai_project p JOIN public.ai_project_group g ON g.id = p.group_id WHERE p.code = $1`, [AGENT])
      assert.equal(agent.is_active, false)
      assert.equal(agent.group_code, 'van-hanh-noi-bo')
      assert.equal(agent.answer_mode, 'claude_code')
      assert.equal(agent.audience, 'admin_akabiz')
      assert.equal(agent.requires_campaign, false)
      assert.deepEqual(agent.output_schema.required, ['tom_tat'])
      assert.ok(agent.rules.length > 500 && agent.rules.length <= 20000)
      await assert.rejects(() => db.query(migration), /V574 đã chạy|đã có/)
      await db.query('ROLLBACK').catch(() => {})
    })

    await check('chuẩn hoá câu lỗi: bỏ tên nhóm, tên người, tên tệp, đường dẫn nhóm, số', async () => {
      const p = async m => (await one('SELECT private.aka_agent_engine_error_pattern($1) AS p', [m])).p
      assert.equal(await p(`ERR_NETWORK_IO_SUSPENDED (-331) loading 'https://www.facebook.com/groups/nhomthu1'`),
        await p(`ERR_NETWORK_IO_SUSPENDED (-331) loading 'https://www.facebook.com/groups/100000000000001'`))
      assert.equal(await p('Đăng bài thất bại vào Nhóm rao vặt A: Form đăng bài chưa đóng sau 60 giây'),
        await p('Đăng bài thất bại vào NHÓM MUA BÁN B ✅: Form đăng bài chưa đóng sau 45 giây'))
      assert.equal(await p('Lỗi nhắn tin khách inbox page đến Nguyễn Văn A: Không tìm thấy ô để nhập tin nhắn'),
        await p('Lỗi nhắn tin khách inbox page đến Trần Thị B: Không tìm thấy ô để nhập tin nhắn'))
      assert.equal(await p('Không dùng được media "a_1.jpg": local path không tồn tại'), await p('Không dùng được media "b 2.png": local path không tồn tại'))
      assert.notEqual(await p('Không comment được bài thứ 5: hết giờ'), await p('Không comment được bài của mình: hết giờ'))
      assert.equal((await p(null)), '')
    })

    let netRuns = []
    await check('bật đọc lỗi (chưa chèn việc): gom đúng ca, mã đã biết và Zalo không thành ca, không đếm trùng', async () => {
      await setCfg({ enabled: true })
      for (const g of ['nhomthu1', '100000000000001', 'nhomthu2', 'abc', 'xyz']) {
        netRuns.push(await outcome({ code: 'err_engine_fb_ui_not_ready', pub: 'FB44', step: 'nav', screenshot: true,
          message: `ERR_NETWORK_IO_SUSPENDED (-331) loading 'https://www.facebook.com/groups/${g}'` }))
      }
      for (const f of ['1794_a.jpg', '99_b.jpg']) {
        await outcome({ code: 'err_undefined', pub: 'SYS99', step: 'type_content', screenshot: f === '1794_a.jpg',
          message: `Không dùng được media "${f}": local path không tồn tại và không có cloud URL fallback` })
      }
      for (let i = 0; i < 3; i++) await outcome({ code: 'err_fb_group_composer_editor_not_found', pub: 'FB40', step: 'open_composer', message: 'Không tìm thấy ô đăng bài' })
      await outcome({ campaign: zaloCampaign, code: 'err_undefined', pub: 'SYS99', action: 'zalo_message_stranger', step: 'send', message: 'lỗi Zalo' })
      await outcome({ ok: true, message: 'ok' })
      const r = await tick()
      assert.equal(r.enabled, true)
      assert.equal(r.seen, 10, 'chỉ kết quả lỗi của chiến dịch Facebook')
      assert.equal(r.enqueue, false)
      const list = await cases()
      assert.equal(list.length, 2)
      const net = list.find(c => c.case_key.includes('ERR_NETWORK_IO_SUSPENDED'))
      assert.equal(Number(net.hits), 5)
      assert.equal(net.kind, 'ma_chua_ket_luan')
      assert.equal(net.public_code, 'FB44')
      assert.equal(net.step, 'nav')
      assert.equal(net.sample_runs.length, 5)
      const media = list.find(c => c.case_key.includes('media'))
      assert.equal(media.kind, 'chua_phan_loai')
      assert.equal(Number(media.hits), 2)
      assert.ok(media.screenshot_run)
      const hourly = await all(`SELECT error_code, sum(n)::int AS n FROM private.auto_engine_error_hourly GROUP BY 1 ORDER BY 1`)
      assert.deepEqual(hourly.map(h => [h.error_code, h.n]), [['err_engine_fb_ui_not_ready', 5], ['err_fb_group_composer_editor_not_found', 3], ['err_undefined', 2]])
      const again = await tick()
      assert.equal(again.seen, 0, 'lượt sau không đọc lại khoảng cũ')
      assert.equal(Number((await caseLike('ERR_NETWORK_IO_SUSPENDED')).hits), 5)
      assert.equal((await pendingMessages()).length, 0)
    })

    await check('lượt làm chiến dịch bị engine tạm dừng cộng vào ca; contrib.campaignEffect không được tính', async () => {
      assert.equal(Number((await caseLike('ERR_NETWORK_IO_SUSPENDED')).pauses), 0, 'các kết quả trước đều có contrib pause nhưng lượt không dừng')
      await mark()
      await outcome({ code: 'err_engine_fb_ui_not_ready', pub: 'FB44', step: 'nav', pause: true,
        message: `ERR_NETWORK_IO_SUSPENDED (-331) loading 'https://www.facebook.com/groups/q'` })
      await rewind()
      await tick()
      const net = await caseLike('ERR_NETWORK_IO_SUSPENDED')
      assert.equal(Number(net.hits), 6)
      assert.equal(Number(net.pauses), 1)
    })

    await check('lượt bị bỏ dở: xét 30 phút sau khi bắt đầu, chỉ tính khi máy khách còn hoạt động sau lúc đóng, mỗi lượt một lần', async () => {
      await db.query(`INSERT INTO public.auto_staff_device_presence (staff_id, last_seen_at) VALUES ($1, clock_timestamp())`, [CUSTOMER_STAFF])
      await outcome({ close: 'stale', finalCode: 'err_engine_interrupted_before_send', startedAgo: '40 minutes', ago: '26 minutes' })
      await outcome({ close: 'stale', finalCode: 'err_engine_interrupted_before_send', startedAgo: '40 minutes', ago: '26 minutes', staff: CUSTOMER_STAFF_2 })
      await outcome({ close: 'stale', finalCode: 'err_engine_interrupted_before_send', startedAgo: '20 minutes', ago: '6 minutes' }) // chưa đủ 30 phút
      await db.query(`UPDATE private.auto_engine_error_watch_state SET stale_cursor_at = clock_timestamp() - interval '50 minutes'`)
      const r = await tick()
      assert.equal(r.stale, 1)
      assert.equal((await tick()).stale, 0, 'lượt đã xét không xét lại')
      const stale = await caseLike('stale|facebook_group_post|err_engine_interrupted_before_send')
      assert.equal(stale.kind, 'luot_bo_do')
      assert.equal(Number(stale.hits), 1)
    })

    await check('bật chèn việc khi agent chưa bật: không chèn, ghi lý do', async () => {
      await setCfg({ enqueue: true })
      const r = await tick()
      assert.equal(r.enqueue, false)
      assert.match((await one('SELECT last_error FROM private.auto_engine_error_watch_state')).last_error, /agent chưa bật/)
      assert.equal((await pendingMessages()).length, 0)
    })

    let first
    await check('agent bật: mỗi lượt chỉ một câu mở hội thoại mới, ca có lượt dừng chiến dịch đi trước', async () => {
      await db.query(`UPDATE public.ai_project SET is_active = true WHERE code = $1`, [AGENT])
      const r = await tick()
      assert.equal(r.inserted.length, 1)
      assert.match(r.inserted[0].khoa, /ERR_NETWORK_IO_SUSPENDED/)
      const pending = await pendingMessages()
      assert.equal(pending.length, 1)
      first = pending[0]
      assert.match(first.question, /^\[Tự động\] Ca lỗi engine Facebook: mã lỗi chưa có kết luận\n/)
      assert.match(first.question, /khoa: err_engine_fb_ui_not_ready\|fb_post_group\|nav\|ERR_NETWORK_IO_SUSPENDED/)
      assert.match(first.question, /so luot: 6 .* so lan dung chien dich: 1/)
      assert.match(first.question, /luot mau: \d+/)
      const thread = await one('SELECT * FROM public.ai_message_thread WHERE id = $1', [first.thread_id])
      assert.equal(Number(thread.org_staff_id), STAFF)
      assert.equal(Number(thread.organization_id), ORG)
      assert.equal(thread.source, 'api')
      assert.equal(thread.intake_data.loai, 'ma_chua_ket_luan')
      assert.equal(thread.intake_data.so_luot, 6)
      assert.equal(thread.intake_data.luot_mau.length, 5)
      const net = await caseLike('ERR_NETWORK_IO_SUSPENDED')
      assert.equal(net.status, 'queued')
      assert.equal(Number(net.last_message_id), Number(first.id))
      assert.equal(r.tasksToday, 1)
      const again = await tick()
      assert.equal(again.inserted.length, 0, 'đang có câu chờ thì không mở hội thoại mới')
      assert.equal((await pendingMessages()).length, 1)
    })

    let second
    await check('có báo cáo thì ca sang reported và ca kế được chèn', async () => {
      await answer(first.id)
      const r = await tick()
      assert.equal((await caseLike('ERR_NETWORK_IO_SUSPENDED')).status, 'reported')
      assert.equal(r.inserted.length, 1)
      second = (await pendingMessages())[0]
      assert.notEqual(Number(second.thread_id), Number(first.thread_id))
      assert.equal(r.tasksToday, 2)
    })

    await check('ca đã báo: tăng chưa đủ gấp 3 thì im, đủ thì hỏi tiếp trong cùng hội thoại', async () => {
      await answer(second.id)
      await tick() // chèn ca thứ ba (còn lại)
      for (const m of await pendingMessages()) await answer(m.id)
      await tick()
      assert.equal((await pendingMessages()).length, 0, 'mọi ca đã báo')
      await mark()
      for (let i = 0; i < 5; i++) await outcome({ code: 'err_engine_fb_ui_not_ready', pub: 'FB44', step: 'nav', message: `ERR_NETWORK_IO_SUSPENDED (-331) loading 'https://www.facebook.com/groups/g${i}'` })
      await rewind()
      let r = await tick()
      assert.equal(r.inserted.length, 0, '6 → 11 lượt chưa đủ gấp 3')
      await mark()
      for (let i = 0; i < 8; i++) await outcome({ code: 'err_engine_fb_ui_not_ready', pub: 'FB44', step: 'nav', message: `ERR_NETWORK_IO_SUSPENDED (-331) loading 'https://www.facebook.com/groups/h${i}'` })
      await rewind()
      r = await tick()
      assert.equal(r.inserted.length, 1, '6 → 19 lượt thì báo lại')
      const m = (await pendingMessages())[0]
      assert.equal(Number(m.thread_id), Number(first.thread_id), 'hỏi tiếp trong hội thoại của ca')
      assert.equal(m.seq, 2)
      assert.match(m.question, /báo lại/)
      assert.match(m.question, /so luot: 19 \(lan bao truoc: 6\)/)
      await answer(m.id)
      await tick()
    })

    await check('câu quá hạn: gửi lại bằng câu mới, tối đa resendPerDay lần mỗi ngày', async () => {
      await mark()
      for (let i = 0; i < 2; i++) await outcome({ code: 'err_engine_fb_action_failed', pub: 'FB42', step: 'click_post', message: 'Đăng bài thất bại vào Nhóm A: Form đăng bài chưa đóng sau 60 giây' })
      await rewind()
      let r = await tick()
      assert.equal(r.inserted.length, 1)
      const ids = [r.inserted[0].messageId]
      for (let round = 1; round <= 3; round++) {
        await db.query(`UPDATE public.ai_message SET deadline_at = clock_timestamp() - interval '1 second' WHERE id = $1`, [ids.at(-1)])
        r = await tick()
        if (round <= 2) {
          assert.equal(r.inserted.length, 1, `lần gửi lại ${round}`)
          assert.ok(!ids.includes(r.inserted[0].messageId), 'câu gửi lại là câu mới')
          ids.push(r.inserted[0].messageId)
        } else {
          assert.equal(r.inserted.length, 0, 'hết lượt gửi lại trong ngày')
          assert.equal((await caseLike('Form đăng bài')).status, 'failed')
        }
      }
      await db.query(`UPDATE private.auto_engine_error_cases SET status = 'known' WHERE case_key LIKE '%Form đăng bài%'`)
    })

    await check('trần mỗi ngày và ca đã đánh dấu known / muted không thành việc', async () => {
      const st = await one('SELECT tasks_today FROM private.auto_engine_error_watch_state')
      await setCfg({ maxPerDay: st.tasks_today })
      await mark()
      await outcome({ code: 'err_fb_identity_switch_failed', pub: 'FB06', step: '__identity', message: 'Không lấy được tên Facebook identity hiện tại' })
      await rewind()
      let r = await tick()
      assert.equal(r.inserted.length, 0, 'đã chạm trần ngày')
      assert.equal((await caseLike('identity')).status, 'new')
      await setCfg({ maxPerDay: 40 })
      await db.query(`UPDATE private.auto_engine_error_cases SET status = 'muted', muted_until = now() + interval '1 day' WHERE case_key LIKE '%identity%'`)
      r = await tick()
      assert.equal(r.inserted.length, 0, 'ca tắt tiếng')
      await db.query(`UPDATE private.auto_engine_error_cases SET status = 'new', muted_until = NULL WHERE case_key LIKE '%identity%'`)
      r = await tick()
      assert.equal(r.inserted.length, 1)
      await answer(r.inserted[0].messageId)
      await tick()
    })

    await check('xin ảnh cho ca chưa phân loại: mỗi ca một yêu cầu, mỗi khách một yêu cầu mỗi ngày; ảnh về thì hỏi tiếp', async () => {
      await setCfg({ imageRequests: true })
      await mark()
      const shotRun = await outcome({ code: 'err_undefined', pub: 'SYS99', step: 'send_message', action: 'fb_message_page_inbox_customer', screenshot: true,
        message: 'Lỗi nhắn tin khách inbox page đến Nguyễn Văn A: Không tìm thấy ô để nhập tin nhắn' })
      await outcome({ code: 'err_undefined', pub: 'SYS99', step: 'group_invite', action: 'fb_group_invite', screenshot: true, message: 'Link group nhận lời mời không hợp lệ' })
      await rewind()
      let r = await tick()
      assert.equal(r.inserted.length, 1)
      assert.equal(r.imageRequests, 1)
      const reqs = await all(`SELECT * FROM public.auto_desktop_diagnostic_requests WHERE requested_by = 'error-watch'`)
      assert.equal(reqs.length, 1)
      assert.equal(Number(reqs[0].staff_id), CUSTOMER_STAFF)
      const firstCase = (await cases()).find(c => Number(c.image_request_id) === Number(reqs[0].id))
      assert.ok(firstCase, 'ca ghi mã yêu cầu ảnh')
      assert.ok([shotRun].includes(Number(reqs[0].filter.targetRunId)) || Number(reqs[0].filter.targetRunId) > 0)
      const m1 = (await pendingMessages())[0]
      assert.match(m1.question, new RegExp(`yeu cau anh: ${reqs[0].id}`))
      assert.equal(Number((await one('SELECT intake_data FROM public.ai_message_thread WHERE id = $1', [m1.thread_id])).intake_data.yeu_cau_anh), Number(reqs[0].id))
      await answer(m1.id)
      r = await tick() // ca chưa phân loại thứ hai, cùng khách cùng ngày: không xin ảnh nữa
      assert.equal(r.inserted.length, 1)
      assert.equal(r.imageRequests, 0)
      assert.equal((await all(`SELECT 1 FROM public.auto_desktop_diagnostic_requests WHERE requested_by = 'error-watch'`)).length, 1)
      await answer(r.inserted[0].messageId)
      await tick()
      // Ảnh về.
      await db.query(`INSERT INTO public.auto_desktop_diagnostic_files (request_id, image_id, content, sha256) VALUES ($1, gen_random_uuid(), '\\xffd8ffe0'::bytea, repeat('a', 64))`, [reqs[0].id])
      await db.query(`UPDATE public.auto_desktop_diagnostic_requests SET status = 'done', completed_at = now() WHERE id = $1`, [reqs[0].id])
      r = await tick()
      assert.equal(r.inserted.length, 1)
      assert.equal(r.inserted[0].anh, true)
      const follow = (await pendingMessages())[0]
      assert.equal(Number(follow.thread_id), Number(firstCase.thread_id ?? m1.thread_id))
      assert.match(follow.question, /Đã có 1 ảnh lỗi/)
      await answer(follow.id)
      r = await tick()
      assert.equal(r.inserted.length, 0, 'không hỏi tiếp lần hai cho cùng yêu cầu ảnh')
    })

    await check('mã đã biết tăng bất thường: cần đủ 3 ngày dữ liệu, giờ này >= 20 lượt và >= 3 lần mức nền', async () => {
      const base = async (code, n, days) => {
        for (let d = 1; d <= days; d++) {
          await db.query(`INSERT INTO private.auto_engine_error_hourly (platform, error_code, action_code, hour_at, n)
            VALUES ('facebook', $1, 'fb_post_group', date_trunc('hour', clock_timestamp()) - make_interval(days => $2), $3)
            ON CONFLICT (platform, error_code, action_code, hour_at) DO UPDATE SET n = EXCLUDED.n`, [code, d, n])
        }
      }
      const current = (code, n) => db.query(`INSERT INTO private.auto_engine_error_hourly (platform, error_code, action_code, hour_at, n)
        VALUES ('facebook', $1, 'fb_post_group', date_trunc('hour', clock_timestamp()), $2)
        ON CONFLICT (platform, error_code, action_code, hour_at) DO UPDATE SET n = EXCLUDED.n`, [code, n])
      await current('err_fb_group_composer_editor_not_found', 30)
      let r = await tick()
      assert.equal(r.spikes, 0, 'chưa đủ 3 ngày dữ liệu')
      await base('err_fb_group_composer_editor_not_found', 5, 4)
      await base('err_group_post_frequency_limit', 20, 4)
      await current('err_group_post_frequency_limit', 30)
      r = await tick()
      assert.equal(r.spikes, 1)
      const spike = await caseLike('spike|err_fb_group_composer_editor_not_found')
      assert.equal(spike.kind, 'tang_bat_thuong')
      assert.equal(Number(spike.hits), 30)
      assert.equal(await caseLike('spike|err_group_post_frequency_limit'), undefined, '30 so với nền 20 không phải tăng bất thường')
      for (const m of await pendingMessages()) await answer(m.id)
    })

    await check('thiết lập gõ sai không làm hàm lỗi; fire bật mà thiếu pg_net / Vault thì bỏ qua', async () => {
      await setCfg({ maxPending: 'abc', maxPerDay: '', regrowFactor: 'x', staffId: STAFF, fire: true, fireRoutineId: 'trig_abc', enqueueWindow: { fromMinute: 'a' } })
      const r = await tick()
      assert.equal(r.ok, true)
      assert.equal(r.fired, 0)
      await setCfg({ staffId: 'khong-phai-so' })
      const bad = await tick()
      assert.equal(bad.enqueue, false)
      await db.query(`UPDATE public.auto_system_settings SET value = 'không phải json' WHERE key = 'engine.error_watch'`)
      assert.deepEqual(await tick(), { ok: true, enabled: false })
    })

    await check('cửa sổ chèn việc theo phút: ngoài cửa sổ thì không chèn', async () => {
      const minute = new Date().getUTCMinutes()
      const outside = (minute + 30) % 60
      await db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = 'engine.error_watch'`, [JSON.stringify({ enabled: true, enqueue: true,
        staffId: STAFF, maxPerDay: 40, enqueueWindow: { fromMinute: outside, toMinute: outside } })])
      await mark()
      await outcome({ code: 'err_fb_composer_editor_not_found', pub: 'FB35', step: 'open_composer', action: 'fb_post_my_profile', message: 'Không tìm thấy ô đăng bài' })
      await rewind()
      let r = await tick()
      assert.equal(r.enqueue, false)
      assert.equal((await caseLike('err_fb_composer_editor_not_found')).status, 'new')
      await setCfg({ enqueueWindow: { fromMinute: 0, toMinute: 59 } })
      r = await tick()
      assert.equal(r.inserted.length, 1)
    })

    await check('quyền: chỉ service_role gọi được hàm, bảng sổ ca không mở cho vai trò khác', async () => {
      const acl = async fn => (await one(`SELECT coalesce(proacl::text, '') AS a FROM pg_proc WHERE oid = $1::regprocedure`, [fn])).a
      const a = await acl('public.aka_agent_engine_error_watch_tick_v1()')
      assert.ok(a.includes('service_role=X'))
      for (const role of ['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api']) {
        assert.equal((await one(`SELECT has_function_privilege($1, 'public.aka_agent_engine_error_watch_tick_v1()', 'EXECUTE') AS ok`, [role])).ok, false, role)
        assert.equal((await one(`SELECT has_table_privilege($1, 'private.auto_engine_error_cases', 'SELECT') AS ok`, [role])).ok, false, role)
      }
    })

    await check('gỡ: bỏ hàm, bảng, thiết lập; agent đã có hội thoại thì chỉ tắt', async () => {
      await db.query(rollback)
      assert.equal((await one(`SELECT to_regprocedure('public.aka_agent_engine_error_watch_tick_v1()') AS f`)).f, null)
      assert.equal((await one(`SELECT to_regclass('private.auto_engine_error_cases') AS t`)).t, null)
      assert.equal((await all(`SELECT 1 FROM public.auto_system_settings WHERE key = 'engine.error_watch'`)).length, 0)
      const agent = await one(`SELECT is_active, audience FROM public.ai_project WHERE code = $1`, [AGENT])
      assert.deepEqual(agent, { is_active: false, audience: 'off' })
      assert.ok((await all('SELECT 1 FROM public.ai_message')).length > 0, 'lịch sử báo cáo còn nguyên')
      await assert.rejects(() => db.query(rollback), /không có gì để gỡ/)
      await db.query('ROLLBACK').catch(() => {})
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${passed} đạt, ${failed} lỗi`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
