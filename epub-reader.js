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
  const path=decoded.startsWith('/')?decoded:`${base.substring(0,base.lastIndexOf('/')+1)}${decoded}`;
  return normalizeZipPath(path);
};
const parseMarkup=(xml,kind='application/xml')=>{
  const doc=new DOMParser().parseFromString(xml,kind);
  if(kind!=='text/html' && doc.getElementsByTagName('parsererror').length)throw new Error('EPUB XML 結構不正確');
  return doc;
};
const cleanLabel=text=>(text||'').replace(/\s+/g,' ').trim();
const directChildren=(node,name)=>Array.from(node?.children||[]).filter(el=>el.localName?.toLowerCase()===name.toLowerCase());
const isCoverLabel=text=>/^(?:封面|封面頁|書封|封頁|cover(?:\s+page)?|jacket)$/i.test(cleanLabel(text));
const escapeFile = name=>(name||'ebook').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100).trim()||'ebook';

function splitCssSelectors(value){
  const selectors=[];let start=0,depth=0,quote='';
  for(let i=0;i<value.length;i++){
    const char=value[i];
    if(quote){if(char===quote&&value[i-1]!=='\\')quote='';continue;}
    if(char==='"'||char==="'"){quote=char;continue;}
    if(char==='('||char==='[')depth++;
    else if(char===')'||char===']')depth=Math.max(0,depth-1);
    else if(char===','&&depth===0){selectors.push(value.slice(start,i).trim());start=i+1;}
  }
  selectors.push(value.slice(start).trim());
  return selectors.filter(Boolean);
}

function parseCssRules(css,output=[]){
  const source=(css||'').replace(/^\uFEFF/,'').replace(/\/\*[\s\S]*?\*\//g,'');
  let cursor=0;
  while(cursor<source.length){
    while(cursor<source.length&&/[\s;}]/.test(source[cursor]))cursor++;
    let open=cursor,quote='';
    for(;open<source.length;open++){
      const char=source[open];
      if(quote){if(char===quote&&source[open-1]!=='\\')quote='';continue;}
      if(char==='"'||char==="'"){quote=char;continue;}
      if(char==='{')break;
    }
    if(open>=source.length)break;
    const prelude=source.slice(cursor,open).trim();
    const selector=prelude.slice(prelude.lastIndexOf(';')+1).trim();
    let end=open+1,depth=1;quote='';
    for(;end<source.length&&depth;end++){
      const char=source[end];
      if(quote){if(char===quote&&source[end-1]!=='\\')quote='';continue;}
      if(char==='"'||char==="'"){quote=char;continue;}
      if(char==='{')depth++;
      else if(char==='}')depth--;
    }
    if(depth)break;
    const body=source.slice(open+1,end-1);
    cursor=end;
    if(!selector)continue;
    if(selector.startsWith('@')){
      if(/^@(media|supports|layer|container)\b/i.test(selector))parseCssRules(body,output);
      continue;
    }
    output.push({selectors:splitCssSelectors(selector),declarations:body});
  }
  return output;
}

function declaredWritingMode(declarations){
  const expression=/(?:^|;)\s*(?:-epub-writing-mode|-webkit-writing-mode|writing-mode)\s*:\s*([\w-]+)/gi;
  let match,last=null;
  while((match=expression.exec(declarations||'')))last=match[1].toLowerCase();
  if(last==='tb-rl')return 'vertical-rl';
  if(last==='tb-lr')return 'vertical-lr';
  return ['vertical-rl','vertical-lr','horizontal-tb'].includes(last)?last:null;
}
const directionForWritingMode=mode=>mode==='vertical-rl'?'R2L':mode==='vertical-lr'?'L2R':null;

function selectorMatches(selector,elements){
  try{return elements.some(element=>element?.matches(selector));}catch{return false;}
}

