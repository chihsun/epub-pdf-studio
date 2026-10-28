const MAX_FILE_BYTES=250*1024*1024;
const MAX_UNCOMPRESSED_BYTES=600*1024*1024;
const MAX_IMAGE_PIXELS=40_000_000;
const MIME_TYPE='application/epub+zip';
const getByLocal=(parent,name)=>Array.from(parent?.getElementsByTagName('*')||[]).filter(node=>node.localName===name);
const parseXml=source=>{
  const doc=new DOMParser().parseFromString(source,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw new Error('EPUB XML 格式錯誤，已停止處理');
  return doc;
};

function normalizePath(path){
  const parts=[];
  for(const part of (path||'').replaceAll('\\','/').split('/')){
    if(!part||part==='.')continue;
    if(part==='..'){if(!parts.length)throw new Error('EPUB 資源路徑超出封裝目錄');parts.pop();}
    else parts.push(part);
  }
  return parts.join('/');
}

function resolvePath(basePath,href){
  const raw=(href||'').trim();
  if(!raw||/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw))return null;
  let path=raw.split('#')[0].split('?')[0];
  if(!path)return null;
  try{path=decodeURIComponent(path);}catch{ /* retain malformed escapes for a safe lookup */ }
  const joined=path.startsWith('/')?path.slice(1):basePath.slice(0,basePath.lastIndexOf('/')+1)+path;
  return normalizePath(joined);
}

