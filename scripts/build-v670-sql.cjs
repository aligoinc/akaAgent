#!/usr/bin/env node
// V670: "Chạy cùng lúc" chiến dịch trên cùng một tài khoản Zalo (anh chốt 26/11/2026: ô tích ở chiến dịch phụ, mỗi loại một chiến dịch,
// chung thao tác thì chờ, chỉ engine v2; thiết kế https://claude.ai/artifact/6rFygSGCcMZAzUx5vfbFx9).
//
// p1: auto_campaign_actions.allow_parallel_run (akaBiz bật theo loại; lúc đầu Huỷ lời mời kết bạn, Thêm thành viên vào group, Tham gia
//     group bằng link). Giao dịch riêng, chỉ ALTER bảng danh mục + UPDATE 3 dòng.
// p2: auto_campaigns.parallel_run_enabled (khách tích) + quyền ghi theo cột cho aka_agent_desktop. Giao dịch riêng (bảng nóng).
// p3: auto_engine_leases thêm làn (lane, action_id, action_codes), khoá chính (account_id) → (account_id, lane); thay thân 6 hàm:
//     claim_target_v1 (làn + kiểm làn khác, trạng thái parallel_wait), release_v1 / close_stale_v1 (không trả tài khoản về "chờ xử lý" khi
//     làn khác còn giữ chỗ), health_v1 (một tài khoản có thể có nhiều lease), create_control_campaign_v2 (Web / iOS gửi parallelRunEnabled),
//     update_control_campaign_atomic (Web / iOS sửa chiến dịch gửi khoá parallel_run_enabled);
//     thêm aka_agent_engine_parallel_wait_v1 (chỉ đọc, cho nút "Lý do đang chờ"). Đổi khoá chính và thay claim phải cùng một giao dịch:
//     claim cũ dùng ON CONFLICT (account_id).
// Chiến dịch không tích luôn ở làn 'main': claim đi đúng nhánh giữ chỗ cũ; bước kiểm làn khác chỉ thấy gì khi tài khoản có làn khác.
//
// Nguồn: pg_get_functiondef production đọc chỉ đọc 26/11/2026 (scripts/fixtures/campaign-parallel-run/live-20261126.json, kèm md5), trừ
// claim_target_v1: dựng trên thân sau V667 (scripts/build-v667-sql.cjs: V666 loại trừ gửi đã apply 26/11, rồi V667 nơi chạy 'server', cùng
// thay hàm này). Thứ tự apply: V666 → V667 → V670; p3 kiểm V667 p2 đã có trong sổ và claim đúng thân V667. Gỡ V670 trả claim về thân V667.
// Thân hàm mới không ghi số migration trong chú thích: đổi số thì md5 thân hàm không đổi.
// Chạy: node scripts/build-v670-sql.cjs (ghi 3 phần migration + bản gỡ). Không sửa tay các file đó.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const VERSION = 'v670'
const BASE = `${VERSION}_campaign_parallel_run`
const NAMES = { p1: `migration_${BASE}_p1`, p2: `migration_${BASE}_p2`, p3: `migration_${BASE}_p3`, rollback: `rollback_${BASE}` }
const PARALLEL_ACTIONS = ['zalo_cancel_sent_friend_request', 'zalo_add_group_member', 'zalo_join_group_link']
const FIXTURE = 'scripts/fixtures/campaign-parallel-run/live-20261126.json'

const SIG = {
  claim: 'public.aka_agent_engine_claim_target_v1(jsonb)',
  release: 'public.aka_agent_engine_release_v1(bigint,uuid)',
  closeStale: 'public.aka_agent_engine_close_stale_v1(integer)',
  health: 'public.aka_agent_engine_health_v1(integer)',
  createV2: 'public.create_control_campaign_v2(bigint,bigint,text,jsonb,jsonb,text)',
  updateAtomic: 'public.update_control_campaign_atomic(bigint,bigint,bigint,timestamp with time zone,jsonb,jsonb,boolean,text,integer,jsonb)'
}
const NEW_SIG = 'public.aka_agent_engine_parallel_wait_v1(bigint, text[])'

function patch(text, from, to, label) {
  const n = text.split(from).length - 1
  if (n !== 1) throw new Error(`${label}: cần đúng 1 chỗ, thấy ${n}`)
  return text.split(from).join(to)
}

/** Khối từ start tới hết end (lần đầu sau start), kèm kiểm md5 để bộ sinh dừng nếu bản nguồn đổi. */
function block(text, start, end, expectedMd5, label) {
  if (text.split(start).length - 1 !== 1) throw new Error(`${label}: cần đúng 1 điểm bắt đầu`)
  const i = text.indexOf(start)
  const j = text.indexOf(end, i)
  if (j < 0) throw new Error(`${label}: không thấy điểm kết thúc`)
  const out = text.slice(i, j + end.length)
  if (md5(out) !== expectedMd5) throw new Error(`${label}: khối nguồn đổi (${md5(out)})`)
  return out
}

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, FIXTURE), 'utf8'))
function live(sig) {
  const key = sig.replace(/^public\./, '')
  const fn = fixture.functions[key]
  if (!fn) throw new Error(`${FIXTURE}: thiếu ${key}`)
  if (md5(fn.def) !== fn.md5) throw new Error(`${FIXTURE}: md5 của ${key} không khớp nội dung`)
  return { ...fn, source: 'bản production 26/11' }
}

