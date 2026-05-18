-- Tighten phone/Zalo group extraction for facebook_find_data_group blocks.
-- Runtime reads these block codes from Supabase, so update existing DB rows
-- in addition to keeping migration_v8 fresh for new installs.

UPDATE auto_blocks
SET
  code = replace(
    replace(
      replace(
        replace(code, E'\r\n', E'\n'),
        $$function normalizePhone(value) {
  const raw = String(value || '').trim();
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (/^0\d{9,10}$/.test(digits)) return digits;
  return '';
}$$,
        $$function normalizePhone(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[\s.\-]/g, '');
  let digits = compact.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (/^0[35789]\d{8}$/.test(digits)) return digits;
  return '';
}$$
      ),
      $$function findPhones(text) {
  const matches = String(text || '').match(/(?:\+?84|0)(?:[\s.\-()]?\d){8,10}/g) || [];
  return matches.map(normalizePhone).filter(Boolean);
}$$,
      $$function findPhones(text) {
  const matches = String(text || '').match(/(?:\+84|84|0)[\s.\-]?[35789](?:[\s.\-]?\d){8}\b/g) || [];
  return matches.map(normalizePhone).filter(Boolean);
}$$
    ),
    $$function findZaloLinks(text) {
  const matches = String(text || '').match(/https?:\/\/(?:zalo\.me|zaloapp\.com)\/[^\s"'<>),]+/gi) || [];
  return matches.map(x => x.trim()).filter(Boolean);
}$$,
    $$function findZaloLinks(text) {
  const matches = String(text || '').match(/(?:https?:\/\/)?zalo\.me\/g\/[a-z0-9]+/gi) || [];
  return matches.map(x => x.trim()).filter(Boolean);
}$$
  ),
  updated_at = now()
WHERE name IN ('fb_extract_data_from_group_posts', 'fb_extract_data_from_group_comments');
