import {inspectEpub,convertEpub} from './epub-reader.js';
import {loadPdfFont} from './pdf-engine.js';

const $=id=>document.getElementById(id);
const state={book:null,file:null,output:null,font:null,loading:false};
const FONT_URL=new URL('./fonts/reading-ming.ttf',import.meta.url).href;
const SIZE_NAMES={original:'原書尺寸',A4:'A4',A5:'A5',B5:'B5',Letter:'Letter','6x9':'6 × 9'};
const sizes=document.querySelectorAll('input[name="page-size"]');
const activeRadio=name=>document.querySelector(`input[name="${name}"]:checked`)?.value;
const getOptions=()=>({
  pageSize:activeRadio('page-size')||'A4',
  orientation:activeRadio('orientation')||'auto',
  fontSize:Number($('font-size').value),marginMM:Number($('margin').value),lineHeight:Number($('line-height').value),
  includeCover:$('include-cover').checked,includeImages:$('include-images').checked,
  chapterBreak:$('chapter-break').checked,pageNumbers:$('page-numbers').checked
});
function status(message,progress){
  $('status-panel').hidden=false;
  $('status-text').textContent=message;
  $('status-percent').textContent=`${Math.round(progress*100)}%`;
  $('progress-fill').style.width=`${Math.round(progress*100)}%`;
}
function setError(message){$('error-panel').textContent=message;$('error-panel').hidden=false;}
function clearMessages(){
  $('error-panel').hidden=true;$('warning-panel').hidden=true;
  $('result-panel').hidden=true;$('status-panel').hidden=true;
}
function clearOutput(){
  state.output=null;
  $('result-panel').hidden=true;$('warning-panel').hidden=true;
  $('status-panel').hidden=true;
}
function selectFile(){if(!state.loading)$('file-input').click();}
async function acceptFile(file){
  if(!file||state.loading)return;
  clearMessages();clearOutput();state.book=null;state.file=file;
  $('book-details').hidden=true;
  $('convert-button').disabled=true;
  status('正在讀取 EPUB 書籍資訊',0.02);
  try{
    const book=await inspectEpub(file);
    state.book=book;
    $('book-title').textContent=book.title;
    $('book-author').textContent=book.author;
    const fixed=book.fixedLayout&&book.viewport;
    const pageLabel=fixed?`固定版面 · ${book.viewport.pxWidth} × ${book.viewport.pxHeight} px`:'可重排排版 · 預設 A4';
    $('book-extra').textContent=`${(file.size/1024/1024).toFixed(1)} MB · ${book.spine.length} 個閱讀項目 · ${pageLabel}`;
    const original=document.querySelector('input[name="page-size"][value="original"]');
    original.disabled=!fixed;
    original.parentElement.title=fixed?'使用書籍中提供的固定版面尺寸':'這本書沒有可用的固定頁面尺寸，請選擇 A4 等紙張';
    // Fixed-layout books choose their declared size; reflowable books choose A4.
    document.querySelector(`input[name="page-size"][value="${fixed?'original':'A4'}"]`).checked=true;
    $('book-details').hidden=false;
    $('convert-button').disabled=false;
    $('status-panel').hidden=true;
  }catch(e){
    state.book=null;setError(e?.message||'無法開啟此 EPUB，請確認檔案是否有效且未加密');$('status-panel').hidden=true;
  }
}
function updateRangeLabels(){
  $('font-size-label').textContent=`${$('font-size').value} pt`;
  $('margin-label').textContent=`${$('margin').value} mm`;
  $('line-height-label').textContent=`${Number($('line-height').value).toFixed(1)}×`;
}
function reset(){
  document.querySelector('input[name="page-size"][value="A4"]').checked=true;
  document.querySelector('input[name="orientation"][value="auto"]').checked=true;
  $('font-size').value='12';$('margin').value='18';$('line-height').value='1.5';
  for(const id of ['include-cover','include-images','chapter-break','page-numbers'])$(id).checked=true;
  updateRangeLabels();clearOutput();
}
async function convert(){
  if(!state.book||state.loading)return;
  state.loading=true;
  $('convert-button').disabled=true;
  $('choose-button').disabled=true;
  $('file-input').disabled=true;
  $('convert-button-label').textContent='轉換進行中…';
  clearMessages();
  try{
    status('正在準備中文字型',.01);
    if(!state.font)state.font=await loadPdfFont(FONT_URL);
    status('正在解析 EPUB 章節',.08);
    const output=await convertEpub(state.book,getOptions(),state.font,(progress,msg)=>status(msg,.08+progress*.92));
    state.output=output;
    $('result-stats').textContent=`${output.pageCount} 頁 · ${(output.blob.size/1024/1024).toFixed(1)} MB · ${SIZE_NAMES[getOptions().pageSize]} · ${output.imageCount} 張圖片`;
    $('result-panel').hidden=false;
    if(output.warnings.length){
      const unique=[...new Set(output.warnings)];
      $('warning-panel').textContent=`部分內容未完整轉換（${unique.length} 項）：${unique.slice(0,8).join('；')}${unique.length>8?' ……':''}`;
      $('warning-panel').hidden=false;
    }
  }catch(e){setError(e?.message||'轉換失敗，請嘗試更換書籍或簡化設定');$('status-panel').hidden=true;}
  finally{
    state.loading=false;$('convert-button').disabled=!state.book;$('choose-button').disabled=false;
    $('file-input').disabled=false;$('convert-button-label').textContent='重新轉換 PDF';
  }
}
function download(){
  if(!state.output)return;
  const url=URL.createObjectURL(state.output.blob);
  const a=document.createElement('a');
  a.href=url;a.download=state.output.fileName;a.style.display='none';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function registerPWA(){
  if(!('serviceWorker' in navigator)){$('offline-label').textContent='本機處理 · 瀏覽器不支援離線快取';return;}
  navigator.serviceWorker.register('./service-worker.js',{scope:'./'}).then(async()=>{
    try{await navigator.serviceWorker.ready;$('offline-label').textContent='本機處理 · 支援離線使用';}
    catch{$('offline-label').textContent='本機處理 · 已啟用隱私保護';}
  }).catch(()=>{$('offline-label').textContent='本機處理 · 離線安裝未完成';});
}
$('choose-button').addEventListener('click',e=>{e.stopPropagation();selectFile();});
$('replace-button').addEventListener('click',selectFile);
$('dropzone').addEventListener('click',e=>{if(!e.target.closest('button'))selectFile();});
$('dropzone').addEventListener('keydown',e=>{if(e.target!==$('dropzone'))return;if(e.key==='Enter'||e.key===' '){e.preventDefault();selectFile();}});
$('file-input').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)acceptFile(f);e.target.value='';});
const zone=$('dropzone');
for(const name of ['dragenter','dragover'])zone.addEventListener(name,e=>{e.preventDefault();zone.classList.add('drag-over');});
for(const name of ['dragleave','drop'])zone.addEventListener(name,e=>{e.preventDefault();zone.classList.remove('drag-over');});
zone.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f)acceptFile(f);});
$('reset-button').addEventListener('click',reset);
for(const el of document.querySelectorAll('.options-panel input'))el.addEventListener('input',()=>{updateRangeLabels();clearOutput();});
$('convert-button').addEventListener('click',convert);
$('download-button').addEventListener('click',download);
updateRangeLabels();registerPWA();