// ---------- claim_target_v1 (trên thân sau V667) ----------
// V666 (loại trừ gửi, apply 26/11) và V667 (engine v2 cho tài khoản Zalo Server trên VPS) cùng thay hàm này; V670 dựng tiếp trên thân V667.
const V667 = require('./build-v667-sql.cjs')
const V667_CLAIM_MD5 = 'df4b8e4284c911dad4b275383f7ddb2b'
const V667_P2 = V667.NAMES.p2
if (V667.NEW_MD5.claim !== V667_CLAIM_MD5 || md5(V667.texts.claim) !== V667_CLAIM_MD5) {
  throw new Error(`V667: thân claim khác bản V670 dựng trên (${V667.NEW_MD5.claim}); dựng lại V670 trên bản mới`)
}
// Chuỗi nguồn: claim production đọc 26/11 trước V666 (fixture V670) = bản V666 thay = bản V667 dựng trên (V667 kiểm thân V666 sinh ra khớp
// md5 đo sau khi chạy V666). Thân V667 phải còn bước kiểm loại trừ gửi của V666 và nơi chạy 'server'.
if (require('./build-v666-sql.cjs').OLD.engineClaim !== live(SIG.claim).def) throw new Error('V666: claim gốc khác claim production của fixture V670')
for (const piece of ["private.aka_agent_send_exclusion_claim_check(v_campaign_id, v_account_id, p_ctx->>'sendExclusionRunner')", "OR v_runtime NOT IN ('desktop','fly','server') THEN"]) {
  if (!V667.texts.claim.includes(piece)) throw new Error(`V667: thân claim thiếu ${piece}`)
}
const claimLive = { def: V667.texts.claim, md5: V667_CLAIM_MD5, source: 'bản sau V667' }
let claim = claimLive.def
claim = patch(claim,
  `  v_tc_sends jsonb;                 -- mọi bước gửi đã biết hỏng: {thao tác gửi: mã}, bỏ luôn bước tìm SĐT
BEGIN`,
  `  v_tc_sends jsonb;                 -- mọi bước gửi đã biết hỏng: {thao tác gửi: mã}, bỏ luôn bước tìm SĐT
  -- "Chạy cùng lúc": làn giữ chỗ của lượt ('main' hoặc mã loại chiến dịch), thao tác của lượt, chiến dịch làn khác đang chặn.
  v_lane text;
  v_codes text[];
  v_par record;
BEGIN`, 'claim: khai báo')
const claimLeaseOld = block(claim, '  -- Giữ chỗ tài khoản có hạn.',
  '    heartbeat_at = EXCLUDED.heartbeat_at, expires_at = EXCLUDED.expires_at;\n', '2d6769a26deb6b10b04d799008fadc77', 'claim: giữ chỗ')
