// Generate only from the live source capture. Does not connect to or apply a database.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..'), dir = path.join(root, 'migrations/snapshots/facebook-group-export')
const source = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8'))
if (source.projectRef !== 'cgjbsmqtfhqvttudyjzq') throw new Error('Wrong project')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const replace = (text, from, to) => {
  if (text.split(from).length !== 2) throw new Error('Live fragment missing/ambiguous: ' + from)
  return text.replace(from, to)
}
const targets = source.functions.map(row => {
  if (md5(row.definition) !== row.checksum) throw new Error('Corrupt capture')
  let definition = row.definition
  const filtered = row.signature.includes('read_filtered_group')
  const flag = `${filtered ? 'p_query' : 'p_data'}->>'includeFacebookGroupMetadata'='true'`
  const order = " ORDER BY (m->>'created_at')::timestamptz DESC,(m->>'id')::bigint DESC"
  const extra = ` || CASE WHEN ${flag} THEN jsonb_build_object('facebook_group_metadata',
      CASE WHEN export_contact.flatform_type='facebook' THEN jsonb_build_object(
        'memberCount',export_contact.extra_data->'memberCount','postsPerDay',export_contact.extra_data->'postsPerDay',
        'privacy',export_contact.extra_data->'privacy') END) ELSE '{}'::jsonb END`
  if (filtered) {
    definition = replace(definition, "'provenance','[]'::jsonb) END),'[]') INTO rows",
      "'provenance','[]'::jsonb) END" + extra + order + "),'[]') INTO rows")
    definition = replace(definition, "selected_ids,NULL,0,page_limit) m;",
      `selected_ids,NULL,0,page_limit) m
  LEFT JOIN public.auto_account_contacts export_contact ON ${flag}
    AND export_contact.id=(m->>'contact_id')::bigint AND export_contact.staff_id=owner_id
    AND export_contact.organization_id=p_organization_id;`)
  } else {
    definition = replace(definition, "'dataset_ids','[]'::jsonb,'dataset_names','[]'::jsonb,'provenance','[]'::jsonb) END),'[]'::jsonb)",
      "'dataset_ids','[]'::jsonb,'dataset_names','[]'::jsonb,'provenance','[]'::jsonb) END" + extra + order + "),'[]'::jsonb)")
    definition = replace(definition, "LEAST(1000,COALESCE((p_data->>'limit')::integer,100))) m);",
      `LEAST(1000,COALESCE((p_data->>'limit')::integer,100))) m
    LEFT JOIN public.auto_account_contacts export_contact ON ${flag}
      AND export_contact.id=(m->>'contact_id')::bigint AND export_contact.staff_id=v_owner
      AND export_contact.organization_id=p_organization_id);`)
  }
  return { ...row, definition, checksum: md5(definition), sourceChecksum: row.checksum }
})
const signature = 'public.aka_agent_get_campaign_group_export_metadata(bigint,bigint,bigint,bigint[],text,text)'
const create = fs.readFileSync(path.join(__dirname, 'campaign-metadata.sql'), 'utf8')
const manifest = rows => JSON.stringify(rows.map(({definition, ...r}) => r))
const guard = rows => `DO $guard$ DECLARE e jsonb; a record; BEGIN
 FOR e IN SELECT value FROM jsonb_array_elements($manifest$${manifest(rows)}$manifest$::jsonb) LOOP
  SELECT md5(pg_get_functiondef(p.oid)) checksum,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text acl
   INTO a FROM pg_proc p WHERE p.oid=to_regprocedure(e->>'signature');
  IF NOT FOUND OR a.checksum IS DISTINCT FROM e->>'checksum' OR a.owner IS DISTINCT FROM e->>'owner'
   OR a.prosecdef IS DISTINCT FROM (e->>'prosecdef')::boolean OR a.provolatile::text IS DISTINCT FROM e->>'provolatile'
   OR to_jsonb(a.proconfig) IS DISTINCT FROM e->'proconfig' OR a.acl IS DISTINCT FROM e->>'acl' THEN
   RAISE EXCEPTION 'V443 function drift: %',e->>'signature'; END IF;
 END LOOP;
END $guard$;\n`
const newTargetPath = path.join(dir, 'new-rpc-target.json')
const newTarget = fs.existsSync(newTargetPath) ? JSON.parse(fs.readFileSync(newTargetPath, 'utf8')) : null
const migration = `-- V443: export-only Facebook group metadata. No runtime/collector changes.
-- Generated from captured live definitions; preserve staff, sharing/revoke, filters and 60s timeouts.
BEGIN;
SET LOCAL lock_timeout='5s';
${guard([...source.functions, ...source.dependencies])}
DO $guard$ BEGIN IF to_regprocedure('${signature}') IS NOT NULL THEN
 RAISE EXCEPTION 'V443 target already exists; inspect before applying'; END IF; END $guard$;
${targets.map(r => r.definition + ';').join('\n')}
${create}
REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ${signature} TO service_role,aka_agent_desktop;
${guard(targets)}
${newTarget ? guard([newTarget]) : '-- New RPC target checksum is captured by the rollback rehearsal before handoff.'}
-- A new public RPC requires schema discovery; no reload occurs in rollback rehearsals.
NOTIFY pgrst, 'reload schema';
COMMIT;
`
fs.writeFileSync(path.join(root, 'migrations/migration_v443_facebook_group_export.sql'), migration)
fs.writeFileSync(path.join(dir, 'target.json'), JSON.stringify({projectRef:source.projectRef, functions:targets}, null, 2)+'\n')
if (newTarget) fs.writeFileSync(path.join(dir, 'rollback.sql'), `-- Explicit rollback only; no business data is changed.\nBEGIN;\nSET LOCAL lock_timeout='5s';\n${guard([...targets,newTarget])}
DROP FUNCTION ${signature};
${source.functions.map(r=>r.definition+';').join('\n')}
${guard(source.functions)}NOTIFY pgrst, 'reload schema';\nCOMMIT;\n`)
console.log('Generated V443 from live capture; production not changed.')
