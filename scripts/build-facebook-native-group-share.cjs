// Builds a reviewable data-only candidate from the captured live workflow.
// No network, DB connection or apply command.
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'migrations/snapshots/facebook-native-group-share')
const before = JSON.parse(fs.readFileSync(path.join(dir, 'before.json'), 'utf8'))
const blockFiles = { fb_prepare_native_group_share: 'prepare.js', fb_select_native_share_group: 'select.js', fb_submit_native_group_share: 'submit.js' }
const blocks = Object.entries(blockFiles).map(([name,file], i) => ({id: -1001-i, name,
  code: fs.readFileSync(path.join(root, 'scripts/workflows/facebook-native-group-share',file),'utf8'),
  category:'facebook',kind:'js',is_builtin:true,config_schema:[],output_schema:[],default_config:{},
  description:'Native share of a specific source post into one group; version 1.'}))
// The initial migration is already applied. Runtime fixtures use current source,
// while regenerating that migration must retain its original block definitions.
const appliedBlocks = JSON.parse(fs.readFileSync(path.join(dir, 'search-wait-before.json'), 'utf8')).blocks
const migrationBlocks = blocks.map(block => ({ ...block, code: appliedBlocks.find(row => row.name === block.name).code }))
const elements = [
 {name:'fb_group_share_target_title',xpath:"//*[@role='main']//h1",description:'Tên nhóm hiện tại để tìm trong hộp chia sẻ.'},
 {name:'fb_share_to_group_button',xpath:"//*[@role='dialog']//*[@role='button' and @aria-label='Chia sẻ lên nhóm']",description:'Chọn chia sẻ bài viết lên nhóm.'},
 {name:'fb_share_group_result',xpath:"//*[@role='dialog']//a[contains(@href,'/groups/') and ancestor::*[@role='button']]",description:'Link định danh của kết quả chọn nhóm.'},
 {name:'fb_share_group_search_empty',xpath:"//*[@role='dialog']//*[normalize-space(text())='Không có nhóm nào khớp với tìm kiếm của bạn.']",description:'Kết quả tìm nhóm rỗng đã xác minh DOM ngày 23/10/2026.'}
].map(e=>({...e,category:'facebook',is_builtin:true}))
function patchWorkflow(source) {
 const w=structuredClone(source)
 const gate=w.edges.find(e=>e.source==='if_skip_known_approval'&&e.sourceHandle==='false'&&e.target==='open_composer')
 if(!gate)throw Error('Live workflow gate changed')
 gate.target='if_native_group_share'
 w.nodes.push({id:'if_native_group_share',blockId:1,blockName:'if_else',systemType:'ifElse',label:'Chia sẻ bài viết nguồn vào nhóm?',position:{x:600,y:200},config:{condition:'vars.groupPostShareFromPost === true'}},
 ...blocks.map((b,i)=>({id:b.name,blockId:b.id,blockName:b.name,label:b.name,position:{x:600,y:350+i*150},config:{}})),
 {id:'if_native_group_selected',blockId:1,blockName:'if_else',systemType:'ifElse',position:{x:600,y:575},config:{condition:'vars.groupShareSelected === true'}})
 const edge=(source,target,sourceHandle)=>({id:`native-${source}-${target}`,source,target,...(sourceHandle?{sourceHandle}:{})})
 w.edges.push(edge('if_native_group_share','open_composer','false'),edge('if_native_group_share',blocks[0].name,'true'),
 edge(blocks[0].name,blocks[1].name),edge(blocks[1].name,'if_native_group_selected'),
 edge('if_native_group_selected',blocks[2].name,'true'),edge('if_native_group_selected','merge_join','false'),edge(blocks[2].name,'merge_join'))
 w.default_variables={...w.default_variables,groupPostShareFromPost:false,groupPostShareCaption:'',groupPostShareWorkflowVersion:1,
 resultStatusDeclarations:[...(w.default_variables.resultStatusDeclarations||[]),{actionCode:'fb_post_group',statusCodes:['campaign_detail_skipped','campaign_detail_success','campaign_detail_error']} ]}
 w.variables_schema.push({name:'groupPostShareFromPost',type:'boolean',label:'Chia sẻ bài viết nguồn vào nhóm',default:false},
 {name:'groupPostShareCaption',type:'textarea',label:'Nội dung kèm bài chia sẻ',default:''})
 return w
}
const after=before.workflows.map(patchWorkflow)
const json=(value,tag)=>`$${tag}$${JSON.stringify(value)}$${tag}$::jsonb`
const workflowSql=after.map((w,i)=>`baseline := ${json(before.workflows[i],'before_'+i)};
 target := ${json(w,'after_'+i)};
 SELECT jsonb_agg(CASE WHEN (n->>'blockId')::bigint<0 THEN jsonb_set(n,'{blockId}',to_jsonb((SELECT id FROM public.auto_blocks WHERE name=n->>'blockName'))) ELSE n END ORDER BY ord)
 INTO nodes FROM jsonb_array_elements(target->'nodes') WITH ORDINALITY a(n,ord);
 target := jsonb_set(target,'{nodes}',nodes);
 SELECT to_jsonb(w) INTO current_row FROM public.auto_workflows w WHERE w.name=baseline->>'name' FOR UPDATE;
 IF (SELECT count(*) FROM public.auto_workflows WHERE name=baseline->>'name')<>1 OR current_row IS NULL OR (current_row-'created_at'-'updated_at' IS DISTINCT FROM baseline-'created_at'-'updated_at'
   AND current_row-'created_at'-'updated_at' IS DISTINCT FROM target-'created_at'-'updated_at')
 THEN RAISE EXCEPTION 'native_group_share_workflow_changed: %',baseline->>'name'; END IF;
 UPDATE public.auto_workflows SET nodes=target->'nodes',edges=target->'edges',default_variables=target->'default_variables',variables_schema=target->'variables_schema',updated_at=now()
 WHERE name=target->>'name' AND current_row-'created_at'-'updated_at' IS DISTINCT FROM target-'created_at'-'updated_at';`).join('\n')