const claimLeaseNew = `  -- "Chạy cùng lúc" (anh chốt 26/11/2026): làn giữ chỗ. Lease đang giữ (leaseToken) ở làn nào thì giữ làn đó. Lượt mới: chiến dịch có tích
  -- (parallel_run_enabled) của tài khoản Zalo mà loại được akaBiz bật (allow_parallel_run) giữ làn riêng của loại (lane = action_id); mọi
  -- chiến dịch khác giữ làn 'main' như trước.
  IF v_req_token IS NOT NULL THEN
    SELECT el.lane INTO v_lane FROM public.auto_engine_leases el WHERE el.account_id = v_account_id AND el.lease_token = v_req_token;
  END IF;
  IF v_lane IS NULL THEN
    v_lane := CASE WHEN c.parallel_run_enabled
                    AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo'
                    AND nullif(btrim(coalesce(c.action_id, '')), '') IS NOT NULL
                    AND coalesce((SELECT ca.allow_parallel_run FROM public.auto_campaign_actions ca WHERE ca.id = c.action_id), false)
                   THEN c.action_id ELSE 'main' END;
  END IF;
  -- Giữ chỗ tài khoản có hạn (theo làn). Lease cũ đã hết hạn thì runner mới lấy được; data dở của lease cũ
  -- vẫn "đang chạy" và chỉ được aka_agent_engine_close_stale_v1 đóng (không bao giờ gửi lại).
  SELECT * INTO l FROM public.auto_engine_leases WHERE account_id = v_account_id AND lane = v_lane FOR UPDATE;
  v_has_lease := FOUND;
  IF v_has_lease AND l.expires_at > v_now AND l.lease_token IS DISTINCT FROM v_req_token THEN
    RETURN jsonb_build_object('status', 'busy', 'runnerId', l.runner_id, 'expiresAt', l.expires_at);
  END IF;
  v_token := CASE WHEN v_has_lease AND l.lease_token = v_req_token AND l.expires_at > v_now THEN l.lease_token ELSE gen_random_uuid() END;
  v_codes := ARRAY(SELECT DISTINCT x.value->>'code'
                     FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_ctx->'actions') = 'array' THEN p_ctx->'actions' ELSE '[]'::jsonb END) x
                    WHERE nullif(btrim(coalesce(x.value->>'code', '')), '') IS NOT NULL);
  -- Bắt đầu lượt mới (chưa giữ lease còn hạn ở làn này) mà làn khác của tài khoản đang chạy chiến dịch cùng loại, hay dùng chung thao tác:
  -- chờ, không giữ chỗ, không ghi gì (mỗi loại một chiến dịch; chung thao tác thì chờ như trước). Chỉ thấy gì khi tài khoản đang có làn
  -- khác 'main', tức có chiến dịch có tích đang chạy. Dòng tài khoản đã khoá FOR UPDATE ở trên nên hai lượt nhận cùng tài khoản đi lần lượt.
  IF v_token IS DISTINCT FROM v_req_token THEN
    -- Chính chiến dịch này còn lease ở làn khác (làn đổi giữa hai lượt vì khách đổi ô tích hay akaBiz đổi loại, lượt trước dừng đột ngột chưa
    -- nhả): như lease còn hạn của lượt trước khi chưa có làn, busy tới khi lease đó hết hạn hoặc được nhả; một chiến dịch không chạy ở hai làn.
    SELECT o.runner_id, o.expires_at INTO v_par FROM public.auto_engine_leases o
     WHERE o.account_id = v_account_id AND o.lane <> v_lane AND o.expires_at > v_now AND o.campaign_id = c.id
     ORDER BY o.acquired_at LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('status', 'busy', 'runnerId', v_par.runner_id, 'expiresAt', v_par.expires_at);
    END IF;
    SELECT o.campaign_id, (o.action_id IS NOT DISTINCT FROM c.action_id) AS same_type,
           ARRAY(SELECT x FROM unnest(o.action_codes) x WHERE x = ANY (v_codes) ORDER BY 1) AS codes
      INTO v_par
      FROM public.auto_engine_leases o
     WHERE o.account_id = v_account_id AND o.lane <> v_lane AND o.expires_at > v_now
       AND (o.action_id = c.action_id OR o.action_codes && v_codes)
     ORDER BY o.acquired_at, o.lane LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('status', 'parallel_wait', 'campaignId', v_par.campaign_id,
        'campaignName', (SELECT x.name FROM public.auto_campaigns x WHERE x.id = v_par.campaign_id),
        'reason', CASE WHEN v_par.same_type THEN 'same_type' ELSE 'same_action' END,
        'actionCodes', to_jsonb(v_par.codes));
    END IF;
  END IF;
  -- V501: campaign_schedule = lịch của chiến dịch lúc bắt đầu lượt (khung giờ hiện tại của chiến dịch nhiều khung giờ).
  INSERT INTO public.auto_engine_leases AS el (account_id, lane, lease_token, runner_id, runtime_target, campaign_id, acquired_at, heartbeat_at, expires_at,
    campaign_schedule, action_id, action_codes)
  VALUES (v_account_id, v_lane, v_token, v_runner, v_runtime, v_campaign_id, v_now, v_now, v_now + make_interval(secs => v_lease_seconds),
    c.schedule, c.action_id, coalesce(v_codes, ARRAY[]::text[]))
  ON CONFLICT (account_id, lane) DO UPDATE SET
    lease_token = EXCLUDED.lease_token, runner_id = EXCLUDED.runner_id, runtime_target = EXCLUDED.runtime_target,
    campaign_id = EXCLUDED.campaign_id,
    acquired_at = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.acquired_at ELSE EXCLUDED.acquired_at END,
    campaign_schedule = CASE WHEN el.lease_token = EXCLUDED.lease_token THEN el.campaign_schedule ELSE EXCLUDED.campaign_schedule END,
    action_id = EXCLUDED.action_id, action_codes = EXCLUDED.action_codes,
    heartbeat_at = EXCLUDED.heartbeat_at, expires_at = EXCLUDED.expires_at;
`
claim = patch(claim, claimLeaseOld, claimLeaseNew, 'claim: giữ chỗ')

// ---------- release_v1 ----------
const releaseLive = live(SIG.release)
const releaseOld = block(releaseLive.def, '  UPDATE public.auto_accounts SET status', '));\n', '3cf6a678c2b6f104250f76510c7f7bf4', 'release: trả tài khoản')
// Làn khác của tài khoản có thể đang nhận lượt đúng lúc này: claim giữ khoá dòng tài khoản tới hết giao dịch và lease mới chưa commit, nên câu
// trả tài khoản về "chờ xử lý" (một câu, chụp dữ liệu lúc bắt đầu) không thấy lease đó và trả tài khoản về "chờ xử lý" trong khi làn kia chạy
// (giả lập A seed 6); hai làn nhả cùng lúc thì mỗi bên thấy lease chưa commit của bên kia và tài khoản kẹt "đang chạy". Khoá dòng tài khoản
// bằng một câu riêng trước khi tài khoản còn "đang chạy" (đúng dòng mà câu cập nhật dưới vẫn khoá khi tài khoản về "chờ xử lý"), câu cập nhật
// chụp dữ liệu sau khi giao dịch kia xong. Chỉ tra theo khoá chính, không đọc thêm bảng nào: bảng auto_campaigns không có chỉ mục account_id
// dùng được cho câu kiểu "tài khoản có chiến dịch có tích" (EXPLAIN production 26/11: Seq Scan 78 MB) mà release chạy ở mọi lượt.
const accountRunningLock = (accountExpr, indent = '  ') => `${indent}PERFORM 1 FROM public.auto_accounts WHERE id = ${accountExpr} AND status = 'đang chạy' FOR UPDATE;`
const releaseNew = `  -- "Chạy cùng lúc": làn khác của tài khoản còn giữ chỗ thì tài khoản vẫn "đang chạy". Làn khác có thể đang nhận lượt (giữ khoá dòng tài
  -- khoản, lease mới chưa commit): khoá dòng tài khoản bằng câu riêng trước (khi còn "đang chạy", đúng dòng câu dưới vẫn khoá) để câu cập nhật
  -- chụp dữ liệu sau khi giao dịch kia xong và thấy lease đó.
${accountRunningLock('p_account_id')}
  UPDATE public.auto_accounts SET status = 'chờ xử lý', updated_at = v_now WHERE id = p_account_id AND status = 'đang chạy' AND runtime_operation_claim_token IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.account_id = auto_accounts.id
                        AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL))
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases ol WHERE ol.account_id = auto_accounts.id AND ol.expires_at > v_now);
`
const release = patch(releaseLive.def, releaseOld, releaseNew, 'release')