async function detectWritingMode(item,zip,stylesheetCache){
  const doc=parseMarkup(await zip.file(item.path).async('string'),'text/html');
  const roots=[doc.documentElement,doc.body].filter(Boolean);
  const totalText=doc.body?.textContent?.trim().length||0;
  let rootMode=null,rootDeclared=false,contentMode=null,contentDeclared=false;
  const styles=[];
  for(const node of Array.from(doc.querySelectorAll('link[rel],style'))){
    if(node.localName?.toLowerCase()==='style'){styles.push(node.textContent||'');continue;}
    if(!(node.getAttribute('rel')||'').toLowerCase().split(/\s+/).includes('stylesheet'))continue;
    const href=node.getAttribute('href');
    if(!href)continue;
    try{
      const path=resolvePath(item.path,href);
      if(!stylesheetCache.has(path)){
        const entry=zip.file(path);
        stylesheetCache.set(path,entry?await entry.async('string'):'');
      }
      styles.push(stylesheetCache.get(path));
    }catch{ /* ignore unavailable or external stylesheets */ }
  }
  for(const stylesheet of styles){
    for(const rule of parseCssRules(stylesheet)){
      const mode=declaredWritingMode(rule.declarations);
      if(!mode)continue;
      if(rule.selectors.some(selector=>selectorMatches(selector,roots))){rootMode=mode;rootDeclared=true;continue;}
      if(totalText<1)continue;
      let matchedText=0;
      for(const selector of rule.selectors){
        try{
          for(const element of doc.querySelectorAll(selector)){
            if(element!==doc.documentElement&&element!==doc.body)matchedText+=element.textContent?.trim().length||0;
          }
        }catch{ /* ignore selectors unsupported by this browser */ }
      }
      if(matchedText>=totalText*.25){contentMode=mode;contentDeclared=true;}
    }
  }
  for(const element of roots){
    const mode=declaredWritingMode(element.getAttribute('style')||'');
    if(mode){rootMode=mode;rootDeclared=true;}
  }
  if(totalText>0){
    for(const element of doc.querySelectorAll('[style]')){
      if(roots.includes(element))continue;
      const mode=declaredWritingMode(element.getAttribute('style')||'');
      if(mode&&(element.textContent?.trim().length||0)>=totalText*.25){contentMode=mode;contentDeclared=true;}
    }
  }
  if(rootDeclared)return rootMode;
  if(contentDeclared)return contentMode;
  return null;
}

async function detectEpubDirection(spineEl,spine,zip){
  const declared=(spineEl?.getAttribute('page-progression-direction')||'').trim().toLowerCase();
  if(declared==='rtl')return {direction:'R2L',source:'EPUB 方向標記'};
  if(declared==='ltr')return {direction:'L2R',source:'EPUB 方向標記'};
  const stylesheetCache=new Map();
  let checked=0;
  for(const item of spine){
    if(!/html|xhtml/.test(item.media))continue;
    if(checked++>=12)break;
    try{
      const mode=await detectWritingMode(item,zip,stylesheetCache);
      const direction=directionForWritingMode(mode);
      if(direction)return {direction,source:mode==='vertical-rl'?'直排 CSS（vertical-rl）':'直排 CSS（vertical-lr）'};
    }catch{ /* keep checking later spine items */ }
  }
  return {direction:null,source:null};
}

function resolveBookmarkTarget(sourcePath,href){
  if(!href)return null;
  try{
    const path=resolvePath(sourcePath,href);
    const hash=href.indexOf('#');
    let fragment=hash>=0?href.slice(hash+1).split('?')[0]:'';
    try{fragment=decodeURIComponent(fragment);}catch{ /* retain an invalid encoded fragment */ }
    return {path,fragment};
  }catch{return null;}
}

function parseNavList(list,sourcePath){
  return directChildren(list,'li').flatMap(li=>{
    const children=Array.from(li.children||[]);
    const label=children.find(el=>['a','span'].includes(el.localName?.toLowerCase()));
    const nested=children.find(el=>['ol','ul'].includes(el.localName?.toLowerCase()));
    const title=cleanLabel(label?.textContent);
    const childEntries=nested?parseNavList(nested,sourcePath):[];
    if(!title)return childEntries;
    const target=resolveBookmarkTarget(sourcePath,label?.getAttribute('href')||'');
    return [{title,...(target||{}),children:childEntries}];
  });
}

