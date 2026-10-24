/* Safe, browser-local EPUB container / spine parser. Never inject book HTML into the app. */
import {PdfWriter, addEmbeddedFont, PdfLayout, finishPdf, PAGE_SIZES} from './pdf-engine.js';

const XML = 'application/xml';
const stripHash = str => (str||'').split('#')[0].split('?')[0];
const getByLocal = (parent,name) => Array.from(parent?.getElementsByTagName('*')||[]).filter(el=>el.localName===name);
const normalizeZipPath = path => {
  const parts=[];
  for(const part of (path||'').replaceAll('\\','/').split('/')){
    if(!part||part==='.')continue;
    if(part==='..'){if(!parts.length)throw new Error('EPUB 包含非法相對路徑');parts.pop();}
    else parts.push(part);
  }
  return parts.join('/');
};
const resolvePath=(base,relative)=>{
  if(/^[a-z][a-z0-9+.-]*:/i.test(relative||'')) throw new Error('不支援 EPUB 外部資源');
  let decoded=stripHash(relative);
  try{decoded=decodeURIComponent(decoded);}catch{ /* preserve unmatched percent signs */ }
  return normalizeZipPath(`${base.substring(0,base.lastIndexOf('/')+1)}${decoded}`);
};
const parseMarkup=(xml,kind='application/xml')=>{
  const doc=new DOMParser().parseFromString(xml,kind);
  if(kind!=='text/html' && doc.getElementsByTagName('parsererror').length)throw new Error('EPUB XML 結構不正確');
  return doc;
};
const escapeFile = name=>(name||'ebook').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100).trim()||'ebook';