const sql=`-- Candidate only. Captured live workflow definitions: 23 October 2026.
-- Atomic and idempotent. Refuses drift; preserves shared blocks/elements and RPCs.
BEGIN;
DO $native_share$
DECLARE item jsonb; baseline jsonb; target jsonb; current_row jsonb; nodes jsonb;
BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(${json(before.elements,'existing_elements')}) LOOP
  IF (SELECT count(*) FROM public.auto_elements WHERE name=item->>'name')<>1
    OR (SELECT xpath FROM public.auto_elements WHERE name=item->>'name') IS DISTINCT FROM item->>'xpath'
  THEN RAISE EXCEPTION 'native_group_share_element_changed: %',item->>'name'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(${json(elements,'new_elements')}) LOOP
  IF (SELECT count(*) FROM public.auto_elements WHERE name=item->>'name')>1
    OR EXISTS(SELECT 1 FROM public.auto_elements WHERE name=item->>'name' AND xpath IS DISTINCT FROM item->>'xpath')
  THEN RAISE EXCEPTION 'native_group_share_element_collision: %',item->>'name'; END IF;
  INSERT INTO public.auto_elements(name,xpath,category,is_builtin,description)
    SELECT item->>'name',item->>'xpath','facebook',true,item->>'description'
    WHERE NOT EXISTS(SELECT 1 FROM public.auto_elements WHERE name=item->>'name');
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(${json(migrationBlocks,'new_blocks')}) LOOP
  IF (SELECT count(*) FROM public.auto_blocks WHERE name=item->>'name')>1
    OR EXISTS(SELECT 1 FROM public.auto_blocks WHERE name=item->>'name' AND
      (code IS DISTINCT FROM item->>'code' OR kind IS DISTINCT FROM 'js' OR config_schema IS DISTINCT FROM '[]'::jsonb OR output_schema IS DISTINCT FROM '[]'::jsonb OR default_config IS DISTINCT FROM '{}'::jsonb))
  THEN RAISE EXCEPTION 'native_group_share_block_collision: %',item->>'name'; END IF;
  INSERT INTO public.auto_blocks(name,code,category,kind,is_builtin,description,config_schema,output_schema,default_config)
    SELECT item->>'name',item->>'code','facebook','js',true,item->>'description','[]','[]','{}'
    WHERE NOT EXISTS(SELECT 1 FROM public.auto_blocks WHERE name=item->>'name');
 END LOOP;
 ${workflowSql}
END $native_share$;
COMMIT;
`
const migration=path.join(root,'supabase/migrations/20261023142009_facebook_native_group_share.sql')
const rollbackSql=`-- Guarded rollback; keeps inert blocks/elements for run history.
BEGIN;
DO $rollback$
DECLARE baseline jsonb; target jsonb; current_row jsonb; nodes jsonb;
BEGIN
${after.map((w,i)=>`baseline := ${json(before.workflows[i],'before_'+i)};
 target := ${json(w,'after_'+i)};
 SELECT jsonb_agg(CASE WHEN (n->>'blockId')::bigint<0 THEN jsonb_set(n,'{blockId}',to_jsonb((SELECT id FROM public.auto_blocks WHERE name=n->>'blockName'))) ELSE n END ORDER BY ord)
 INTO nodes FROM jsonb_array_elements(target->'nodes') WITH ORDINALITY a(n,ord);
 target := jsonb_set(target,'{nodes}',nodes);
 SELECT to_jsonb(w) INTO current_row FROM public.auto_workflows w WHERE w.name=baseline->>'name' FOR UPDATE;
 IF (SELECT count(*) FROM public.auto_workflows WHERE name=baseline->>'name')<>1 OR current_row IS NULL OR (current_row-'created_at'-'updated_at' IS DISTINCT FROM target-'created_at'-'updated_at' AND current_row-'created_at'-'updated_at' IS DISTINCT FROM baseline-'created_at'-'updated_at')
 THEN RAISE EXCEPTION 'native_group_share_rollback_drift: %',baseline->>'name'; END IF;
 UPDATE public.auto_workflows SET nodes=baseline->'nodes',edges=baseline->'edges',default_variables=baseline->'default_variables',variables_schema=baseline->'variables_schema',updated_at=now() WHERE name=baseline->>'name';`).join('\n')}
END $rollback$;
COMMIT;
`
if(require.main===module){
 fs.writeFileSync(migration,sql)
 fs.writeFileSync(path.join(dir,'rollback.sql'),rollbackSql)
 console.log(path.relative(root,migration))
}
module.exports={before,after,blocks,elements,sql,rollbackSql,patchWorkflow}