// ---------- close_stale_v1 ----------
const closeLive = live(SIG.closeStale)
const closeOld = block(closeLive.def, '    UPDATE public.auto_accounts SET status', '));\n', '7d7c43e4bcaa4ca8a3015c0512a5e28a', 'close_stale: trả tài khoản')
const closeNew = `    -- "Chạy cùng lúc": làn khác của tài khoản chưa tới lúc dọn thì tài khoản vẫn "đang chạy". Khoá dòng tài khoản trước bằng câu riêng (như
    -- release_v1; tài khoản có làn riêng đã khoá ở đầu vòng thì câu này không chờ gì) để câu cập nhật thấy lease của làn khác.
${accountRunningLock('v_lease.account_id', '    ')}
    UPDATE public.auto_accounts SET status = 'chờ xử lý', updated_at = v_now WHERE id = v_lease.account_id AND status = 'đang chạy' AND runtime_operation_claim_token IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.account_id = auto_accounts.id
                        AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL))
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases ol WHERE ol.account_id = auto_accounts.id AND ol.expires_at > v_now - v_stale);
`
// Job dọn lease hết hạn: tài khoản đang có làn riêng (lease này ở làn riêng, hoặc tài khoản còn lease khác ở làn riêng; tra theo khoá chính
// của auto_engine_leases) thì khoá dòng chiến dịch rồi dòng tài khoản mà không chờ (SKIP LOCKED); đang bị giữ (làn khác đang nhận lượt / nhả
// chỗ, bộ chạy đang lấy lại lease này) thì để lease này cho lần chạy sau của job. Không chờ vì job giữ khoá các lease của cả lô (tài khoản có
// làn riêng có thể có nhiều lease) mà claim khoá chiến dịch → tài khoản → lease: chờ thì có thể khoá chéo (giả lập A). Tài khoản chỉ có làn
// chính giữ thứ tự khoá như trước (lease → chiến dịch → tài khoản).
const closeLoopOld = `    DELETE FROM public.auto_engine_leases WHERE account_id = v_lease.account_id AND lease_token = v_lease.lease_token;\n`
const closeLoopNew = `    -- "Chạy cùng lúc": tài khoản đang có làn riêng thì khoá dòng chiến dịch rồi dòng tài khoản mà không chờ; đang bị giữ (làn khác đang nhận
    -- lượt / nhả chỗ) thì để lease này cho lần chạy sau. Không chờ: job đang giữ khoá các lease của lô, claim khoá chiến dịch → tài khoản → lease.
    IF v_lease.lane <> 'main'
       OR EXISTS (SELECT 1 FROM public.auto_engine_leases ol WHERE ol.account_id = v_lease.account_id AND ol.lane <> 'main') THEN
      PERFORM 1 FROM public.auto_campaigns WHERE id = v_lease.campaign_id FOR UPDATE SKIP LOCKED;
      IF NOT FOUND AND EXISTS (SELECT 1 FROM public.auto_campaigns WHERE id = v_lease.campaign_id) THEN CONTINUE; END IF;
      PERFORM 1 FROM public.auto_accounts WHERE id = v_lease.account_id FOR UPDATE SKIP LOCKED;
      IF NOT FOUND AND EXISTS (SELECT 1 FROM public.auto_accounts WHERE id = v_lease.account_id) THEN CONTINUE; END IF;
    END IF;
` + closeLoopOld
const closeStale = patch(patch(patch(closeLive.def, closeOld, closeNew, 'close_stale'),
  '    SELECT l.account_id, l.campaign_id, l.lease_token FROM public.auto_engine_leases l\n',
  '    SELECT l.account_id, l.campaign_id, l.lease_token, l.lane FROM public.auto_engine_leases l\n', 'close_stale: đọc làn của lease'),
  closeLoopOld, closeLoopNew, 'close_stale: khoá trước khi dọn')

// ---------- health_v1 ----------
const healthLive = live(SIG.health)
const healthOld = block(healthLive.def, "           'lease', (SELECT", 'fb.account_id),\n', 'e21481f0c943e7a0fce00e816d8635e8', 'health: lease')
const healthNew = `           'lease', (SELECT jsonb_build_object('runnerId', l.runner_id, 'campaignId', l.campaign_id, 'expiresAt', l.expires_at,
                       'heartbeatAt', l.heartbeat_at) FROM public.auto_engine_leases l WHERE l.account_id = fb.account_id
                       ORDER BY (l.lane = 'main') DESC, l.expires_at DESC LIMIT 1),
`
const health = patch(healthLive.def, healthOld, healthNew, 'health')

