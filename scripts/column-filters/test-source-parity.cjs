// Compare SQL source URL normalization against the existing Desktop normalizers.
const fs=require('node:fs'),ts=require('typescript'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict')
const source=fs.readFileSync('src/main/data/repositories/accountContactRepository.ts','utf8')
const functions={}
for(const kind of ['Post','Profile','Group']){
 const name=`normalizeFacebook${kind}UrlForCompare`,start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1)
 const js=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 functions[kind.toLowerCase()]=new Function(js+`; return ${name}`)()
}
const common=['',' abc ','@Some.Name','12345','groups/Abc/extra','facebook.com/Alice','m.facebook.com/Alice/friends','mobile.facebook.com/Alice','mbasic.facebook.com/Alice','fb.com/Alice/friends/friends','facebook.com/foo/bar','facebook.com/%41lice','facebook.com/%E1%BA%A2nh','facebook.com/profile.php?id=00123&ref=foo','facebook.com/profile.php?id=a+b%2Fc','facebook.com/groups/ABC/posts/123','facebook.com/foo/groups/%41bc','http://www.facebook.com/posts/123','https://facebook.com/posts/123?ref=foo&id=a%20b&__a=1#x','https://facebook.com/posts/123?Ref=keep&x=%41','https://facebook.com:443/posts/123','https://facebook.com.evil.test/foo','https://example.test/foo']
const cases=Object.entries(functions).flatMap(([kind,fn])=>common.map(value=>({kind,value,expected:fn(value)||null})))
const quote=v=>"'"+v.replaceAll("'","''")+"'"
const values=cases.map((c,i)=>`(${i},${quote(c.value)},${quote(c.kind)})`).join(',')
const r=spawnSync('/opt/homebrew/bin/psql',['-X','-qAt','-h','127.0.0.1','-p','55421','-d','column_filters','-v','ON_ERROR_STOP=1'],{input:`SELECT jsonb_agg(private.column_filter_fb_url_v1(value,kind) ORDER BY id) FROM (VALUES ${values}) t(id,value,kind);`,encoding:'utf8'})
assert.equal(r.status,0,r.stderr);const actual=JSON.parse(r.stdout)
for(const [i,c] of cases.entries())assert.equal(actual[i],c.expected,JSON.stringify(c))
console.log(`${cases.length} source URL parity cases passed`)
