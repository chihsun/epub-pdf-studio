export function startPdfOptimization(file,options,onProgress=()=>{}){
  const worker=new Worker(new URL('./pdf-optimizer.worker.js',import.meta.url));
  let settled=false;
  let resolveTask,rejectTask;
  const promise=new Promise((resolve,reject)=>{resolveTask=resolve;rejectTask=reject;});
  const finish=(callback,value)=>{
    if(settled)return;
    settled=true;
    worker.terminate();
    callback(value);
  };
  worker.onmessage=event=>{
    const message=event.data||{};
    if(message.type==='progress'){onProgress(message);return;}
    if(message.type==='result')finish(resolveTask,message.result);
    if(message.type==='error'){
      const error=new Error(message.message||'PDF 最佳化失敗');
      error.code=message.code||'PDF_OPTIMIZE_FAILED';
      error.warnings=message.warnings||[];
      finish(rejectTask,error);
    }
  };
  worker.onerror=event=>finish(rejectTask,new Error(event.message||'PDF 最佳化 Worker 無法執行'));
  file.arrayBuffer().then(buffer=>{
    if(settled)return;
    worker.postMessage({type:'optimize',buffer,options},[buffer]);
  }).catch(error=>finish(rejectTask,error));
  return {
    promise,
    cancel(){
      const error=new DOMException('已取消 PDF 最佳化','AbortError');
      finish(rejectTask,error);
    }
  };
}
