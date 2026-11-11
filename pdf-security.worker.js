/* Reuse the bundled qpdf runtime and its strict input checks. */
importScripts('./pdf-optimizer.worker.js');
self.addEventListener('message',event=>{
 const m=event.data;
 if(m.type!=='secure')return;
 (async()=>{
 self.postMessage({type:'progress',message:'正在載入 PDF 引擎…'});
 await initQpdf();
 const paths=['/secure-in.pdf','/secure.json','/secure-overlay.pdf','/secure-out.pdf','/secure-metadata.json'];
 try{
 qpdf.FS.writeFile(paths[0],new Uint8Array(m.buffer));
 const auth=m.options.inputPassword?['--password='+m.options.inputPassword]:[];
 const run=args=>{const r=runQpdf(args);if(r.exitCode!==0)throw Error('PDF 處理未通過：'+(r.stderr||r.stdout));};
 self.postMessage({type:'progress',message:'正在檢查 PDF 結構…'});
 run([...auth,'--check',paths[0]]);
 self.postMessage({type:'progress',message:'正在讀取頁面尺寸…'});
 run([...auth,'--json',paths[0],paths[1]]);
 const raw=qpdf.FS.readFile(paths[1],{encoding:'utf8'});
 if(/"\/ByteRange"\s*:/.test(raw))throw Error('已簽章 PDF 無法重新寫入，以免簽章失效。');
 const data=JSON.parse(raw),objects=data.qpdf?.[1]||{};
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
 if(rotation%360!==0||userUnit!==1)throw Error('第一版暫不處理有頁面旋轉或特殊 UserUnit 的 PDF；請保留原檔。');
 return box;
 });
 self.postMessage({type:'pages',boxes});
 const overlay=await new Promise((resolve,reject)=>{self.addEventListener('message',function receive(e){if(e.data.type==='overlay'){self.removeEventListener('message',receive);resolve(e.data.buffer);}});});
 const args=[...auth,paths[0]];
 if(overlay){qpdf.FS.writeFile(paths[2],new Uint8Array(overlay));args.push('--overlay',paths[2],'--');}
 const o=m.options;
 if(o.metadata){writeMetadataPatch(data,o.metadata,paths[4]);args.push('--update-from-json='+paths[4]);}
 if(o.encrypt){
 args.push('--encrypt',o.openPassword||'',o.ownerPassword,'256','--print='+o.print,'--modify='+o.modify,'--extract='+(o.extract?'y':'n'),'--annotate='+(o.annotate?'y':'n'),'--');
 }
 self.postMessage({type:'progress',message:'正在合併浮水印並檢查輸出…'});
 args.push(paths[3]);run(args);
 const checkAuth=o.encrypt?['--password='+o.ownerPassword]:auth;
 run([...checkAuth,'--check',paths[3]]);
 const output=qpdf.FS.readFile(paths[3]);
 const buffer=output.slice().buffer;self.postMessage({type:'result',buffer},[buffer]);
 }finally{cleanup(paths);}
 })().catch(e=>self.postMessage({type:'error',message:e.message}));
});
