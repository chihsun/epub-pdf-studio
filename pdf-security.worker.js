/* Reuse the bundled qpdf runtime and its strict input checks. */
importScripts('./pdf-optimizer.worker.js');
importScripts('./pdf-watermark.worker.js');
self.addEventListener('message',event=>{
 const m=event.data;
 if(m.type!=='secure')return;
 (async()=>{
 self.postMessage({type:'progress',message:'正在載入 PDF 引擎…'});
 await initQpdf();
 const paths=['/secure-in.pdf','/secure.json','/secure-overlay.pdf','/secure-out.pdf','/secure-metadata.json','/secure-overlay.json','/secure-merged.pdf','/secure-raster.pdf'];
 try{
 qpdf.FS.writeFile(paths[0],new Uint8Array(m.buffer));
 const o=m.options;
 let auth=o.inputPassword?['--password='+o.inputPassword]:[];
 const run=args=>{const r=runQpdf(args);if(r.exitCode!==0)throw Error('PDF 處理未通過：'+(r.stderr||r.stdout));};
 self.postMessage({type:'progress',message:'正在檢查 PDF 結構…'});
 run([...auth,'--check',paths[0]]);
 self.postMessage({type:'progress',message:'正在讀取頁面尺寸…'});
 run([...auth,'--json',paths[0],paths[1]]);
 const raw=qpdf.FS.readFile(paths[1],{encoding:'utf8'});
 if(/"\/ByteRange"\s*:/.test(raw))throw Error('已簽章 PDF 無法重新寫入，以免簽章失效。');
 let data=JSON.parse(raw);
 const preservedMetadata=o.metadata||readDocumentMetadata(data);
 async function renderDocument(input,stage){
  self.postMessage({type:'progress',message:stage==='before'?'正在整頁轉圖，完成後再加上浮水印…':'正在整頁轉圖（包含浮水印）…'});
  const rasterized=await new Promise(resolve=>{
   const receive=event=>{if(event.data?.type!=='rasterized')return;self.removeEventListener('message',receive);resolve(event.data.buffer);};
   self.addEventListener('message',receive);
   const buffer=qpdf.FS.readFile(input).slice().buffer;
   self.postMessage({type:'rasterize',buffer,stage},[buffer]);
  });
  assertPdf(new Uint8Array(rasterized));qpdf.FS.writeFile(paths[7],new Uint8Array(rasterized));
  run(['--check',paths[7]]);run(['--json',paths[7],paths[5]]);
  const rendered=JSON.parse(qpdf.FS.readFile(paths[5],{encoding:'utf8'}));
  if(rendered.pages?.length!==data.pages.length)throw Error('整頁轉圖後頁數不符，已停止輸出');
  writeMetadataPatch(rendered,preservedMetadata,paths[4]);
 }
 if(o.rasterize&&o.rasterTiming==='before'){
  run([...auth,paths[0],'--decrypt',paths[6]]);
  await renderDocument(paths[6],'before');
  run([paths[7],'--update-from-json='+paths[4],paths[6]]);
  qpdf.FS.writeFile(paths[0],qpdf.FS.readFile(paths[6]));auth=[];
  run(['--json',paths[0],paths[1]]);data=JSON.parse(qpdf.FS.readFile(paths[1],{encoding:'utf8'}));
 }
 const objects=data.qpdf?.[1]||{};
 const resolve=value=>typeof value==='string'&&objects['obj:'+value]?objects['obj:'+value].value:value;
 const boxes=data.pages.map(page=>{
 let node=resolve(page.object),box,rotation=0,userUnit=1,seen=new Set();
 while(node){
 box??=resolve(node['/CropBox'])||resolve(node['/MediaBox']);
 if(node['/Rotate']!==undefined)rotation=Number(node['/Rotate']);
 if(node['/UserUnit']!==undefined)userUnit=Number(node['/UserUnit']);
 const parent=node['/Parent'];if(!parent||seen.has(parent))break;seen.add(parent);node=resolve(parent);
 }
 if(!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||box[2]<=box[0]||box[3]<=box[1])throw Error('無法辨識頁面尺寸。');
 if((rotation%360!==0||userUnit!==1)&&!(o.rasterize&&o.watermark===false))throw Error('新增浮水印暫不直接處理旋轉頁面或特殊 UserUnit；請選擇「加上浮水印之前」整頁轉圖。');
 return box;
 });
 self.postMessage({type:'pages',boxes});
 const overlay=await new Promise((resolve,reject)=>{self.addEventListener('message',function receive(e){if(e.data.type==='overlay'){self.removeEventListener('message',receive);resolve(e.data.buffer);}});});
 let args=[...auth,paths[0]];
 let patch;
 if(overlay){
  qpdf.FS.writeFile(paths[2],new Uint8Array(overlay));
  if(o.compatibleWatermark){
   run(['--json','--json-stream-data=inline',paths[2],paths[5]]);
   patch=editableWatermarkPatch(data,JSON.parse(qpdf.FS.readFile(paths[5],{encoding:'utf8'})));
  }else args.push('--overlay',paths[2],'--');
 }
 if(o.metadata){
  const metadata=metadataPatch({...data,qpdf:[patch?.qpdf[0]||data.qpdf[0],data.qpdf[1]]},o.metadata);
  if(patch)Object.assign(patch.qpdf[1],metadata.qpdf[1]);else patch=metadata;
 }
 if(patch){qpdf.FS.writeFile(paths[4],JSON.stringify(patch));args.push('--update-from-json='+paths[4]);}
 if(o.rasterize&&o.rasterTiming!=='before'){
  // Render the complete watermarked document before applying output encryption.
  run([...args,'--decrypt',paths[6]]);
  await renderDocument(paths[6],'after');
  args=[paths[7],'--update-from-json='+paths[4]];
 }
 if(o.encrypt){
 args.push('--encrypt',o.openPassword||'',o.ownerPassword,'256','--print='+o.print,'--modify='+o.modify,'--extract='+(o.extract?'y':'n'),'--annotate='+(o.annotate?'y':'n'),'--');
 }
 self.postMessage({type:'progress',message:'正在合併浮水印並檢查輸出…'});
 args.push(paths[3]);run(args);
 const checkAuth=o.encrypt?['--password='+o.ownerPassword]:o.rasterize?[]:auth;
 run([...checkAuth,'--check',paths[3]]);
 const output=qpdf.FS.readFile(paths[3]);
 const buffer=output.slice().buffer;self.postMessage({type:'result',buffer,rasterized:Boolean(o.rasterize),rasterTiming:o.rasterTiming||'after'},[buffer]);
 }finally{cleanup(paths);}
 })().catch(e=>self.postMessage({type:'error',message:e.message}));
});
