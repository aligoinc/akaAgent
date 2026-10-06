"""Build v351 from the captured LIVE rows, never from historical migrations."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = json.loads((ROOT / 'migrations/snapshots/campaign-content-v350/source.json').read_text())
blocks = {b['name']: b for b in source['blocks']}
changed = {}

def replace(code, old, new):
    assert code.count(old) == 1, (old[:160], code.count(old))
    return code.replace(old, new, 1)

def patch(name, old, new):
    changed[name] = replace(changed.get(name, blocks[name]['code']), old, new)

# New consumers allocate once and hand media to subsequent technical steps.
for name, var, initial, render, rewrite in [
    ('fb_type_post_content','text',"String(input.content || vars.campaignContent || '')",'await renderContentTemplate(text)','await rewriteContentForRun(text)'),
    ('fb_share_post','content',"String(input.content || vars.campaignContent || '')",'await renderContentTemplate(content)','await rewriteContentForRun(content)'),
    ('fb_post_reels','content',"String(input.content || vars.campaignContent || '')",'await renderContentTemplate(content)','await rewriteContentForRun(content)'),
    ('fb_page_post_api','message',"String(vars.campaignContent || input.campaignContent || '').trim()",'(await renderContentTemplate(message)).trim()','(await rewriteContentForRun(message)).trim()'),
    ('fb_post_current_identity_ui','message',"String(vars.campaignContent || input.campaignContent || '').trim()",'(await renderContentTemplate(message)).trim()','(await rewriteContentForRun(message)).trim()'),
    ('fb_send_page_inbox_message','message',"String(vars.campaignContent || input.campaignContent || '').replace(/\\t/g, '      ')",'(await renderContentTemplate(message)).trim()','(await rewriteContentForRun(message)).trim()'),
]:
    old=f'let {var} = {initial}\n{var} = {render}\n{var} = {rewrite}'
    new=f'''let {var}
if (typeof helpers.prepareCampaignContent === 'function') {{
  const prepared = await helpers.prepareCampaignContent({{
    rewriteCode: __aiRewriteUsingCode,
    sourceText: vars.campaignSourceText || '',
    sourceMedia: vars.campaignSourceMedia || []
  }})
  {var} = prepared.content
  vars.campaignContent = prepared.content
  vars.images = prepared.media
  vars.contentVariantIndex = prepared.variantIndex
}} else {{
  {var} = {initial}
  {var} = {render}
  {var} = {rewrite}
}}'''
    patch(name,old,new)

# Page inbox can skip an unmatched conversation. Allocate only after its header
# has been verified, immediately before typing into that conversation.
name='fb_send_page_inbox_message'
code=changed[name]
a=code.index('let message\nif (typeof helpers.prepareCampaignContent')
b=code.index('\nconst images =',a)
code=code[:a]+"""let message = ''
if (typeof helpers.prepareCampaignContent !== 'function') {
  message = String(vars.campaignContent || input.campaignContent || '').replace(/\\t/g, '      ')
  message = (await renderContentTemplate(message)).trim()
  message = (await rewriteContentForRun(message)).trim()
}
"""+code[b:]
code=replace(code,'const images = (Array.isArray(vars.images)', 'let images = (Array.isArray(vars.images)')
code=replace(code,'if (!message && images.length === 0)', "if (typeof helpers.prepareCampaignContent !== 'function' && !message && images.length === 0)")
code=replace(code,"  const typed = await dom('setMessageText', {", """  if (typeof helpers.prepareCampaignContent === 'function') {
    const prepared = await helpers.prepareCampaignContent({ rewriteCode: __aiRewriteUsingCode, recipientName: customerName })
    message = prepared.content.replace(/\\t/g, '      ').trim()
    images = prepared.media
    vars.contentVariantIndex = prepared.variantIndex
    if (!message && images.length === 0) throw new Error('Không có nội dung hoặc ảnh để gửi tin')
  }
  const typed = await dom('setMessageText', {""")
changed[name]=code

# Reels' video is part of the selected bundle, so resolve it after preparation.
name='fb_post_reels'
old="const videoPath = String(input.videoPath || vars.videoPath || '').trim()\nif (!videoPath) throw new Error('videoPath rỗng (cần ít nhất 1 video trong vars.images)')\n"
patch(name,old,'')
code=changed[name]; idx=code.index('// Mở trang tạo Reels')
changed[name]=code[:idx]+"const videoPath = String(typeof helpers.prepareCampaignContent === 'function' ? (vars.images || [])[0] || '' : input.videoPath || vars.videoPath || '').trim()\nif (!videoPath) throw new Error('videoPath rỗng (cần ít nhất 1 video trong vars.images)')\n\n"+code[idx:]

patch('fb_send_message','  const imgs = Array.isArray(input.images)', '  let imgs = Array.isArray(input.images)')
patch('fb_send_message', '''  text = (await renderContentTemplate(text, { resolveFullNameFromPage: true })).trim()
  text = (await rewriteContentForRun(text)).trim()''', '''  if (typeof helpers.prepareCampaignContent === 'function') {
    const prepared = await helpers.prepareCampaignContent({ rewriteCode: __aiRewriteUsingCode, resolveFullNameFromPage: true })
    text = prepared.content.trim()
    imgs = prepared.media
    vars.contentVariantIndex = prepared.variantIndex
  } else {
    text = (await renderContentTemplate(text, { resolveFullNameFromPage: true })).trim()
    text = (await rewriteContentForRun(text)).trim()
  }''')

for name in ['fb_comment_at_position','fb_comment_current_post']:
    code=blocks[name]['code']; a=code.index("let text = String(input.text || item.text || '')"); b=code.index('\n\nif (!text && images.length === 0)',a)
    legacy=code[a:b].replace('let text =','text =',1).replace('const images =','images =',1)
    changed[name]=code[:a]+'''let text
let images
if (typeof helpers.prepareCampaignContent === 'function') {
  const prepared = await helpers.prepareCampaignContent({ kind: 'comment', rewriteCode: __aiRewriteUsingCode })
  text = prepared.content.replace(/\\t/g, '      ')
  images = prepared.media.slice(0, 1)
  vars.contentVariantIndex = prepared.variantIndex
} else {
'''+legacy+'\n}'+code[b:]

patch('fb_prepare_post_link_comment_iteration',"if (!text.trim() && images.length === 0) {", "if (typeof helpers.prepareCampaignContent !== 'function' && !text.trim() && images.length === 0) {")

name='fb_newsfeed_check_comment';code=blocks[name]['code'];a=code.index('const variants = helpers.splitVariants(');b=code.index("if (!String(text || '').trim())",a)
legacy=code[a:b].replace('let text =','text =',1)
changed[name]=code[:a]+'''let text
if (typeof helpers.prepareCampaignContent === 'function') {
  const prepared = await helpers.prepareCampaignContent({
    kind: 'newsfeed_comment', postContent, postName: String(post.targetName || '')
  })
  text = prepared.content
  vars.contentVariantIndex = prepared.variantIndex
} else {
'''+legacy+'}\n'+code[b:]

# Scraping stays outside preparation. Preserve the source separately; do not
# spin, combine or rewrite it a second time in new runtimes.
name='fb_scrape_post';code=blocks[name]['code']
code=replace(code,"const appendContent = String(input.appendContent || vars.campaignContent || '')", "const appendContent = typeof helpers.prepareCampaignContent === 'function' ? '' : String(input.appendContent || vars.campaignContent || '')")
needle="helpers.log('📋 Scrape: '"
idx=code.index(needle)
code=code[:idx]+'''if (typeof helpers.prepareCampaignContent === 'function') {
  vars.campaignSourceText = scrapedText
  vars.campaignSourceMedia = scrapedImages
  return { scrapedText, scrapedImages, sourceContent: scrapedText }
}

'''+code[idx:]
changed[name]=code
for name in ['fb_rewrite_source_content_ai','fb_compose_source_manual_content']:
    changed[name]="// Updated runtimes combine/rewrite the selected bundle at its consumer.\nif (typeof helpers.prepareCampaignContent === 'function') return input\n\n"+blocks[name]['code']

lines=['-- Generated by scripts/build-campaign-content-block-migration.py from captured linked production rows.',
       '-- Apply after v350. Legacy apps lack the optional helper and retain the original path.',
       '-- Data only: no DDL, no PostgREST schema reload.', 'BEGIN;', "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '30s';"]
lines.append("""DO $schema_guard$
DECLARE v_rpc regprocedure := to_regprocedure('public.aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer)');
BEGIN
  IF v_rpc IS NULL OR md5(pg_get_functiondef(v_rpc)) IS DISTINCT FROM '006a6da075ede4e9c6b07194422f65c9' THEN
    RAISE EXCEPTION 'v351: apply/verify v350 content allocator first';
  END IF;
END;
$schema_guard$;""")
for name,code in changed.items():
    row=blocks[name]; tag='$content_v351$'; assert tag not in code
    lines.append(f'''DO $guard$
BEGIN
  IF (SELECT md5(jsonb_build_array(code,config_schema,output_schema,default_config)::text)
      FROM public.auto_blocks WHERE id={row['id']} AND name='{name}')
    IS DISTINCT FROM '{row['source_checksum']}' THEN
    RAISE EXCEPTION 'v351 live block changed: {name}';
  END IF;
END;
$guard$;
UPDATE public.auto_blocks SET code={tag}{code}{tag}, updated_at=now() WHERE id={row['id']};''')
for row in source['workflows']:
    lines.append(f'''DO $guard$
BEGIN
  IF (SELECT md5(jsonb_build_array(nodes,edges,variables_schema,default_variables)::text)
      FROM public.auto_workflows WHERE id={row['id']})
    IS DISTINCT FROM '{row['source_checksum']}' THEN
    RAISE EXCEPTION 'v351 live workflow changed: {row['id']}';
  END IF;
END;
$guard$;
UPDATE public.auto_workflows SET default_variables=COALESCE(default_variables,'{{}}'::jsonb)
  || '{{"campaignContentPreparationVersion":1}}'::jsonb, updated_at=now() WHERE id={row['id']};''')
lines+=['COMMIT;','']
(ROOT/'migrations/migration_v351_campaign_content_blocks.sql').write_text('\n\n'.join(lines).rstrip()+'\n')
# Machine-readable target hashes for isolated validation/rollback tooling.
(ROOT/'migrations/snapshots/campaign-content-v350/targets.json').write_text(json.dumps(
    {name:{'id':blocks[name]['id'],'code_md5':hashlib.md5(code.encode()).hexdigest()} for name,code in changed.items()},indent=2)+'\n')
print(f'Generated {len(changed)} blocks and {len(source["workflows"])} workflows')
