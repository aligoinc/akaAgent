const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const m=require('./action-status-policy-migration.cjs')
const directory=path.join(m.root,'migrations/snapshots/action-status-policies-v362')
const before=JSON.parse(fs.readFileSync(path.join(directory,'before.json'),'utf8'))
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'))
assert.equal(m.hash(fs.readFileSync(path.join(directory,'before.json'))),manifest.sha256)
assert.equal(before.project_ref,m.ref)
m.validateSnapshot(before)
const changes=[]
function replace(body,from,to){assert.equal(body.split(from).length,2,`Expected exactly one occurrence: ${from.slice(0,100)}`);return body.split(from).join(to)}
function change(name,edit){const f=before.functions.find(f=>f.signature.startsWith(name+'('));assert(f,name);const target=edit(f.definition);assert.notEqual(target,f.definition);changes.push({...f,target});}

for(const name of ['aka_agent_enqueue_campaign_detail_automations','aka_agent_enqueue_group_only_automations']) change(name,body=>{
 body=replace(body,'AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete','AND NEW.is_delete IS NOT DISTINCT FROM OLD.is_delete\n    AND NEW.sub_status_id IS NOT DISTINCT FROM OLD.sub_status_id')
 body=replace(body,'AND lower(trigger_status.status_value) = lower(NEW.status)',`AND lower(trigger_status.status_value) = lower(NEW.status)
        AND (trigger_status.sub_status_ids IS NULL OR NEW.sub_status_id=ANY(trigger_status.sub_status_ids))
        -- A secondary observation only wakes rules whose full condition has
        -- just become true. Preserve the existing failed-enqueue reconciliation.
        AND (TG_OP<>'UPDATE' OR v_is_reconcile OR (
          trigger_status.sub_status_ids IS NULL AND (
            NEW.status IS DISTINCT FROM OLD.status OR NEW.action_code IS DISTINCT FROM OLD.action_code
            OR NEW.is_delete IS DISTINCT FROM OLD.is_delete
          )
        ) OR (
          trigger_status.sub_status_ids IS NOT NULL AND NOT COALESCE(
            NOT COALESCE(OLD.is_delete,false)
            AND lower(trigger_status.status_value)=lower(OLD.status)
            AND (trigger_status.action_code IS NULL OR trigger_status.action_code IS NOT DISTINCT FROM OLD.action_code)
            AND OLD.sub_status_id=ANY(trigger_status.sub_status_ids),false
          )
        ))`)
 if(name==='aka_agent_enqueue_campaign_detail_automations') body=replace(body,'AND lower(status_catalog.name) = lower(NEW.status)',`AND ((NEW.status_id IS NOT NULL AND status_catalog.id=NEW.status_id)
        OR (NEW.status_id IS NULL AND (status_catalog.status_value=NEW.status
          OR (status_catalog.status_value IS NULL AND lower(status_catalog.name)=lower(NEW.status)))))`)
 return body
})

change('auto_automation_to_json',body=>replace(body,"'status_value', trigger_status.status_value,",`'status_value', trigger_status.status_value,
          'sub_status_ids', trigger_status.sub_status_ids,
          'sub_status_labels', (SELECT jsonb_agg(s.name ORDER BY selected.position)
            FROM unnest(trigger_status.sub_status_ids) WITH ORDINALITY selected(id,position)
            JOIN public.auto_status s ON s.id=selected.id),`))
change('aka_agent_get_automation_options',body=>replace(body,"SELECT jsonb_build_object(\n    'automation_actions'",`SELECT jsonb_build_object(
    'result_statuses', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',s.id,'code',s.code,'name',s.name,'status_value',s.status_value,'color',s.color,
      'flatform_type',s.flatform_type,'description',s.description
    ) ORDER BY s.sort_order,s.id) FROM public.auto_status s
      WHERE s.component_type='campaign_detail' AND s.is_active AND NOT s.is_delete),'[]'::jsonb),
    'automation_actions'`))

