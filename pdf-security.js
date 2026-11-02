import {PdfWriter} from './pdf-engine.js';
const $=id=>document.getElementById(id);
let activeWorker=null,downloadUrl=null;
const status=text=>{$('secure-status').textContent=text;};
$('secure-json').addEventListener('change',async event=>{
 try{
  const file=event.target.files?.[0];if(!file)return;
  const data=JSON.parse(await file.text());
  if(!Array.isArray(data.images))throw Error('JSON 缺少 images 陣列');
  const pages=data.images.map(item=>({page:Number(item.savedIndex),text:String(item.text??''),applied:item.applied===true,sourceWidth:item.sourceWidth??item.width??null,sourceHeight:item.sourceHeight??item.height??null}));
  if(pages.some(item=>!Number.isInteger(item.page)||item.page<1))throw Error('JSON 含無效的 savedIndex');
  $('secure-pages').value=JSON.stringify(pages,null,2);
  if(data.renderer?.fontFamily)$('secure-font').value=String(data.renderer.fontFamily);
  if(Number.isFinite(data.renderer?.globalAlpha))$('secure-alpha').value=data.renderer.globalAlpha;
  if(/^#[0-9a-f]{6}$/i.test(data.renderer?.fillStyle||''))$('secure-color').value=data.renderer.fillStyle;
  $('secure-watermark').checked=true;
  $('secure-json-info').textContent=`已匯入 ${pages.length} 筆頁面資料；原始隨機位置未記錄，請選擇位置。`;
 }catch(error){$('secure-json-info').textContent='匯入失敗：'+error.message;}
});
async function compress(bytes){
 const stream=new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
 return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function makeOverlay(boxes,records,options){
 const writer=new PdfWriter(),pages=writer.reserve(),ids=[];
 for(let i=0;i<boxes.length;i++){
  const box=boxes[i],w=box[2]-box[0],h=box[3]-box[1];
  const record=records.find(x=>x.page===i+1);
  const text=options.text||(record?.applied?String(record.text||''):'');
  let resources='<< >>',content='';
  if(text){
   const scale=Math.min(2,2048/Math.max(w,h));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(w*scale));canvas.height=Math.max(1,Math.ceil(h*scale));
   const ctx=canvas.getContext('2d');const size=options.size*Math.min(canvas.width,canvas.height);
   ctx.font=`${size}px ${JSON.stringify(options.font)}`;ctx.fillStyle=options.color;ctx.globalAlpha=options.alpha;ctx.textBaseline='alphabetic';
   const tw=ctx.measureText(text).width, pos=options.position==='random'?Math.floor(Math.random()*5):Number(options.position);
   const coords=[[canvas.width-tw-8*scale,canvas.height-18*scale],[10*scale,canvas.height-18*scale],[canvas.width-tw-8*scale,2*size],[10*scale,2*size],[(canvas.width-tw)/2,canvas.height/2]][pos];
   ctx.fillText(text,coords[0],coords[1]);
   const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,rgb=new Uint8Array(canvas.width*canvas.height*3),alpha=new Uint8Array(canvas.width*canvas.height);
   for(let j=0,k=0;j<alpha.length;j++){rgb[k++]=rgba[j*4];rgb[k++]=rgba[j*4+1];rgb[k++]=rgba[j*4+2];alpha[j]=rgba[j*4+3];}
   const mask=writer.stream(await compress(alpha),`/Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`);
   const image=writer.stream(await compress(rgb),`/Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask ${mask} 0 R`);
   resources=`<< /XObject << /Im ${image} 0 R >> >>`;content=`q ${w} 0 0 ${h} 0 0 cm /Im Do Q`;
  }
  const stream=writer.stream(new TextEncoder().encode(content));
  ids.push(writer.add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${w} ${h}] /Resources ${resources} /Contents ${stream} 0 R >>`));
 }
 writer.set(pages,`<< /Type /Pages /Count ${ids.length} /Kids [${ids.map(id=>`${id} 0 R`).join(' ')}] >>`);
 const root=writer.add(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
 const info=writer.add('<< /Producer (EPUB PDF Studio) >>');
 return (await writer.build(root,info).arrayBuffer());
}
$('secure-cancel').addEventListener('click',()=>{activeWorker?.terminate();activeWorker=null;$('secure-run').disabled=false;$('secure-cancel').hidden=true;status('已取消。');});
$('secure-run').addEventListener('click',async()=>{
 try{
  const file=$('secure-file').files[0];if(!file)throw Error('請選擇 PDF 檔案');
  const encrypt=$('secure-encrypt').checked,watermark=$('secure-watermark').checked;
  if(!encrypt&&!watermark)throw Error('請選擇加密或浮水印');
  const ownerPassword=$('secure-owner-password').value,openPassword=$('secure-open-password').value;
  if(encrypt&&(!ownerPassword||ownerPassword===openPassword))throw Error('請設定與開啟密碼不同的管理密碼');
  const opts={inputPassword:$('secure-input-password').value,encrypt,ownerPassword,openPassword,print:$('secure-print').value,modify:$('secure-modify').value,extract:$('secure-extract').checked,annotate:$('secure-annotate').checked};
  const overlayOpts={text:$('secure-text').value,font:$('secure-font').value||'Verdana',size:Number($('secure-size').value),alpha:Number($('secure-alpha').value),color:$('secure-color').value,position:$('secure-position').value};
  if(!Number.isFinite(overlayOpts.size)||overlayOpts.size<0.01||overlayOpts.size>0.3||!Number.isFinite(overlayOpts.alpha)||overlayOpts.alpha<0||overlayOpts.alpha>1)throw Error('請確認字級比例與透明度範圍');
  const records=$('secure-pages').value.trim()?JSON.parse($('secure-pages').value):[];
  if(!Array.isArray(records)||records.some(x=>!Number.isInteger(x.page)||x.page<1))throw Error('逐頁資料必須是包含有效 page 的陣列');
  if(watermark&&!overlayOpts.text&&!records.some(x=>x.applied&&x.text))throw Error('請輸入浮水印文字或匯入逐頁編號');
  $('secure-run').disabled=true;$('secure-cancel').hidden=false;$('secure-download').hidden=true;status('正在檢查 PDF…');
  const worker=activeWorker=new Worker(new URL('./pdf-security.worker.js',import.meta.url));
  worker.onmessage=async event=>{
   const message=event.data;
   try{
    if(message.type==='pages'){
     if(records.some(x=>x.page>message.boxes.length))throw Error('逐頁資料超出 PDF 頁數');
     status('正在產生浮水印與保護設定…');
     const buffer=watermark?await makeOverlay(message.boxes,records,overlayOpts):null;
     worker.postMessage({type:'overlay',buffer},buffer?[buffer]:[]);
    }else if(message.type==='result'){
     if(downloadUrl)URL.revokeObjectURL(downloadUrl);
     downloadUrl=URL.createObjectURL(new Blob([message.buffer],{type:'application/pdf'}));
     $('secure-download').href=downloadUrl;$('secure-download').download=file.name.replace(/\.pdf$/i,'')+'-protected.pdf';$('secure-download').hidden=false;
     status('處理完成，請下載並檢查輸出。');worker.terminate();activeWorker=null;$('secure-run').disabled=false;$('secure-cancel').hidden=true;
    }else if(message.type==='error')throw Error(message.message);
   }catch(error){worker.terminate();activeWorker=null;$('secure-run').disabled=false;$('secure-cancel').hidden=true;status(error.message);}
  };
  worker.onerror=()=>{worker.terminate();activeWorker=null;$('secure-run').disabled=false;$('secure-cancel').hidden=true;status('PDF 處理引擎發生錯誤。');};
  const buffer=await file.arrayBuffer();worker.postMessage({type:'secure',buffer,options:opts},[buffer]);
 }catch(error){$('secure-run').disabled=false;$('secure-cancel').hidden=true;status(error.message);}
});
