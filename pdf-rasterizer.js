import {PdfWriter} from './pdf-engine.js';

// One canvas at a time; cancellation destroys PDF.js and its rendering worker.
export async function rasterizePdf(buffer,options,onProgress,signal){
  const dpi=Number(options.rasterDpi);
  const jpeg=Boolean(options.lossyImages);
  const quality=Number(options.quality?.jpegQuality);
  if(!Number.isInteger(dpi)||dpi<72||dpi>600)throw Error('轉圖解析度須為 72–600 DPI。');
  if(jpeg&&(!Number.isInteger(quality)||quality<40||quality>100))throw Error('請選擇高品質、均衡、高壓縮或自訂 JPEG 品質。');
  const check=()=>signal.throwIfAborted();
  check();
  const pdfjs=await import('./vendor/pdfjs/pdf.mjs');
  check();
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;
  const base=new URL('./vendor/pdfjs/',import.meta.url);
  const task=pdfjs.getDocument({data:new Uint8Array(buffer),password:options.password||'',
    cMapUrl:new URL('cmaps/',base).href,cMapPacked:true,
    standardFontDataUrl:new URL('standard_fonts/',base).href,
    wasmUrl:new URL('wasm/',base).href,iccUrl:new URL('iccs/',base).href,
    isEvalSupported:false,stopAtErrors:true});
  const abort=()=>{void task.destroy();};
  signal.addEventListener('abort',abort,{once:true});
  const canvas=document.createElement('canvas');
  try{
    check();
    const pdf=await task.promise;
    const writer=new PdfWriter(),pages=writer.reserve(),ids=[];
    for(let n=1;n<=pdf.numPages;n++){
      check();
      onProgress({phase:'rasterizing',message:`正在將每頁轉成圖片：${n} / ${pdf.numPages}（${dpi} DPI）`});
      const page=await pdf.getPage(n),box=page.getViewport({scale:1});
      const viewport=page.getViewport({scale:dpi/72});
      const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
      if(!Number.isFinite(width*height)||width<1||height<1||width>16384||height>16384||width*height>32000000)throw Error(`第 ${n} 頁轉圖尺寸過大，請降低轉圖 DPI。`);
      canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d',{willReadFrequently:!jpeg});
      await page.render({canvasContext:context,viewport,background:'rgb(255,255,255)'}).promise;
      check();
      let bytes,filter;
      if(jpeg){
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality/100));
        if(!blob||blob.type!=='image/jpeg')throw Error('瀏覽器無法產生 JPEG 圖片。');
        bytes=new Uint8Array(await blob.arrayBuffer());filter='DCTDecode';
      }else{
        const rgba=context.getImageData(0,0,canvas.width,canvas.height).data;
        const rgb=new Uint8Array(canvas.width*canvas.height*3);
        for(let i=0,j=0;i<rgba.length;i+=4){rgb[j++]=rgba[i];rgb[j++]=rgba[i+1];rgb[j++]=rgba[i+2];}
        bytes=new Uint8Array(await new Response(new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
        filter='FlateDecode';
      }
      check();
      const image=writer.stream(bytes,`/Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter}`);
      const content=writer.stream(new TextEncoder().encode(`q ${box.width} 0 0 ${box.height} 0 0 cm /Im Do Q`));
      ids.push(writer.add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${box.width} ${box.height}] /Resources << /XObject << /Im ${image} 0 R >> >> /Contents ${content} 0 R >>`));
      page.cleanup();canvas.width=canvas.height=1;
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    writer.set(pages,`<< /Type /Pages /Count ${ids.length} /Kids [${ids.map(id=>`${id} 0 R`).join(' ')}] >>`);
    const root=writer.add(`<< /Type /Catalog /Pages ${pages} 0 R >>`),info=writer.add('<< >>');
    check();
    return await writer.build(root,info).arrayBuffer();
  }finally{
    signal.removeEventListener('abort',abort);canvas.width=canvas.height=1;
    await task.destroy();
  }
}
