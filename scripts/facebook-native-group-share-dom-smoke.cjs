// Real XPath/DOM with local Electron fixtures, never a Facebook request.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {app,BrowserWindow}=require('electron')
const {before,elements,blocks}=require('./build-facebook-native-group-share.cjs')
const selectors=Object.fromEntries([...before.elements,...elements].map(e=>[e.name,e.xpath]))
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor
let checks=0
async function main(){
 await app.whenReady()
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}})
 try {
  for(const mode of ['success','caption','missing','wrong-id','slow-list','slow-empty','deadline-result','late-result','suggestion-rerender','suggestion-disappears','outside-dialog-duplicate','tracking-result','query-changed','search-removed','abort-wait','no-list','duplicate','title-missing','title-duplicate','disabled','submit-timeout','abort-before','abort-selection','abort-submit']) {
   let now=0,location='https://www.facebook.com/groups/target/',posted=0,selected=0
   let searchStartedAt,selectedAt,searchEndedAt
   const delay=mode==='deadline-result'?10000:mode==='late-result'?10500:5000
   const delayed=['slow-list','slow-empty','deadline-result','late-result','abort-wait'].includes(mode)
   const abort=new AbortController(),navigation=[],fills=[]
   const vars={inputDataUid:'123',targetUrl:location,sourceLink:'https://www.facebook.com/author/posts/456',groupPostShareCaption:mode==='caption'?'Caption test':''}
   const render=async html=>win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html))
   const evaluate=async(code,...args)=>win.webContents.executeJavaScript(`((__args,location)=>{${code}\n})(${JSON.stringify(args)},${JSON.stringify({href:location})})`)
   const form=`<div role="dialog"><div contenteditable="true" id="outside-editor"></div><form method="POST"><div contenteditable="true" class="notranslate" id="caption"></div><div role="button" aria-label="Đăng" ${mode==='disabled'?'aria-disabled="true"':''} onclick="window.submits++;${mode==='submit-timeout'?'':'this.closest(\'form\').remove()'}">Đăng</div></form></div>`
   const formScript=`window.selected++;window.selectedGeneration=window.resultGeneration;document.body.innerHTML=${JSON.stringify(form)}`
   const result=(key)=>`<div role="button" data-share-group="true"><a href="https://www.facebook.com/groups/${key}/"></a><span>Same group name</span></div>`
   const results=['missing','slow-empty'].includes(mode)?'<span>Không có nhóm nào khớp với tìm kiếm của bạn.</span>'
    :mode==='no-list'?'':mode==='wrong-id'||delayed?result('other'):mode==='duplicate'?result('target')+result('target'):result('other')+result('target')
   const suggestion=mode.startsWith('suggestion-')
   const outside=mode==='outside-dialog-duplicate'?`<div role="dialog">${result('target')}</div>`:''
   const search=`${outside}<div role="dialog"><input role="combobox" type="search" aria-label="Tìm kiếm nhóm"><div id="results">${suggestion?result('target'):''}</div></div>`
   const toGroup=`<div role="dialog"><div role="button" aria-label="Chia sẻ lên nhóm" onclick='document.body.innerHTML=${JSON.stringify(search).replace(/'/g,'&#39;')}'>Nhóm</div></div>`
   const source=`<div role="dialog"><div role="button" aria-label="Chia sẻ" onclick='document.body.innerHTML=${JSON.stringify(toGroup).replace(/'/g,'&#39;')}'>Chia sẻ</div></div>`
   const page={
    evaluate:async(code,...args)=>{
     const out=await evaluate(code,...args)
     const counts=await win.webContents.executeJavaScript('({posted:window.submits||0,selected:window.selected||0,queries:window.searchQueries||[]})')
     posted=counts.posted;selected=counts.selected
     if(searchStartedAt===undefined&&counts.queries.includes('Current group name'))searchStartedAt=now
     if(selected&&selectedAt===undefined)selectedAt=now
     if(mode==='abort-submit'&&posted)abort.abort()
     if(mode==='abort-selection'&&counts.queries.includes('Current group name'))abort.abort()
     return out
    },
    navigate:async url=>{
     if(searchStartedAt!==undefined)searchEndedAt=now
     navigation.push(url);location=url
     await render(url===vars.sourceLink?source:'<main role="main"><h1>Current group name</h1></main>')
     await win.webContents.executeJavaScript(`window.submits=0;window.selected=0;window.searchQueries=[];window.resultGeneration='suggestion';
      document.addEventListener('click',event=>{if(event.target.closest('[data-share-group]')){${formScript}}});
      document.addEventListener('input',event=>{
       if(event.target.tagName!=='INPUT')return;
       window.searchQueries.push(event.target.value);
       document.getElementById('results').innerHTML=${suggestion?JSON.stringify(result('target')):`event.target.value==='Current group name'?${JSON.stringify(results)}:''`};
      });`)
    },
    waitForSelector:async xpath=>assert(await evaluate('return document.evaluate(__args[0],document,null,7,null).snapshotLength>0',xpath)),
    fill:async(xpath,text)=>{
     fills.push({xpath,text})
     await evaluate(`const r=document.evaluate(__args[0],document,null,7,null);if(r.snapshotLength!==1)throw Error('ambiguous fill');const el=r.snapshotItem(0);if(el.tagName==='INPUT')throw Error('Search must use the existing group-share input method');el.textContent=__args[1];`,xpath,text)
    }
   }
   const helpers={element:async name=>{assert(selectors[name],name);return selectors[name]},sleep:async ms=>{
    abort.signal.throwIfAborted();now+=ms
    if(mode==='abort-wait'&&searchStartedAt!==undefined&&now-searchStartedAt>=2000)abort.abort()
    abort.signal.throwIfAborted()
    if(delayed&&searchStartedAt!==undefined&&now-searchStartedAt>=delay){
     await evaluate('const results=document.getElementById("results");if(results)results.innerHTML=__args[0];',result('other')+result('target'))
    }
    if(searchStartedAt!==undefined&&now-searchStartedAt>=10000&&!selected){
     if(suggestion){
      await evaluate('document.getElementById("results").replaceChildren();')
      await evaluate('window.resultGeneration="search-results";document.getElementById("results").innerHTML=__args[0];',mode==='suggestion-rerender'?result('target'):result('other'))
     }
     if(mode==='tracking-result')await evaluate('for(const a of document.querySelectorAll("a"))a.href+="?ref=search_results";')
     if(mode==='query-changed')await evaluate('document.querySelector("input").value="Changed query";')
     if(mode==='search-removed')await evaluate('document.querySelector("input").remove();')
    }
   }}
   const ClockDate=class extends Date {static now(){return now}}
   const run=async name=>new AsyncFunction('vars','page','helpers','signal','Date',blocks.find(b=>b.name===name).code)(vars,page,helpers,abort.signal,ClockDate)
   await render(`<main role="main">${mode==='title-missing'?'':mode==='title-duplicate'?'<h1>One</h1><h1>Two</h1>':'<h1>Current group name</h1>'}</main>`)
   if(mode==='abort-before')abort.abort()
   let output,error
   try{
    await run('fb_prepare_native_group_share')
    assert.equal(vars.groupShareTarget.name,'Current group name','data has no stored name')
    output=await run('fb_select_native_share_group')
    if(vars.groupShareSelected)output=await run('fb_submit_native_group_share')
   }catch(e){e.message=mode+': '+e.message;error=e}
   if(['success','caption','slow-list','slow-empty','deadline-result','suggestion-rerender','outside-dialog-duplicate','tracking-result'].includes(mode)){
    assert.ifError(error);assert.equal(posted,1);assert.equal(selected,1)
    assert.equal(output.actionResult.operationState,'committed');assert.equal(output.actionResult.data.destinationPostUrl,null)
    assert.equal(vars.postUrl,'');assert.equal(vars.groupPostUrl,'')
    assert.equal(fills.some(f=>f.text==='Caption test'),mode==='caption')
    assert.equal(selectedAt-searchStartedAt,10000,'always wait the full ten seconds before selecting, even for an existing suggestion')
    if(suggestion)assert.equal(await evaluate('return window.selectedGeneration;'),'search-results','select the rerendered result, never the initial suggestion')
   }else if(['missing','wrong-id','late-result','suggestion-disappears'].includes(mode)){
    assert.ifError(error);assert.equal(posted,0);assert.equal(selected,0)
    assert.equal(output.actionResult.statusCode,'campaign_detail_skipped');assert.equal(output.actionResult.errorCode,undefined)
    assert.equal(output.actionResult.message,'Không tìm thấy nhóm để chia sẻ, chưa tham gia nhóm')
    assert.equal(navigation.at(-1),'https://www.facebook.com/groups/target/')
    assert.equal(searchEndedAt-searchStartedAt,10000,'do not skip before the full 10-second search window')
   }else if(['submit-timeout','abort-submit'].includes(mode)){
    assert.ifError(error);assert.equal(posted,1)
    assert.equal(output.actionResult.statusCode,'campaign_detail_error')
    assert.equal(output.actionResult.operationState,'unknown')
   }else{
    assert(error,mode+': must not report empty/success')
    assert.equal(posted,['submit-timeout','abort-submit'].includes(mode)?1:0)
    if(mode==='abort-wait')assert.equal(selected,0,'cancel during the search wait does not select or skip')
   }
   checks++
  }
  const searchChecks=await require('./facebook-native-group-share-search-checks.cjs')(win)
  console.log(`${checks} real DOM fixtures and ${searchChecks} React search checks passed; no Facebook traffic or posts`)
 }finally{win.destroy();app.quit()}
}
main().catch(e=>{console.error(e);app.exit(1)})
