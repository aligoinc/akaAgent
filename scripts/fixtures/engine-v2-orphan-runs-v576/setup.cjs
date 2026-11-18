// DB thử cho V576 (scripts/build-v576-sql.cjs): nạp đúng thân production đọc 18/11 của các hàm V576 kiểm md5 trước khi apply (close_stale,
// report_v1 nếu DB thử khác; hàm reset của Desktop và hàm reset bên trong) cùng hai hàm / một bảng tối thiểu mà hàm reset gọi. Không chạm DB thật.
'use strict'
const V = require('../../build-v576-sql.cjs')

const WRAPPER_STUBS = `
DO $s$ BEGIN
  IF to_regprocedure('public.aka_agent_staff_runtime_scope(bigint,text)') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION public.aka_agent_staff_runtime_scope(p_staff_id bigint, p_lock text) RETURNS TABLE(id bigint, organization_id bigint)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $b$
      BEGIN
        IF private.aka_agent_staff_scope_for_request() IS NOT NULL AND p_staff_id IS DISTINCT FROM private.aka_agent_staff_scope_for_request() THEN RETURN; END IF;
        RETURN QUERY SELECT s.id, s.organization_id FROM public.org_staff AS s WHERE s.id = p_staff_id FOR UPDATE OF s;
      END $b$$f$;
  END IF;
  IF to_regprocedure('public.aka_agent_lock_campaign_input_serialization(bigint)') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION public.aka_agent_lock_campaign_input_serialization(p_campaign_id bigint) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $b$
      BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || p_campaign_id::text, 0)); END $b$$f$;
  END IF;
  IF to_regclass('public.auto_campaign_inputs') IS NULL THEN
    CREATE TABLE public.auto_campaign_inputs (id bigserial PRIMARY KEY, campaign_id bigint, status text, note text, is_delete boolean DEFAULT false);
  END IF;
END $s$;
`

/** Dựng phần V576 cần (không apply V576). notes: ghi chú. */
async function prepareV576(db, notes = []) {
  const md5Of = async sig => (await db.query(`SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m`, [`public.${sig}`])).rows[0].m
  await db.query(WRAPPER_STUBS)
  const live = V.LIVE.functions
  for (const sig of [V.SIG.closeStale, V.SIG.report]) {
    if (await md5Of(sig) !== live[sig].md5) { notes.push(`${sig}: nạp bản production 18/11`); await db.query(live[sig].definition) }
  }
  for (const sig of ['reset_desktop_running_statuses(bigint,boolean,boolean)', V.SIG.wrapper]) await db.query(live[sig].definition)
  await db.query(`GRANT EXECUTE ON FUNCTION public.${V.SIG.wrapper} TO aka_agent_desktop`)
  return notes
}

/** Dựng rồi apply V576. */
async function applyV576(db, notes = []) {
  await prepareV576(db, notes)
  await db.query(V.migration)
  notes.push('V576 (đóng lượt bị bỏ dở: mồ côi, chốt theo kết quả, reset Desktop): đã apply')
  return notes
}

module.exports = { WRAPPER_STUBS, prepareV576, applyV576 }
