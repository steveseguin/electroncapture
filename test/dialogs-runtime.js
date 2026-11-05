'use strict';

// Real prompt windows and IPC; menu construction is captured to invoke its handlers.
// All pages and profiles are disposable local fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname, '..');const appRequire=require('node:module').createRequire(path.join(root,'package.json'));
if(!process.versions.electron){
 (async()=>{
 const directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'elecap-dialog-runtime-'));
 const server=require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><body>Dialog fixture</body>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env={...process.env,DIALOG_ARTIFACTS:directory,ELECTRON_CAPTURE_USER_DATA_DIR:path.join(directory,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 try{const child=require('node:child_process').spawn(process.env.VALIDATION_ELECTRON || appRequire('electron'),[__filename,'--multiinstance','--no-node','--pin','--nodpi','--width=640','--height=360','--url=http://127.0.0.1:'+server.address().port+'/'],{cwd:root,env});
 const log=fs.createWriteStream(path.join(directory,'runtime.log'));child.stdout.pipe(log);child.stderr.pipe(log);const timer=setTimeout(()=>child.kill('SIGKILL'),90000);
 const code=await new Promise((r,j)=>{child.once('error',j);child.once('exit',r);});clearTimeout(timer);const report=JSON.parse(fs.readFileSync(path.join(directory,'result.json')));console.log(directory,JSON.stringify(report));assert.equal(code,0);assert.ok(report.passed);
 }finally{await new Promise(r=>server.close(r));}
 })().catch(e=>{console.error(e);process.exitCode=1;});
}else{
 const {app,BrowserWindow}=require('electron');app.setAsDefaultProtocolClient=()=>false;app.isDefaultProtocolClient=()=>true;
 const report={checks:[],passed:false};const save=()=>fs.writeFileSync(path.join(process.env.DIALOG_ARTIFACTS,'result.json'),JSON.stringify(report,null,2));
 const check=(ok,name)=>{assert.ok(ok,name);report.checks.push(name);save();};
 const waitFor=async(fn,name)=>{const end=Date.now()+10000;while(!await fn()){if(Date.now()>end)throw Error('Timed out: '+name);await new Promise(r=>setTimeout(r,50));}};
 const menuPath=appRequire.resolve('electron-context-menu'),original=appRequire(menuPath);let options;require.cache[menuPath].exports=o=>{options=o;return original(o);};
 appRequire('./main');
 app.whenReady().then(async()=>{try{
 await waitFor(()=>BrowserWindow.getAllWindows().length===1,'window');const target=BrowserWindow.getAllWindows()[0];await waitFor(()=>!target.webContents.isLoading(),'page');
 const item=label=>options.prepend({}, {frameURL:target.webContents.getURL(),mediaType:'none'},target).find(x=>x.label?.includes(label));
 const open=async label=>{const before=new Set(BrowserWindow.getAllWindows());const pending=item(label).click();let dialog;await waitFor(()=>{dialog=BrowserWindow.getAllWindows().find(w=>!before.has(w));return dialog;},'dialog');await waitFor(()=>!dialog.webContents.isLoading()&&dialog.webContents.executeJavaScript('!!document.querySelector("#data")'),'dialog input');return{dialog,pending};};
 const finish=async(entry,value,cancel=false)=>{await entry.dialog.webContents.executeJavaScript(`document.querySelector('#data').value=${JSON.stringify(value)};setTimeout(()=>document.querySelector(${JSON.stringify(cancel?'#cancel':'#ok')}).click(),0);true;`);await entry.pending;await waitFor(()=>entry.dialog.isDestroyed(),'dialog closes');};
 const title=await open('Edit Window Title');check(!target.isAlwaysOnTop(),'title dialog temporarily unpins');await finish(title,'Capture "Ω"');check(target.getTitle()==='Capture "Ω"'&&target.args.title===target.getTitle(),'title dialog applies Unicode and quotes');check(target.isAlwaysOnTop(),'title dialog restores pin');
 const cancel=await open('Edit Window Title');await finish(cancel,'discarded',true);check(target.getTitle()==='Capture "Ω"'&&target.isAlwaysOnTop(),'cancel preserves title and pin');
 const expectedJS='quoted \" Ω';const jsText='window.dialogValue = '+JSON.stringify(expectedJS)+';';const js=await open('Insert JavaScript');await finish(js,jsText);check(await target.webContents.executeJavaScript('window.dialogValue')===expectedJS,'JavaScript dialog executes and preserves quotes');check(target.isAlwaysOnTop(),'JavaScript dialog restores pin');
 const jsAgain=await open('Insert JavaScript');check(await jsAgain.dialog.webContents.executeJavaScript('document.querySelector("#data").value')===jsText,'JavaScript roundtrip preserves text');await finish(jsAgain,'',true);
 const cssText='body { background-color: rgba(10, 20, 30, 0.5); }';const css=await open('Insert CSS');await finish(css,cssText);check(await target.webContents.executeJavaScript('getComputedStyle(document.body).backgroundColor')==='rgba(10, 20, 30, 0.5)','CSS dialog applies alpha color');check(target.isAlwaysOnTop(),'CSS dialog restores pin');
 const overlapA=await open('Insert CSS');const overlapB=await open('Edit Window Title');await finish(overlapA,'',true);check(!target.isAlwaysOnTop(),'first overlapping dialog does not restore pin early');await finish(overlapB,'',true);check(target.isAlwaysOnTop(),'last overlapping dialog restores pin');
 const duringRestore=await open('Edit Window Title');target.minimize();await waitFor(()=>target.isMinimized(),'prompt owner minimizes');target.restore();target.show();await waitFor(()=>!target.isMinimized()&&target.isVisible(),'prompt owner restores');check(!target.isAlwaysOnTop(),'restore respects active dialog pin suspension');await finish(duringRestore,'',true);check(target.isAlwaysOnTop(),'closing dialog restores pin after minimize/restore');
 const editURL=await open('Edit URL');await finish(editURL,'about:blank');await waitFor(()=>target.webContents.getURL()==='about:blank'&&!target.webContents.isLoading(),'URL navigation');check(target.isAlwaysOnTop(),'URL edit navigates and restores pin');
 report.passed=true;save();app.quit();
 }catch(e){report.error=e.stack;save();console.error(e);app.exit(1);}});
}
