/* qpdf runs in a dedicated worker so large documents do not block the UI. */
let qpdfPromise;
let qpdf;
let stdout=[];
let stderr=[];

self.addEventListener('message',event=>{
  const message=event.data||{};
  if(message.type==='optimize')optimize(message).catch(error=>{
    self.postMessage({type:'error',code:error.code||'PDF_OPTIMIZE_FAILED',message:error.message||String(error),warnings:error.warnings||[]});
  });
});

function initQpdf(){
  if(!qpdfPromise){
    try{
      importScripts(new URL('./vendor/qpdf/qpdf.js',self.location.href).href);
      const factory=self.Module;
      if(typeof factory!=='function')throw new Error('qpdf WASM 模組初始化器未載入');
      qpdfPromise=factory({
        noInitialRun:true,
        locateFile:path=>path.endsWith('.wasm')?new URL('./vendor/qpdf/qpdf.wasm',self.location.href).href:path,
        print:text=>stdout.push(String(text)),
        printErr:text=>stderr.push(String(text))
      }).then(module=>{qpdf=module;return module;});
    }catch(error){qpdfPromise=Promise.reject(error);}
  }
  return qpdfPromise;
}

function runQpdf(args){
  stdout=[];stderr=[];
  let exitCode;
  try{exitCode=qpdf.callMain(args);}
  catch(error){
    if(error?.name==='ExitStatus'&&Number.isFinite(error.status))exitCode=error.status;
    else throw error;
  }
  return {exitCode:Number.isFinite(exitCode)?exitCode:0,stdout:stdout.join('\n').trim(),stderr:stderr.join('\n').trim()};
}

function containsAscii(bytes,value){
  const pattern=Uint8Array.from(value,character=>character.charCodeAt(0));
  const first=pattern[0];
  for(let index=0;index<=bytes.length-pattern.length;){
    index=bytes.indexOf(first,index);
    if(index<0)return false;
    let match=true;
    for(let offset=1;offset<pattern.length;offset++)if(bytes[index+offset]!==pattern[offset]){match=false;break;}
    if(match)return true;
    index++;
  }
  return false;
}

function assertPdf(bytes){
  const header=bytes.subarray(0,Math.min(bytes.length,1024));
  if(!containsAscii(header,'%PDF-')){
    const error=new Error('檔案沒有有效的 PDF 標頭，請選擇未損壞的 PDF。');
    error.code='PDF_INVALID_HEADER';
    throw error;
  }
}

function cleanup(paths){
  for(const path of paths){
    try{if(qpdf?.FS?.analyzePath(path).exists)qpdf.FS.unlink(path);}catch{}
  }
}

async function optimize(message){
  const bytes=new Uint8Array(message.buffer);
  const options=message.options||{};
  assertPdf(bytes);
  self.postMessage({type:'progress',phase:'loading',message:'正在載入本機 PDF 引擎'});
  await initQpdf();
  const inputPath='/epub-pdf-studio-input.pdf';
  const outputPath='/epub-pdf-studio-optimized.pdf';
  const signaturePath='/epub-pdf-studio-signature-check.json';
  cleanup([inputPath,outputPath,signaturePath]);
  qpdf.FS.writeFile(inputPath,bytes);
  try{
    const password=String(options.password||'');
    const auth=password? [`--password=${password}`] : [];
    self.postMessage({type:'progress',phase:'checking',message:'正在檢查 PDF 結構與密碼'});
    const check=runQpdf([...auth,'--check',inputPath]);
    if(check.exitCode!==0){
      const reason=check.stderr||check.stdout||`qpdf 結束代碼 ${check.exitCode}`;
      const error=new Error(`PDF 結構檢查未通過，已保留原檔。${password?'請確認密碼與檔案完整性。':'若檔案設有開啟密碼，請在進階設定輸入密碼。'}\n${reason.slice(0,1200)}`);
      error.code=check.exitCode===3?'PDF_CHECK_WARNING':'PDF_CHECK_FAILED';
      error.warnings=[reason];
      throw error;
    }
    // Inspect qpdf's structured object view so signatures stored in compressed
    // object streams are detected too. JSON stream data is omitted by default.
    self.postMessage({type:'progress',phase:'checking',message:'正在檢查 PDF 數位簽章'});
    const signatureCheck=runQpdf([...auth,'--json',inputPath,signaturePath]);
    if(signatureCheck.exitCode!==0){
      const error=new Error(`無法確認 PDF 數位簽章狀態，為保護文件完整性已停止處理。${signatureCheck.stderr?`\n${signatureCheck.stderr.slice(0,800)}`:''}`);
      error.code='PDF_SIGNATURE_CHECK_FAILED';
      throw error;
    }
    const signatureJson=qpdf.FS.readFile(signaturePath,{encoding:'utf8'});
    if(/"\/ByteRange"\s*:/.test(signatureJson)){
      const error=new Error('偵測到 PDF 數位簽章欄位。重新寫入會使簽章失效，因此已停止處理；原始檔未修改。');
      error.code='PDF_SIGNED';
      throw error;
    }
    cleanup([signaturePath]);
    const pagesResult=runQpdf([...auth,'--show-npages',inputPath]);
    const pageCount=Number.parseInt(pagesResult.stdout,10);
    if(pagesResult.exitCode!==0||!Number.isFinite(pageCount))throw new Error(pagesResult.stderr||'無法讀取 PDF 頁數');

    self.postMessage({type:'progress',phase:'optimizing',message:'正在進行無損結構與圖片處理'});
    const quality=options.quality||{};
    const args=[...auth,'--compress-streams=y','--decode-level=generalized','--recompress-flate','--compression-level=9'];
    args.push(options.objectStreams?'--object-streams=generate':'--object-streams=preserve');
    if(options.lossyImages){
      const jpegQuality=Number(quality.jpegQuality);
      if(!Number.isInteger(jpegQuality)||jpegQuality<40||jpegQuality>100){
        const error=new Error('圖片 JPEG 品質設定無效，請重新選擇品質預設。');
        error.code='PDF_QUALITY_INVALID';
        throw error;
      }
      args.push('--optimize-images',`--jpeg-quality=${jpegQuality}`);
    }
    args.push(inputPath,outputPath);
    const result=runQpdf(args);
    if(result.exitCode!==0&&result.exitCode!==3){
      const error=new Error(result.stderr||result.stdout||`qpdf 最佳化失敗，結束代碼 ${result.exitCode}`);
      error.code='PDF_OPTIMIZE_FAILED';
      throw error;
    }
    if(!qpdf.FS.analyzePath(outputPath).exists)throw new Error('qpdf 沒有產生輸出 PDF，原始檔未修改');
    const output=qpdf.FS.readFile(outputPath,{encoding:'binary'});
    const outputBytes=new Uint8Array(output.buffer.slice(output.byteOffset,output.byteOffset+output.byteLength));
    if(!outputBytes.length||!containsAscii(outputBytes.subarray(0,Math.min(outputBytes.length,1024)),'%PDF-'))throw new Error('最佳化輸出不是有效的 PDF，原始檔未修改');
    const warnings=result.exitCode===3?[result.stderr||result.stdout||'qpdf 完成時回報警告，請比對原始檔。']:[];
    self.postMessage({
      type:'result',
      result:{buffer:outputBytes.buffer,pageCount,warnings,exitCode:result.exitCode,lossyImages:Boolean(options.lossyImages)}
    },[outputBytes.buffer]);
  }finally{
    cleanup([inputPath,outputPath,signaturePath]);
  }
}
