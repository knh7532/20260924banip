// ===== 20260908 추가 시작 : Main Dashboard - MQuery 직접 REST API =====
import { runtimeOverride } from "../runtimeConfig";

export interface MainDashboardFilterParams {
  hostname?: string;
  gpuId?: string;
  migInstanceId?: string;
}

export interface MainDrilldownQueryDto {
  connectionId: string;
  statementId: string;
  user: string;
  node: string;
  worker: string;
  service: string;
  status: string;
  elapsed: number | null;
  progress: number | null;
  qid: string;
  qidTags: string;
  startEpoch: number | null;
  peakCpuUsagePercent: number | null;
  peakMemoryUsagePercent: number | null;
  peakDiskUsagePercent: number | null;
  peakGrEngineActivePercent: number | null;
  peakGpuMemoryUsedMib: number | null;
  peakGpuMemoryTotalMib: number | null;
  gpuUtilization: number | null;
  memoryBytes: number | null;
  dataScannedBytes: number | null;
}

export interface MainDrilldownWorkerDto {
  node: string;
  worker: string;
  migInstanceId: number | null;
  grEngineActivePercent: number | null;
  healthy: boolean;
  healthStatus: "HEALTHY" | "NOT_HEALTHY" | "UNHEALTHY" | string;
  alert: string | null;
}

export interface MainDrilldownResponseDto {
  activeSessions: number;
  runningQueries: number;
  cpuUsagePercent: number | null;
  gpuMemoryUsagePercent: number | null;
  connectedUsers: number;
  failedQueries1h: number;
  diskSpillBytes: number | null;
  orphanLocks: number;
  queries: MainDrilldownQueryDto[];
  topQueries: MainDrilldownQueryDto[];
  workers: MainDrilldownWorkerDto[];
}

export interface MainPerformancePointDto {
  collectTime: string;
  node: string;
  cpuUsagePercent: number | null;
  ramUsagePercent: number | null;
  diskUsagePercent: number | null;
  gpuUsagePercent: number | null;
}

export interface MainLiveStatDto { stmtId: string; elapsed: number | null; prog: number | null }

export interface StatementPlanStepDto {
  step: number | null;
  planName: string | null;
  rows: number | null;
  chunks: number | null;
  chunkPerRows: number | null;
  planTime: string | null;
  newStep: number | null;
  readData: string | null;
  writeData: string | null;
  tableInfo: string | null;
  planRuntime: number | null;
  status: string | null;
}

export interface MainStatementDetailDto {
  connectionId: number | null;
  statementId: number | null;
  hostname: string | null;
  workerHostname: string | null;
  databaseName: string | null;
  serviceName: string | null;
  userId: string | null;
  sqlType: string | null;
  sqlStatement: string | null;
  queryPlan: string | null;
  queryTerminationStatus: string | null;
  planSteps: StatementPlanStepDto[];
}

function baseUrl(): string {
  const configured = (runtimeOverride("portalApiUrl") ?? import.meta.env.VITE_PORTAL_API_BASE ?? "").trim();
  return configured.replace(/\/$/, "");
}

function fmt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function appendFilters(q: URLSearchParams, filters?: MainDashboardFilterParams) {
  if (!filters) return;
  if (filters.hostname) q.set("hostname", filters.hostname);
  if (filters.gpuId !== undefined && filters.gpuId !== "") q.set("gpuId", filters.gpuId);
  if (filters.migInstanceId !== undefined && filters.migInstanceId !== "") q.set("migInstanceId", filters.migInstanceId);
}

async function getJson<T>(path: string, startMs: number, endMs: number,
  filters?: MainDashboardFilterParams, signal?: AbortSignal): Promise<T> {
  const q = new URLSearchParams({ startTime: fmt(startMs), endTime: fmt(endMs) });
  appendFilters(q, filters);
  const res = await fetch(`${baseUrl()}/api/aireactechartdashboard/main/${path}?${q}`, {
    signal, credentials: "include",
  });
  if (!res.ok) throw new Error(`Spring Main Dashboard API HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchMainDrilldown = (startMs:number,endMs:number,filters?:MainDashboardFilterParams,signal?:AbortSignal) =>
  getJson<MainDrilldownResponseDto>("drilldown",startMs,endMs,filters,signal);

export const fetchMainPerformance = (startMs:number,endMs:number,filters?:MainDashboardFilterParams,signal?:AbortSignal) =>
  getJson<MainPerformancePointDto[]>("performance",startMs,endMs,filters,signal);

export const fetchMainLiveStats = (startMs:number,endMs:number,signal?:AbortSignal) =>
  getJson<MainLiveStatDto[]>("live-stats",startMs,endMs,undefined,signal);

// ===== 20260908 추가 시작 : Statement ID -> Worker Log 쿼리문/실행계획 직접 조회 =====
export async function fetchMainStatementDetail(
  connectionId: string,
  statementId: string,
  signal?: AbortSignal,
): Promise<MainStatementDetailDto> {
  const q = new URLSearchParams({ connectionId, statementId });
  const res = await fetch(`${baseUrl()}/api/aisqreamboard/worker_log/statement_detail?${q}`, {
    signal, credentials: "include",
  });
  if (!res.ok) throw new Error(`Statement Detail API HTTP ${res.status}`);
  return res.json() as Promise<MainStatementDetailDto>;
}
// ===== 20260908 추가 끝 : Statement ID -> Worker Log 쿼리문/실행계획 직접 조회 =====
// ===== 20260908 추가 끝 : Main Dashboard - MQuery 직접 REST API =====