export async function inspectEpub(file) {
  if(!file || !/\.epub$/i.test(file.name))throw new Error('請選擇副檔名為 .epub 的檔案');
  if(file.size>250*1024*1024)throw new Error('這本 EPUB 超過目前 250 MB 的安全處理上限');
  const zip=await JSZip.loadAsync(file,{checkCRC32:false});
  const decompressedBytes=Object.values(zip.files).reduce((total,item)=>total+(item._data?.uncompressedSize||0),0);
  if(decompressedBytes>600*1024*1024)throw new Error('EPUB 解壓後資料過大，已停止以保護瀏覽器記憶體');
  const container=zip.file('META-INF/container.xml');
  if(!container)throw new Error('找不到 EPUB 的 META-INF/container.xml');
  const containerXML=parseMarkup(await container.async('string'));
  const rootfile=getByLocal(containerXML,'rootfile')[0];
  const opfPath=normalizeZipPath(rootfile?.getAttribute('full-path')||'');
  if(!opfPath||!zip.file(opfPath))throw new Error('EPUB 缺少 OPF 書籍描述檔');
  const opf=parseMarkup(await zip.file(opfPath).async('string'));
  const metadata=getByLocal(opf,'metadata')[0];
  const title=getByLocal(metadata,'title')[0]?.textContent?.trim()||file.name.replace(/\.epub$/i,'');
  const author=getByLocal(metadata,'creator')[0]?.textContent?.trim()||'未提供作者資訊';
  const language=getByLocal(metadata,'language')[0]?.textContent?.trim()||'';
  const metadataProps=getByLocal(metadata,'meta');
  const fixedLayout=metadataProps.some(m=>(m.getAttribute('property')==='rendition:layout'&&m.textContent.trim()==='pre-paginated')) ||
    metadataProps.some(m=>m.getAttribute('name')==='fixed-layout'&&m.getAttribute('content')==='true');
  const manifest=new Map();
  for(const item of getByLocal(opf,'item')){
    const id=item.getAttribute('id'),href=item.getAttribute('href');
    if(id&&href){
      let path=null;
      try{path=resolvePath(opfPath,href);}catch{}
      manifest.set(id,{id,path,media:item.getAttribute('media-type')||'',properties:item.getAttribute('properties')||''});
    }
  }
  const spineEl=getByLocal(opf,'spine')[0];
  const spine=getByLocal(spineEl,'itemref').map(item=>manifest.get(item.getAttribute('idref')))
    .filter(item=>item&&item.path&&(/xhtml\+xml|text\/html|image\//.test(item.media))&&zip.file(item.path));
  if(!spine.length)throw new Error('找不到可轉換的 EPUB 閱讀章節');
  let coverItem=[...manifest.values()].find(item=>item.properties.split(/\s+/).includes('cover-image'));
  if(!coverItem){
    const coverId=metadataProps.find(m=>m.getAttribute('name')==='cover')?.getAttribute('content');
    coverItem=manifest.get(coverId);
  }
  if(coverItem&&!coverItem.media.startsWith('image/'))coverItem=null;
  let viewport=null;
  for(const item of spine.slice(0,5)){
    if(!(/html|xhtml/.test(item.media)))continue;
    const raw=await zip.file(item.path).async('string');
    const doc=parseMarkup(raw,'text/html');
    const vp=doc.querySelector('meta[name="viewport"]')?.getAttribute('content')||'';
    const w=/\bwidth\s*=\s*["']?(\d+(?:\.\d+)?)/i.exec(vp)?.[1];
    const h=/\bheight\s*=\s*["']?(\d+(?:\.\d+)?)/i.exec(vp)?.[1];
    if(w&&h){
      const width=Number(w)*.75,height=Number(h)*.75;
      if(width>=100&&height>=100&&width<14400&&height<14400){ viewport={width,height,pxWidth:Number(w),pxHeight:Number(h)};break; }
    }
  }
  const info={title,author,language, fixedLayout,viewport,spine,manifest,coverItem,zip,opfPath,fileName:file.name};
  return info;
}

const SKIP=new Set(['script','style','noscript','iframe','object','embed','audio','video','form','input','button','select','textarea','canvas','svg','math','nav']);
const BLOCK=new Set(['div','section','article','main','aside','header','footer','figure','figcaption','center','details','summary','body']);
const HEADINGS=new Set(['h1','h2','h3','h4','h5','h6']);
const INLINE=new Set(['span','a','em','i','b','strong','u','s','strike','small','big','sup','sub','code','mark','q','cite','abbr','time','font','ruby','rt','rp']);
function inlineRuns(element,style={}) {
  if(element.nodeType===Node.TEXT_NODE)return [{text:element.nodeValue||'',...style}];
  if(element.nodeType!==Node.ELEMENT_NODE)return [];
  const tag=element.localName?.toLowerCase();
  if(SKIP.has(tag)||tag==='img'||tag==='image')return [];
  if(tag==='br')return [{text:'\n',...style}];
  const next={...style,bold:style.bold||tag==='strong'||tag==='b',underline:style.underline||tag==='u'};
  return Array.from(element.childNodes).flatMap(el=>inlineRuns(el,next));
}
const normalizedRuns = runs => {
  const cleaned=runs.map(run=>({...run,text:run.text.replace(/[\t\u00a0]+/g,' ').replace(/[ \t]*\n[ \t]*/g,' ')}));
  if(cleaned.length){cleaned[0].text=cleaned[0].text.replace(/^\s+/,'');cleaned[cleaned.length-1].text=cleaned.at(-1).text.replace(/\s+$/,'');}
  return cleaned.filter(run=>run.text);
};

export async function convertEpub(info, options, pdfFont, onProgress=()=>{}) {
  const size= options.pageSize==='original'&&info.fixedLayout&&info.viewport
    ? [info.viewport.width,info.viewport.height]
    : PAGE_SIZES[options.pageSize] || PAGE_SIZES.A4;
  const [width,height]=options.orientation==='landscape'?[Math.max(...size),Math.min(...size)]:options.orientation==='portrait'?[Math.min(...size),Math.max(...size)]:size;
  const opts={...options,width,height};
  if((opts.marginMM*72/25.4)*2+60>=width)throw new Error('紙張寬度太窄，請縮小頁邊距');
  const writer=new PdfWriter();
  const fontRef=addEmbeddedFont(writer,pdfFont);
  const layout=new PdfLayout(writer,fontRef,opts,info);
  const warnings=[];
  let imageCount=0;
  const drawAsset=async (sourceBase,href,media='')=>{
    if(!options.includeImages)return;
    if(!href)return;
    let path='';
    try{path=resolvePath(sourceBase,href);}catch{warnings.push('已略過外部圖片資源');return;}
    const entry=info.zip.file(path);
    if(!entry){warnings.push(`圖片不存在：${path}`);return;}
    if(imageCount>=250){warnings.push('圖片超過 250 張，已略過其餘圖片');return;}
    const ext=(path.split('.').pop()||'').toLowerCase();
    const type=media||({'jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','gif':'image/gif','webp':'image/webp','svg':'image/svg+xml'}[ext]||'');
    if(type==='image/svg+xml'||ext==='svg'){warnings.push(`SVG 圖片暫不支援：${path}`);return;}
    try{await layout.drawImage(await entry.async('uint8array'),type,path);imageCount++;}
    catch(e){warnings.push(`無法繪製圖片 ${path}：${e.message}`);}
  };
  const drawNode=async(node,path,depth=0)=>{
    if(depth>55)return;
    if(node.nodeType!==Node.ELEMENT_NODE)return;
    const tag=node.localName?.toLowerCase();
    if(SKIP.has(tag))return;
    if(tag==='img'||tag==='image'){
      const href=node.getAttribute('src')||node.getAttribute('href')||node.getAttribute('xlink:href');
      await drawAsset(path,href);return;
    }
    if(HEADINGS.has(tag)){
      const level=Number(tag.charAt(1));
      const runs=normalizedRuns(inlineRuns(node));
      if(runs.length) layout.drawParagraph(runs,{bold:true,fontSize:Math.max(options.fontSize+1,options.fontSize+(7-level)*1.5),before:level<=2?12:7,after:7});
      return;
    }
    if(tag==='hr'){layout.divider();return;}
    if(tag==='p'||tag==='blockquote'||tag==='pre'||tag==='figcaption'||tag==='dt'||tag==='dd'){
      // Images embedded inside a <p> are common in illustrated EPUBs.
      // Handle them in document order instead of silently dropping them.
      if(Array.from(node.getElementsByTagName('*')).some(el=>['img','image'].includes(el.localName?.toLowerCase()))){
        let pending=[];
        const flush=()=>{const runs=normalizedRuns(pending);if(runs.length)layout.drawParagraph(runs,{indent:tag==='blockquote'?14:tag==='dd'?10:0});pending=[];};
        for(const child of Array.from(node.childNodes)){
          if(child.nodeType===Node.ELEMENT_NODE && ['img','image'].includes(child.localName?.toLowerCase())){flush();await drawNode(child,path,depth+1);}
          else pending.push(...inlineRuns(child));
        }
        flush();
      }else{
        const runs=normalizedRuns(inlineRuns(node));
        if(runs.length)layout.drawParagraph(runs,{indent:tag==='blockquote'?14:tag==='dd'?10:0,after:tag==='pre'?8:undefined});
      }
      return;
    }
    if(tag==='ul'||tag==='ol'){
      let n=Number(node.getAttribute('start')||'1');
      for(const li of Array.from(node.children).filter(el=>el.localName?.toLowerCase()==='li')){
        const prefix=tag==='ol'?`${n++}. `:'• ';
        const runs=normalizedRuns(inlineRuns(li));
        layout.drawParagraph([{text:prefix},...runs],{indent:10,after:2});
      }
      layout.cursor-=5;return;
    }
    if(tag==='table'){
      for(const tr of Array.from(node.querySelectorAll('tr'))){
        const cells=Array.from(tr.children).filter(el=>/^(td|th)$/.test(el.localName?.toLowerCase()||''));
        const text=cells.map(el=>el.textContent.trim()).join('   |   ');
        if(text)layout.drawParagraph([{text}],{fontSize:options.fontSize*.9,bold:cells.some(el=>el.localName==='th'),after:3});
      }
      return;
    }
    if(INLINE.has(tag)){
      const runs=normalizedRuns(inlineRuns(node));
      if(runs.length)layout.drawParagraph(runs);
      return;
    }
    if(BLOCK.has(tag)||tag==='li'||tag==='picture'){
      // If a container has both text and block elements, keep its stray text nodes.
      let loose=[];
      const flush=()=>{if(loose.length){const runs=normalizedRuns(loose);if(runs.length)layout.drawParagraph(runs);loose=[];}};
      for(const child of Array.from(node.childNodes)){
        if(child.nodeType===Node.TEXT_NODE){if(child.nodeValue?.trim())loose.push({text:child.nodeValue});}
        else if(child.nodeType===Node.ELEMENT_NODE){const childTag=child.localName?.toLowerCase();if(INLINE.has(childTag)){loose.push(...inlineRuns(child));}else{flush();await drawNode(child,path,depth+1);}}
      }
      flush();return;
    }
    for(const child of Array.from(node.children||[]))await drawNode(child,path,depth+1);
  };
  const cover=info.coverItem;
  if(options.includeCover&&cover&&info.zip.file(cover.path)){
    try {await layout.drawImage(await info.zip.file(cover.path).async('uint8array'),cover.media,cover.path);imageCount++;layout.nextPage();}
    catch(e){warnings.push(`封面無法加入：${e.message}`);}
  }
  let sections=0;
  for(const [index,item] of info.spine.entries()){
    onProgress(index/info.spine.length,`正在處理章節 ${index+1} / ${info.spine.length}`);
    if(index>0)layout.beginChapter();
    if(item.media.startsWith('image/')){
      if(options.includeImages){
        try{await layout.drawImage(await info.zip.file(item.path).async('uint8array'),item.media,item.path);imageCount++;}
        catch(e){warnings.push(`圖片頁面無法處理：${item.path}：${e.message}`);}
      }
    } else {
      try{
        const raw=await info.zip.file(item.path).async('string');
        const dom=parseMarkup(raw,'text/html');
        await drawNode(dom.body,item.path);
        sections++;
      }catch(e){warnings.push(`章節無法處理 ${item.path}：${e.message}`);}
    }
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  onProgress(.96,'正在建立 PDF 檔案');
  const {pagesId,pageCount}=layout.finish();
  if(layout.pageItems===0 && layout.pages.length===1 && sections===0 && imageCount===0)throw new Error('此 EPUB 沒有可輸出的文字或圖片');
  const blob=finishPdf(writer,pagesId,info);
  onProgress(1,'轉換完成');
  return {blob,pageCount,sections,imageCount,warnings,fileName:`${escapeFile(info.title)}.pdf`,pageSize:[width,height]};
}
