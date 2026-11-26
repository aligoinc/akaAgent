// "Chạy cùng lúc" (V670): dựng DB thử ở trạng thái V670 dựng trên: 5 hàm production 26/11/2026 và claim sau V667 (V666 loại trừ gửi + V667
// nơi chạy 'server'). Dùng chung cho bài kiểm V670 (scripts/campaign-parallel-run-v670-smoke.cjs) và bộ kịch bản engine v2
// (SCENARIO_PARALLEL_RUN, scripts/engine-v2-scenarios/bootstrap.cjs). Cần DB đã dựng bằng bootstrap với SCENARIO_FACEBOOK_MIGRATIONS=1,
// SCENARIO_TARGET_CHECK=1, SCENARIO_ORPHAN_RUNS=1. Không chạm DB thật. Apply thật V666 → V667 → V670 trên DB của V667:
// scripts/campaign-parallel-run-v670-apply-smoke.cjs.
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../../..')

/** Câu CREATE FUNCTION của private.aka_agent_send_exclusion_claim_check trong migration V666 (loại trừ gửi), nguyên văn. */
function sendExclusionClaimCheckDef() {
  const text = fs.readFileSync(path.join(ROOT, 'migrations/migration_v666_send_exclusion_review_fixes.sql'), 'utf8')
  const start = 'CREATE FUNCTION private.aka_agent_send_exclusion_claim_check(p_campaign_id bigint, p_account_id bigint, p_runner text)'
  const i = text.indexOf(start)
  if (i < 0 || text.indexOf(start, i + 1) >= 0) throw new Error('V666: cần đúng một CREATE FUNCTION private.aka_agent_send_exclusion_claim_check')
  const end = '$function$;'
  const j = text.indexOf(end, text.indexOf('AS $function$', i) + 'AS $function$'.length)
  if (j < 0) throw new Error('V666: không thấy cuối hàm aka_agent_send_exclusion_claim_check')
  return text.slice(i, j + end.length)
}

/**
 * Cột / hàm production mà fixture chưa có, rồi đúng 6 hàm V670 vá ở bản V670 dựng trên (md5 khớp: 5 hàm production 26/11, claim sau V667).
 * skip: các khoá trong v670.defs không cài (DB đã chạy thật V666 → V667 thì giữ claim của nó); ledger: false thì không ghi dòng sổ V666 / V667.
 */
async function installLive(db, notes = [], { skip = [], ledger = true } = {}) {
  const v670 = require('../../build-v670-sql.cjs')
  // Claim sau V666 gọi hàm kiểm loại trừ gửi của V666 mỗi lần nhận lượt; lõi engine luôn gửi ctx.sendExclusionRunner nên hàm trả NULL ngay.
  // Hàm này gọi private.aka_agent_send_exclusion_needs_v2 (V654) chỉ khi chiến dịch có lựa chọn loại trừ theo tài khoản mà bộ chạy không báo
  // bản: DB thử chưa có V654 thì cài bản thay trả false (không chiến dịch thử nào rơi vào nhánh đó).
  await db.query('CREATE SCHEMA IF NOT EXISTS private')
  if (!(await db.query(`SELECT to_regprocedure('private.aka_agent_send_exclusion_needs_v2(jsonb,bigint)') r`)).rows[0].r) {
    await db.query(`CREATE FUNCTION private.aka_agent_send_exclusion_needs_v2(p_selection jsonb, p_account bigint) RETURNS boolean
      LANGUAGE sql IMMUTABLE AS $f$ SELECT false $f$`)
    notes.push('V670: DB thử chưa có V654, cài bản thay private.aka_agent_send_exclusion_needs_v2 (luôn false)')
  }
  if (!(await db.query(`SELECT to_regprocedure('private.aka_agent_send_exclusion_claim_check(bigint,bigint,text)') r`)).rows[0].r) {
    await db.query(sendExclusionClaimCheckDef())
  }
  await db.query(`ALTER TABLE public.auto_campaigns ADD COLUMN IF NOT EXISTS web_campaign_form text`)
  await db.query(`ALTER TABLE public.auto_campaigns ADD COLUMN IF NOT EXISTS control_idempotency_key text`)
  await db.query(`ALTER TABLE public.auto_campaign_actions ADD COLUMN IF NOT EXISTS limit_check_action_codes text[] NOT NULL DEFAULT ARRAY[]::text[]`)
  await db.query(`UPDATE public.auto_campaign_actions SET limit_check_action_codes = CASE id
      WHEN 'zalo_message_phone' THEN ARRAY['zalo_find_phone_user','zalo_message_stranger','zalo_add_friend']
      WHEN 'zalo_message_group_member' THEN ARRAY['zalo_message_stranger','zalo_add_friend']
      WHEN 'zalo_join_group_link' THEN ARRAY['zalo_join_group_link']
      WHEN 'zalo_add_group_member' THEN ARRAY['zalo_add_group_member']
      ELSE limit_check_action_codes END
    WHERE coalesce(array_length(limit_check_action_codes, 1), 0) = 0`)
  // Hàm tạo chiến dịch bên trong của Web: chỉ cần chèn dòng và trả campaign_id như bản production.
  await db.query(`CREATE OR REPLACE FUNCTION public.create_control_campaign(p_staff_id bigint, p_organization_id bigint, p_idempotency_key text,
      p_campaign jsonb, p_inputs jsonb DEFAULT '[]'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
    DECLARE v_id bigint;
    BEGIN
      INSERT INTO public.auto_campaigns (name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, control_idempotency_key)
      VALUES (p_campaign->>'name', p_campaign->>'actionId', (p_campaign->>'accountId')::bigint, 'chờ xử lý', now(), false, p_staff_id, p_organization_id, p_idempotency_key)
      RETURNING id INTO v_id;
      RETURN jsonb_build_object('created', true, 'campaign_id', v_id);
    END $f$`)
  for (const [key, d] of Object.entries(v670.defs)) {
    if (skip.includes(key)) continue
    await db.query(d.liveDef)
    const got = (await db.query(`SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m`, [d.sig])).rows[0].m
    if (got !== d.liveMd5) throw new Error(`V670 fixture: ${key} cài ra md5 ${got}, khác bản V670 dựng trên ${d.liveMd5}`)
  }
  // Sổ migration (nếu DB thử có bảng sổ): V666 loại trừ gửi và V667 p2 đã apply, như production lúc apply V670.
  if (ledger && (await db.query(`SELECT to_regclass('supabase_migrations.schema_migrations') r`)).rows[0].r) {
    for (const [version, name] of [['20261126104354', 'migration_v666_send_exclusion_review_fixes'], ['20261126999901', v670.V667_P2]]) {
      await db.query(`INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ($1, $2, '{}') ON CONFLICT DO NOTHING`, [version, name])
    }
  }
  notes.push(`V670: ${Object.keys(v670.defs).filter(k => !skip.includes(k)).join(', ')} ở bản V670 dựng trên đã cài`)
}

/** Apply V670 p1 → p2 → p3 (bản sinh) sau installLive. */
async function applyV670(db, notes = []) {
  const v670 = require('../../build-v670-sql.cjs')
  await db.query(v670.p1)
  await db.query(v670.p2)
  await db.query(v670.p3)
  notes.push('V670 ("Chạy cùng lúc", p1–p3): đã apply')
}

module.exports = { installLive, applyV670 }