// ---------- create_control_campaign_v2 ----------
const createLive = live(SIG.createV2)
const createOld = block(createLive.def, '    ELSIF v_web_form IS NOT NULL THEN', '  RETURN v_result;\n', '6d87e88300d8860ea5979087054fb0c6', 'create_v2')
const createNew = `    ELSIF v_web_form IS NOT NULL THEN
      -- Chỉ ghi cột form, không nêu status: không chạy trigger UPDATE OF status, không đổi config version.
      UPDATE public.auto_campaigns
      SET web_campaign_form = v_web_form
      WHERE id = v_campaign_id
        AND staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    END IF;
    -- "Chạy cùng lúc" từ form Web / iOS (parallelRunEnabled = true). Không gửi hay false = mặc định của cột (false). Chỉ ghi cột này.
    IF p_campaign->>'parallelRunEnabled' = 'true' THEN
      UPDATE public.auto_campaigns
      SET parallel_run_enabled = true
      WHERE id = v_campaign_id
        AND staff_id = p_staff_id
        AND organization_id = p_organization_id
        AND COALESCE(is_delete, false) = false;
    END IF;
  END IF;

  RETURN v_result;
`
const createV2 = patch(createLive.def, createOld, createNew, 'create_v2')

// ---------- update_control_campaign_atomic (Web / iOS sửa chiến dịch; API gửi khoá parallel_run_enabled khi ô đang hiện) ----------
const updateLive = live(SIG.updateAtomic)
const updateOld = "    refresh_data = CASE WHEN p_campaign_patch ? 'refresh_data' THEN (p_campaign_patch->>'refresh_data')::boolean ELSE campaign.refresh_data END,\n"
const updateNew = updateOld
  + "    -- \"Chạy cùng lúc\": chỉ đổi khi form gửi khoá (ô đang hiện); không gửi thì giữ nguyên. Không thuộc config version.\n"
  + "    parallel_run_enabled = CASE WHEN p_campaign_patch ? 'parallel_run_enabled' THEN COALESCE((p_campaign_patch->>'parallel_run_enabled')::boolean, false) ELSE campaign.parallel_run_enabled END,\n"
const updateAtomic = patch(updateLive.def, updateOld, updateNew, 'update_atomic')

// ---------- aka_agent_engine_parallel_wait_v1 (mới) ----------
const parallelWaitBody = `
-- "Chạy cùng lúc": chiến dịch này có đang phải chờ một chiến dịch ở làn khác của cùng tài khoản không (cùng loại, hoặc dùng chung thao tác),
-- theo quy tắc của aka_agent_engine_claim_target_v1. Chỉ đọc; cho nút "Lý do đang chờ". NULL khi không phải chờ vì chạy cùng lúc.
-- Thao tác của chiến dịch phải là thao tác claim dùng (mã lõi engine khai khi nhận lượt): nơi gọi có lõi (Desktop) gửi p_action_codes; không
-- gửi thì lấy limit_check_action_codes + mã loại, cộng Tìm SĐT cho "Thêm thành viên" (lõi khai Tìm SĐT, required: false, trong kế hoạch nhận
-- lượt của loại này: zaloAddGroupMemberClaimPlan; lõi đổi thì sửa cùng lúc).
DECLARE
  v_now timestamptz := clock_timestamp();
  c public.auto_campaigns%ROWTYPE;
  v_platform text;
  v_allow boolean;
  v_codes text[];
  v_given text[];
  v_lane text;
  v_par record;
BEGIN
  SELECT * INTO c FROM public.auto_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR coalesce(c.is_delete, false) OR c.account_id IS NULL OR NOT public.aka_agent_engine_scope_ok(c.staff_id) THEN
    RETURN NULL;
  END IF;
  SELECT lower(btrim(coalesce(a.flatform_type, ''))) INTO v_platform FROM public.auto_accounts a WHERE a.id = c.account_id;
  SELECT coalesce(ca.allow_parallel_run, false), coalesce(ca.limit_check_action_codes, ARRAY[]::text[]) INTO v_allow, v_codes
    FROM public.auto_campaign_actions ca WHERE ca.id = c.action_id;
  v_lane := CASE WHEN c.parallel_run_enabled AND coalesce(v_allow, false) AND v_platform = 'zalo'
                      AND nullif(btrim(coalesce(c.action_id, '')), '') IS NOT NULL
                 THEN c.action_id ELSE 'main' END;
  v_given := ARRAY(SELECT DISTINCT btrim(x) FROM unnest(coalesce(p_action_codes, ARRAY[]::text[])) x WHERE nullif(btrim(coalesce(x, '')), '') IS NOT NULL);
  IF cardinality(v_given) > 0 THEN
    v_codes := v_given;
  ELSE
    v_codes := coalesce(v_codes, ARRAY[]::text[]) || ARRAY[c.action_id]
      || CASE WHEN c.action_id = 'zalo_add_group_member' THEN ARRAY['zalo_find_phone_user'] ELSE ARRAY[]::text[] END;
  END IF;
  SELECT o.campaign_id, (o.action_id IS NOT DISTINCT FROM c.action_id) AS same_type,
         ARRAY(SELECT x FROM unnest(o.action_codes) x WHERE x = ANY (v_codes) ORDER BY 1) AS codes
    INTO v_par
    FROM public.auto_engine_leases o
   WHERE o.account_id = c.account_id AND o.expires_at > v_now AND o.campaign_id IS DISTINCT FROM c.id
     AND (o.lane <> v_lane OR v_lane <> 'main')
     AND (o.action_id = c.action_id OR o.action_codes && v_codes)
   ORDER BY o.acquired_at, o.lane LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('campaignId', v_par.campaign_id,
    'campaignName', (SELECT x.name FROM public.auto_campaigns x WHERE x.id = v_par.campaign_id),
    'reason', CASE WHEN v_par.same_type THEN 'same_type' ELSE 'same_action' END,
    'actionCodes', to_jsonb(v_par.codes), 'lane', v_lane);
END `
const parallelWaitDef = `CREATE OR REPLACE FUNCTION public.aka_agent_engine_parallel_wait_v1(p_campaign_id bigint, p_action_codes text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$${parallelWaitBody}$function$
`

