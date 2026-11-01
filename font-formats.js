const MAX_FONT_BYTES=40*1024*1024;
const readTag=(bytes,offset)=>String.fromCharCode(...bytes.subarray(offset,offset+4));
const align4=value=>(value+3)&~3;

function checkedView(bytes){
  if(!(bytes instanceof Uint8Array))bytes=new Uint8Array(bytes);
  return {bytes,view:new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)};
}

async function inflateZlib(bytes,expected){
  if(typeof DecompressionStream!=='function')throw new Error('此瀏覽器不支援 WOFF 解壓，請選 TTF/OTF 或改用新版 Chrome、Edge、Firefox、Safari');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader=stream.getReader(),chunks=[];let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;
      if(total>expected||total>MAX_FONT_BYTES){await reader.cancel();throw new Error('WOFF 字型解壓後超過宣告大小或 40 MB 限制');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  if(total!==expected)throw new Error('WOFF 字型資料長度與目錄不符');
  const output=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.byteLength;}
  return output;
}

function tableChecksum(tag,bytes){
  let sum=0;
  for(let offset=0;offset<align4(bytes.byteLength);offset+=4){
    let word=0;
    for(let i=0;i<4;i++){
      let byte=offset+i<bytes.byteLength?bytes[offset+i]:0;
      if(tag==='head'&&offset+i>=8&&offset+i<12)byte=0;
      word=(word*256+byte)>>>0;
    }
    sum=(sum+word)>>>0;
  }
  return sum;
}

export async function decodeWoff1(input){
  const {bytes,view}=checkedView(input);
  if(bytes.byteLength<44||view.getUint32(0)!==0x774f4646)throw new Error('WOFF 標頭無效');
  const flavor=view.getUint32(4),fileLength=view.getUint32(8),numTables=view.getUint16(12),reserved=view.getUint16(14),totalSfntSize=view.getUint32(16);
  if(fileLength!==bytes.byteLength||reserved!==0||numTables<1||numTables>256||totalSfntSize>MAX_FONT_BYTES)throw new Error('WOFF 標頭欄位無效或字型超過 40 MB 限制');
  const directoryEnd=44+numTables*20;
  if(directoryEnd>bytes.byteLength)throw new Error('WOFF 字型目錄不完整');
  const tables=[];let previousTag='';let calculatedSize=12+numTables*16;
  for(let i=0;i<numTables;i++){
    const pos=44+i*20,tag=readTag(bytes,pos),offset=view.getUint32(pos+4),compressedLength=view.getUint32(pos+8),originalLength=view.getUint32(pos+12),checksum=view.getUint32(pos+16);
    if(tag<=previousTag||offset%4||offset<directoryEnd||compressedLength>originalLength||offset+compressedLength>bytes.byteLength||originalLength>MAX_FONT_BYTES)throw new Error('WOFF 字型目錄或資料範圍無效');
    previousTag=tag;calculatedSize+=align4(originalLength);
    tables.push({tag,offset,compressedLength,originalLength,checksum});
  }
  if(calculatedSize!==totalSfntSize)throw new Error('WOFF 宣告的解壓後大小不符');
  const ranges=[...tables].sort((a,b)=>a.offset-b.offset);
  for(let i=1;i<ranges.length;i++)if(ranges[i-1].offset+ranges[i-1].compressedLength>ranges[i].offset)throw new Error('WOFF 字型表格資料重疊');
  const expanded=[];
  for(const table of tables){
    const compressed=bytes.subarray(table.offset,table.offset+table.compressedLength);
    const data=table.compressedLength===table.originalLength?compressed.slice():await inflateZlib(compressed,table.originalLength);
    if(tableChecksum(table.tag,data)!==table.checksum)throw new Error('WOFF 字型表格校驗失敗：'+table.tag);
    expanded.push({...table,data});
  }
  return buildSfnt(flavor,expanded,totalSfntSize);
}

function buildSfnt(flavor,tables,totalSize){
  if(totalSize>MAX_FONT_BYTES||tables.length>256)throw new Error('解壓後字型超過 40 MB 限制');
  const output=new Uint8Array(totalSize),view=new DataView(output.buffer),count=tables.length;
  view.setUint32(0,flavor);view.setUint16(4,count);
  let power=1,selector=0;while(power*2<=count){power*=2;selector++;}
  view.setUint16(6,power*16);view.setUint16(8,selector);view.setUint16(10,count*16-power*16);
  let offset=12+count*16;
  tables.forEach((table,index)=>{
    const p=12+index*16;
    for(let j=0;j<4;j++)output[p+j]=table.tag.charCodeAt(j);
    view.setUint32(p+4,table.checksum);view.setUint32(p+8,offset);view.setUint32(p+12,table.data.byteLength);
    output.set(table.data,offset);offset+=align4(table.data.byteLength);
  });
  if(offset!==totalSize)throw new Error('字型重建長度不符');
  return output;
}