async function readNavigation(spineEl,manifest,zip){
  const navItem=[...manifest.values()].find(item=>item.properties.split(/\s+/).includes('nav'));
  if(navItem?.path&&zip.file(navItem.path)){
    try{
      const doc=parseMarkup(await zip.file(navItem.path).async('string'),'text/html');
      const navs=getByLocal(doc,'nav');
      const toc=navs.find(nav=>{
        const type=nav.getAttribute('epub:type')||nav.getAttributeNS?.('http://www.idpf.org/2007/ops','type')||'';
        return type.split(/\s+/).includes('toc')||nav.getAttribute('role')==='doc-toc';
      })||navs[0];
      const list=Array.from(toc?.children||[]).find(el=>['ol','ul'].includes(el.localName?.toLowerCase()));
      const entries=list?parseNavList(list,navItem.path):[];
      if(entries.length)return entries;
    }catch{ /* use the EPUB 2 NCX when the EPUB 3 navigation document is incomplete */ }
  }

  const tocId=spineEl?.getAttribute('toc');
  const ncxItem=(tocId&&manifest.get(tocId))||[...manifest.values()].find(item=>item.media==='application/x-dtbncx+xml'||/\.ncx$/i.test(item.path||''));
  if(!ncxItem?.path||!zip.file(ncxItem.path))return [];
  try{
    const doc=parseMarkup(await zip.file(ncxItem.path).async('string'));
    const navMap=getByLocal(doc,'navMap')[0];
    const parsePoints=parent=>directChildren(parent,'navPoint').flatMap(point=>{
      const label=directChildren(point,'navLabel')[0];
      const content=directChildren(point,'content')[0];
      const title=cleanLabel(getByLocal(label,'text')[0]?.textContent);
      const children=parsePoints(point);
      if(!title)return children;
      const target=resolveBookmarkTarget(ncxItem.path,content?.getAttribute('src')||'');
      return [{title,...(target||{}),children}];
    });
    return navMap?parsePoints(navMap):[];
  }catch{return [];}
}

