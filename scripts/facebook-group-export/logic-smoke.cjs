const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { buildSync } = require('esbuild'), XLSX = require('xlsx')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-group-export-'))
try {
  buildSync({ entryPoints: [path.resolve(__dirname, '../../src/shared/facebookGroupExport.ts')], outfile: path.join(dir, 'helper.cjs'), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  const h = require(path.join(dir, 'helper.cjs'))
  for (const action of ['facebook_group_post','facebook_join_group','facebook_find_data_group','facebook_comment_seeding']) assert.equal(h.canExportFacebookGroupMetadata(action),true)
  for (const action of ['facebook_message_uid','facebook_group_invite','facebook_comment_seeding_post','facebook_find_data_search','zalo_message_group','email_send','sms_send',null]) assert.equal(h.canExportFacebookGroupMetadata(action),false)
  for (const metadata of [null, {}, {memberCount:null,postsPerDay:'',privacy:null}, {memberCount:' ',postsPerDay:'0'}, {memberCount:true,postsPerDay:-3,privacy:42}]) {
    assert.deepEqual(h.appendFacebookGroupExportColumns([{Tên:'A'}],[h.normalizeFacebookGroupMetadata(metadata)]),[{Tên:'A'}])
  }
  assert.deepEqual(h.facebookGroupExportValues({memberCount:0,postsPerDay:0,privacy:'Public'}),[0,'','','Công khai'])
  assert.deepEqual(h.facebookGroupExportValues({memberCount:'123',postsPerDay:'5',privacy:'Private'}),[123,5,'ngày','Riêng tư'])
  assert.equal(h.isFacebookGroupTarget({dataTypeCode:'facebook_person',flatformType:'facebook',contactType:'group',uid:'https://facebook.com/groups/12'}),false)
  assert.equal(h.isFacebookGroupTarget({flatformType:'zalo',contactType:'group',uid:'12'}),false)
  assert.equal(h.isFacebookGroupTarget({flatformType:'facebook',contactType:'person',uid:'12'}),false)
  assert.equal(h.isFacebookGroupTarget({contactType:'campaign_input',uid:'12'}),false)
  for (const url of ['https://facebook.com/groups/12/posts/34','https://facebook.com/groups/12/permalink/34','https://facebook.com/groups/12?multi_permalinks=34','https://facebook.com.evil.test/groups/12','https://example.test/groups/12']) assert.equal(h.facebookGroupIdentity(url),undefined)
  const source = (metadata, overrides={}) => ({uid:'12',url:'https://m.facebook.com/groups/12/',flatform_type:'facebook',contact_type:'group',metadata,...overrides})
  const input = sources => ({uid:'https://www.facebook.com/groups/12?ref=share',data_type_code:'facebook_group',sources})
  assert.deepEqual(h.resolveCampaignGroupMetadata(input([source({memberCount:123,postsPerDay:3,privacy:'Public'}),source({memberCount:456,postsPerDay:'3',privacy:'Công khai'})])),{memberCount:undefined,postsPerDay:3,privacy:'Công khai'})
  assert.deepEqual(h.resolveCampaignGroupMetadata(input([source({memberCount:0}),source({privacy:'Private'})])),{memberCount:0,postsPerDay:undefined,privacy:'Riêng tư'})
  assert.equal(h.resolveCampaignGroupMetadata(input([source({memberCount:777},{uid:'99',url:'https://facebook.com/groups/99'})])),undefined,'changed source target must not supply metadata')
  assert.equal(h.resolveCampaignGroupMetadata({...input([source({memberCount:777})]),data_type_code:'facebook_page'}),undefined)
  assert.equal(h.resolveCampaignGroupMetadata(input([])),undefined)
  // A field appearing only beyond the first 500 rows still creates its column.
  const rows=Array.from({length:501},(_,i)=>({STT:i+1,UID:i===0?'12345678901234567890':String(i),Tên:i===0?'=Tên nhóm':'Dòng '+i}))
  const metadata=Array.from({length:501},()=>undefined);metadata[500]={privacy:'Public'}
  const output=h.appendFacebookGroupExportColumns(rows,metadata)
  assert.deepEqual(Object.keys(output[0]),['STT','UID','Tên','Privacy']);assert.equal(output[0].Privacy,'');assert.equal(output[500].Privacy,'Công khai')
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(output),'Export')
  const roundtrip=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'})
  const sheet=roundtrip.Sheets.Export
  assert.equal(sheet.B2.v,'12345678901234567890');assert.equal(sheet.C2.t,'s');assert.equal(sheet.C2.f,undefined)
  assert.equal(XLSX.utils.sheet_to_json(sheet).length,501)
  assert.equal(sheet.D502.v,'Công khai')
  console.log('PASS action gate, semantic/platform guards, invalid/zero values, conflicting sources, changed targets, dynamic columns across pages and XLSX round trip')
} finally { fs.rmSync(dir,{recursive:true,force:true}) }