const PATCHED = [
  { key: 'claim', sig: SIG.claim, live: claimLive, def: claim },
  { key: 'release', sig: SIG.release, live: releaseLive, def: release },
  { key: 'close_stale', sig: SIG.closeStale, live: closeLive, def: closeStale },
  { key: 'health', sig: SIG.health, live: healthLive, def: health },
  { key: 'create_v2', sig: SIG.createV2, live: createLive, def: createV2 },
  { key: 'update_atomic', sig: SIG.updateAtomic, live: updateLive, def: updateAtomic }
]
for (const p of PATCHED) {
  if (p.def === p.live.def) throw new Error(`${p.key}: không đổi gì`)
  if (!p.def.endsWith('$function$\n')) throw new Error(`${p.key}: cuối định nghĩa lạ`)
}

const ledgerGuard = name => `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '${name}') THEN
      RAISE EXCEPTION '${name} đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;`
const colExists = (table, col) => `EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.${table}'::regclass AND attname = '${col}' AND NOT attisdropped)`

const p1 = `-- V670 p1: "Chạy cùng lúc", cột akaBiz bật theo loại chiến dịch. SINH TỪ scripts/build-v670-sql.cjs, không sửa tay.
-- Thêm auto_campaign_actions.allow_parallel_run (mặc định false; khách không sửa), bật cho ${PARALLEL_ACTIONS.join(', ')}.
-- Giao dịch riêng, ngắn: ALTER bảng danh mục giữ khoá tới hết giao dịch. Gỡ: ${NAMES.rollback}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
${ledgerGuard(NAMES.p1)}
  IF ${colExists('auto_campaign_actions', 'allow_parallel_run')} THEN RAISE EXCEPTION 'V670 p1 đã chạy (allow_parallel_run đã có)'; END IF;
  IF (SELECT count(*) FROM public.auto_campaign_actions WHERE id IN (${PARALLEL_ACTIONS.map(id => `'${id}'`).join(', ')})) <> ${PARALLEL_ACTIONS.length} THEN
    RAISE EXCEPTION 'V670 p1: thiếu loại chiến dịch cần bật';
  END IF;
END $pre$;

ALTER TABLE public.auto_campaign_actions ADD COLUMN allow_parallel_run boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.auto_campaign_actions.allow_parallel_run IS
  'Chạy cùng lúc (V670): akaBiz bật thì khách tích được "Chạy cùng lúc" cho loại này; chiến dịch có tích chạy ở làn riêng của loại, mỗi tài khoản mỗi loại một chiến dịch. Khách không sửa.';
UPDATE public.auto_campaign_actions SET allow_parallel_run = true
 WHERE id IN (${PARALLEL_ACTIONS.map(id => `'${id}'`).join(', ')});

DO $post$
BEGIN
  IF (SELECT count(*) FROM public.auto_campaign_actions WHERE allow_parallel_run) <> ${PARALLEL_ACTIONS.length} THEN
    RAISE EXCEPTION 'V670 p1 postflight: số loại bật khác ${PARALLEL_ACTIONS.length}';
  END IF;
END $post$;
COMMIT;
`

const p2 = `-- V670 p2: "Chạy cùng lúc", cột khách tích trên chiến dịch. SINH TỪ scripts/build-v670-sql.cjs, không sửa tay.
-- Thêm auto_campaigns.parallel_run_enabled (mặc định false: mọi chiến dịch đang có chạy như cũ) và quyền ghi theo cột cho Desktop (V435).
-- Cột riêng thay vì extra_settings: form Desktop đang phát hành dựng lại extra_settings mỗi lần lưu, khoá mới sẽ bị xoá mà không báo.
-- Giao dịch riêng, ngắn (bảng nóng). Cần p1. Gỡ: ${NAMES.rollback}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
${ledgerGuard(NAMES.p2)}
  IF NOT ${colExists('auto_campaign_actions', 'allow_parallel_run')} THEN RAISE EXCEPTION 'V670 p2: chạy p1 trước'; END IF;
  IF ${colExists('auto_campaigns', 'parallel_run_enabled')} THEN RAISE EXCEPTION 'V670 p2 đã chạy (parallel_run_enabled đã có)'; END IF;
END $pre$;

ALTER TABLE public.auto_campaigns ADD COLUMN parallel_run_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.auto_campaigns.parallel_run_enabled IS
  'Chạy cùng lúc (V670): khách tích ở form; chỉ có hiệu lực khi loại có allow_parallel_run và chiến dịch chạy bằng engine v2 (tài khoản Zalo).';
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    GRANT INSERT (parallel_run_enabled), UPDATE (parallel_run_enabled) ON public.auto_campaigns TO aka_agent_desktop;
  END IF;
END $grant$;

DO $post$
BEGIN
  IF NOT ${colExists('auto_campaigns', 'parallel_run_enabled')} THEN RAISE EXCEPTION 'V670 p2 postflight: thiếu cột'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_desktop')
     AND NOT (has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'parallel_run_enabled', 'UPDATE')
              AND has_column_privilege('aka_agent_desktop', 'public.auto_campaigns', 'parallel_run_enabled', 'INSERT')) THEN
    RAISE EXCEPTION 'V670 p2 postflight: Desktop chưa có quyền ghi cột';
  END IF;
END $post$;
COMMIT;
`