for(const name of ['auto_save_automation_v171_internal','aka_agent_save_automation_v205_internal']) change(name,body=>{
 body=replace(body,'  v_status jsonb;','  v_status jsonb;\n  v_previous_trigger_statuses jsonb := \'[]\'::jsonb;\n  v_sub_status_json jsonb;\n  v_sub_status_ids bigint[];')
 body=replace(body,'    DELETE FROM public.auto_automation_trigger_statuses AS trigger_status',`    SELECT COALESCE(jsonb_agg(to_jsonb(trigger_status)),'[]'::jsonb)
    INTO v_previous_trigger_statuses FROM public.auto_automation_trigger_statuses trigger_status
    WHERE trigger_status.automation_id=v_rule_id;
    DELETE FROM public.auto_automation_trigger_statuses AS trigger_status`)
 const mapping=name==='auto_save_automation_v171_internal'?'v_status_mapping_id':'v_mapping.id'
 body=replace(body,'    INSERT INTO public.auto_automation_trigger_statuses (',`    -- Missing field from an old client preserves the same saved condition.
    -- Explicit JSON null clears the filter; an empty or malformed array fails.
    v_sub_status_json:=CASE
      WHEN v_status ? 'subStatusIds' THEN v_status->'subStatusIds'
      WHEN v_status ? 'sub_status_ids' THEN v_status->'sub_status_ids'
      ELSE (SELECT p->'sub_status_ids' FROM jsonb_array_elements(v_previous_trigger_statuses) p
        WHERE (p->>'status_mapping_id')::bigint=${mapping} LIMIT 1) END;
    v_sub_status_ids:=NULL;
    IF v_sub_status_json IS NOT NULL AND v_sub_status_json<>'null'::jsonb THEN
      IF jsonb_typeof(v_sub_status_json)<>'array' THEN RAISE EXCEPTION 'invalid_automation_sub_status_ids'; END IF;
      IF jsonb_array_length(v_sub_status_json)=0 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_sub_status_json) i
        WHERE jsonb_typeof(i)<>'number' OR i::text !~ '^[1-9][0-9]*$'
      ) THEN RAISE EXCEPTION 'invalid_automation_sub_status_ids'; END IF;
      SELECT array_agg(DISTINCT i::text::bigint ORDER BY i::text::bigint) INTO v_sub_status_ids
      FROM jsonb_array_elements(v_sub_status_json) i;
    END IF;
    INSERT INTO public.auto_automation_trigger_statuses (`)
 if(name==='auto_save_automation_v171_internal') {
  body=replace(body,'      action_code,\n      status_value\n    )\n    VALUES (','      action_code,\n      status_value,\n      sub_status_ids\n    )\n    VALUES (')
  body=replace(body,'      v_action_code,\n      v_status_value\n    )','      v_action_code,\n      v_status_value,\n      v_sub_status_ids\n    )')
 } else {
  body=replace(body,'      automation_id, status_mapping_id, action_code, status_value\n','      automation_id, status_mapping_id, action_code, status_value, sub_status_ids\n')
  body=replace(body,'      v_rule_id, v_mapping.id, v_mapping.action_code, v_mapping.status_value\n','      v_rule_id, v_mapping.id, v_mapping.action_code, v_mapping.status_value, v_sub_status_ids\n')
  body=replace(body,'    AND wildcard.status_mapping_id = wildcard_mapping.id',`    AND wildcard.status_mapping_id = wildcard_mapping.id
    AND (wildcard.sub_status_ids IS NULL OR (
      specific.sub_status_ids IS NOT NULL AND specific.sub_status_ids <@ wildcard.sub_status_ids
    ))`)
 }
 return body
})

change('aka_agent_save_automation',body=>{
 const carry=` || CASE
          WHEN v_status ? 'subStatusIds' THEN jsonb_build_object('subStatusIds',v_status->'subStatusIds')
          WHEN v_status ? 'sub_status_ids' THEN jsonb_build_object('subStatusIds',v_status->'sub_status_ids')
          ELSE '{}'::jsonb END`
 body=replace(body,"          'statusValue', v_mapping.status_value\n        )", "          'statusValue', v_mapping.status_value\n        )"+carry)
 body=replace(body,"            ''\n          )), '')\n        )\n      );", "            ''\n          )), '')\n        )"+carry+"\n      );")
 body=replace(body,"      WHERE NULLIF(btrim(COALESCE(wildcard.value ->> 'actionCode', '')), '') IS NULL",`      WHERE NULLIF(btrim(COALESCE(wildcard.value ->> 'actionCode', '')), '') IS NULL
        AND (
          wildcard.value->'subStatusIds'='null'::jsonb
          OR (jsonb_typeof(wildcard.value->'subStatusIds')='array'
            AND jsonb_typeof(candidate.value->'subStatusIds')='array'
            AND (candidate.value->'subStatusIds') <@ (wildcard.value->'subStatusIds'))
          OR (NOT (wildcard.value ? 'subStatusIds') AND NOT EXISTS (
            SELECT 1 FROM public.auto_automation_trigger_statuses saved
            WHERE saved.automation_id=p_automation_id AND saved.sub_status_ids IS NOT NULL
          ))
        )`)
 return body
})