const flattenBookmarks=nodes=>(nodes||[]).flatMap(node=>[node,...flattenBookmarks(node.children)]);
const cloneBookmarkTree=nodes=>(nodes||[]).map(node=>({...node,children:cloneBookmarkTree(node.children)}));
function resolvedBookmarkTree(nodes,pageCount){
  return (nodes||[]).flatMap(node=>{
    const children=resolvedBookmarkTree(node.children,pageCount);
    let pageIndex=node.pageIndex;
    if(!Number.isInteger(pageIndex)||pageIndex<0||pageIndex>=pageCount)pageIndex=children[0]?.pageIndex;
    if(!Number.isInteger(pageIndex)||pageIndex<0||pageIndex>=pageCount)return children;
    return [{title:cleanLabel(node.title)||'章節',pageIndex,children}];
  });
}
const countBookmarks=nodes=>(nodes||[]).reduce((total,node)=>total+1+countBookmarks(node.children),0);

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
  const epubDirection=await detectEpubDirection(spineEl,spine,zip);
  const navigation=await readNavigation(spineEl,manifest,zip);
  let coverItem=[...manifest.values()].find(item=>item.properties.split(/\s+/).includes('cover-image'));
  if(!coverItem){
    const coverId=metadataProps.find(m=>m.getAttribute('name')==='cover')?.getAttribute('content');
    coverItem=manifest.get(coverId);
  }
  if(coverItem&&(!coverItem.path||!coverItem.media.startsWith('image/')))coverItem=null;
  let coverPage=null;
  const navCoverPaths=new Set(flattenBookmarks(navigation).filter(entry=>entry.path&&isCoverLabel(entry.title)).map(entry=>entry.path));
  const coverCandidates=spine.filter((item,index)=>index===0||navCoverPaths.has(item.path));
  for(const item of coverCandidates){
    if(!/html|xhtml/.test(item.media))continue;
    try{
      const doc=parseMarkup(await zip.file(item.path).async('string'),'text/html');
      const bodyType=doc.body?.getAttribute('epub:type')||doc.body?.getAttributeNS?.('http://www.idpf.org/2007/ops','type')||'';
      const isCover=bodyType.split(/\s+/).includes('cover')||navCoverPaths.has(item.path);
      if(!isCover)continue;
      const image=getByLocal(doc,'img')[0]||getByLocal(doc,'image')[0];
      const href=image?.getAttribute('src')||image?.getAttribute('href')||image?.getAttribute('xlink:href')||image?.getAttributeNS?.('http://www.w3.org/1999/xlink','href')||'';
      if(!href)continue;
      const imagePath=resolvePath(item.path,href);
      if(!zip.file(imagePath))continue;
      const manifestImage=[...manifest.values()].find(entry=>entry.path===imagePath);
      const ext=(imagePath.split('.').pop()||'').toLowerCase();
      const media=manifestImage?.media||({'jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','webp':'image/webp','gif':'image/gif'}[ext]||'');
      if(!media.startsWith('image/'))continue;
      coverPage={path:item.path,imagePath,media};
      if(!coverItem)coverItem=manifestImage||{path:imagePath,media};
      break;
    }catch{ /* keep the normal chapter conversion path if cover extraction is incomplete */ }
  }
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
  const info={title,author,language, fixedLayout,viewport,spine,manifest,coverItem,coverPage,navigation,readingDirection:epubDirection.direction,readingDirectionSource:epubDirection.source,zip,opfPath,fileName:file.name};
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
    const ext=(path.split('.').pop()||'').toLowerCase();
    const type=media||({'jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','gif':'image/gif','webp':'image/webp','svg':'image/svg+xml'}[ext]||'');
    if(type==='image/svg+xml'||ext==='svg'){warnings.push(`SVG 圖片暫不支援：${path}`);return;}
    try{if(await layout.drawImage(layout.hasImageSource(path)?null:await entry.async('uint8array'),type,path))imageCount++;}
    catch(e){warnings.push(`無法繪製圖片 ${path}：${e.message}`);}
  };
  let activeBookmarkTargets=new Map();
  layout.onAnchors=(ids,pageIndex)=>{
    for(const id of ids)for(const bookmark of activeBookmarkTargets.get(id)||[])bookmark.pageIndex=pageIndex;
  };
  const bookmarkAnchorIds=node=>{
    const id=node.getAttribute?.('id')||node.getAttribute?.('xml:id')||'';
    return id&&activeBookmarkTargets.has(id)?[id]:[];
  };
  const markBookmarkTarget=node=>{
    const id=node.getAttribute?.('id')||node.getAttribute?.('xml:id')||'';
    if(id)for(const bookmark of activeBookmarkTargets.get(id)||[])bookmark.pageIndex=layout.currentPageIndex();
  };
  const drawNode=async(node,path,depth=0)=>{
    if(depth>55)return;
    if(node.nodeType!==Node.ELEMENT_NODE)return;
    markBookmarkTarget(node);
    const tag=node.localName?.toLowerCase();
    if(SKIP.has(tag))return;
    if(tag==='img'||tag==='image'){
      const href=node.getAttribute('src')||node.getAttribute('href')||node.getAttribute('xlink:href');
      await drawAsset(path,href);return;
    }
    if(HEADINGS.has(tag)){
      const level=Number(tag.charAt(1));
      const runs=normalizedRuns(inlineRuns(node));
      if(runs.length) layout.drawParagraph(runs,{bold:true,fontSize:Math.max(options.fontSize+1,options.fontSize+(7-level)*1.5),before:level<=2?12:7,after:7,anchorIds:bookmarkAnchorIds(node)});
      return;
    }
    if(tag==='hr'){layout.divider();return;}
    if(tag==='p'||tag==='blockquote'||tag==='pre'||tag==='figcaption'||tag==='dt'||tag==='dd'){
      // Images embedded inside a <p> are common in illustrated EPUBs.
      // Handle them in document order instead of silently dropping them.
      if(Array.from(node.getElementsByTagName('*')).some(el=>['img','image'].includes(el.localName?.toLowerCase()))){
        let pending=[];
        let anchorIds=bookmarkAnchorIds(node);
        const flush=()=>{const runs=normalizedRuns(pending);if(runs.length)layout.drawParagraph(runs,{indent:tag==='blockquote'?14:tag==='dd'?10:0,anchorIds});pending=[];anchorIds=[];};
        for(const child of Array.from(node.childNodes)){
          if(child.nodeType===Node.ELEMENT_NODE && ['img','image'].includes(child.localName?.toLowerCase())){flush();await drawNode(child,path,depth+1);}
          else pending.push(...inlineRuns(child));
        }
        flush();
      }else{
        const runs=normalizedRuns(inlineRuns(node));
        if(runs.length)layout.drawParagraph(runs,{indent:tag==='blockquote'?14:tag==='dd'?10:0,after:tag==='pre'?8:undefined,anchorIds:bookmarkAnchorIds(node)});
      }
      return;
    }
    if(tag==='ul'||tag==='ol'){
      let n=Number(node.getAttribute('start')||'1');
      for(const li of Array.from(node.children).filter(el=>el.localName?.toLowerCase()==='li')){
        const prefix=tag==='ol'?`${n++}. `:'• ';
        const runs=normalizedRuns(inlineRuns(li));
        layout.drawParagraph([{text:prefix},...runs],{indent:10,after:2,anchorIds:bookmarkAnchorIds(li)});
      }
      layout.cursor-=5;return;
    }
    if(tag==='table'){
      for(const tr of Array.from(node.querySelectorAll('tr'))){
        const cells=Array.from(tr.children).filter(el=>/^(td|th)$/.test(el.localName?.toLowerCase()||''));
        const text=cells.map(el=>el.textContent.trim()).join('   |   ');
        if(text)layout.drawParagraph([{text}],{fontSize:options.fontSize*.9,bold:cells.some(el=>el.localName==='th'),after:3,anchorIds:bookmarkAnchorIds(tr)});
      }
      return;
    }
    if(INLINE.has(tag)){
      const runs=normalizedRuns(inlineRuns(node));
      if(runs.length)layout.drawParagraph(runs,{anchorIds:bookmarkAnchorIds(node)});
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
  const coverPage=info.coverPage;
  let coverPageRendered=false;
  const bookmarks=cloneBookmarkTree(info.navigation);
  const navigationEntries=flattenBookmarks(bookmarks);
  if(options.includeCover&&cover&&info.zip.file(cover.path)){
    try {
      const coverPageIndex=layout.currentPageIndex();
      const coverPath=coverPage?.imagePath||cover.path;
      const coverMedia=coverPage?.media||cover.media;
      if(await layout.drawImage(layout.hasImageSource(coverPath,true)?null:await info.zip.file(coverPath).async('uint8array'),coverMedia,coverPath,true)){
        imageCount++;coverPageRendered=Boolean(coverPage);
        if(!coverPage||!navigationEntries.some(bookmark=>bookmark.path===coverPage.path))bookmarks.unshift({title:'封面',pageIndex:coverPageIndex,children:[]});
        layout.nextPage();
        for(const bookmark of navigationEntries)if((bookmark.path===cover.path||bookmark.path===coverPage?.path)&&bookmark.pageIndex==null)bookmark.pageIndex=coverPageIndex;
      }
    }
    catch(e){warnings.push(`封面無法加入：${e.message}`);}
  }
  let sections=0;
  for(const [index,item] of info.spine.entries()){
    onProgress(index/info.spine.length,`正在處理章節 ${index+1} / ${info.spine.length}`);
    if(coverPage&&item.path===coverPage.path&&(!options.includeCover||coverPageRendered))continue;
    if(index>0)layout.beginChapter();
    const chapterPage=layout.currentPageIndex();
    for(const bookmark of navigationEntries)if(bookmark.path===item.path&&bookmark.pageIndex==null)bookmark.pageIndex=chapterPage;
    activeBookmarkTargets=new Map();
    for(const bookmark of navigationEntries){
      if(bookmark.path!==item.path||!bookmark.fragment)continue;
      const targets=activeBookmarkTargets.get(bookmark.fragment)||[];targets.push(bookmark);activeBookmarkTargets.set(bookmark.fragment,targets);
    }
    if(item.media.startsWith('image/')){
      if(options.includeImages){
       try{if(await layout.drawImage(layout.hasImageSource(item.path)?null:await info.zip.file(item.path).async('uint8array'),item.media,item.path))imageCount++;}
        catch(e){warnings.push(`圖片頁面無法處理：${item.path}：${e.message}`);}
      }
    } else {
      try{
        const raw=await info.zip.file(item.path).async('string');
        const dom=parseMarkup(raw,'text/html');
        if(!(info.navigation||[]).length){
          const heading=dom.body.querySelector('h1,h2,h3,h4,h5,h6');
          const title=cleanLabel(heading?.textContent);
          if(title)bookmarks.push({title,pageIndex:chapterPage,children:[]});
        }
        await drawNode(dom.body,item.path);
        sections++;
      }catch(e){warnings.push(`章節無法處理 ${item.path}：${e.message}`);}
    }
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  onProgress(.96,'正在建立 PDF 檔案');
  const {pagesId,pageIds,pageCount}=layout.finish();
  if(layout.pageItems===0 && layout.pages.length===1 && sections===0 && imageCount===0)throw new Error('此 EPUB 沒有可輸出的文字或圖片');
  const resolvedBookmarks=resolvedBookmarkTree(bookmarks,pageCount);
  const bookmarkCount=countBookmarks(resolvedBookmarks);
  const manualDirection=options.readingDirection==='rtl'?'R2L':options.readingDirection==='ltr'?'L2R':null;
  const readingDirection=manualDirection||info.readingDirection||null;
  const directionSource=manualDirection?'手動覆寫':info.readingDirectionSource;
  const blob=finishPdf(writer,pagesId,info,pageIds,resolvedBookmarks,readingDirection);
  onProgress(1,'轉換完成');
  return {blob,pageCount,sections,imageCount,bookmarkCount,readingDirection,directionSource,warnings,fileName:`${escapeFile(info.title)}.pdf`,pageSize:[width,height]};
}
