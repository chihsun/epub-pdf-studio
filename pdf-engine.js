/* EPUB PDF Studio — browser-only searchable Unicode PDF writer.
   Text is embedded using an open-source TrueType CJK font; no remote services. */
const encoder = new TextEncoder();
const writeAscii = value => encoder.encode(value);
const escapeHex = (text) => {
  let result = '';
  for (const cp of text) {
    let n = cp.codePointAt(0);
    if (n > 0xffff) n = 0x25a1; // BMP font fallback for supplemental-plane symbols
    result += n.toString(16).padStart(4,'0').toUpperCase();
  }
  return result;
};
const pdfUnicodeString = (text) => `<FEFF${escapeHex(text)}>`;
const fmt = number => Number(number.toFixed(2)).toString();

export class PdfWriter {
  constructor() { this.objects = [null]; }
  reserve() { this.objects.push(null); return this.objects.length - 1; }
  set(id, data) { this.objects[id] = data; }
  add(data) { const id = this.reserve(); this.set(id, data); return id; }
  stream(bytes, dictionary = '') {
    const id = this.reserve();
    this.set(id, [writeAscii(`<< /Length ${bytes.length} ${dictionary} >>\nstream\n`), bytes, writeAscii('\nendstream')]);
    return id;
  }
  build(rootId, infoId) {
    const chunks = [writeAscii('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')];
    const offsets = [0];
    let cursor = chunks[0].length;
    for(let i=1;i<this.objects.length;i++) {
      if(!this.objects[i]) throw new Error(`PDF 物件 ${i} 未初始化`);
      offsets.push(cursor);
      const pre = writeAscii(`${i} 0 obj\n`), post = writeAscii('\nendobj\n');
      chunks.push(pre); cursor += pre.length;
      const obj = this.objects[i];
      for (const bytes of (Array.isArray(obj) ? obj : [typeof obj === 'string' ? writeAscii(obj) : obj])) {
        chunks.push(bytes); cursor += bytes.length;
      }
      chunks.push(post); cursor+=post.length;
    }
    const xrefOffset = cursor;
    const xref = ['xref',`0 ${this.objects.length}`,'0000000000 65535 f '];
    for(let i=1;i<offsets.length;i++) xref.push(`${String(offsets[i]).padStart(10,'0')} 00000 n `);
    xref.push(`trailer\n<< /Size ${this.objects.length} /Root ${rootId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
    chunks.push(writeAscii(xref.join('\n')));
    return new Blob(chunks,{type:'application/pdf'});
  }
}

function readFontMetrics(arrayBuffer) {
  const v = new DataView(arrayBuffer);
  const u16 = x => v.getUint16(x,false);
  const i16 = x => v.getInt16(x,false);
  const u32 = x => v.getUint32(x,false);
  const tables = {};
  for(let i=0;i<u16(4);i++) {
    const p = 12+i*16;
    tables[String.fromCharCode(...new Uint8Array(arrayBuffer,p,4))] = { offset:u32(p+8),length:u32(p+12) };
  }
  if(!tables.cmap || !tables.hmtx || !tables.hhea || !tables.head) throw new Error('字型缺少必要的 TrueType 表格');
  const upm=u16(tables.head.offset+18);
  const nHMetrics=u16(tables.hhea.offset+34);
  const cmap=tables.cmap.offset;
  let cmapStart=-1;
  const subCount=u16(cmap+2);
  for(let i=0;i<subCount;i++) {
    const p=cmap+4+i*8;
    const platform=u16(p), encoding=u16(p+2), offset=cmap+u32(p+4);
    if(u16(offset)===4 && platform===3 && encoding===1) { cmapStart=offset; break; }
    if(u16(offset)===4 && cmapStart<0) cmapStart=offset;
  }
  if(cmapStart<0) throw new Error('字型不支援 Unicode BMP cmap');
  const segCount=u16(cmapStart+6)/2;
  const endBase=cmapStart+14;
  const startBase=endBase+segCount*2+2;
  const deltaBase=startBase+segCount*2;
  const rangeBase=deltaBase+segCount*2;
  const cidMap=new Uint8Array(65536*2);
  const widths=[];
  const advancesCache=new Map();
  const aw = gid => {
    if(!advancesCache.has(gid)) advancesCache.set(gid,u16(tables.hmtx.offset+Math.min(gid,nHMetrics-1)*4));
    return advancesCache.get(gid);
  };
  const fallback = new Set();
  for(let i=0;i<segCount;i++) {
    const end=u16(endBase+i*2),start=u16(startBase+i*2),delta=i16(deltaBase+i*2),range=u16(rangeBase+i*2);
    for(let cp=start;cp<=end && cp<65535;cp++) {
      let gid=0;
      if(range===0) gid=(cp+delta)&65535;
      else {
        const address=rangeBase+i*2+range+(cp-start)*2;
        if(address<arrayBuffer.byteLength-1) {
          gid=u16(address);
          if(gid) gid=(gid+delta)&65535;
        }
      }
      if(!gid) continue;
      cidMap[cp*2]=gid>>8;cidMap[cp*2+1]=gid&255;
      widths.push(`${cp} [${Math.round(aw(gid)*1000/upm)}]`);
      fallback.add(cp);
    }
  }
  return {cidMap, widths:widths.join(' '), upm, ascender:i16(tables.hhea.offset+4), descender:i16(tables.hhea.offset+6), cmap:fallback};
}

export async function loadPdfFont(url) {
  const response=await fetch(url);
  if(!response.ok) throw new Error('無法載入離線中文字型');
  const buffer=await response.arrayBuffer();
  const metrics=readFontMetrics(buffer);
  const face=new FontFace('EPUBStudioMing',buffer,{style:'normal',weight:'400'});
  await face.load();
  document.fonts.add(face);
  return {bytes:new Uint8Array(buffer),metrics};
}

function makeUnicodeCMap() {
  return writeAscii(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n1 beginbfrange\n<0000> <FFFF> <0000>\nendbfrange\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`);
}

export function addEmbeddedFont(writer, font) {
  const descriptorId=writer.reserve();
  const cidFontId=writer.reserve();
  const fontStreamId=writer.stream(font.bytes,`/Length1 ${font.bytes.length}`);
  const gidMapId=writer.stream(font.metrics.cidMap);
  const unicodeId=writer.stream(makeUnicodeCMap());
  const asc=Math.round(font.metrics.ascender/font.metrics.upm*1000);
  const desc=Math.round(font.metrics.descender/font.metrics.upm*1000);
  writer.set(descriptorId,`<< /Type /FontDescriptor /FontName /EPUBStudioMing /Flags 4 /FontBBox [-1000 -1000 2000 2000] /ItalicAngle 0 /Ascent ${asc} /Descent ${desc} /CapHeight 900 /StemV 80 /MissingWidth 1000 /FontFile2 ${fontStreamId} 0 R >>`);
  writer.set(cidFontId,`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /EPUBStudioMing /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /DW 1000 /W [ ${font.metrics.widths} ] /CIDToGIDMap ${gidMapId} 0 R >>`);
  return writer.add(`<< /Type /Font /Subtype /Type0 /BaseFont /EPUBStudioMing /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${unicodeId} 0 R >>`);
}

const MM = 72/25.4;
export const PAGE_SIZES = {
  A4:[210*MM,297*MM],
  A5:[148*MM,210*MM],
  B5:[176*MM,250*MM],
  Letter:[612,792],
  '6x9':[6*72,9*72]
};

export class PdfLayout {
  constructor(writer,fontRef,opts,info) {
    this.writer=writer;
    this.fontRef=fontRef;
    this.opts=opts;
    this.width=opts.width;
    this.height=opts.height;
    this.margin=opts.marginMM*MM;
    this.cursor=this.height-this.margin;
    this.pages=[];
    this.ops=[];
    this.usedImages=new Set();
    this.images=new Map();
    this.imageSources=new Map();
    this.imageSerial=0;
    this.title=info.title||'';
    this.canvas=document.createElement('canvas');
    this.ctx=this.canvas.getContext('2d');
    this.pageItems=0;
    this.pageFontRef=fontRef;
  }
  maxTextWidth(indent=0){ return this.width-this.margin*2-indent; }
  currentPageIndex(){ return this.pages.length; }
  hasImageSource(label,cover=false){ return Boolean(label&&this.imageSources.has(`${cover?'cover':'image'}:${label}`)); }
  measure(text,size){this.ctx.font=`${size}px EPUBStudioMing`;return this.ctx.measureText(text).width;}
  ensure(required=20) { if(this.cursor-required < this.margin+(this.opts.pageNumbers?12:0)) this.nextPage(); }
  nextPage() {
    if(this.pageItems || this.pages.length===0) this.pages.push({ops:this.ops,images:new Set(this.usedImages)});
    this.ops=[];this.usedImages=new Set();this.cursor=this.height-this.margin;this.pageItems=0;
  }
  beginChapter() { if(this.opts.chapterBreak && (this.pageItems || this.pages.length)) this.nextPage(); }
  drawLine(runs,x,baseline,size,weight='normal') {
    let pen=x;
    // Merge adjacent, equally styled tokens to prevent one PDF text command per CJK glyph.
    const grouped=[];
    for(const r of runs) {
      if(!r.text)continue;
      const bold=Boolean(r.bold || weight==='bold'), underline=Boolean(r.underline);
      const last=grouped.at(-1);
      if(last && last.bold===bold && last.underline===underline)last.text+=r.text;
      else grouped.push({text:r.text,bold,underline});
    }
    for(const r of grouped){
      const actual=r.text.replace(/[\u{10000}-\u{10FFFF}]/gu,'□');
      const glyphs=escapeHex(actual);
      if(!glyphs)continue;
      this.ops.push(`BT /F1 ${fmt(size)} Tf ${r.bold?'2 Tr 0.25 w ':'0 Tr '}1 0 0 1 ${fmt(pen)} ${fmt(baseline)} Tm <${glyphs}> Tj ET`);
      const width=this.measure(actual,size);
      if(r.underline)this.ops.push(`${fmt(pen)} ${fmt(baseline-1.5)} m ${fmt(pen+width)} ${fmt(baseline-1.5)} l 0.5 w S`);
      pen+=width;
    }
    this.pageItems++;
  }
  drawParagraph(runs,style={}) {
    const size=style.fontSize || this.opts.fontSize;
    const height=size*(style.lineHeight||this.opts.lineHeight);
    const indent=style.indent||0;
    const before=style.before??0;
    const after=style.after??size*.53;
    const anchorIds=Array.isArray(style.anchorIds)?style.anchorIds:[];
    let anchorsMarked=false;
    this.cursor-=before;
    const maxW=this.maxTextWidth(indent);
    let line=[], lineW=0;
    const flush=()=>{
      if(!line.length)return;
      this.ensure(height);
      if(!anchorsMarked&&anchorIds.length){this.onAnchors?.(anchorIds,this.currentPageIndex());anchorsMarked=true;}
      this.drawLine(line,this.margin+indent,this.cursor-size*.87,size,style.bold?'bold':'normal');
      this.cursor-=height;line=[];lineW=0;
    };
    const pieces=(runs||[]).flatMap(run=>this.tokenize(run));
    for(const run of pieces){
      if(run.text==='\n') {flush();continue;}
      if(!run.text) continue;
      // Keep Latin words intact but break exceptionally long words at grapheme boundaries.
      const parts=this.measure(run.text,size)>maxW ? Array.from(run.text) : [run.text];
      for(const part of parts){
        if(!line.length && /^\s+$/.test(part))continue;
        const pw=this.measure(part,size);
        if(line.length && lineW+pw>maxW){flush();if(/^\s+$/.test(part)) continue;}
        line.push({...run,text:part});lineW+=pw;
      }
    }
    flush();this.cursor-=after;
  }
  tokenize(run){
    const text=run.text.replace(/\r\n?/g,'\n').replace(/\u00ad/g,'');
    // One Han/kana character per token; grouped Latin words + punctuation + spacing.
    const tokens=text.match(/\n|[\t ]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\n\t \p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu)||[];
    return tokens.map(s=>({...run,text:s==='\t'?'    ':s}));
  }
  trimCoverWhitespace(canvas){
    try{
      const width=canvas.width,height=canvas.height;
      const data=canvas.getContext('2d').getImageData(0,0,width,height).data;
      let minX=width,minY=height,maxX=-1,maxY=-1;
      for(let y=0;y<height;y+=2){
        for(let x=0;x<width;x+=2){
          const offset=(y*width+x)*4;
          if(data[offset]<248||data[offset+1]<248||data[offset+2]<248){
            minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
          }
        }
      }
      if(maxX<0)return canvas;
      const padX=Math.ceil(width*.015),padY=Math.ceil(height*.015);
      let left=0,right=width,top=0,bottom=height;
      if(minX>=width*.08&&width-1-maxX>=width*.08){left=Math.max(0,minX-padX);right=Math.min(width,maxX+padX+1);}
      if(minY>=height*.08&&height-1-maxY>=height*.08){top=Math.max(0,minY-padY);bottom=Math.min(height,maxY+padY+1);}
      if(left===0&&right===width&&top===0&&bottom===height)return canvas;
      const trimmed=document.createElement('canvas');
      trimmed.width=right-left;trimmed.height=bottom-top;
      trimmed.getContext('2d',{alpha:false}).drawImage(canvas,left,top,trimmed.width,trimmed.height,0,0,trimmed.width,trimmed.height);
      return trimmed;
    }catch{return canvas;}
  }
  async drawImage(bytes,media,label='',cover=false) {
    const cacheKey=label?`${cover?'cover':'image'}:${label}`:'';
    let image=cacheKey?this.imageSources.get(cacheKey):null;
    if(!image){
      const blob=new Blob([bytes],{type:media});
      let bitmap;
      try { bitmap=await createImageBitmap(blob); } catch { throw new Error(`不支援圖片格式：${label||media}`); }
      const w=bitmap.width,h=bitmap.height;
      if(w<1||h<1) {bitmap.close();return false;}
      const canvas=document.createElement('canvas');
      const jpegScale=Math.min(1,1800/Math.max(w,h));
      canvas.width=Math.max(1,Math.round(w*jpegScale));canvas.height=Math.max(1,Math.round(h*jpegScale));
      const context=canvas.getContext('2d',{alpha:false});
      context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
      const outputCanvas=cover?this.trimCoverWhitespace(canvas):canvas;
      const jpegBlob=await new Promise(resolve=>outputCanvas.toBlob(resolve,'image/jpeg',.88));
      if(!jpegBlob)return false;
      const jpgBytes=new Uint8Array(await jpegBlob.arrayBuffer());
      const key=`Im${++this.imageSerial}`;
      const imgRef=this.writer.stream(jpgBytes,`/Type /XObject /Subtype /Image /Width ${outputCanvas.width} /Height ${outputCanvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`);
      this.images.set(key,imgRef);
      image={key,width:cover?outputCanvas.width:w,height:cover?outputCanvas.height:h};
      if(cacheKey)this.imageSources.set(cacheKey,image);
    }
    const {key,width:w,height:h}=image;
    if(cover){
      if(this.pageItems)this.nextPage();
      const scale=Math.max(this.width/w,this.height/h);
      const pw=w*scale,ph=h*scale;
      const x=(this.width-pw)/2,y=(this.height-ph)/2;
      this.usedImages.add(key);
      this.ops.push(`q ${fmt(pw)} 0 0 ${fmt(ph)} ${fmt(x)} ${fmt(y)} cm /${key} Do Q`);
      this.pageItems++;
      return true;
    }
    const maxWidth=Math.max(1,this.width-2*this.margin);
    const maxHeight=Math.max(1,this.height-2*this.margin-18);
    const scale=Math.min(maxWidth/w,maxHeight/h,1.6);
    const pw=w*scale,ph=h*scale;
    if(ph+10 > this.cursor-this.margin-(this.opts.pageNumbers?12:0) && this.pageItems) this.nextPage();
    this.usedImages.add(key);
    const x=(this.width-pw)/2,y=this.cursor-ph;
    this.ops.push(`q ${fmt(pw)} 0 0 ${fmt(ph)} ${fmt(x)} ${fmt(y)} cm /${key} Do Q`);
    this.cursor-=ph+10;this.pageItems++;
    return true;
  }
  divider(){this.ensure(16);this.ops.push(`0.75 G 0.5 w ${fmt(this.margin)} ${fmt(this.cursor-5)} m ${fmt(this.width-this.margin)} ${fmt(this.cursor-5)} l S 0 G`);this.cursor-=15;this.pageItems++;}
  finish() {
    if(this.pageItems || this.pages.length===0) this.pages.push({ops:this.ops,images:new Set(this.usedImages)});
    const pagesId=this.writer.reserve();
    const pageIds=[];
    for(let i=0;i<this.pages.length;i++) {
      const item=this.pages[i];
      const ops=[...item.ops];
      if(this.opts.pageNumbers) {
        const n=`${i+1} / ${this.pages.length}`;
        const size=9;
        const x=this.width/2-this.measure(n,size)/2;
        ops.push(`BT /F1 ${size} Tf 0 Tr 1 0 0 1 ${fmt(x)} ${fmt(this.margin*.6)} Tm <${escapeHex(n)}> Tj ET`);
      }
      const streamId=this.writer.stream(writeAscii(ops.join('\n')));
      const images=Array.from(item.images).map(key=>`/${key} ${this.images.get(key)} 0 R`).join(' ');
      const resources=`<< /Font << /F1 ${this.fontRef} 0 R >> /XObject << ${images} >> >>`;
      pageIds.push(this.writer.add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${fmt(this.width)} ${fmt(this.height)}] /Resources ${resources} /Contents ${streamId} 0 R >>`));
    }
    this.writer.set(pagesId,`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(x=>`${x} 0 R`).join(' ')}] >>`);
    return {pagesId,pageIds,pageCount:pageIds.length};
  }
}

function writeOutlineLevel(writer,nodes,parentId,pageIds){
  const ids=nodes.map(()=>writer.reserve());
  nodes.forEach((node,index)=>{
    const childIds=node.children?.length?writeOutlineLevel(writer,node.children,ids[index],pageIds):[];
    const pageId=pageIds[node.pageIndex];
    let object=`<< /Title ${pdfUnicodeString(node.title)} /Parent ${parentId} 0 R /Dest [${pageId} 0 R /Fit]`;
    if(index)object+=` /Prev ${ids[index-1]} 0 R`;
    if(index<ids.length-1)object+=` /Next ${ids[index+1]} 0 R`;
    if(childIds.length)object+=` /First ${childIds[0]} 0 R /Last ${childIds.at(-1)} 0 R /Count ${countOutlineDescendants(node.children)}`;
    writer.set(ids[index],`${object} >>`);
  });
  return ids;
}
const countOutlineDescendants=nodes=>(nodes||[]).reduce((total,node)=>total+1+countOutlineDescendants(node.children),0);

export function finishPdf(writer,pagesId,metadata,pageIds=[],bookmarks=[],readingDirection=null) {
  let outlinesRef='';
  if(bookmarks.length){
    const outlinesId=writer.reserve();
    const itemIds=writeOutlineLevel(writer,bookmarks,outlinesId,pageIds);
    writer.set(outlinesId,`<< /Type /Outlines /First ${itemIds[0]} 0 R /Last ${itemIds.at(-1)} 0 R /Count ${countOutlineDescendants(bookmarks)} >>`);
    outlinesRef=` /Outlines ${outlinesId} 0 R /PageMode /UseOutlines`;
  }
  const viewerPreferences=['L2R','R2L'].includes(readingDirection)?` /ViewerPreferences << /Direction /${readingDirection} >>`:'';
  const root=writer.add(`<< /Type /Catalog /Pages ${pagesId} 0 R${outlinesRef}${viewerPreferences} >>`);
  const info=writer.add(`<< /Title ${pdfUnicodeString(metadata.title||'EPUB 轉 PDF')} /Author ${pdfUnicodeString(metadata.author||'')} /Creator (EPUB PDF Studio) /Producer (EPUB PDF Studio) >>`);
  return writer.build(root,info);
}
