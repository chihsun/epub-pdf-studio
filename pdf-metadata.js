export function bindPdfMetadata(prefix,{getFile,getPassword,onChange}){
 const panel=document.getElementById(prefix+'-metadata');
 const enable=panel.querySelector('[data-metadata-enable]'),fields=panel.querySelector('fieldset'),note=panel.querySelector('[role=status]');
 let source={},worker=null,generation=0;
 const inputs=()=>Array.from(panel.querySelectorAll('[data-metadata-key]'));
 const set=values=>{for(const input of inputs())input.value=values[input.dataset.metadataKey]??'';};
 const change=()=>{fields.disabled=!enable.checked;onChange();};
 enable.addEventListener('change',change);
 for(const input of inputs())input.addEventListener('input',onChange);
 panel.querySelector('[data-metadata-clear]').addEventListener('click',()=>{set({});enable.checked=true;change();});
 panel.querySelector('[data-metadata-restore]').addEventListener('click',()=>{set(source);onChange();});
 const readButton=panel.querySelector('[data-metadata-read]');
 readButton.addEventListener('click',async()=>{
 const file=getFile();if(!file){note.textContent='請先選擇 PDF。';return;}
 const ticket=++generation;worker?.terminate();worker=new Worker(new URL('./pdf-optimizer.worker.js',import.meta.url));
 const current=worker;readButton.disabled=true;note.textContent='正在讀取原檔文件屬性…';
 const finish=()=>{current.terminate();if(ticket===generation){worker=null;readButton.disabled=false;}};
 current.onmessage=event=>{if(ticket!==generation)return;const m=event.data;
 if(m.type==='metadata'){source=m.metadata;set(source);note.textContent='已讀取原檔 Info 屬性，可勾選修改後調整。';onChange();finish();}
 else if(m.type==='error'){note.textContent=m.message;finish();}};
 current.onerror=()=>{if(ticket===generation)note.textContent='讀取失敗，請確認檔案與密碼。';finish();};
 try{const buffer=await file.arrayBuffer();if(ticket===generation)current.postMessage({type:'inspect-metadata',buffer,password:getPassword()},[buffer]);}
 catch(error){if(ticket===generation)note.textContent=error.message;finish();}
 });
 return {
 values:()=>enable.checked?Object.fromEntries(inputs().map(input=>[input.dataset.metadataKey,input.value.trim()])):null,
 reset(){generation++;worker?.terminate();worker=null;readButton.disabled=false;source={};set({});enable.checked=false;fields.disabled=true;note.textContent='預設保留原檔屬性；可先讀取原檔再編輯。';},
 busy(value){if(value){generation++;worker?.terminate();worker=null;}for(const button of panel.querySelectorAll('button'))button.disabled=value;enable.disabled=value;fields.disabled=value||!enable.checked;}
 };
}
