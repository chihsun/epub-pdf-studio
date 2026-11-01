import {loadPdfFont} from './pdf-engine.js';

export function bindFontOptions(){
  const select=document.getElementById('output-font');
  const note=document.getElementById('epub-font-info');
  let book=null,custom=null;
  document.getElementById('custom-font').addEventListener('change',event=>{
    custom=event.target.files?.[0]||null;
    if(custom){select.value='custom';document.getElementById('font-file-name').textContent=custom.name;}
  });
  return {
    async inspect(value){
      book=value;select.replaceChildren(new Option('內建繁體明體','default'),new Option('選取的本機 TTF 字型','custom'));
      const declarations=new Set();let embedded=0;
      for(const item of book.manifest.values()){
        if(/\.(?:ttf|otf|woff2?)$/i.test(item.path)||/font/i.test(item.media)){
          embedded++;
          if(/\.ttf$/i.test(item.path))select.add(new Option('EPUB 內嵌：'+item.path,'epub:'+item.path));
        }
        if(/css|html/i.test(item.media)){
          const source=await book.zip.file(item.path)?.async('string');
          for(const match of (source||'').matchAll(/font-family\s*:\s*([^;}]+)/gi))declarations.add(match[1].trim().slice(0,160));
        }
      }
      note.textContent='EPUB 字型宣告：'+([...declarations].slice(0,12).join('；')||'未發現')+'。內嵌字型資源：'+embedded+' 個。可選取未加密的 TrueType TTF 作為全書輸出字型；僅有字型名稱時，請另外選取對應字型檔。';
    },
    async load(defaultUrl){
      if(select.value==='default')return loadPdfFont(defaultUrl);
      let bytes;
      if(select.value==='custom'){
        if(!custom)throw new Error('請先選取本機 TTF 字型檔');
        bytes=await custom.arrayBuffer();
      }else{
        const path=select.value.slice(5);
        const encryption=book.zip.file('META-INF/encryption.xml');
        if(encryption)throw new Error('此 EPUB 含加密或混淆資源，目前請使用內建或自行選取的字型');
        bytes=await book.zip.file(path).async('arraybuffer');
      }
      if(bytes.byteLength>40*1024*1024)throw new Error('字型檔超過 40 MB');
      const view=new DataView(bytes);
      if(view.byteLength<12||view.getUint32(0)!==0x00010000)throw new Error('目前僅支援 TrueType 輪廓的 TTF 字型；不支援 OTF、WOFF 或字型集合');
      let glyf=false;
      for(let i=0;i<view.getUint16(4);i++){
        const pos=12+i*16;
        if(pos+16>bytes.byteLength)throw new Error('字型表格損毀');
        const tag=String.fromCharCode(...new Uint8Array(bytes,pos,4));
        if(tag==='glyf')glyf=true;
        if(tag==='OS/2'){
          const offset=view.getUint32(pos+8);
          if(offset+10>bytes.byteLength)throw new Error('字型授權表格損毀');
          if(view.getUint16(offset+8)&0x0202)throw new Error('此字型限制文件嵌入，請改用其他字型');
        }
      }
      if(!glyf)throw new Error('此字型沒有支援的 TrueType 輪廓');
      return loadPdfFont(bytes);
    }
  };
}