for(const [name,eventCode,legacyText] of [['aka_agent_mark_email_open','campaign_detail_viewed','đã xem'],['aka_agent_mark_email_click','campaign_detail_clicked','đã click']]) change(name,body=>{
 const start=body.indexOf('    UPDATE public.auto_campaign_details')
 assert(start>0)
 const end=body.indexOf(';',start)+1
 const legacy=body.slice(start,end)
 const observation=`    -- Policy-managed results keep their original main result, log, quota and
    -- report group. A later real observation only changes the secondary ID.
    UPDATE public.auto_campaign_details d
    SET sub_status_id=s.id
    FROM public.auto_status s
    WHERE d.id=v_message.campaign_detail_id AND d.action_code='email_send'
      AND d.status_id IS NOT NULL AND d.report_group='success' AND NOT d.is_delete
      AND s.code='${eventCode}' AND s.component_type='campaign_detail'
      AND d.sub_status_id IS DISTINCT FROM s.id
      ${eventCode==='campaign_detail_viewed'?"AND NOT EXISTS (SELECT 1 FROM public.auto_status old WHERE old.id=d.sub_status_id AND old.code='campaign_detail_clicked')":''};
${legacy.replace("      AND is_delete = false", "      AND status_id IS NULL\n      AND is_delete = false")}`
 assert(legacy.includes(`SET status = '${legacyText}'`))
 assert(observation.includes('AND status_id IS NULL'))
 return body.slice(0,start)+observation+body.slice(end)
})

for(const name of ['crm_agent_campaign_results','crm_trial_campaign_signal_counts']) change(name,body=>{
 body=replace(body,"d.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')", "(d.report_group='success' OR (d.report_group IS NULL AND d.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')))")
 body=replace(body,"d.status IN ('thất bại', 'lỗi', 'không tồn tại')", "(d.report_group='failure' OR (d.report_group IS NULL AND d.status IN ('thất bại', 'lỗi', 'không tồn tại')))")
 if(name==='crm_agent_campaign_results') {
  body=replace(body,'result.failed, queue.pending','result.failed, result.managed_pending + queue.pending')
  body=replace(body,' AS failed\n    FROM public.auto_campaign_details d'," AS failed, count(*) FILTER (WHERE d.report_group='pending') AS managed_pending\n    FROM public.auto_campaign_details d")
  body=replace(body,"i.status = 'chờ xử lý'",`i.status = 'chờ xử lý'
      AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_details existing
        WHERE existing.input_data_id=i.id AND existing.campaign_id=c.id
          AND existing.is_delete=false AND existing.report_group='pending')`)
 }
 return body
})

change('aka_agent_record_sms_message_status',body=>{
 body=replace(body,'    detail.status,\n    detail.log,','    detail.status,\n    detail.status_id,\n    detail.sub_status_id,\n    detail.log,')
 body=replace(body,'  IF NOT v_existing_found THEN',`  -- Delivery observations never repeat a managed send or recalculate its
  -- committed decisions. Old mobile clients/legacy rows retain the old path.
  IF v_existing_found AND v_existing.status_id IS NOT NULL THEN
    UPDATE public.auto_campaign_details d SET sub_status_id=s.id,
      data=COALESCE(d.data,'{}'::jsonb)||v_detail_data
    FROM public.auto_status s
    WHERE d.id=v_existing.id AND s.component_type='campaign_detail'
      AND s.code=CASE p_detail_status WHEN 'đã nhận' THEN 'campaign_detail_received'
        WHEN 'thất bại' THEN 'campaign_detail_failed' ELSE 'campaign_detail_sent' END
      AND s.is_active AND NOT s.is_delete AND d.sub_status_id IS DISTINCT FROM s.id
      AND NOT EXISTS (SELECT 1 FROM public.auto_status prior WHERE prior.id=d.sub_status_id
        AND prior.code='campaign_detail_received');
    RETURN QUERY SELECT p_input_data_id,v_input.campaign_id,v_existing.id,v_existing.status,
      false,false,true,NULL::text;
    RETURN;
  END IF;

  IF NOT v_existing_found THEN`)
 return body
})