function parseDirectory(bytes,baseOffset=0){
  const {view}=checkedView(bytes),signature=view.getUint32(baseOffset);
  if(![0x00010000,0x74727565,0x4f54544f].includes(signature))throw new Error('字型不是支援的 OpenType/TrueType 檔案');
  const count=view.getUint16(baseOffset+4);
  if(count<1||count>256||baseOffset+12+count*16>bytes.byteLength)throw new Error('字型目錄無效');
  const tables=[];
  for(let i=0;i<count;i++){
    const p=baseOffset+12+i*16,tag=readTag(bytes,p),checksum=view.getUint32(p+4),offset=view.getUint32(p+8),length=view.getUint32(p+12);
    if(offset+length>bytes.byteLength||length>MAX_FONT_BYTES)throw new Error('字型表格超出檔案範圍：'+tag);
    tables.push({tag,checksum,offset,length});
  }
  return {signature,baseOffset,tables};
}

function decodeName(bytes,table){
  if(!table||table.length<6)return '';
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),base=table.offset,count=view.getUint16(base+2),strings=base+view.getUint16(base+4);
  let family='',subfamily='';
  for(let i=0;i<count;i++){
    const p=base+6+i*12;if(p+12>base+table.length)break;
    const platform=view.getUint16(p),nameId=view.getUint16(p+6),length=view.getUint16(p+8),offset=view.getUint16(p+10),start=strings+offset;
    if((nameId!==1&&nameId!==2)||start+length>base+table.length)continue;
    let value='';
    if(platform===0||platform===3){for(let j=0;j+1<length;j+=2)value+=String.fromCharCode(view.getUint16(start+j));}
    else value=new TextDecoder('windows-1252').decode(bytes.subarray(start,start+length));
    value=value.trim();if(nameId===1&&!family)family=value;if(nameId===2&&!subfamily)subfamily=value;
  }
  return [family,subfamily].filter(Boolean).join(' ');
}

export function fontFaceCount(input){
  const {bytes,view}=checkedView(input);
  if(bytes.byteLength>=12&&view.getUint32(0)===0x74746366){
    if(bytes.byteLength<12)throw new Error('字型集合標頭不完整');
    const count=view.getUint32(8);if(count<1||count>64||12+count*4>bytes.byteLength)throw new Error('字型集合的字型數量無效');return count;
  }
  return 1;
}

export function fontFaceNames(input){
  const {bytes,view}=checkedView(input),count=fontFaceCount(bytes);
  if(count===1)return [fontName(bytes,0)];
  const names=[];
  for(let i=0;i<count;i++){const base=view.getUint32(12+i*4);const directory=parseDirectory(bytes,base);names.push(fontName(bytes,base,directory));}
  return names;
}

function fontName(bytes,base,directory=parseDirectory(bytes,base)){
  const nameTable=directory.tables.find(table=>table.tag==='name');
  const label=decodeName(bytes,{offset:nameTable?.offset||0,length:nameTable?.length||0});
  return label||`字型 ${base?`位移 ${base}`:'1'}`;
}

export function extractFontFace(input,index=0){
  const {bytes,view}=checkedView(input);
  if(bytes.byteLength>=12&&view.getUint32(0)===0x74746366){
    const count=fontFaceCount(bytes);if(index<0||index>=count)throw new Error('字型集合所選字型不存在');
    const directory=parseDirectory(bytes,view.getUint32(12+index*4));
    const tables=directory.tables.map(table=>({tag:table.tag,checksum:table.checksum,data:bytes.subarray(table.offset,table.offset+table.length).slice()})).sort((a,b)=>a.tag.localeCompare(b.tag));
    const total=12+tables.length*16+tables.reduce((sum,table)=>sum+align4(table.data.byteLength),0);
    return buildSfnt(directory.signature,tables,total);
  }
  return bytes;
}

export function validateTrueTypeOutline(input){
  const {bytes}=checkedView(input),directory=parseDirectory(bytes),tags=new Set(directory.tables.map(table=>table.tag));
  if(!tags.has('glyf')||!tags.has('loca'))throw new Error('目前只支援 TrueType 輪廓；CFF/CFF2 OTF 字型尚不支援');
  for(const required of ['cmap','head','hhea','hmtx','maxp'])if(!tags.has(required))throw new Error('字型缺少必要表格：'+required);
  const os2=directory.tables.find(table=>table.tag==='OS/2');
  if(os2){if(os2.length<10)throw new Error('字型授權表格損毀');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(view.getUint16(os2.offset+8)&0x0202)throw new Error('此字型限制 PDF 嵌入，請改用其他字型');}
  return bytes;
}
