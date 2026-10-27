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

async function collectDeflated(readable){
  const reader=readable.getReader();
  const chunks=[];
  let length=0;
  while(true){
    const {value,done}=await reader.read();
    if(done)break;
    chunks.push(value);length+=value.length;
  }
  const output=new Uint8Array(length);
  let offset=0;
  for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}
  return output;
}

async function deflateBytes(bytes){
  if(typeof CompressionStream==='undefined')throw new Error('此瀏覽器不支援 PDF 無損壓縮');
  const stream=new CompressionStream('deflate');
  const compressed=collectDeflated(stream.readable);
  const writer=stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return compressed;
}

async function deflateImagePlanes(data,width,height){
  if(typeof CompressionStream==='undefined')throw new Error('此瀏覽器不支援圖片無損壓縮');
  let hasAlpha=false;
  for(let index=3;index<data.length;index+=4){if(data[index]!==255){hasAlpha=true;break;}}
  const colorStream=new CompressionStream('deflate');
  const alphaStream=hasAlpha?new CompressionStream('deflate'):null;
  const colorPromise=collectDeflated(colorStream.readable);
  const alphaPromise=alphaStream?collectDeflated(alphaStream.readable):null;
  const colorWriter=colorStream.writable.getWriter();
  const alphaWriter=alphaStream?.writable.getWriter();
  const rowsPerBatch=Math.max(1,Math.floor(900000/Math.max(1,width)));
  for(let top=0;top<height;top+=rowsPerBatch){
    const rows=Math.min(rowsPerBatch,height-top);
    const color=new Uint8Array(rows*width*3);
    const alpha=hasAlpha?new Uint8Array(rows*width):null;
    for(let row=0;row<rows;row++){
      let source=((top+row)*width)*4;
      let rgb=(row*width)*3;
      let gray=row*width;
      for(let column=0;column<width;column++){
        color[rgb++]=data[source++];
        color[rgb++]=data[source++];
        color[rgb++]=data[source++];
        if(alpha)alpha[gray++]=data[source];
        source++;
      }
    }
    await colorWriter.write(color);
    if(alphaWriter)await alphaWriter.write(alpha);
  }
  await colorWriter.close();
  if(alphaWriter)await alphaWriter.close();
  const [color,alpha]=await Promise.all([colorPromise,alphaPromise||Promise.resolve(null)]);
  return {color,alpha};
}

function jpegInfo(bytes){
  if(!bytes||bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)return null;
  let width=0,height=0,components=0,orientation=1,frameMarker=0;
  let offset=2;
  const u16=(at,little=false)=>little?bytes[at]|bytes[at+1]<<8:bytes[at]<<8|bytes[at+1];
  const u32=(at,little=false)=>little?(bytes[at]|bytes[at+1]<<8|bytes[at+2]<<16|bytes[at+3]<<24)>>>0:(bytes[at]*0x1000000+bytes[at+1]*0x10000+bytes[at+2]*0x100+bytes[at+3])>>>0;
  const sof=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  while(offset+4<bytes.length){
    if(bytes[offset]!==0xff){offset++;continue;}
    while(offset<bytes.length&&bytes[offset]===0xff)offset++;
    const marker=bytes[offset++];
    if(marker===0xd9||marker===0xda)break;
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    if(offset+2>bytes.length)break;
    const segmentLength=u16(offset);
    if(segmentLength<2||offset+segmentLength>bytes.length)break;
    const payload=offset+2;
    if(marker===0xe1&&segmentLength>=16&&bytes[payload]===0x45&&bytes[payload+1]===0x78&&bytes[payload+2]===0x69&&bytes[payload+3]===0x66&&bytes[payload+4]===0&&bytes[payload+5]===0){
      const tiff=payload+6;
      const little=bytes[tiff]===0x49&&bytes[tiff+1]===0x49;
      if((little||bytes[tiff]===0x4d&&bytes[tiff+1]===0x4d)&&u16(tiff+2,little)===42){
        const ifd=tiff+u32(tiff+4,little);
        if(ifd+2<=offset+segmentLength){
          const count=u16(ifd,little);
          for(let entry=ifd+2;entry+12<=ifd+2+count*12&&entry+12<=offset+segmentLength;entry+=12){
            if(u16(entry,little)!==0x0112)continue;
            const type=u16(entry+2,little),items=u32(entry+4,little);
            const valueAt=items===1?entry+8:tiff+u32(entry+8,little);
            if(type===3&&valueAt+2<=offset+segmentLength)orientation=u16(valueAt,little);
            else orientation=0;
            break;
          }
        }
      }
    }
    if(sof.has(marker)&&segmentLength>=8){
      frameMarker=marker;height=u16(payload+1);width=u16(payload+3);components=bytes[payload+5];
    }
    offset+=segmentLength;
  }
  if(!width||!height)return null;
  return {width,height,components,orientation,canEmbed:[0xc0,0xc1,0xc2].includes(frameMarker)&&orientation===1&&(components===1||components===3)};
}

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