const functionPre = PATCHED.map(p => `  v_oid := to_regprocedure('${p.sig}');
  IF v_oid IS NULL THEN RAISE EXCEPTION 'V670 p3: không có ${p.sig}'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '${md5(p.def)}' THEN RAISE EXCEPTION 'V670 p3 đã chạy (${p.key})'; END IF;
  IF v_md5 IS DISTINCT FROM '${p.live.md5}' THEN
    RAISE EXCEPTION 'V670 p3: định nghĩa ${p.key} khác ${p.live.source}, dừng để đối chiếu bản live (${p.key}: %)', v_md5;
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v670_acl_${p.key}', v_acl, true);`).join('\n')

const functionPost = PATCHED.map(p => `  v_oid := to_regprocedure('${p.sig}');
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${md5(p.def)}' THEN
    RAISE EXCEPTION 'V670 p3 postflight: định nghĩa ${p.key} %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v670_acl_${p.key}', true) THEN RAISE EXCEPTION 'V670 p3 postflight: quyền / chủ sở hữu ${p.key} bị đổi'; END IF;`).join('\n')

const p3 = `-- V670 p3: "Chạy cùng lúc", làn giữ chỗ của engine v2. SINH TỪ scripts/build-v670-sql.cjs, không sửa tay.
-- auto_engine_leases: thêm lane ('main' cho dòng đang có), action_id, action_codes; khoá chính (account_id) → (account_id, lane).
-- Thay thân claim_target_v1, release_v1, close_stale_v1, health_v1, create_control_campaign_v2 (giữ chữ ký, chủ sở hữu, quyền); thêm
-- aka_agent_engine_parallel_wait_v1 (chỉ đọc). Đổi khoá chính và thay claim cùng một giao dịch (claim cũ dùng ON CONFLICT (account_id)).
-- Nguồn: claim = thân sau V667 (V666 loại trừ gửi + V667 nơi chạy 'server'), 5 hàm còn lại = pg_get_functiondef production 26/11/2026:
-- ${PATCHED.map(p => `${p.key} ${p.live.md5}`).join(', ')}.
-- Bản mới: ${PATCHED.map(p => `${p.key} ${md5(p.def)}`).join(', ')}.
-- Cần p1, p2 và ${V667_P2} (V667 cũng thay claim; V670 dựng trên thân V667). DDL làm PostgREST nạp lại schema: apply ngoài giờ cao
-- điểm. Gỡ: ${NAMES.rollback}.sql (trước khi gỡ V667).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text;
BEGIN
${ledgerGuard(NAMES.p3)}
  IF NOT ${colExists('auto_campaign_actions', 'allow_parallel_run')} OR NOT ${colExists('auto_campaigns', 'parallel_run_enabled')} THEN
    RAISE EXCEPTION 'V670 p3: chạy p1, p2 trước';
  END IF;
  IF ${colExists('auto_engine_leases', 'lane')} THEN RAISE EXCEPTION 'V670 p3 đã chạy (auto_engine_leases.lane đã có)'; END IF;
  IF to_regprocedure('${NEW_SIG}') IS NOT NULL THEN RAISE EXCEPTION 'V670 p3: ${NEW_SIG} đã có'; END IF;
  -- Hai IF lồng nhau: một biểu thức "to_regclass(...) IS NOT NULL AND NOT EXISTS (...)" vẫn lỗi khi không có bảng sổ (phân tích cả biểu thức).
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '${V667_P2}') THEN
      RAISE EXCEPTION 'V670 p3: cần ${V667_P2} trước (cùng thay aka_agent_engine_claim_target_v1, V670 dựng trên bản của V667)';
    END IF;
  END IF;
  IF to_regprocedure('private.aka_agent_send_exclusion_claim_check(bigint,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'V670 p3: thiếu private.aka_agent_send_exclusion_claim_check (V666 loại trừ gửi)';
  END IF;
${functionPre}
END $pre$;

ALTER TABLE public.auto_engine_leases ADD COLUMN lane text NOT NULL DEFAULT 'main';
ALTER TABLE public.auto_engine_leases ADD COLUMN action_id text;
ALTER TABLE public.auto_engine_leases ADD COLUMN action_codes text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE public.auto_engine_leases DROP CONSTRAINT auto_engine_leases_pkey;
ALTER TABLE public.auto_engine_leases ADD CONSTRAINT auto_engine_leases_pkey PRIMARY KEY (account_id, lane);
COMMENT ON COLUMN public.auto_engine_leases.lane IS
  'Chạy cùng lúc (V670): ''main'' cho chiến dịch thường (như trước), mã loại chiến dịch cho chiến dịch có tích "Chạy cùng lúc". Mỗi tài khoản mỗi làn một lease.';

${PATCHED.map(p => p.def + ';\n').join('\n')}
${parallelWaitDef};
-- Hàm mới nhận quyền mặc định của schema public (Supabase cấp cho anon, authenticated): thu lại, chỉ service_role và Desktop.
REVOKE ALL ON FUNCTION ${NEW_SIG} FROM PUBLIC;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION ${NEW_SIG} FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION ${NEW_SIG} FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_chat_api') THEN REVOKE ALL ON FUNCTION ${NEW_SIG} FROM aka_agent_chat_api; END IF;
  GRANT EXECUTE ON FUNCTION ${NEW_SIG} TO service_role;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    GRANT EXECUTE ON FUNCTION ${NEW_SIG} TO aka_agent_desktop;
  END IF;
END $grant$;

DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
${functionPost}
  IF md5((SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('${NEW_SIG}'))) IS DISTINCT FROM '${md5(parallelWaitBody)}' THEN
    RAISE EXCEPTION 'V670 p3 postflight: thân aka_agent_engine_parallel_wait_v1 khác bản sinh';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
              AND has_function_privilege(r.rolname, '${NEW_SIG}', 'EXECUTE')) THEN
    RAISE EXCEPTION 'V670 p3 postflight: anon / authenticated gọi được aka_agent_engine_parallel_wait_v1';
  END IF;
  IF (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM pg_catalog.pg_index i
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
       WHERE i.indrelid = 'public.auto_engine_leases'::regclass AND i.indisprimary) IS DISTINCT FROM ARRAY['account_id', 'lane'] THEN
    RAISE EXCEPTION 'V670 p3 postflight: khoá chính auto_engine_leases khác (account_id, lane)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_leases WHERE lane <> 'main') THEN RAISE EXCEPTION 'V670 p3 postflight: lease cũ không ở làn main'; END IF;
END $post$;
COMMIT;
`

