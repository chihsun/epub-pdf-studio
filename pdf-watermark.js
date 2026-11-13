// Editable Form XObjects with the settings structure recognized by PDF-XChange.
const enc=new TextEncoder();
const num=value=>String(Number(value.toFixed(5)));
const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function validateEditableWatermarkText(text,font){
  for(const char of text){
    const cp=char.codePointAt(0);
    if(cp>65535||!font.metrics.cmap.has(cp))throw Error(`所選字型無法嵌入「${char}」（U+${cp.toString(16).toUpperCase()}），請改用包含此字的字型或調整文字。`);
  }
}
export function addEditableWatermark(writer,text,options,fontRef,font){
  validateEditableWatermarkText(text,font);
  const {width:w,height:h}=options;
  const advance=[...text].reduce((sum,c)=>sum+font.metrics.advanceWidths.get(c.charCodeAt(0)),0)/1000;
  const emHeight=(font.metrics.ascender-font.metrics.descender)/font.metrics.upm;
  const availableW=w-20,availableH=h-20;
  if(availableW<=4||availableH<=4||advance<=0||emHeight<=0)throw Error('頁面或浮水印尺寸無法使用');
  const size=Math.min(options.size*Math.min(w,h),(availableW-4)/advance,(availableH-4)/emHeight);
  const bw=advance*size+4,bh=emHeight*size+4;
  const pos=options.position==='random'?Math.floor(Math.random()*5):Number(options.position);
  const coords=[[w-bw-10,10],[10,10],[w-bw-10,h-bh-10],[10,h-bh-10],[(w-bw)/2,(h-bh)/2]];
  if(!coords[pos])throw Error('浮水印位置無效');
  const [x,y]=coords[pos],color=options.color;
  if(!/^#[0-9a-f]{6}$/i.test(color))throw Error('浮水印顏色無效');
  const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255);
  const date='D:'+new Date().toISOString().replace(/[-:T]/g,'').slice(0,14)+'Z';
  const selected=options.pageNumbers.join(', ');
  const settings=`<?xml version="1.0" encoding="UTF-8"?><WatermarkSettings version="8.0"><Font type="TrueType" underline="false" size="${num(size)}" name="${xml(font.postScriptName)}"/><TextAlignment alignment="0"/>${xml(text)}<Scale value="1"/><Rotation value="0"/><Opacity value="${num(options.alpha)}"/><Location ontop="1"/><Color r="${num(rgb[0])}" g="${num(rgb[1])}" b="${num(rgb[2])}"/><Alignment unit="1" horizvalue="${num((x+bw/2-w/2)*25.4/72)}" vertvalue="${num((h/2-y-bh/2)*25.4/72)}" horizalign="1" vertalign="1"/><Appearance fixedprint="0" onscreen="1" onprint="1" onexport="1"/><PageRange odd="1" even="1" start="${options.pageNumbers[0]-1}" end="${options.pageNumbers.at(-1)-1}" fullrange="${selected}" rangeflags="6"/></WatermarkSettings>`;
  const settingsId=writer.stream(enc.encode(settings));
  const gs=writer.add(`<< /Type /ExtGState /CA ${num(options.alpha)} /ca ${num(options.alpha)} >>`);
  const hex=[...text].map(c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
  const baseline=2-font.metrics.descender/font.metrics.upm*size;
  const form=writer.stream(enc.encode(`/GS0 gs ${rgb.map(num).join(' ')} rg BT /F0 ${num(size)} Tf 2 ${num(baseline)} Td <${hex}> Tj ET`),
    `/Type /XObject /Subtype /Form /BBox [0 0 ${num(bw)} ${num(bh)}] /Resources << /Font << /F0 ${fontRef} 0 R >> /ExtGState << /GS0 ${gs} 0 R >> >> /LastModified (${date}) /PieceInfo << /ADBE_CompoundType << /DocSettings ${settingsId} 0 R /LastModified (${date}) /Private /Watermark >> >>`);
  const name='PSW'+options.pageNumber;
  return {resources:`<< /XObject << /${name} ${form} 0 R >> >>`,content:`/Artifact << /Subtype /Watermark /Type /Pagination >> BDC\nq 1 0 0 1 ${num(x+options.originX)} ${num(y+options.originY)} cm /${name} Do Q\nEMC`};
}