export async function addEmbeddedFont(writer, font) {
  const descriptorId=writer.reserve();
  const cidFontId=writer.reserve();
  let fontBytes=font.bytes;
  let fontFilter='';
  try{
    const compressed=await deflateBytes(font.bytes);
    if(compressed.length<font.bytes.length){fontBytes=compressed;fontFilter=' /Filter /FlateDecode';}
  }catch{}
  const fontStreamId=writer.stream(fontBytes,`${fontFilter} /Length1 ${font.bytes.length}`);
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
  coverBounds(canvas){
    const width=canvas.width,height=canvas.height;
    const data=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;
    let minX=width,minY=height,maxX=-1,maxY=-1;
    for(let y=0;y<height;y+=2){
      for(let x=0;x<width;x+=2){
        const offset=(y*width+x)*4;
        if(data[offset+3]>8&&(data[offset]<248||data[offset+1]<248||data[offset+2]<248)){
          minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
        }
      }
    }
    if(maxX<0)return {left:0,top:0,right:width,bottom:height,width,height};
    const padX=Math.ceil(width*.015),padY=Math.ceil(height*.015);
    let left=0,right=width,top=0,bottom=height;
    if(minX>=width*.08&&width-1-maxX>=width*.08){left=Math.max(0,minX-padX);right=Math.min(width,maxX+padX+1);}
    if(minY>=height*.08&&height-1-maxY>=height*.08){top=Math.max(0,minY-padY);bottom=Math.min(height,maxY+padY+1);}
    return {left,top,right,bottom,width:right-left,height:bottom-top};
  }
  async coverCrop(bitmap,width,height){
    const scale=Math.min(1,1000/Math.max(width,height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const bounds=this.coverBounds(canvas);
    const left=Math.max(0,Math.floor(bounds.left*width/canvas.width));
    const top=Math.max(0,Math.floor(bounds.top*height/canvas.height));
    const right=Math.min(width,Math.ceil(bounds.right*width/canvas.width));
    const bottom=Math.min(height,Math.ceil(bounds.bottom*height/canvas.height));
    return {left,top,right,bottom,width:right-left,height:bottom-top};
  }
  addJpegImage(bytes,width,height,components){
    const key=`Im${++this.imageSerial}`;
    const colorSpace=components===1?'/DeviceGray':'/DeviceRGB';
    const imageRef=this.writer.stream(bytes,`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode`);
    this.images.set(key,imageRef);
    return {key,width,height};
  }
  async addLosslessImage(canvas){
    const width=canvas.width,height=canvas.height;
    const data=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;
    const {color,alpha}=await deflateImagePlanes(data,width,height);
    const alphaRef=alpha?this.writer.stream(alpha,`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`):null;
    const mask=alphaRef?` /SMask ${alphaRef} 0 R`:'';
    const key=`Im${++this.imageSerial}`;
    const imageRef=this.writer.stream(color,`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${mask}`);
    this.images.set(key,imageRef);
    return {key,width,height};
  }
  async drawImage(bytes,media,label='',cover=false) {
    const cacheKey=label?`${cover?'cover':'image'}:${label}`:'';
    let image=cacheKey?this.imageSources.get(cacheKey):null;
    if(!image){
      if(!bytes)throw new Error('圖片資料遺失');
      const quality=this.opts.quality||{preset:'original'};
      const originalQuality=quality.preset==='original';
      const isJpeg=media==='image/jpeg'||media==='image/jpg';
      const jpeg=isJpeg?jpegInfo(bytes):null;
      const directJpeg=Boolean(originalQuality&&jpeg?.canEmbed);
      let bitmap=null;
      if(!directJpeg||cover){
        try{bitmap=await createImageBitmap(new Blob([bytes],{type:media}));}
        catch{throw new Error(`不支援圖片格式：${label||media}`);}
      }
      try{
        const width=directJpeg?jpeg.width:bitmap.width;
        const height=directJpeg?jpeg.height:bitmap.height;
        if(width<1||height<1)return false;
        const crop=cover?await this.coverCrop(bitmap,width,height):{left:0,top:0,right:width,bottom:height,width,height};
        if(directJpeg){
          image={...this.addJpegImage(bytes,width,height,jpeg.components),crop};
        }else{
          const maxWidth=Math.max(1,this.width-2*this.margin);
          const maxHeight=Math.max(1,this.height-2*this.margin-18);
          const displayScale=cover?Math.max(this.width/crop.width,this.height/crop.height):Math.min(maxWidth/width,maxHeight/height,1.6);
          const actualDpi=displayScale>0?72/displayScale:0;
          const downsample=originalQuality||!quality.targetDpi||!quality.thresholdDpi||actualDpi<=quality.thresholdDpi
            ?1:Math.max(0.01,Math.min(1,displayScale*quality.targetDpi/72));
          const outputWidth=Math.max(1,Math.round(crop.width*downsample));
          const outputHeight=Math.max(1,Math.round(crop.height*downsample));
          const canvas=document.createElement('canvas');
          canvas.width=outputWidth;canvas.height=outputHeight;
          const context=canvas.getContext('2d',{alpha:originalQuality,willReadFrequently:originalQuality});
          if(!originalQuality){context.fillStyle='#ffffff';context.fillRect(0,0,outputWidth,outputHeight);}
          context.drawImage(bitmap,crop.left,crop.top,crop.width,crop.height,0,0,outputWidth,outputHeight);
          if(originalQuality){
            image=await this.addLosslessImage(canvas);
          }else{
            const jpegBlob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',Math.min(1,Math.max(.4,quality.jpegQuality/100))));
            if(!jpegBlob)throw new Error('無法依品質設定壓縮圖片');
            image=this.addJpegImage(new Uint8Array(await jpegBlob.arrayBuffer()),outputWidth,outputHeight,3);
          }
          image.crop={left:0,top:0,right:outputWidth,bottom:outputHeight,width:outputWidth,height:outputHeight};
        }
      }finally{bitmap?.close();}
      if(cacheKey)this.imageSources.set(cacheKey,image);
    }
    const {key,width:w,height:h}=image;
    if(cover){
      if(this.pageItems)this.nextPage();
      const crop=image.crop||{left:0,top:0,width:w,height:h};
      const scale=Math.max(this.width/crop.width,this.height/crop.height);
      const pw=w*scale,ph=h*scale;
      const x=(this.width-crop.width*scale)/2-crop.left*scale;
      const y=(this.height-crop.height*scale)/2-(h-crop.top-crop.height)*scale;
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
