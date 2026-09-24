// ===== 20260908 추가 시작 : Worker Monitoring - MQuery 직접 매핑 =====
import { useState } from "react";
import { fetchWorkerDashboard, type WorkerDashboardResponseDto, type WorkerDashboardRowDto } from "../../api/aiReactEchartWorkerApi";
import { BarCell, Card, Table } from "../../components/drilldown/primitives";
import { PageHead } from "../../components/drilldown/PageHead";
import { PinChip } from "../../components/drilldown/PinChip";
import { usePolling } from "../../hooks/usePolling";
import type { DrilldownScreenProps } from "../DrilldownDashboard";
import { MainStatementDetailModal } from "./MainStatementDetailModal";

const EMPTY:WorkerDashboardResponseDto={nodes:[]};
const pct=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?"-":`${v.toFixed(1)}%`;
const gib=(used:number|null|undefined,total:number|null|undefined)=>used==null?"-":`${(used/1024).toFixed(2)} GB${total==null?"":` / ${(total/1024).toFixed(2)} GB`}`;

export function WorkerMonitoring({refreshMs,filters,title,pinnedMs,onClearPin}:DrilldownScreenProps){
  const [data,setData]=useState<WorkerDashboardResponseDto>(EMPTY); const [loaded,setLoaded]=useState(false); const [failed,setFailed]=useState(false);
  const [detail,setDetail]=useState<WorkerDashboardRowDto|null>(null);
  const endMs=filters.endMs??pinnedMs??Date.now(); const startMs=endMs-filters.rangeSec*1000;
  usePolling(async(signal)=>{try{const r=await fetchWorkerDashboard(startMs,endMs,filters.server,filters.gpu,filters.mig,signal);setData(r);setFailed(false);setLoaded(true);}catch(e){if(signal.aborted)return;console.error(e);setFailed(true);setLoaded(true);}},refreshMs,[filters.server,filters.gpu,filters.mig,filters.rangeSec,filters.endMs,pinnedMs]);
  return <>
    <PageHead title={title} sub="MQuery · Node별 GPU0~3 / MIG Worker"><PinChip pinnedMs={pinnedMs} onClear={onClearPin}/></PageHead>
    {data.nodes.map(node=><Card key={node.hostname} title={node.hostname} aside={`${node.rows.length} workers`} body={false}>
      <Table head={["GPU","MIG","Worker","Statement ID","Service","상태","CPU","GPU 사용률","GPU Memory","RAM","Disk"]}
        loading={!loaded} error={failed?"Worker 데이터를 불러오지 못했습니다.":undefined}
        empty={loaded&&!failed&&node.rows.length===0?"조회된 Worker 데이터가 없습니다.":undefined}>
        {node.rows.map((r,i)=><tr key={`${r.gpuId}-${r.migInstanceId}-${r.statementId}-${i}`}>
          <td>GPU{r.gpuId??"-"}</td><td>{r.migInstanceId??"-"}</td><td>{r.workerHostname||"-"}</td>
          <td>{r.connectionId!=null&&r.statementId!=null?<button type="button" className="sqm-link" onClick={()=>setDetail(r)}>{r.statementId}</button>:(r.statementId??"-")}</td>
          <td>{r.serviceName||"-"}</td><td>{r.queryTerminationStatus||"-"}</td>
          <td><BarCell percent={r.peakCpuUsagePercent??0} color="var(--blue)" text={pct(r.peakCpuUsagePercent)}/></td>
          <td><BarCell percent={r.peakGrEngineActivePercent??0} color="var(--green)" text={pct(r.peakGrEngineActivePercent)}/></td>
          <td>{gib(r.peakGpuMemoryUsedMib,r.peakGpuMemoryTotalMib)}</td>
          <td>{pct(r.peakMemoryUsagePercent)}</td><td>{pct(r.peakDiskUsagePercent)}</td>
        </tr>)}
      </Table>
    </Card>)}
    {loaded&&!failed&&data.nodes.length===0?<Card title="Worker Monitoring"><div className="sqm-table__empty">조회기간에 해당하는 MQuery Worker 데이터가 없습니다.</div></Card>:null}
    {detail?.connectionId!=null&&detail.statementId!=null?<MainStatementDetailModal connectionId={String(detail.connectionId)} statementId={String(detail.statementId)} initialTab="sql" onClose={()=>setDetail(null)}/>:null}
  </>;
}
// ===== 20260908 추가 끝 : Worker Monitoring - MQuery 직접 매핑 =====
