/* Shared qpdf JSON metadata support. Loaded by the optimizer and security workers. */
const metadataKeys=['Title','Author','Subject','Keywords','Creator','Producer'];
function metadataObjects(data){return data.qpdf?.[1]||{};}
function metadataResolve(data,value){return typeof value==='string'&&/^\d+ \d+ R$/.test(value)?metadataObjects(data)['obj:'+value]?.value:value;}
function readDocumentMetadata(data){
 const trailer=metadataObjects(data).trailer?.value||{};
 const info=metadataResolve(data,trailer['/Info'])||{};
 return Object.fromEntries(metadataKeys.map(key=>{const value=metadataResolve(data,info['/'+key]);return [key.toLowerCase(),typeof value==='string'&&value.startsWith('u:')?value.slice(2):''];}));
}
function metadataPatch(data,values){
 const objects=metadataObjects(data),trailer={...objects.trailer?.value};
 const original=metadataResolve(data,trailer['/Info'])||{};
 const info={...original};
 for(const key of metadataKeys){delete info['/'+key];const value=String(values[key.toLowerCase()]??'').trim();if(value)info['/'+key]='u:'+value;}
 let ref=trailer['/Info'];
 if(typeof ref!=='string'||!/^\d+ \d+ R$/.test(ref))ref=(Number(data.qpdf[0].maxobjectid)+1)+' 0 R';
 trailer['/Info']=ref;
 const changed={trailer:{value:trailer},['obj:'+ref]:{value:info}};
 const rootRef=trailer['/Root'],root=metadataResolve(data,rootRef);
 if(root&&root['/Metadata']){const catalog={...root};delete catalog['/Metadata'];changed['obj:'+rootRef]={value:catalog};}
 return {qpdf:[{...data.qpdf[0]},changed]};
}
function writeMetadataPatch(data,values,path){qpdf.FS.writeFile(path,JSON.stringify(metadataPatch(data,values)));}
async function inspectDocumentMetadata(message){
 await initQpdf();const paths=['/metadata-input.pdf','/metadata-read.json'];
 try{
 qpdf.FS.writeFile(paths[0],new Uint8Array(message.buffer));
 const auth=message.password?['--password='+message.password]:[];
 const result=runQpdf([...auth,'--json',paths[0],paths[1]]);
 if(result.exitCode!==0)throw Error('無法讀取文件屬性，請確認 PDF 與開啟密碼。');
 const data=JSON.parse(qpdf.FS.readFile(paths[1],{encoding:'utf8'}));
 self.postMessage({type:'metadata',metadata:readDocumentMetadata(data)});
 }finally{cleanup(paths);}
}
self.addEventListener('message',event=>{if(event.data.type==='inspect-metadata')inspectDocumentMetadata(event.data).catch(error=>self.postMessage({type:'error',message:error.message}));});