function readViewport(doc){
  const value=doc.querySelector('meta[name="viewport"]')?.getAttribute('content')||'';
  const width=/\bwidth\s*=\s*["']?(\d+(?:\.\d+)?)/i.exec(value)?.[1];
  const height=/\bheight\s*=\s*["']?(\d+(?:\.\d+)?)/i.exec(value)?.[1];
  if(!width||!height)return null;
  const result={width:Number(width),height:Number(height)};
  return result.width>=100&&result.height>=100&&result.width<14400&&result.height<14400?result:null;
}

function parseCssRules(css){
  return Array.from((css||'').replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g),match=>({selector:match[1].trim(),body:match[2]}))
    .filter(rule=>rule.selector&&!rule.selector.startsWith('@'));
}

function declarations(source){
  const result={};
  for(const part of (source||'').split(';')){
    const colon=part.indexOf(':');
    if(colon<1)continue;
    result[part.slice(0,colon).trim().toLowerCase()]=part.slice(colon+1).trim();
  }
  return result;
}

function lengthInPixels(value,axis,viewport){
  if(!value||!viewport)return null;
  const match=/^\s*(\d+(?:\.\d+)?)\s*(px|%|vw|vh|pt|mm|cm|in)?\s*$/i.exec(value);
  if(!match)return null;
  const number=Number(match[1]),unit=(match[2]||'px').toLowerCase();
  if(unit==='%')return viewport[axis]*number/100;
  if(unit==='vw')return viewport.width*number/100;
  if(unit==='vh')return viewport.height*number/100;
  if(unit==='pt')return number*96/72;
  if(unit==='mm')return number*96/25.4;
  if(unit==='cm')return number*96/2.54;
  if(unit==='in')return number*96;
  return number;
}

function displayedSize(element,rules,viewport){
  if(!viewport)return null;
  let width=lengthInPixels(element.getAttribute('width'),'width',viewport);
  let height=lengthInPixels(element.getAttribute('height'),'height',viewport);
  let unknownSizing=false;
  for(const rule of rules){
    const selectors=rule.selector.split(',').map(value=>value.trim());
    if(!selectors.some(selector=>{try{return element.matches(selector);}catch{return false;}}))continue;
    const values=declarations(rule.body);
    for(const key of ['width','height'])if(values[key]&&!['auto','initial','inherit','unset'].includes(values[key].toLowerCase())&&lengthInPixels(values[key],key,viewport)==null)unknownSizing=true;
    if(values.transform&&values.transform.toLowerCase()!=='none')unknownSizing=true;
    width=Math.max(width||0,lengthInPixels(values.width,'width',viewport)||0)||width;
    height=Math.max(height||0,lengthInPixels(values.height,'height',viewport)||0)||height;
  }
  const inline=declarations(element.getAttribute('style'));
  for(const key of ['width','height'])if(inline[key]&&!['auto','initial','inherit','unset'].includes(inline[key].toLowerCase())&&lengthInPixels(inline[key],key,viewport)==null)unknownSizing=true;
  if(inline.transform&&inline.transform.toLowerCase()!=='none')unknownSizing=true;
  width=Math.max(width||0,lengthInPixels(inline.width,'width',viewport)||0)||width;
  height=Math.max(height||0,lengthInPixels(inline.height,'height',viewport)||0)||height;
  if(unknownSizing||(!width&&!height))return null;
  return {width:width||null,height:height||null};
}

async function readDocument(item,zip,manifest){
  if(!/html|xhtml/.test(item.media))return null;
  const entry=zip.file(item.path);
  if(!entry)return null;
  const doc=new DOMParser().parseFromString(await entry.async('string'),'text/html');
  const viewport=readViewport(doc);
  const cssTexts=Array.from(doc.querySelectorAll('style'),node=>({base:item.path,source:node.textContent||''}));
  for(const link of doc.querySelectorAll('link[rel]')){
    if(!(link.getAttribute('rel')||'').toLowerCase().split(/\s+/).includes('stylesheet'))continue;
    const cssPath=resolvePath(item.path,link.getAttribute('href')||'');
    if(cssPath&&zip.file(cssPath))cssTexts.push({base:cssPath,source:await zip.file(cssPath).async('string')});
  }
  const rules=cssTexts.flatMap(entry=>parseCssRules(entry.source));
  const refs=[];
  const add=(href,size=null,base=item.path)=>{
    const path=resolvePath(base,href);
    if(!path||!manifest.has(path))return;
    refs.push({path,size});
  };
  for(const image of doc.querySelectorAll('img')){
    const size=displayedSize(image,rules,viewport);
    add(image.getAttribute('src')||'',size);
    const srcset=image.getAttribute('srcset')||'';
    for(const candidate of srcset.split(','))add(candidate.trim().split(/\s+/)[0]||'',size);
  }
  for(const image of getByLocal(doc,'image')){
    add(image.getAttribute('href')||image.getAttribute('xlink:href')||image.getAttributeNS?.('http://www.w3.org/1999/xlink','href')||'',viewport);
  }
  const cssUrl=/url\(\s*(["']?)(.*?)\1\s*\)/gi;
  for(const css of cssTexts){
    let match;
    while((match=cssUrl.exec(css.source)))add(match[2],viewport,css.base);
  }
  const inlineSources=(doc.documentElement?.outerHTML||'')+'\n'+cssTexts.map(entry=>entry.source).join('\n');
  const inlineImageCount=(inlineSources.match(/data:image\/[^,\s"')]+;base64,/gi)||[]).length;
  return {viewport,refs,inlineImageCount};
}

function validateMimetypeHeader(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<30||view.getUint32(0,true)!==0x04034b50)throw new Error('EPUB ZIP 封裝不完整，已停止處理');
  const method=view.getUint16(8,true),nameLength=view.getUint16(26,true),extraLength=view.getUint16(28,true);
  const name=new TextDecoder().decode(bytes.subarray(30,30+nameLength));
  if(name!=='mimetype'||method!==0||extraLength!==0)throw new Error('EPUB 的 mimetype 必須是第一個未壓縮且沒有額外欄位的 ZIP 項目，已停止處理');
}

function encryptedResources(doc){
  return new Set(getByLocal(doc,'CipherReference').map(node=>node.getAttribute('URI')).filter(Boolean).map(uri=>{
    let decoded=uri;
    try{decoded=decodeURIComponent(uri);}catch{ /* retain the original URI */ }
    return normalizePath(decoded.replace(/^\//,''));
  }));
}

function validatePackage(zip){
  const container=zip.file('META-INF/container.xml');
  if(!container)throw new Error('輸出 EPUB 缺少 META-INF/container.xml');
  return container.async('string').then(source=>{
    const doc=parseXml(source);
    const rootfile=getByLocal(doc,'rootfile')[0];
    const opfPath=normalizePath(rootfile?.getAttribute('full-path')||'');
    if(!opfPath||!zip.file(opfPath))throw new Error('輸出 EPUB 的 OPF 套件文件無法讀取');
    return zip.file(opfPath).async('string').then(opfSource=>{
      const opf=parseXml(opfSource),items=getByLocal(opf,'item');
      for(const item of items){
        const href=item.getAttribute('href')||'';
        const path=resolvePath(opfPath,href);
        if(path&&!zip.file(path))throw new Error('輸出 EPUB 缺少 OPF 資源：'+path);
      }
      return opfPath;
    });
  });
}

export async function inspectFixedLayoutEpub(file){
  if(!file||!file.name||!file.name.toLowerCase().endsWith('.epub'))throw new Error('請選擇 .epub 檔案');
  if(file.size>MAX_FILE_BYTES)throw new Error('EPUB 超過目前 250 MB 的安全處理上限');
  const zip=await JSZip.loadAsync(file,{checkCRC32:false});
  const fileEntries=Object.values(zip.files).filter(entry=>!entry.dir);
  const decompressed=fileEntries.reduce((sum,entry)=>sum+(entry._data?.uncompressedSize||0),0);
  if(decompressed>MAX_UNCOMPRESSED_BYTES)throw new Error('EPUB 解壓後超過 600 MB 的安全處理上限');
  const names=fileEntries.map(entry=>entry.name);
  if(names[0]!=='mimetype')throw new Error('EPUB 封裝中的 mimetype 項目順序不正確，為避免損壞文件已停止處理');
  const signature=names.some(name=>/^META-INF\/signatures\.xml$/i.test(name)||/^META-INF\/signatures\//i.test(name));
  if(signature)throw new Error('此 EPUB 含有數位簽章；重新封裝會使簽章失效，因此未產生修改檔案');
  const mimetype=await zip.file('mimetype')?.async('string');
  if(mimetype!==MIME_TYPE)throw new Error('mimetype 內容不是標準 EPUB 封裝類型');
  const container=zip.file('META-INF/container.xml');
  if(!container)throw new Error('找不到 EPUB 的 META-INF/container.xml');
  const containerDoc=parseXml(await container.async('string'));
  const opfPath=normalizePath(getByLocal(containerDoc,'rootfile')[0]?.getAttribute('full-path')||'');
  const opfEntry=zip.file(opfPath);
  if(!opfPath||!opfEntry)throw new Error('找不到 EPUB 套件文件 OPF');
  await validatePackage(zip);
  const opf=parseXml(await opfEntry.async('string'));
  const metadata=getByLocal(opf,'metadata')[0];
  const layoutValue=(getByLocal(metadata,'meta').find(node=>node.getAttribute('property')==='rendition:layout')?.textContent||'').trim().toLowerCase();
  if(layoutValue==='roll')throw new Error('目前只支援 pre-paginated 固定版面；roll 連續版面不會被修改');
  const globalFixed=layoutValue==='pre-paginated'||getByLocal(metadata,'meta').some(node=>node.getAttribute('name')==='fixed-layout'&&(node.getAttribute('content')||'').toLowerCase()==='true');
  const manifest=new Map();
  for(const node of getByLocal(opf,'manifest')[0]?.getElementsByTagName('*')||[]){
    if(node.localName!=='item')continue;
    const path=resolvePath(opfPath,node.getAttribute('href')||'');
    if(path)manifest.set(path,{path,media:(node.getAttribute('media-type')||'').toLowerCase(),properties:node.getAttribute('properties')||''});
  }
  const spineElement=getByLocal(opf,'spine')[0];
  const spine=getByLocal(spineElement,'itemref').flatMap(node=>{
    const idref=node.getAttribute('idref');
    const source=getByLocal(opf,'manifest')[0]?.getElementsByTagName('*');
    const manifestNode=Array.from(source||[]).find(item=>item.localName==='item'&&item.getAttribute('id')===idref);
    if(!manifestNode)return [];
    const path=resolvePath(opfPath,manifestNode.getAttribute('href')||'');
    if(!path||!zip.file(path))return [];
    const properties=(node.getAttribute('properties')||'').split(/\s+/).filter(Boolean);
    const isReflowable=properties.includes('rendition:layout-reflowable');
    const isFixed=properties.includes('rendition:layout-pre-paginated')||(!isReflowable&&globalFixed);
    return [{path,media:(manifestNode.getAttribute('media-type')||'').toLowerCase(),properties,isFixed}];
  });
  const fixedItems=spine.filter(item=>item.isFixed);
  if(!fixedItems.length)throw new Error('此 EPUB 沒有宣告 pre-paginated 固定版面，未進行處理');
  const encryptedEntry=zip.file('META-INF/encryption.xml');
  const encrypted=encryptedEntry?encryptedResources(parseXml(await encryptedEntry.async('string'))):new Set();
  const images=new Map([...manifest.values()].filter(item=>item.media.startsWith('image/')).map(item=>[item.path,item]));
  const usage=new Map(),sharedWithReflowable=new Set(),documents=[];
  const addUsage=(path,size,isFixed)=>{
    if(!path||!images.has(path))return;
    if(!isFixed){sharedWithReflowable.add(path);return;}
    const previous=usage.get(path)||{width:0,height:0,hasDisplaySize:false};
    if(size?.width||size?.height){previous.width=Math.max(previous.width,size.width||0);previous.height=Math.max(previous.height,size.height||0);previous.hasDisplaySize=true;}
    usage.set(path,previous);
  };
  for(const item of spine){
    if(/html|xhtml/.test(item.media)){
      const document=await readDocument(item,zip,images);
      if(document){documents.push({item,document});for(const ref of document.refs)addUsage(ref.path,ref.size,item.isFixed);}
    }else if(item.media.startsWith('image/'))addUsage(item.path,null,item.isFixed);
  }
  const firstViewport=documents.find(record=>record.item.isFixed&&record.document.viewport)?.document.viewport||null;
  for(const item of spine)if(item.isFixed&&item.media.startsWith('image/'))addUsage(item.path,firstViewport,true);
  for(const record of documents){
    if(record.item.isFixed)continue;
    for(const ref of record.document.refs)addUsage(ref.path,ref.size,false);
  }
  const coverId=getByLocal(metadata,'meta').find(node=>node.getAttribute('name')==='cover')?.getAttribute('content');
  const coverNode=Array.from(getByLocal(opf,'manifest')[0]?.getElementsByTagName('*')||[]).find(node=>node.localName==='item'&&(node.getAttribute('id')===coverId||(node.getAttribute('properties')||'').split(/\s+/).includes('cover-image')));
  if(coverNode){
    const coverPath=resolvePath(opfPath,coverNode.getAttribute('href')||'');
    addUsage(coverPath,firstViewport,true);
  }
  const imageFormats={jpeg:0,png:0,gif:0,svg:0,other:0,encrypted:0,shared:0};
  const candidates=[];
  for(const [path,info] of usage){
    const entry=images.get(path);
    if(encrypted.has(path)){imageFormats.encrypted++;continue;}
    if(entry.media==='image/jpeg'||entry.media==='image/jpg'){
      if(sharedWithReflowable.has(path)){imageFormats.shared++;continue;}
      candidates.push({path,display:info});imageFormats.jpeg++;
    }else if(entry.media==='image/png')imageFormats.png++;
    else if(entry.media==='image/gif')imageFormats.gif++;
    else if(entry.media==='image/svg+xml')imageFormats.svg++;
    else imageFormats.other++;
  }
  const spreadCount=spine.filter(item=>item.properties.some(value=>/^(?:rendition:)?page-spread-(?:left|right|center)$/.test(value))).length;
  const direction=(spineElement?.getAttribute('page-progression-direction')||'default').toLowerCase();
  const title=getByLocal(metadata,'title')[0]?.textContent?.trim()||file.name.replace(/\.epub$/i,'');
  const inlineImageCount=documents.filter(record=>record.item.isFixed).reduce((total,record)=>total+record.document.inlineImageCount,0);
  return {file,zip,opfPath,title,fixedPageCount:fixedItems.length,spineCount:spine.length,spreadCount,direction,candidates,encrypted,imageFormats,inlineImageCount};
}

async function compressJpeg(bytes,quality,downsample,targetDpi,display){
  if(bytes.length<3||bytes[0]!==0xff||bytes[1]!==0xd8)throw new Error('JPEG 標記不正確');
  const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
  let canvas=null;
  try{
    if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>MAX_IMAGE_PIXELS)throw new Error('圖片尺寸超過安全處理上限');
    let scale=1;
    if(downsample&&display?.hasDisplaySize){
      const displayWidth=display.width||display.height*bitmap.width/bitmap.height;
      const displayHeight=display.height||display.width*bitmap.height/bitmap.width;
      const targetWidth=displayWidth*targetDpi/96;
      const targetHeight=displayHeight*targetDpi/96;
      scale=Math.min(1,targetWidth/bitmap.width,targetHeight/bitmap.height);
    }
    const width=Math.max(1,Math.round(bitmap.width*scale));
    const height=Math.max(1,Math.round(bitmap.height*scale));
    canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{alpha:false});
    if(!context)throw new Error('無法建立圖片轉換畫布');
    context.fillStyle='#fff';context.fillRect(0,0,width,height);
    context.drawImage(bitmap,0,0,width,height);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('JPEG 編碼失敗')),'image/jpeg',quality/100));
    const output=new Uint8Array(await blob.arrayBuffer());
    return output.length<bytes.length?{bytes:output,width,height}:null;
  }finally{bitmap.close();if(canvas){canvas.width=0;canvas.height=0;}}
}

async function validateOutput(blob){
  const header=new Uint8Array(await blob.slice(0,65536).arrayBuffer());
  validateMimetypeHeader(header);
  const zip=await JSZip.loadAsync(blob,{checkCRC32:false});
  const type=await zip.file('mimetype')?.async('string');
  if(type!==MIME_TYPE)throw new Error('輸出 EPUB 的 mimetype 驗證失敗');
  await validatePackage(zip);
  const encryption=zip.file('META-INF/encryption.xml');
  if(encryption){
    const refs=encryptedResources(parseXml(await encryption.async('string')));
    for(const path of refs)if(!zip.file(path))throw new Error('輸出 EPUB 缺少加密資源：'+path);
  }
  return true;
}

export async function optimizeFixedLayoutEpub(book,options,onProgress=()=>{}){
  const quality=Math.min(100,Math.max(40,Math.round(Number(options.quality)||80)));
  const targetDpi=Math.min(1200,Math.max(72,Math.round(Number(options.targetDpi)||300)));
  const downsample=Boolean(options.downsample);
  if(!options.compressJpeg)throw new Error("請先啟用 JPEG 有損壓縮；降採樣也需要重新編碼 JPEG");
  const {zip}=book;
  const originalMimetypeEntry=zip.files.mimetype;
  const replacements=[];
  const originalSize=book.file.size;
  let optimized=0,unchanged=0,skipped=0,metadataChanged=false;
  let blob;
  try{
    for(let index=0;index<book.candidates.length;index++){
      const item=book.candidates[index];
      onProgress(.05+.68*(index/Math.max(1,book.candidates.length)),'處理固定版面圖片 '+(index+1)+' / '+book.candidates.length);
      try{
        const source=zip.file(item.path);
        if(!source){skipped++;continue;}
        const raw=await source.async('uint8array');
        const result=await compressJpeg(raw,quality,downsample,targetDpi,item.display);
        if(!result){unchanged++;continue;}
        replacements.push({path:item.path,source});
        zip.file(item.path,result.bytes,{binary:true,date:source.date,compression:'STORE',unixPermissions:source.unixPermissions,dosPermissions:source.dosPermissions});
        optimized++;metadataChanged=true;
      }catch{skipped++;}
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    zip.file('mimetype',MIME_TYPE,{compression:'STORE',date:originalMimetypeEntry?.date,unixPermissions:originalMimetypeEntry?.unixPermissions,dosPermissions:originalMimetypeEntry?.dosPermissions});
    onProgress(.76,'重新封裝 EPUB');
    blob=await zip.generateAsync({type:'blob',mimeType:MIME_TYPE,compression:'DEFLATE',compressionOptions:{level:6},streamFiles:true,comment:zip.comment},metadata=>onProgress(.76+metadata.percent*.0024,'重新封裝 EPUB'));
    onProgress(.91,'驗證 EPUB 封裝與資源引用');
    await validateOutput(blob);
  }finally{
    for(const item of replacements)zip.files[item.path]=item.source;
    zip.files.mimetype=originalMimetypeEntry;
  }
  const warnings=[];
  const formats=book.imageFormats;
  if(formats.encrypted)warnings.push(formats.encrypted+' 個加密／DRM 圖片資源已略過');
  if(formats.png)warnings.push(formats.png+' 個 PNG 資源保持原樣');
  if(formats.gif)warnings.push(formats.gif+' 個 GIF 資源保持原樣');
  if(formats.svg)warnings.push(formats.svg+' 個 SVG 資源保持原樣，包括內嵌 base64 圖片');
  if(book.inlineImageCount)warnings.push(book.inlineImageCount+' 個 XHTML/CSS 內嵌 base64 圖片保持原樣');
  if(formats.other)warnings.push(formats.other+' 個未知或其他圖片格式保持原樣');
  if(formats.shared)warnings.push(formats.shared+' 個同時用於可重排內容的圖片保持原樣');
  if(downsample){
    const noViewport=book.candidates.filter(item=>!item.display.hasDisplaySize).length;
    if(noViewport)warnings.push(noViewport+' 個 JPEG 沒有可確認的 viewport／顯示尺寸，未降採樣');
  }
  if(skipped)warnings.push(skipped+' 個 JPEG 無法解碼或超出安全尺寸限制，保持原樣');
  if(unchanged)warnings.push(unchanged+' 個 JPEG 編碼後沒有縮小，因此保留原圖');
  if(metadataChanged)warnings.push('重新編碼的 JPEG 會移除或改變 EXIF、XMP、ICC 等 metadata（可能包含位置或裝置資訊）；目前不提供 metadata 保留或選擇性清除設定。');
  if(blob.size>=originalSize)warnings.push('此次封裝後檔案未變小；原始 EPUB 仍保留，請先檢查內容再決定是否使用輸出檔。');
  onProgress(1,'最佳化完成');
  return {blob,optimized,unchanged,skipped,originalSize,outputSize:blob.size,warnings,fileName:book.file.name.replace(/\.epub$/i,'')+'_optimized.epub'};
}
