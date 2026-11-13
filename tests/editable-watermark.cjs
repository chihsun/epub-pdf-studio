const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
(async()=>{
 global.FontFace=class {constructor(family){this.family=family;}async load(){return this;}};
 global.document={fonts:new Set()};
 const {PdfWriter,addEmbeddedFont}=await import(pathToFileURL(path.resolve('pdf-engine.js')));
 const {loadEditableWatermarkFont}=await import(pathToFileURL(path.resolve('font-options.js')));
 const {addEditableWatermark,validateEditableWatermarkText}=await import(pathToFileURL(path.resolve('pdf-watermark.js')));
 const font=await loadEditableWatermarkFont(new File([fs.readFileSync('fonts/reading-ming.ttf')],'test.ttf'));
 assert(font.postScriptName&&font.bytes.length);assert(font.metrics.advanceWidths.get(0x4e2d)>0);
 assert.throws(()=>validateEditableWatermarkText('😀',font),/字型/);
 const text='中文測試 ABC 123 & < >';validateEditableWatermarkText(text,font);
 const w=new PdfWriter(),pages=w.reserve(),native=w.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 const dummy=w.stream(new TextEncoder().encode(''),'/Type /XObject /Subtype /Form /BBox [0 0 1 1]');
 const ids=[];
 for(let n=1;n<=3;n++){
  const c=w.stream(new TextEncoder().encode('BT /F0 12 Tf 20 200 Td (Original page '+n+') Tj ET'));
  const array=w.add(`[${c} 0 R]`);
  ids.push(w.add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 220 340] /CropBox [10 20 210 320] /Contents ${array} 0 R >>`));
 }
 w.set(pages,`<< /Type /Pages /Count 3 /Kids [${ids.map(id=>id+' 0 R').join(' ')}] /Resources << /Font << /F0 ${native} 0 R >> /XObject << /PSW2 ${dummy} 0 R >> >> >>`);
 const root=w.add(`<< /Type /Catalog /Pages ${pages} 0 R >>`),info=w.add('<< >>');
 const input=await w.build(root,info).arrayBuffer();
 async function overlay(boxes){
  const out=new PdfWriter(),pages=out.reserve(),fontId=await addEmbeddedFont(out,font),ids=[];
  for(let i=0;i<boxes.length;i++){
   let mark={resources:'<< >>',content:''};
   if(i)mark=addEditableWatermark(out,text,{width:200,height:300,originX:10,originY:20,position:String(i-1),size:.1,alpha:.35,color:'#1266ab',pageNumber:i+1,pageNumbers:[2,3]},fontId,font);
   const content=out.stream(new TextEncoder().encode(mark.content));ids.push(out.add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 200 300] /Resources ${mark.resources} /Contents ${content} 0 R >>`));
  }
  out.set(pages,`<< /Type /Pages /Count 3 /Kids [${ids.map(id=>id+' 0 R').join(' ')}] >>`);
  return out.build(out.add(`<< /Type /Catalog /Pages ${pages} 0 R >>`),out.add('<< >>')).arrayBuffer();
 }
 const q=await require('../vendor/qpdf/qpdf.js')({noInitialRun:true,locateFile:()=>path.resolve('vendor/qpdf/qpdf.wasm'),print:()=>{},printErr:()=>{}});
 const handlers=[],messages=[];
 const scope={console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,atob,btoa,setTimeout,clearTimeout,providedQpdf:q};
 let pending;
 scope.self={location:{href:'http://localhost/pdf-security.worker.js'},addEventListener:(type,fn)=>handlers.push(fn),removeEventListener:(type,fn)=>{const i=handlers.indexOf(fn);if(i>=0)handlers.splice(i,1);},postMessage:m=>{messages.push(m);if(m.type==='pages')pending=overlay(m.boxes).then(buffer=>handlers.slice().forEach(fn=>fn({data:{type:'overlay',buffer}})));}};
 const context=vm.createContext(scope);
 scope.importScripts=(...paths)=>paths.forEach(p=>vm.runInContext(fs.readFileSync(p.replace(/^\.\//,''),'utf8'),context));
 vm.runInContext(fs.readFileSync('pdf-security.worker.js','utf8'),context);vm.runInContext('qpdf=providedQpdf;qpdfPromise=Promise.resolve(qpdf)',context);
 for(const encrypted of [false,true]){
  messages.length=0;
  handlers.slice().forEach(fn=>fn({data:{type:'secure',buffer:input.slice(0),options:{compatibleWatermark:true,metadata:{title:'屬性測試'},encrypt:encrypted,ownerPassword:'test-owner',openPassword:'test-open',print:'full',modify:'all',extract:true,annotate:true}}}));
  const deadline=Date.now()+30000;while(!messages.some(m=>['result','error'].includes(m.type))&&Date.now()<deadline){if(pending){await pending;pending=null;}await new Promise(r=>setTimeout(r,10));}
  assert(!messages.find(m=>m.type==='error'),messages.find(m=>m.type==='error')?.message);
  const result=messages.find(m=>m.type==='result');assert(result,'security worker result');
  if(!encrypted&&process.env.WRITE_EDITABLE_SAMPLE)fs.writeFileSync('outputs/watermark-compatibility/chinese-editable.pdf',new Uint8Array(result.buffer));
  q.FS.writeFile('/test.pdf',new Uint8Array(result.buffer));const auth=encrypted?['--password=test-open']:[];
  assert.equal(q.callMain([...auth,'--check','/test.pdf']),0);
  assert.equal(q.callMain([...auth,'--json','--json-stream-data=inline','--decode-level=all','/test.pdf','/test.json']),0);
  const data=JSON.parse(q.FS.readFile('/test.json',{encoding:'utf8'})),objects=data.qpdf[1];assert.equal(data.pages.length,3);
  const resolve=v=>typeof v==='string'&&/^\d+ \d+ R$/.test(v)?objects['obj:'+v]?.value:v;
  const page=index=>resolve(data.pages[index].object);
  assert.equal(page(0)['/Resources'],undefined,'first page stays unchanged');
  const marked=page(1);assert.equal(marked['/Contents'].length,4,'graphics isolation and original content');
  assert(marked['/Resources']['/Font']['/F0'],'inherited fonts preserved');
  assert(marked['/Resources']['/XObject']['/PSW2']&&marked['/Resources']['/XObject']['/PSW2x'],'resource collision avoided');
  const form=objects['obj:'+marked['/Resources']['/XObject']['/PSW2x']].stream;
  assert.equal(form.dict['/PieceInfo']['/ADBE_CompoundType']['/Private'],'/Watermark');
  const settingsRef=form.dict['/PieceInfo']['/ADBE_CompoundType']['/DocSettings'];
  const settings=Buffer.from(objects['obj:'+settingsRef].stream.data,'base64').toString('utf8');
  assert(settings.includes('中文測試 ABC 123 &amp; &lt; &gt;'));assert(settings.includes(font.postScriptName));assert(settings.includes('fullrange="2, 3"'));
  const fontObject=resolve(form.dict['/Resources']['/Font']['/F0']),cid=resolve(fontObject['/DescendantFonts'][0]),descriptor=resolve(cid['/FontDescriptor']);assert(descriptor['/FontFile2'],'embedded TrueType font');
  const trailer=objects.trailer.value;assert.equal(resolve(trailer['/Info'])['/Title'],'u:屬性測試');
 }
 console.log('PASS: editable Chinese/English, embedded uploaded font, XML escaping, marked Form, exact pages, inherited resources/collision, metadata, encryption, missing glyph rejection');
})().catch(e=>{console.error('FAIL: '+e.message);process.exitCode=1});
