// Data-only follow-up; never rewrite the already applied initial migration.
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'migrations/snapshots/facebook-native-group-share')
const snapshot = JSON.parse(fs.readFileSync(path.join(dir, 'search-wait-before.json'), 'utf8'))
const name = 'fb_select_native_share_group'
const before = snapshot.blocks.find(row => row.name === name)
if (!before) throw new Error('Missing live block baseline')
const after = { ...before, code: fs.readFileSync(path.join(root, 'scripts/workflows/facebook-native-group-share/select.js'), 'utf8') }
const comparable = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['id', 'created_at', 'updated_at'].includes(key)))
const json = (value, tag) => `$${tag}$${JSON.stringify(comparable(value))}$${tag}$::jsonb`
function build(from, to, tag) {
  return `-- Native group share: ten-second search wait and atomic selection in its dialog.
-- Updates only code/updated_at of the named block; refuses live code or metadata drift.
BEGIN;
DO $search_wait$
DECLARE baseline jsonb := ${json(from, 'baseline')};
        target jsonb := ${json(to, 'target')};
        current_row jsonb;
BEGIN
  IF (SELECT count(*) FROM public.auto_blocks WHERE name = baseline->>'name') <> 1 THEN
    RAISE EXCEPTION '${tag}_missing_or_duplicate';
  END IF;
  SELECT to_jsonb(b)-'id'-'created_at'-'updated_at' INTO current_row
  FROM public.auto_blocks b WHERE name = baseline->>'name' FOR UPDATE;
  IF current_row IS DISTINCT FROM baseline AND current_row IS DISTINCT FROM target THEN
    RAISE EXCEPTION '${tag}_drift';
  END IF;
  UPDATE public.auto_blocks SET code = target->>'code', updated_at = now()
  WHERE name = target->>'name' AND current_row IS DISTINCT FROM target;
END $search_wait$;
COMMIT;
`
}
const sql = build(before, after, 'native_group_share_search_wait')
const rollbackSql = build(after, before, 'native_group_share_search_wait_rollback')
const migrationPath = path.join(root, 'supabase/migrations/20261023162331_facebook_native_group_share_search_wait.sql')
const rollbackPath = path.join(dir, 'search-wait-rollback.sql')
if (require.main === module) {
  fs.writeFileSync(migrationPath, sql)
  fs.writeFileSync(rollbackPath, rollbackSql)
  console.log(path.relative(root, migrationPath))
}
module.exports = { snapshot, before, after, sql, rollbackSql, migrationPath, comparable }
