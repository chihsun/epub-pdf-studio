import {inspectLocalFontFile,loadLocalWatermarkFont} from './font-options.js';
import {PdfWriter} from './pdf-engine.js';
const $=id=>document.getElementById(id);
let activeWorker=null,downloadUrl=null,importedPageText=false,selectedPdf=null;
const choosePdf=()=>{if(!activeWorker)$('secure-file').click();};
const acceptPdf=file=>{
 if(!file||activeWorker)return;
 if(!/\.pdf$/i.test(file.name)){status('請選擇 PDF 檔案');return;}
 selectedPdf=file;
 $('secure-file-name').textContent=file.name;
 $('secure-file-size').textContent=(file.size/1024/1024).toFixed(2)+' MB · 本機檔案';
 $('secure-file-details').hidden=false;
 $('secure-download').hidden=true;
 if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=null;}
 status('');
};
$('secure-file').addEventListener('change',event=>acceptPdf(event.target.files?.[0]));
for(const id of ['secure-choose-button','secure-replace-button'])$(id).addEventListener('click',event=>{event.stopPropagation();choosePdf();});
const dropzone=$('secure-dropzone');
dropzone.addEventListener('click',event=>{if(event.target!==$('secure-file'))choosePdf();});
dropzone.addEventListener('keydown',event=>{if(event.target===dropzone&&(event.key==='Enter'||event.key===' ')){event.preventDefault();choosePdf();}});
for(const type of ['dragenter','dragover'])dropzone.addEventListener(type,event=>{event.preventDefault();if(!activeWorker)dropzone.classList.add('dragover');});
for(const type of ['dragleave','drop'])dropzone.addEventListener(type,event=>{event.preventDefault();dropzone.classList.remove('dragover');});
dropzone.addEventListener('drop',event=>acceptPdf(event.dataTransfer?.files?.[0]));
$('secure-text').addEventListener('input',()=>{importedPageText=false;});
function randomWatermarkNumber(){
 const range=90000000,limit=Math.floor(4294967296/range)*range,value=new Uint32Array(1);
 do{crypto.getRandomValues(value);}while(value[0]>=limit);
 return String(10000000+value[0]%range);
}
function generateWatermarkNumber(){
 $('secure-text').value=randomWatermarkNumber();importedPageText=false;
 $('secure-text-info').textContent='隨機產生 8 位數字；本次 PDF 的所選頁面共用此編號，每次執行會重新產生。';
}
function syncRandomText(){
 const enabled=$('secure-random-text').checked;
 $('secure-text').readOnly=enabled;$('secure-regenerate-text').hidden=!enabled;
 if(enabled)generateWatermarkNumber();
 else $('secure-text-info').textContent='可輸入共用文字，或留空使用 JSON 逐頁編號。';
}
$('secure-random-text').addEventListener('change',syncRandomText);
$('secure-regenerate-text').addEventListener('click',generateWatermarkNumber);

