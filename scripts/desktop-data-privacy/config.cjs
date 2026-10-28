const path = require('node:path')
const { privateSecurityAsset } = require('../desktop-session-rls/private-security-assets.cjs')
const root = path.resolve(__dirname, '../..')
const name = 'desktop-data-privacy-v436'
const roots = ['auto_account_contacts', 'auto_account_contact_groups', 'auto_contact_tags', 'auto_content_groups', 'auto_content_templates', 'auto_media_files', 'auto_media_groups']
const members = ['auto_account_contact_group_members', 'auto_media_group_items']
const tables = [...roots, ...members, 'auto_elements', 'auto_system_settings', 'org_organization', 'org_organization_product']
module.exports = {
  root, name, roots, members, tables,
  dir: path.join(root, 'migrations/snapshots', name),
  before: () => privateSecurityAsset(`migrations/snapshots/${name}/before.json`),
  migration: path.join(root, 'migrations/migration_v436_desktop_data_privacy.sql'),
  rollback: path.join(root, 'migrations/rollback_v436_desktop_data_privacy.sql'),
  quote: s => "'" + String(s).replaceAll("'", "''") + "'",
  ident: s => '"' + s.replaceAll('"', '""') + '"'
}
