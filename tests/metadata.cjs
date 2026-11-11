const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const factory=require('../vendor/qpdf/qpdf.js');
(async()=>{
 const module=await factory({noInitialRun:true,locateFile:()=>require('node:path').resolve(__dirname,'../vendor/qpdf/qpdf.wasm'),print:()=>{},printErr:()=>{}});
 const engine=await import('data:text/javascript;base64,'+fs.readFileSync('pdf-engine.js').toString('base64'));
 const messages=[],handlers=[];
 const scope={console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,setTimeout,clearTimeout,providedQpdf:module};
 scope.self={location:{href:'http://localhost/pdf-optimizer.worker.js'},addEventListener:(type,fn)=>handlers.push(fn),removeEventListener:(type,fn)=>{const i=handlers.indexOf(fn);if(i>=0)handlers.splice(i,1);},postMessage:m=>{messages.push(m);if(m.type==='pages')queueMicrotask(()=>handlers.slice().forEach(fn=>fn({data:{type:'overlay',buffer:null}})));}};
 const context=vm.createContext(scope);
 scope.importScripts=(...paths)=>paths.forEach(p=>vm.runInContext(fs.readFileSync(p.replace(/^\.\//,''),'utf8'),context));
 vm.runInContext(fs.readFileSync('pdf-security.worker.js','utf8'),context);
 vm.runInContext('qpdf=providedQpdf;qpdfPromise=Promise.resolve(qpdf);',context);
 function run(args){try{assert.equal(module.callMain(args),0);}catch(e){if(e.name==='ExitStatus')assert.equal(e.status,0);else throw e;}}
 function read(bytes,password=''){
 module.FS.writeFile('/test.pdf',new Uint8Array(bytes));run([...(password?['--password='+password]:[]),'--json','/test.pdf','/test.json']);return JSON.parse(module.FS.readFile('/test.json',{encoding:'utf8'}));
 }
 const keys=['title','author','subject','keywords','creator','producer'];
 const original=Object.fromEntries(keys.map(k=>[k,'來源 '+k]));
 function fixture(values){const w=new engine.PdfWriter(),pages=w.reserve(),page=w.add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 100 100] /Resources << >> >>`);w.set(pages,`<< /Type /Pages /Count 1 /Kids [${page} 0 R] >>`);return engine.finishPdf(w,pages,values);}
 const bytes=new Uint8Array(await fixture(original).arrayBuffer());
 function info(data){scope.data=data;return JSON.parse(vm.runInContext('JSON.stringify(readDocumentMetadata(data))',context));}
 assert.deepEqual(info(read(bytes)),original);
 assert.deepEqual(info(read(await fixture(Object.fromEntries(keys.map(k=>[k,'']))).arrayBuffer())),Object.fromEntries(keys.map(k=>[k,''])));
 const edits=Object.fromEntries(keys.map(k=>[k,'中文 🥔 (測試) \\ '+k]));
 async function optimize(metadata){messages.length=0;scope.message={buffer:bytes.buffer.slice(0),options:{metadata}};await vm.runInContext('optimize(message)',context);const r=messages.find(m=>m.type==='result');assert.ok(r);return r.result.buffer;}
 assert.deepEqual(info(read(await optimize(null))),original);
 assert.deepEqual(info(read(await optimize(edits))),edits);
 assert.deepEqual(info(read(await optimize({}))),Object.fromEntries(keys.map(k=>[k,''])));
 // A PDF without Info, and a catalog with old XMP, use a newly allocated Info object.
 const w=new engine.PdfWriter(),pages=w.reserve(),page=w.add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 100 100] /Resources << >> >>`);w.set(pages,`<< /Type /Pages /Count 1 /Kids [${page} 0 R] >>`);
 const xmp=w.stream(new TextEncoder().encode('<old>stale title</old>'),'/Type /Metadata /Subtype /XML');const root=w.add(`<< /Type /Catalog /Pages ${pages} 0 R /Metadata ${xmp} 0 R >>`),empty=w.add('<< >>');
 let data=read(await w.build(root,empty).arrayBuffer());delete data.qpdf[1].trailer.value['/Info'];scope.data=data;scope.values=edits;
 const patch=vm.runInContext('metadataPatch(data,values)',context);assert.ok(patch.qpdf[1].trailer.value['/Info']);assert.equal(patch.qpdf[1]['obj:'+data.qpdf[1].trailer.value['/Root']].value['/Metadata'],undefined);
 module.FS.writeFile('/patch.json',JSON.stringify(patch));run(['/test.pdf','--update-from-json=/patch.json','/patched.pdf']);assert.deepEqual(info(read(module.FS.readFile('/patched.pdf'))),edits);
 // Exercise the security worker including encryption after metadata changes.
 messages.length=0;handlers.slice().forEach(fn=>fn({data:{type:'secure',buffer:bytes.buffer.slice(0),options:{metadata:edits,encrypt:true,ownerPassword:'test-owner',openPassword:'test-open',print:'full',modify:'all',extract:true,annotate:true}}}));
 const deadline=Date.now()+20000;while(!messages.some(m=>m.type==='result'||m.type==='error')&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
 const error=messages.find(m=>m.type==='error');assert.equal(error,undefined,error?.message);const secured=messages.find(m=>m.type==='result');assert.ok(secured);assert.deepEqual(info(read(secured.buffer,'test-open')),edits);
 messages.length=0;handlers.slice().forEach(fn=>fn({data:{type:'secure',buffer:bytes.buffer.slice(0),options:{metadata:{},encrypt:false}}}));
 const clearDeadline=Date.now()+20000;while(!messages.some(m=>m.type==='result'||m.type==='error')&&Date.now()<clearDeadline)await new Promise(r=>setTimeout(r,10));
 assert.equal(messages.find(m=>m.type==='error'),undefined);const cleared=messages.find(m=>m.type==='result');assert.ok(cleared);assert.deepEqual(info(read(cleared.buffer)),Object.fromEntries(keys.map(k=>[k,''])));
 messages.length=0;scope.message={buffer:bytes.buffer.slice(0),password:''};await vm.runInContext('inspectDocumentMetadata(message)',context);assert.deepEqual(JSON.parse(JSON.stringify(messages.find(m=>m.type==='metadata').metadata)),original);
 console.log('PASS: EPUB metadata, blank fields, optimizer preserve/edit/clear, missing Info, stale XMP removal, encrypted security output');
})().catch(e=>{console.error('FAIL:',e.message);process.exitCode=1;});
