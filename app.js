import {inspectEpub,convertEpub} from './epub-reader.js';
import {loadPdfFont} from './pdf-engine.js';
import {QUALITY_PRESETS,loadQualitySettings,saveQualitySettings,resolveQualitySettings} from './quality-presets.js';
import {startPdfOptimization} from './pdf-optimizer.js';

const $=id=>document.getElementById(id);
const state={book:null,file:null,output:null,font:null,loading:false,pdfFile:null,pdfOutput:null,pdfTask:null,pdfLoading:false};
let qualitySettings=loadQualitySettings();
const FONT_URL=new URL('./fonts/reading-ming.ttf',import.meta.url).href;
const SIZE_NAMES={original:'原書尺寸',A4:'A4',A5:'A5',B5:'B5',Letter:'Letter','6x9':'6 × 9'};
const sizes=document.querySelectorAll('input[name="page-size"]');
const activeRadio=name=>document.querySelector(`input[name="${name}"]:checked`)?.value;
const getOptions=()=>({
  pageSize:activeRadio('page-size')||'A4',
  orientation:activeRadio('orientation')||'auto',
  readingDirection:activeRadio('reading-direction')||'auto',
  fontSize:Number($('font-size').value),marginMM:Number($('margin').value),lineHeight:Number($('line-height').value),
  quality:resolveQualitySettings(qualitySettings),
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
function updatePdfLossyWarning(){
  const lossy=$('pdf-lossy-images');
  const original=qualitySettings.preset==='original';
  if(original)lossy.checked=false;
  lossy.disabled=original;
  $('pdf-lossy-warning').hidden=!lossy.checked;
}
function renderQualitySettings(){
  const preset=qualitySettings.preset;
  const resolved=resolveQualitySettings(qualitySettings);
  $('quality-preset').value=preset;
  $('quality-custom').hidden=preset!=='custom';
  $('quality-target-dpi').value=resolved.targetDpi??180;
  $('quality-threshold-dpi').value=resolved.thresholdDpi??270;
  $('quality-jpeg').value=resolved.jpegQuality??82;
  $('quality-current-label').textContent=`目前：${QUALITY_PRESETS[preset].label}`;
  $('quality-description').textContent=preset==='custom'
    ?`圖片高於 ${resolved.thresholdDpi} DPI 才縮至 ${resolved.targetDpi} DPI；JPEG 品質 ${resolved.jpegQuality}。`
    :QUALITY_PRESETS[preset].description;
  updatePdfLossyWarning();
}
function saveQualityFromControls(){
  qualitySettings=saveQualitySettings({
    preset:$('quality-preset').value,
    custom:{targetDpi:$('quality-target-dpi').value,thresholdDpi:$('quality-threshold-dpi').value,jpegQuality:$('quality-jpeg').value}
  });
  renderQualitySettings();clearOutput();clearPdfOutput();
}
function setWorkspace(workspace,{scroll=false,updateHash=true}={}){
  const pdf=workspace==='pdf';
  $('epub-workspace').hidden=pdf;
  $('pdf-optimizer').hidden=!pdf;
  $('workspace-crumb').textContent=pdf?'PDF 最佳化':'EPUB 轉 PDF';
  document.querySelectorAll('[data-workspace]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.workspace===(pdf?'pdf':'epub'))));
  document.querySelectorAll('[data-workspace-link]').forEach(link=>link.classList.toggle('nav-current',link.dataset.workspaceLink===(pdf?'pdf':'epub')));
  if(updateHash)history.replaceState(null,'',pdf?'#pdf-optimizer':'#epub-workspace');
  if(scroll)window.scrollTo({top:0,behavior:'smooth'});
}
function bindWorkspaceNavigation(){
  document.querySelectorAll('[data-workspace-link]').forEach(link=>link.addEventListener('click',event=>{
    event.preventDefault();
    if(link.dataset.workspaceLink==='help'){
      setWorkspace('epub',{updateHash:false});
      $('instructions').scrollIntoView({behavior:'smooth',block:'start'});
      history.replaceState(null,'','#instructions');
    }else setWorkspace(link.dataset.workspaceLink,{scroll:true});
  }));
  document.querySelectorAll('[data-workspace]').forEach(button=>button.addEventListener('click',()=>setWorkspace(button.dataset.workspace,{scroll:true})));
}
function reset(){
  document.querySelector('input[name="page-size"][value="A4"]').checked=true;
  document.querySelector('input[name="orientation"][value="auto"]').checked=true;
  document.querySelector('input[name="reading-direction"][value="auto"]').checked=true;
  $('font-size').value='12';$('margin').value='18';$('line-height').value='1.5';
  for(const id of ['include-cover','include-images','chapter-break','page-numbers'])$(id).checked=true;
  qualitySettings=saveQualitySettings({preset:'original',custom:qualitySettings.custom});
  renderQualitySettings();
  $('pdf-lossy-images').checked=false;$('pdf-object-streams').checked=false;$('pdf-password').value='';
  updatePdfLossyWarning();
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
    const directionLabel=output.readingDirection==='R2L'?'右至左':output.readingDirection==='L2R'?'左至右':'依閱讀器設定';
    const directionSource=output.directionSource?`（${output.directionSource}）`:'';
    $('result-stats').textContent=`${output.pageCount} 頁 · ${(output.blob.size/1024/1024).toFixed(1)} MB · ${SIZE_NAMES[getOptions().pageSize]} · ${output.imageCount} 張圖片 · ${output.bookmarkCount} 個書籤 · ${directionLabel}${directionSource}`;
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
const formatBytes=bytes=>bytes>=1024*1024?`${(bytes/1024/1024).toFixed(2)} MB`:`${(bytes/1024).toFixed(1)} KB`;
function clearPdfMessages(){
  $('pdf-error-panel').hidden=true;$('pdf-warning-panel').hidden=true;
  $('pdf-result-panel').hidden=true;$('pdf-status-panel').hidden=true;
}
function clearPdfOutput(){
  state.pdfOutput=null;
  $('pdf-result-panel').hidden=true;$('pdf-warning-panel').hidden=true;$('pdf-status-panel').hidden=true;
}
function acceptPdfFile(file){
  if(!file||state.pdfLoading)return;
  clearPdfMessages();clearPdfOutput();
  state.pdfFile=null;$('pdf-file-details').hidden=true;$('pdf-optimize-button').disabled=true;
  if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf'){
    $('pdf-error-panel').textContent='請選擇 PDF 檔案。';$('pdf-error-panel').hidden=false;return;
  }
  state.pdfFile=file;
  $('pdf-file-name').textContent=file.name;
  $('pdf-file-size').textContent=`${formatBytes(file.size)} · 本機檔案`;
  $('pdf-file-pages').textContent=file.size>150*1024*1024?'大型 PDF 可能使用較多瀏覽器記憶體':'頁數將於結構檢查後顯示';
  $('pdf-file-details').hidden=false;
  $('pdf-optimize-button').disabled=false;
  $('pdf-optimize-label').textContent='開始最佳化 PDF';
}
function pdfProgress(phase,message){
  const progress={loading:.16,checking:.38,optimizing:.68,complete:1}[phase]||.2;
  $('pdf-status-panel').hidden=false;
  $('pdf-status-text').textContent=message;
  $('pdf-status-percent').textContent=`${Math.round(progress*100)}%`;
  $('pdf-progress-fill').style.width=`${Math.max(12,Math.round(progress*100))}%`;
}
async function optimizePdf(){
  if(!state.pdfFile||state.pdfLoading)return;
  state.pdfLoading=true;clearPdfMessages();
  $('pdf-optimize-button').disabled=true;$('pdf-choose-button').disabled=true;
  $('pdf-file-input').disabled=true;$('pdf-cancel-button').hidden=false;
  $('pdf-optimize-label').textContent='最佳化進行中…';
  pdfProgress('loading','正在準備本機 PDF 引擎');
  try{
    state.pdfTask=startPdfOptimization(state.pdfFile,{
      quality:resolveQualitySettings(qualitySettings),
      lossyImages:$('pdf-lossy-images').checked,
      objectStreams:$('pdf-object-streams').checked,
      password:$('pdf-password').value
    },message=>pdfProgress(message.phase,message.message));
    const result=await state.pdfTask.promise;
    const blob=new Blob([result.buffer],{type:'application/pdf'});
    state.pdfOutput={blob,pageCount:result.pageCount,warnings:result.warnings||[]};
    $('pdf-file-pages').textContent=`${result.pageCount} 頁 · 結構檢查通過`;
    const difference=state.pdfFile.size-blob.size;
    const changePercent=state.pdfFile.size?Math.abs(difference)/state.pdfFile.size*100:0;
    const sizeText=difference>0?`減少 ${changePercent.toFixed(1)}%`:difference<0?`比原始檔大 ${changePercent.toFixed(1)}%`:'大小相同';
    const qualityText=result.lossyImages?' · 已啟用 JPEG 圖片重壓縮':' · 無損圖片模式';
    $('pdf-result-stats').textContent=`${result.pageCount} 頁 · ${formatBytes(state.pdfFile.size)} → ${formatBytes(blob.size)} · ${sizeText}${qualityText}`;
    $('pdf-result-panel').hidden=false;
    $('pdf-status-panel').hidden=true;
    if(difference<0){$('pdf-warning-panel').textContent='最佳化後的檔案較大；請比較兩個版本，保留較適合的檔案。';$('pdf-warning-panel').hidden=false;}
    if(state.pdfOutput.warnings.length){
      $('pdf-warning-panel').textContent=[...new Set(state.pdfOutput.warnings)].slice(0,4).join('；');
      $('pdf-warning-panel').hidden=false;
    }
  }catch(error){
    if(error?.name==='AbortError'){
      $('pdf-status-panel').hidden=false;
      $('pdf-status-text').textContent='已取消最佳化；原始 PDF 未修改。';
      $('pdf-status-percent').textContent='已取消';
      $('pdf-progress-fill').style.width='0%';
    }else{
      const safeMessage=(error?.message||'PDF 最佳化失敗').replace(/--password=[^\s]*/g,'--password=[已隱去]');
      $('pdf-error-panel').textContent=safeMessage;
      $('pdf-error-panel').hidden=false;
      $('pdf-status-panel').hidden=true;
    }
  }finally{
    state.pdfLoading=false;state.pdfTask=null;
    $('pdf-optimize-button').disabled=!state.pdfFile;
    $('pdf-choose-button').disabled=false;$('pdf-file-input').disabled=false;
    $('pdf-cancel-button').hidden=true;$('pdf-optimize-label').textContent='重新最佳化 PDF';
    $('pdf-password').value='';
  }
}
function downloadPdf(blob,name){
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download=name;anchor.style.display='none';
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function downloadOptimizedPdf(){
  if(!state.pdfOutput||!state.pdfFile)return;
  const name=state.pdfFile.name.replace(/\.pdf$/i,'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_')||'PDF';
  downloadPdf(state.pdfOutput.blob,`${name}_optimized.pdf`);
}
function downloadOriginalPdf(){
  if(!state.pdfFile)return;
  const name=state.pdfFile.name.replace(/\.pdf$/i,'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_')||'PDF';
  downloadPdf(state.pdfFile,`${name}_original.pdf`);
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
for(const el of document.querySelectorAll('#epub-workspace .options-panel input'))el.addEventListener('input',()=>{updateRangeLabels();clearOutput();});
for(const el of document.querySelectorAll('#pdf-optimizer .options-panel input'))el.addEventListener('input',()=>clearPdfOutput());
$('convert-button').addEventListener('click',convert);
$('download-button').addEventListener('click',download);
$('quality-preset').addEventListener('change',()=>{
  qualitySettings=saveQualitySettings({preset:$('quality-preset').value,custom:qualitySettings.custom});
  renderQualitySettings();clearOutput();clearPdfOutput();
});
for(const id of ['quality-target-dpi','quality-threshold-dpi','quality-jpeg'])$(id).addEventListener('change',saveQualityFromControls);
$('pdf-lossy-images').addEventListener('change',()=>{updatePdfLossyWarning();clearPdfOutput();});
document.querySelectorAll('#epub-workspace .options-panel input').forEach(input=>input.addEventListener('change',clearOutput));
$('pdf-optimize-button').addEventListener('click',optimizePdf);
$('pdf-cancel-button').addEventListener('click',()=>state.pdfTask?.cancel());
$('pdf-download-button').addEventListener('click',downloadOptimizedPdf);
$('pdf-original-download-button').addEventListener('click',downloadOriginalPdf);
$('pdf-choose-button').addEventListener('click',event=>{event.stopPropagation();$('pdf-file-input').click();});
$('pdf-replace-button').addEventListener('click',()=>$('pdf-file-input').click());
$('pdf-file-input').addEventListener('change',event=>{const file=event.target.files?.[0];if(file)acceptPdfFile(file);event.target.value='';});
const pdfZone=$('pdf-dropzone');
pdfZone.addEventListener('click',event=>{if(!event.target.closest('button'))$('pdf-file-input').click();});
pdfZone.addEventListener('keydown',event=>{if(event.target!==pdfZone)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();$('pdf-file-input').click();}});
for(const name of ['dragenter','dragover'])pdfZone.addEventListener(name,event=>{event.preventDefault();pdfZone.classList.add('drag-over');});
for(const name of ['dragleave','drop'])pdfZone.addEventListener(name,event=>{event.preventDefault();pdfZone.classList.remove('drag-over');});
pdfZone.addEventListener('drop',event=>{const file=event.dataTransfer?.files?.[0];if(file)acceptPdfFile(file);});
bindWorkspaceNavigation();
renderQualitySettings();
if(location.hash==='#pdf-optimizer')setWorkspace('pdf',{updateHash:false});
updateRangeLabels();registerPWA();