for(const name of ['fn_opp_ctx','fn_opp_trial_state']) change(name,body=>replace(body,
 "d.status in ('thành công','đã xem','đã tham gia')",
 "(d.report_group='success' OR (d.report_group IS NULL AND d.status in ('thành công','đã xem','đã tham gia')))"))

// Resolve display metadata only for the already bounded page. Historical
// reporting never joins current policies, and old rows retain their stored text.
for(const name of ['aka_agent_list_campaign_details_page','aka_agent_list_campaign_details_page_v2']) change(name,body=>{
 body=replace(body,'to_jsonb(detail)',`(to_jsonb(detail) || jsonb_build_object(
          'status_presentation', CASE WHEN main_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',main_status.code,'name',main_status.name,'color',main_status.color) END,
          'sub_status_presentation', CASE WHEN sub_status.id IS NULL THEN NULL ELSE jsonb_build_object('code',sub_status.code,'name',sub_status.name,'color',sub_status.color) END))`)
 return replace(body,'JOIN public.auto_campaign_details AS detail ON detail.id = page.id',`JOIN public.auto_campaign_details AS detail ON detail.id = page.id
        LEFT JOIN public.auto_status main_status ON main_status.id=detail.status_id
        LEFT JOIN public.auto_status sub_status ON sub_status.id=detail.sub_status_id`)
})

const guard=changes.map(f=>{
 const signature=m.quote('public.'+f.signature.replace(/^public\./,''))
 const attrs={owner:f.owner,security_definer:f.security_definer,volatility:f.volatility,settings:f.settings,acl:f.acl}
 return `IF to_regprocedure(${signature}) IS NULL OR md5(pg_get_functiondef(to_regprocedure(${signature})))<>${m.quote(f.md5)} THEN RAISE EXCEPTION 'v362 live function changed: ${f.signature}'; END IF;
IF (SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl) FROM pg_proc p WHERE p.oid=to_regprocedure(${signature})) IS DISTINCT FROM ${m.jsonSQL(attrs,'attributes')} THEN RAISE EXCEPTION 'v362 live function attributes changed: ${f.signature}'; END IF;`
}).join('\n')
const triggers=before.schema.find(s=>s.table==='auto_campaign_details').triggers.filter(t=>/aka_agent_enqueue_campaign_detail_automations\(\)|aka_agent_enqueue_group_only_automations\(\)/.test(t.definition))
assert.equal(triggers.length,2)
const triggerSQL=triggers.map(t=>t.definition.replace(/^CREATE TRIGGER /,'CREATE OR REPLACE TRIGGER ').replace('UPDATE OF status, action_code, is_delete','UPDATE OF status, action_code, is_delete, sub_status_id')+';').join('\n')
assert(triggerSQL.includes('sub_status_id'))
const sql=`-- Reader/Automation compatibility, built only from the captured live definitions.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
IF to_regclass('public.auto_account_action_status_policies') IS NULL THEN RAISE EXCEPTION 'v362 requires v361'; END IF;
${guard}
${triggers.map(t=>`IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.auto_campaign_details'::regclass AND tgname=${m.quote(t.name)}) IS DISTINCT FROM ${m.quote(t.definition)} THEN RAISE EXCEPTION 'v362 live trigger changed: ${t.name}'; END IF;`).join('\n')}
END $guard$;
${changes.map(f=>f.target.trim()+';').join('\n')}
${triggerSQL}
GRANT SELECT ON public.auto_status TO aka_agent_chat_api;
COMMIT;
`
fs.writeFileSync(path.join(m.root,'migrations/migration_v362_action_status_readers.sql'),sql)
fs.writeFileSync(path.join(directory,'changes.json'),JSON.stringify(changes.map(({definition,target,...f})=>({...f,source:definition,target})),null,2)+'\n')
console.log(JSON.stringify({functions:changes.length,triggers:triggers.length}))
