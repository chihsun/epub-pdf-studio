const STORAGE_KEY='epub-pdf-studio-quality-settings-v1';

export const QUALITY_PRESETS=Object.freeze({
  original:Object.freeze({id:'original',label:'原始品質',targetDpi:null,thresholdDpi:null,jpegQuality:null,description:'EPUB 圖片不重新取樣；JPEG 直接嵌入，其餘圖片以無損方式存入 PDF。PDF 最佳化只重組結構及無損壓縮。'}),
  high:Object.freeze({id:'high',label:'高品質',targetDpi:300,thresholdDpi:450,jpegQuality:90,description:'EPUB 圖片高於 450 DPI 才縮至 300 DPI，JPEG 品質 90。'}),
  balanced:Object.freeze({id:'balanced',label:'均衡',targetDpi:150,thresholdDpi:225,jpegQuality:84,description:'EPUB 圖片高於 225 DPI 才縮至 150 DPI，JPEG 品質 84。'}),
  compression:Object.freeze({id:'compression',label:'高壓縮',targetDpi:120,thresholdDpi:180,jpegQuality:72,description:'EPUB 圖片高於 180 DPI 才縮至 120 DPI，JPEG 品質 72；細字、線稿及 OCR 邊緣可能變模糊。'}),
  custom:Object.freeze({id:'custom',label:'自訂',targetDpi:180,thresholdDpi:270,jpegQuality:82,description:'依自訂的目標 DPI、啟動門檻與 JPEG 品質處理。'})
});

const clampInteger=(value,min,max,fallback)=>{
  const number=Number(value);
  return Number.isFinite(number)?Math.min(max,Math.max(min,Math.round(number))):fallback;
};

function normalizeCustom(custom={}){
  const targetDpi=clampInteger(custom.targetDpi,72,1200,180);
  return {
    targetDpi,
    thresholdDpi:clampInteger(custom.thresholdDpi,targetDpi,2400,Math.max(270,targetDpi)),
    jpegQuality:clampInteger(custom.jpegQuality,40,100,82)
  };
}

export function loadQualitySettings(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
    const preset=Object.hasOwn(QUALITY_PRESETS,saved.preset)?saved.preset:'original';
    return {preset,custom:normalizeCustom(saved.custom)};
  }catch{
    return {preset:'original',custom:normalizeCustom()};
  }
}

export function saveQualitySettings(settings){
  const normalized={
    preset:Object.hasOwn(QUALITY_PRESETS,settings?.preset)?settings.preset:'original',
    custom:normalizeCustom(settings?.custom)
  };
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(normalized));}catch{}
  return normalized;
}

export function resolveQualitySettings(settings=loadQualitySettings()){
  const preset=Object.hasOwn(QUALITY_PRESETS,settings?.preset)?settings.preset:'original';
  if(preset==='custom')return {preset,...normalizeCustom(settings.custom)};
  return {...QUALITY_PRESETS[preset]};
}

export function qualityPresetOptions(){
  return Object.values(QUALITY_PRESETS).map(({id,label})=>({id,label}));
}
