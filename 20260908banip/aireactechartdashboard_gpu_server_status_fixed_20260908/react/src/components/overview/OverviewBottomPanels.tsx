import { useEffect, useMemo, useState } from "react";
import { fetchMainInternalErrors, fetchMainTableChunks, type MainInternalErrorPointDto, type MainOverviewFilterParams, type MainTableChunkDto } from "../../api/aiReactEchartMainApi";

function bytes(v?:number){ const n=Number(v??0); if(n>=1024**3)return `${(n/1024**3).toFixed(1)} GB`; if(n>=1024**2)return `${(n/1024**2).toFixed(1)} MB`; return `${Math.round(n/1024)} KB`; }

export function OverviewBottomPanels({startMs,endMs,filters,refreshSec}:{startMs:number;endMs:number;filters:MainOverviewFilterParams;refreshSec:number}){
  const [chunks,setChunks]=useState<MainTableChunkDto[]>([]); const [errors,setErrors]=useState<MainInternalErrorPointDto[]>([]);
  useEffect(()=>{ let alive=true; const load=()=>{ const c=new AbortController(); Promise.all([fetchMainTableChunks(startMs,endMs,filters,c.signal),fetchMainInternalErrors(startMs,endMs,filters,c.signal)]).then(([a,b])=>{if(alive){setChunks(a);setErrors(b)}}).catch(()=>{}); return c; }; let c=load(); const id=setInterval(()=>{c.abort();c=load()},Math.max(5,refreshSec)*1000); return()=>{alive=false;c.abort();clearInterval(id)}; },[startMs,endMs,filters.instances?.join(','),refreshSec]);
  const max=useMemo(()=>Math.max(1,...chunks.map(x=>Number(x.uncompressedTableSizeByte??0))),[chunks]);
  const pts=useMemo(()=>{ const w=520,h=185,p=24, vals=errors.map(x=>Number(x.errorCount??0)), mx=Math.max(1,...vals); return errors.map((e,i)=>({x:p+(errors.length<=1?0:i*(w-2*p)/(errors.length-1)),y:h-p-(Number(e.errorCount??0)/mx)*(h-2*p),...e})); },[errors]);
  return <section className="overview-bottom-pair" aria-label="Table Chunk 및 Internal Runtime Error">
    <div className="panel overview-extra-panel"><div className="panel__head"><strong>Table Chunk</strong><span className="overview-extra-sub">Compressed / Uncompressed Size</span></div><div className="chunk-map">
      {chunks.length===0?<div className="overview-extra-empty">데이터 없음</div>:chunks.map((c,i)=>{const outer=72+Math.sqrt(Number(c.uncompressedTableSizeByte??0)/max)*92; const ratio=Math.max(0.12,Math.min(1,Number(c.compressedTableSizeByte??0)/Math.max(1,Number(c.uncompressedTableSizeByte??0)))); const inner=Math.max(30,outer*Math.sqrt(ratio)); return <div className="chunk-item" key={`${c.tableId}-${i}`} title={`${c.databaseName}.${c.schemaName}.${c.tableName}\nUncompressed ${bytes(c.uncompressedTableSizeByte)}\nCompressed ${bytes(c.compressedTableSizeByte)}`}><div className="chunk-square" style={{width:outer,height:outer}}><div className="chunk-square__compressed" style={{width:inner,height:inner}}/><span className="chunk-square__name">{c.tableName}</span></div><div className="chunk-size">{bytes(c.compressedTableSizeByte)} / {bytes(c.uncompressedTableSizeByte)}</div></div>})}
    </div></div>
    <div className="panel overview-extra-panel"><div className="panel__head"><strong>Internal Runtime Error</strong><span className="overview-extra-sub">worker_log.message_type = error / 500</span></div><div className="error-chart">
      {pts.length===0?<div className="overview-extra-empty">에러 데이터 없음</div>:<svg viewBox="0 0 520 185" preserveAspectRatio="none" role="img" aria-label="Internal Runtime Error 시간별 발생 건수"><line x1="24" y1="161" x2="496" y2="161" className="error-axis"/><polyline points={pts.map(p=>`${p.x},${p.y}`).join(' ')} className="error-line"/>{pts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="3" className="error-dot"><title>{`${p.time}: ${p.errorCount}건`}</title></circle>)}</svg>}
    </div></div>
  </section>;
}
