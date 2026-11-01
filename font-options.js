import {loadPdfFont} from './pdf-engine.js';
import {decodeWoff1,extractFontFace,fontFaceCount,fontFaceNames,validateTrueTypeOutline} from './font-formats.js';

const WOFF2_PATH='./vendor/woff2-encoder/decompress.js';
let woff2DecoderPromise;
const woff2Decoder=()=>woff2DecoderPromise||(woff2DecoderPromise=import(WOFF2_PATH).then(module=>module.default));

async function sourceBytes(book,selection,custom){
  if(selection==='custom'){
    if(!custom)throw new Error('請選取字型檔');
    return new Uint8Array(await custom.arrayBuffer());
  }
  const path=selection.startsWith('epub:')?selection.slice(5):'';
  if(!path)throw new Error('請選取字型');
  const encryption=book.zip.file('META-INF/encryption.xml');
  if(encryption){
    const doc=new DOMParser().parseFromString(await encryption.async('string'),'application/xml');
    const refs=Array.from(doc.getElementsByTagName('*')).filter(node=>node.localName==='CipherReference').map(node=>{
      let uri=node.getAttribute('URI')||'';try{uri=decodeURIComponent(uri);}catch{}
      return uri.replace(/^\//,'').split('#')[0].split('?')[0];
    });
    if(refs.includes(path))throw new Error('此 EPUB 字型經加密或混淆，目前不能直接嵌入 PDF');
  }
  const entry=book.zip.file(path);if(!entry)throw new Error('EPUB 內找不到所選字型');
  return entry.async('uint8array');
}

async function normalizeFont(bytes){
  if(bytes.byteLength>40*1024*1024)throw new Error('字型檔超過 40 MB');
  if(bytes.byteLength>=4){
    const signature=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0);
    if(signature===0x774f4646)bytes=await decodeWoff1(bytes);
    else if(signature===0x774f4632){
      try{bytes=await (await woff2Decoder())(bytes);}
      catch(error){throw new Error('WOFF2 解壓失敗：'+(error?.message||'字型檔無法讀取'));}
    }
  }
  if(bytes.byteLength>40*1024*1024)throw new Error('字型解壓後超過 40 MB');
  return bytes;
}

export function bindFontOptions(){
  const select=document.getElementById('output-font');
  const note=document.getElementById('epub-font-info');
  const customInput=document.getElementById('custom-font');
  const faceSelect=document.getElementById('font-face-index');
  let book=null,custom=null,faceIndex=0,refreshId=0;
  async function refreshFaces(){
    const request=++refreshId;
    faceSelect.hidden=true;faceSelect.replaceChildren();faceIndex=0;
    if(select.value==='default')return;
    try{
      const normalized=await normalizeFont(await sourceBytes(book,select.value,custom));
      const count=fontFaceCount(normalized);
      if(request!==refreshId)return;
      if(count>1){
        for(const [index,name] of fontFaceNames(normalized).entries())faceSelect.add(new Option(name,index));
        faceSelect.hidden=false;
      }
    }catch{}
  }
  select.addEventListener('change',refreshFaces);
  faceSelect.addEventListener('change',()=>{faceIndex=Number(faceSelect.value)||0;});
  customInput.addEventListener('change',event=>{
    custom=event.target.files?.[0]||null;
    if(custom){select.value='custom';document.getElementById('font-file-name').textContent=custom.name;refreshFaces();}
  });
  return {
    async inspect(value){
      book=value;select.replaceChildren(new Option('內建繁體明體','default'),new Option('選取的本機字型檔','custom'));
      const declarations=new Set();let embedded=0;
      for(const item of book.manifest.values()){
        if(/\.(?:ttf|otf|woff2?|ttc|otc)$/i.test(item.path)||/font/i.test(item.media)){
          embedded++;
          select.add(new Option('EPUB 內嵌：'+item.path,'epub:'+item.path));
        }
        if(/css|html/i.test(item.media)){
          const source=await book.zip.file(item.path)?.async('string');
          for(const match of (source||'').matchAll(/font-family\s*:\s*([^;}]+)/gi))declarations.add(match[1].trim().slice(0,160));
        }
      }
      note.textContent='EPUB 字型宣告：'+([...declarations].slice(0,12).join('；')||'未發現')+'。內嵌字型資源：'+embedded+' 個。可選 TrueType 輪廓 TTF/OTF、WOFF、WOFF2 或字型集合；CFF/CFF2 輪廓目前不支援。';
    },
    async load(defaultUrl){
      if(select.value==='default')return loadPdfFont(defaultUrl);
      let bytes=await normalizeFont(await sourceBytes(book,select.value,custom));
      bytes=extractFontFace(bytes,faceIndex);
      validateTrueTypeOutline(bytes);
      return loadPdfFont(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    }
  };
}