const rollback = `-- Gỡ V670 ("Chạy cùng lúc"). SINH TỪ scripts/build-v670-sql.cjs, không sửa tay. Chạy theo đúng thứ tự trong file (p3 → p2 → p1).
-- Gỡ trước khi gỡ V667 (bản gỡ V667 chỉ chạy khi claim đúng thân V667).
-- p3: trả claim về thân V667 và 5 hàm còn lại về bản production 26/11, xoá aka_agent_engine_parallel_wait_v1, xoá các lease không ở làn 'main' (lượt đang chạy ở làn
-- riêng nhận ownership_lost ở lần báo kế tiếp; data dở do aka_agent_engine_close_stale_v1 đóng như mọi lượt bị bỏ dở), trả khoá chính
-- (account_id), xoá 3 cột của bảng giữ chỗ. p2 / p1: xoá 2 cột cài đặt (mất lựa chọn đã tích của khách).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $pre$
BEGIN
  IF NOT ${colExists('auto_engine_leases', 'lane')} THEN RAISE EXCEPTION 'Gỡ V670 p3: chưa có V670 p3'; END IF;
${PATCHED.map(p => `  IF md5(pg_get_functiondef(to_regprocedure('${p.sig}'))) IS DISTINCT FROM '${md5(p.def)}' THEN
    RAISE EXCEPTION 'Gỡ V670: định nghĩa ${p.key} không phải bản V670 (có bản sửa sau V670?), dừng để đối chiếu (%)', md5(pg_get_functiondef(to_regprocedure('${p.sig}')));
  END IF;`).join('\n')}
END $pre$;
DELETE FROM public.auto_engine_leases WHERE lane <> 'main';
ALTER TABLE public.auto_engine_leases DROP CONSTRAINT auto_engine_leases_pkey;
ALTER TABLE public.auto_engine_leases ADD CONSTRAINT auto_engine_leases_pkey PRIMARY KEY (account_id);
ALTER TABLE public.auto_engine_leases DROP COLUMN action_codes;
ALTER TABLE public.auto_engine_leases DROP COLUMN action_id;
ALTER TABLE public.auto_engine_leases DROP COLUMN lane;
${PATCHED.map(p => p.live.def + ';\n').join('\n')}
DROP FUNCTION IF EXISTS ${NEW_SIG};
DO $post$
BEGIN
${PATCHED.map(p => `  IF md5(pg_get_functiondef(to_regprocedure('${p.sig}'))) IS DISTINCT FROM '${p.live.md5}' THEN RAISE EXCEPTION 'Gỡ V670: ${p.key} chưa về bản cũ'; END IF;`).join('\n')}
END $post$;
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.auto_campaigns DROP COLUMN IF EXISTS parallel_run_enabled;
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.auto_campaign_actions DROP COLUMN IF EXISTS allow_parallel_run;
COMMIT;
`

const result = {
  p1, p2, p3, rollback, NAMES, PARALLEL_ACTIONS, NEW_SIG, parallelWaitBody,
  defs: Object.fromEntries(PATCHED.map(p => [p.key, { sig: p.sig, liveDef: p.live.def, liveMd5: p.live.md5, def: p.def, md5: md5(p.def) }]))
}
result.V667_P2 = V667_P2
result.V667_CLAIM_MD5 = V667_CLAIM_MD5
module.exports = result

if (require.main === module) {
  const out = (name, text) => {
    fs.writeFileSync(path.join(ROOT, 'migrations', `${name}.sql`), text)
    console.log(`${name}.sql  md5 ${md5(text)}`)
  }
  out(NAMES.p1, p1)
  out(NAMES.p2, p2)
  out(NAMES.p3, p3)
  out(NAMES.rollback, rollback)
  for (const p of PATCHED) console.log(`${p.key}: ${p.live.md5} → ${md5(p.def)}`)
  console.log(`parallel_wait_v1 prosrc ${md5(parallelWaitBody)}`)
}
