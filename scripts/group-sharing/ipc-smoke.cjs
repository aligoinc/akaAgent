const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{build}=require('esbuild')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sharing-ipc-'))
async function main(){try{
 await build({entryPoints:[path.resolve(__dirname,'../../src/main/ipc/handlers/groupSharingHandlers.ts')],outfile:path.join(dir,'handler.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/^electron$|\/repositories\/groupSharingRepository$/},args=>({path:args.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='electron'?'export const ipcMain={handle:(name,fn)=>globalThis.sharingHandler=fn}':'export const invokeGroupSharing=async(action,input)=>{globalThis.calls.push({action,input});return {ok:true}}',loader:'js'}))}}],logLevel:'silent'})
 const frame={},contents={mainFrame:frame};global.calls=[]
 require(path.join(dir,'handler.cjs')).registerGroupSharingHandlers({webContents:contents})
 const event={sender:contents,senderFrame:frame}
 await assert.rejects(global.sharingHandler({...event,sender:{}},'staff'),/không hợp lệ/)
 await assert.rejects(global.sharingHandler({...event,senderFrame:{}},'save',{kind:'data',groupId:1}),/không hợp lệ/)
 await assert.rejects(global.sharingHandler(event,'data_members',{kind:'data',groupId:1}),/không hợp lệ/)
 await assert.rejects(global.sharingHandler(event,'get',{kind:'data',groupId:'1'}),/không hợp lệ/)
 assert.equal(global.calls.length,0)
 await global.sharingHandler(event,'staff')
 await global.sharingHandler(event,'save',{kind:'data',groupId:1,scope:'organization',expectedRevision:'0',recipientIds:[]})
 assert.equal(global.calls.length,2)
 console.log('PASS IPC: trusted main frame, action and ID validation; no caller-supplied actor')
}finally{fs.rmSync(dir,{recursive:true,force:true})}}
main().catch(e=>{console.error(e);process.exitCode=1})
