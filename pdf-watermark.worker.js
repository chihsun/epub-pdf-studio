// Merge marked page content directly: qpdf --overlay wraps it in a second Form,
// which can hide the watermark marker from native watermark-management tools.
function editableWatermarkPatch(source,overlay){
  const originals=source.qpdf[1],extra=overlay.qpdf[1],changed={};
  const resolve=(objects,value)=>typeof value==='string'&&/^\d+ \d+ R$/.test(value)?objects['obj:'+value]?.value:value;
  let next=Number(source.qpdf[0].maxobjectid);
  const refs=new Map(Object.keys(extra).filter(k=>k.startsWith('obj:')).map(k=>[k.slice(4),`${++next} 0 R`]));
  const remap=value=>{
    if(typeof value==='string')return refs.get(value)||value;
    if(Array.isArray(value))return value.map(remap);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)]));
    return value;
  };
  if(source.pages.length!==overlay.pages.length)throw Error('浮水印頁數與來源不符');
  for(const [ref,mapped]of refs)changed['obj:'+mapped]=remap(extra['obj:'+ref]);
  source.pages.forEach((page,index)=>{
    const overlayPage=resolve(extra,overlay.pages[index].object);
    const added=resolve(extra,overlayPage['/Resources'])?.['/XObject'];
    if(!added||!Object.keys(added).length)return;
    const original=resolve(originals,page.object),updated={...original};
    let node=original,resources,seen=new Set();
    while(node){resources??=resolve(originals,node['/Resources']);const parent=node['/Parent'];if(!parent||seen.has(parent))break;seen.add(parent);node=resolve(originals,parent);}
    resources={...resources};const xobjects={...resolve(originals,resources['/XObject'])};
    let content=overlayPage['/Contents'];
    if(typeof content!=='string'||!refs.has(content))throw Error('無法讀取浮水印內容');
    const mappedContent=changed['obj:'+refs.get(content)];
    let operators=new TextDecoder().decode(Uint8Array.from(atob(mappedContent.stream.data),c=>c.charCodeAt(0)));
    for(const [name,ref]of Object.entries(added)){
      let unique=name;while(Object.hasOwn(xobjects,unique))unique+='x';
      if(unique!==name)operators=operators.replace(name+' Do',unique+' Do');
      xobjects[unique]=remap(ref);
    }
    mappedContent.stream.data=btoa(String.fromCharCode(...new TextEncoder().encode(operators)));
    resources['/XObject']=xobjects;updated['/Resources']=resources;
    const contents=resolve(originals,original['/Contents']);
    // Isolate the original graphics state so its final transform/opacity cannot affect the watermark.
    const before=`${++next} 0 R`,after=`${++next} 0 R`;
    changed['obj:'+before]={stream:{dict:{},data:btoa('q\n')}};
    changed['obj:'+after]={stream:{dict:{},data:btoa('\nQ\n')}};
    updated['/Contents']=[before,...(Array.isArray(contents)?contents:original['/Contents']?[original['/Contents']]:[]),after,refs.get(content)];
    changed['obj:'+page.object]={value:updated};
  });
  return {qpdf:[{...source.qpdf[0],maxobjectid:next},changed]};
}