const syncPageFields=()=>{ $('secure-page-list').parentElement.hidden=$('secure-page-mode').value!=='specified';$('secure-random-count').parentElement.hidden=$('secure-page-mode').value!=='random';$('secure-interval').parentElement.hidden=$('secure-page-mode').value!=='interval';};
const fontMode=()=>document.querySelector('input[name="secure-font-mode"]:checked').value;
const syncFontFields=()=>{const fileMode=fontMode()==='file';$('secure-font').disabled=fileMode;$('secure-font-file').disabled=!fileMode;$('secure-font-face').disabled=!fileMode;};
for(const radio of document.querySelectorAll('input[name="secure-font-mode"]'))radio.addEventListener('change',syncFontFields);
syncFontFields();
$('secure-font-file').addEventListener('change',async event=>{
 const select=$('secure-font-face');select.replaceChildren();
 try{const names=await inspectLocalFontFile(event.target.files?.[0]);names.forEach((name,index)=>select.add(new Option(name,index)));$('secure-font-note').textContent='字型已讀取；產生浮水印前會完成載入。';}
 catch(error){$('secure-font-note').textContent=error.message;}
});
$('secure-page-mode').addEventListener('change',syncPageFields);
syncPageFields();
const status=text=>{$('secure-status').textContent=text;};
$('secure-json').addEventListener('change',async event=>{
 try{
  const file=event.target.files?.[0];if(!file)return;
  const data=JSON.parse(await file.text());
  if(!Array.isArray(data.images))throw Error('JSON 缺少 images 陣列');
  const pages=data.images.map(item=>({page:Number(item.savedIndex),text:String(item.text??''),applied:item.applied===true,sourceWidth:item.sourceWidth??item.width??null,sourceHeight:item.sourceHeight??item.height??null}));
  if(pages.some(item=>!Number.isInteger(item.page)||item.page<1))throw Error('JSON 含無效的 savedIndex');
  $('secure-pages').value=JSON.stringify(pages,null,2);
  $('secure-random-text').checked=false;syncRandomText();
  const texts=[...new Set(pages.filter(x=>x.applied&&x.text).map(x=>x.text))];
  $('secure-text').value=texts[0]||'';
  importedPageText=texts.length>1;
  $('secure-text-info').textContent=importedPageText?'顯示第一個匯入編號；各頁仍使用 JSON 的逐頁編號。修改此欄後，會將新文字套用至所有選定頁面。':'已帶入 JSON 浮水印文字／編號，可直接修改。';
  $('secure-page-mode').value='specified';
  $('secure-page-list').value=pages.filter(x=>x.applied).map(x=>x.page).join(',');syncPageFields();
  if(data.renderer?.fontFamily){$('secure-font').value=String(data.renderer.fontFamily);document.querySelector('input[name="secure-font-mode"][value="name"]').checked=true;syncFontFields();}
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
 const writer=new PdfWriter(),pages=writer.reserve(),ids=[];options.appliedPages=[];
 let intervalPages=[];
 if(options.pageMode==='interval'){
  for(let start=1;start<=boxes.length;){const length=options.intervalMin+Math.floor(Math.random()*(options.intervalMax-options.intervalMin+1));const end=Math.min(boxes.length,start+length-1);intervalPages.push(start+Math.floor(Math.random()*(end-start+1)));start=end+1;}
 }
 const selected=new Set(options.pageMode==='interval'?intervalPages:options.pageMode==='all'?boxes.map((_,i)=>i+1):options.pageMode==='random'?Array.from({length:boxes.length},(_,i)=>({page:i+1,key:Math.random()})).sort((a,b)=>a.key-b.key).slice(0,Math.min(boxes.length,options.randomCount)).map(x=>x.page):options.pageList.filter(n=>n<=boxes.length));
 for(let i=0;i<boxes.length;i++){
  const box=boxes[i],w=box[2]-box[0],h=box[3]-box[1];
  const record=records.find(x=>x.page===i+1);
  const text=selected.has(i+1)?(options.text||String(record?.text||'')):'';
  let resources='<< >>',content='';
  if(text){
   options.appliedPages.push(i+1);
   status(`正在建立浮水印（第 ${i+1} / ${boxes.length} 頁）…`);
   const scale=Math.min(2,2048/Math.max(w,h));
   const fullWidth=Math.max(1,Math.ceil(w*scale)),fullHeight=Math.max(1,Math.ceil(h*scale));
   const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;
   let ctx=canvas.getContext('2d');const size=options.size*Math.min(fullWidth,fullHeight);
   const font=`${size}px ${JSON.stringify(options.font)}, sans-serif`;
   ctx.font=font;
   const metrics=ctx.measureText(text),tw=metrics.width, pos=options.position==='random'?Math.floor(Math.random()*5):Number(options.position);
   const coords=[[fullWidth-tw-8*scale,fullHeight-18*scale],[10*scale,fullHeight-18*scale],[fullWidth-tw-8*scale,2*size],[10*scale,2*size],[(fullWidth-tw)/2,fullHeight/2]][pos];
   const x=Math.max(0,coords[0]),baseline=Math.min(fullHeight,Math.max(size,coords[1]));
   const maxTextWidth=Math.max(1,fullWidth-16*scale),drawWidth=Math.min(tw,maxTextWidth);
   const pad=Math.ceil(size*.25+2);
   const left=Math.max(0,Math.floor(x-pad)),top=Math.max(0,Math.floor(baseline-size*1.5-pad));
   const right=Math.min(fullWidth,Math.ceil(x+drawWidth+pad)),bottom=Math.min(fullHeight,Math.ceil(baseline+size*.5+pad));
   canvas.width=Math.max(1,right-left);canvas.height=Math.max(1,bottom-top);
   ctx=canvas.getContext('2d');ctx.font=font;ctx.fillStyle=options.color;ctx.globalAlpha=options.alpha;ctx.textBaseline='alphabetic';
   ctx.fillText(text,x-left,baseline-top,maxTextWidth);
   const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,rgb=new Uint8Array(canvas.width*canvas.height*3),alpha=new Uint8Array(canvas.width*canvas.height);
   for(let j=0,k=0;j<alpha.length;j++){rgb[k++]=rgba[j*4];rgb[k++]=rgba[j*4+1];rgb[k++]=rgba[j*4+2];alpha[j]=rgba[j*4+3];}
   const mask=writer.stream(await compress(alpha),`/Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`);
   const image=writer.stream(await compress(rgb),`/Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask ${mask} 0 R`);
   const imageWidth=w*canvas.width/fullWidth,imageHeight=h*canvas.height/fullHeight;
   const imageX=w*left/fullWidth,imageY=h*(fullHeight-top-canvas.height)/fullHeight;
   resources=`<< /XObject << /Im ${image} 0 R >> >>`;content=`q ${imageWidth} 0 0 ${imageHeight} ${imageX} ${imageY} cm /Im Do Q`;
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
  const file=selectedPdf;if(!file)throw Error('請選擇 PDF 檔案');
  const encrypt=$('secure-encrypt').checked,watermark=$('secure-watermark').checked;
  if(!encrypt&&!watermark)throw Error('請選擇加密或浮水印');
  const ownerPassword=$('secure-owner-password').value,openPassword=$('secure-open-password').value;
  if(encrypt&&(!ownerPassword||ownerPassword===openPassword))throw Error('請設定與開啟密碼不同的管理密碼');
  const opts={inputPassword:$('secure-input-password').value,encrypt,ownerPassword,openPassword,print:$('secure-print').value,modify:$('secure-modify').value,extract:$('secure-extract').checked,annotate:$('secure-annotate').checked};
  if(watermark&&$('secure-random-text').checked)generateWatermarkNumber();
  const overlayOpts={text:importedPageText?'':$('secure-text').value,font:$('secure-font').value.trim()||'sans-serif',size:Number($('secure-size').value),alpha:Number($('secure-alpha').value),color:$('secure-color').value,position:$('secure-position').value,pageMode:$('secure-page-mode').value,pageList:$('secure-page-list').value.split(',').map(x=>Number(x.trim())).filter(x=>Number.isInteger(x)&&x>0),randomCount:Number($('secure-random-count').value)};
  if(!Number.isFinite(overlayOpts.size)||overlayOpts.size<0.01||overlayOpts.size>0.3||!Number.isFinite(overlayOpts.alpha)||overlayOpts.alpha<0||overlayOpts.alpha>1)throw Error('請確認字級比例與透明度範圍');
  const interval=$('secure-interval').value.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if(overlayOpts.pageMode==='interval'){if(!interval||Number(interval[1])<1||Number(interval[2])<Number(interval[1])||Number(interval[2])>100000)throw Error('請輸入有效間隔範圍，例如 5-10');overlayOpts.intervalMin=Number(interval[1]);overlayOpts.intervalMax=Number(interval[2]);}
  if(watermark&&fontMode()==='file')overlayOpts.font=await loadLocalWatermarkFont($('secure-font-file').files[0],Number($('secure-font-face').value)||0);
  else if(watermark)await document.fonts.load('16px '+JSON.stringify(overlayOpts.font));
  const records=$('secure-pages').value.trim()?JSON.parse($('secure-pages').value):[];
  if(!Array.isArray(records)||records.some(x=>!Number.isInteger(x.page)||x.page<1))throw Error('逐頁資料必須是包含有效 page 的陣列');
  if(watermark&&!overlayOpts.text&&!records.some(x=>x.applied&&x.text))throw Error('請輸入浮水印文字或匯入逐頁編號');
  $('secure-run').disabled=true;$('secure-cancel').hidden=false;$('secure-download').hidden=true;status('正在檢查 PDF…');
  const worker=activeWorker=new Worker(new URL('./pdf-security.worker.js',import.meta.url));
  worker.onmessage=async event=>{
   const message=event.data;
   try{
    if(message.type==='progress'){status(message.message);return;}
    if(message.type==='pages'){
     if(!Number.isInteger(overlayOpts.randomCount)||overlayOpts.randomCount<1)throw Error('隨機頁數需為正整數');
     status('正在產生浮水印與保護設定…');
     const buffer=watermark?await makeOverlay(message.boxes,records,overlayOpts):null;
     if(watermark&&!overlayOpts.appliedPages.length)throw Error('沒有可套用的浮水印頁面，請確認頁碼與文字。');
     worker.postMessage({type:'overlay',buffer},buffer?[buffer]:[]);
    }else if(message.type==='result'){
     if(downloadUrl)URL.revokeObjectURL(downloadUrl);
     downloadUrl=URL.createObjectURL(new Blob([message.buffer],{type:'application/pdf'}));
     $('secure-download').href=downloadUrl;$('secure-download').download=file.name.replace(/\.pdf$/i,'')+'-protected.pdf';$('secure-download').hidden=false;
     status(watermark?'已加上 '+overlayOpts.appliedPages.length+' 頁浮水印：'+overlayOpts.appliedPages.join(', ')+'。請下載新檔檢查。':'處理完成，請下載並檢查輸出。');worker.terminate();activeWorker=null;$('secure-run').disabled=false;$('secure-cancel').hidden=true;
    }else if(message.type==='error')throw Error(message.message);
   }catch(error){worker.terminate();activeWorker=null;$('secure-run').disabled=false;$('secure-cancel').hidden=true;status(error.message);}
  };
  worker.onerror=()=>{worker.terminate();activeWorker=null;$('secure-run').disabled=false;$('secure-cancel').hidden=true;status('PDF 處理引擎發生錯誤。');};
  const buffer=await file.arrayBuffer();worker.postMessage({type:'secure',buffer,options:opts},[buffer]);
 }catch(error){$('secure-run').disabled=false;$('secure-cancel').hidden=true;status(error.message);}
});
