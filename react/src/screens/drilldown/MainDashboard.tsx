/**
 * Main Dashboard (`#/drilldown/main`) — 정적 `res/sqream/mockup/index.html`.
 *
 * 드릴다운 10화면 중 가장 크다 — KPI 4, 클러스터 성능 차트, 세션 통계 4박스,
 * Query Overview, Node Health, Top Queries.
 *
 * 정적본에서 그대로 지키는 것:
 *  - 무데이터 표기는 `--`로 통일한다(2026-08-08 표기 통일 — 예전엔 표마다 달랐다).
 *  - Service 열은 X17부터 **qid 파생 표시 축**(select_service/etl_service/sqream +
 *    실행 전 compile)이다 — etl_service는 배지 강조(ADR H-0003의 etl 강조 계승).
 *  - Node Health는 **기대 노드 3개를 항상** 그린다 — 데이터가 없으면 그렇게 말한다.
 *  - `Failed Queries (1h)`는 에러 **로그 건수**다(실제 실패 쿼리 수가 아님) — 원본 각주 유지.
 *  - Cluster Performance 아래 **현재값 스트립**(CPU·GPU·Disk I/O)을 유지한다.
 *  - Top Queries: `node`는 running 메타 → topk 라벨 순으로 되짚고, 결측 수치는 **0**으로
 *    보정한다(정적과 동일). CPU Time은 **초 반올림**, 두 자원은 **막대**로 낸다.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { PageHead } from "../../components/drilldown/PageHead";
import { SortReset } from "../../components/drilldown/SortReset";
import { useToast } from "../../components/drilldown/useToast";
import { useTableSort } from "../../components/drilldown/useTableSort";
import { Card, Kpi, Pill, Table } from "../../components/drilldown/primitives";
import { usePolling } from "../../hooks/usePolling";
import {
  fetchMainDrilldown, fetchMainPerformance,
  type MainPerformancePointDto,
} from "../../api/aiReactEchartDrilldownMainApi";
import type { TimeSeries } from "../../lib/series";
import { PinChip } from "../../components/drilldown/PinChip";
import type { DrilldownScreenProps } from "../DrilldownDashboard";
import {
  WORKER_MEM_LIMIT_BYTES, WORKER_MEM_LIMIT_GB,
  displayNode, formatBytes, formatInt, formatPercent,
} from "../../lib/format";
import { DrilldownChart } from "./DrilldownChart";
import { MainStatementDetailModal } from "./MainStatementDetailModal";
import { RestartGuideDialog, type RestartGuideInfo } from "./RestartGuideDialog";
import { StatDetail, type StatKind } from "./StatDetail";

const EXPECTED_NODES = ["icspreamh2gpu01", "icspreamh2gpu02", "icspreamh2gpu03"];

/** 스트립에서 고를 수 있는 지표 (X7-b — 라디오). */
type MetricLabel = "CPU Usage" | "GPU Usage" | "RAM Usage" | "Disk I/O";

/**
 * Kill(X6) 낙관적 억제 시간 — kill 반영(tick ≤1s) + scrape(5s) + 폴링 간격을 덮는다.
 * 이보다 짧으면 kill된 행이 한 주기 되살아나고, 만료를 지우지 않으면 재사용된
 * 신원(stmt_id 풀 3종/슬롯)의 **다음 쿼리**까지 잘못 숨긴다 — 둘 다 하면 안 된다.
 */
const KILL_SUPPRESS_MS = 15_000;

interface Kpis { sessions: number; queries: number; cpu: number; gpu: number }
interface Stats { users: number; failed: number; spool: number }
interface QueryRow {
  connectionId: string;
  id: string; user: string; node: string; worker: string; service: string; status: string;
  elapsed: number; prog: number;
  /** `JOI-14H` — exporter가 채번한다(QID 규칙 v2.10). X17에서 Q-Type 열은 빠졌지만
      데이터는 유지한다 — currentPhase 시드·mockSql/플랜 분기·CLE Kill 차단·서비스 파생이 쓴다. */
  qid: string;
  /** `JOIN:3,TXTKEY` — 점수의 근거. 점수만으로는 조치를 못 정한다(문서 §2.3). */
  qidTags: string;
  /** 시작 epoch(초) — Kill 세대 토큰(X6-R1). 결측이면 NaN — Kill이 비활성된다
      (fail-closed, X6-R4: 토큰 없는 kill은 exporter가 400으로 거부). */
  startEpoch: number;
}
interface TopRow {
  id: string; node: string; worker: string; cpuTime: number; gpu: number; scanned: number;
  /** 쿼리가 잡은 메모리(bytes). 한도(`WORKER_MEM_LIMIT_BYTES`) 대비로 보여 준다. */
  memory: number;
}
/** 차트의 마지막 유효 값 — Cluster Performance 아래 스트립. */
interface Latest { cpu: number; gpu: number; ram: number; disk: number }
interface WorkerHealth {
  name: string; healthy: boolean;
  healthStatus: string;
  grEngineActivePercent: number;
  alert: string | null;
}

const ZERO_KPI: Kpis = { sessions: 0, queries: 0, cpu: NaN, gpu: NaN };
const ZERO_STATS: Stats = { users: 0, failed: 0, spool: NaN };

function clock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--";
  const s = Math.max(0, Math.floor(seconds));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export function MainDashboard({ refreshMs, filters, title, pinnedMs, onPickTime, onClearPin }: DrilldownScreenProps) {
  const { rangeSec } = filters;
  const [kpis, setKpis] = useState<Kpis>(ZERO_KPI);
  const [stats, setStats] = useState<Stats>(ZERO_STATS);
  const [queries, setQueries] = useState<QueryRow[]>([]);
  const [top, setTop] = useState<TopRow[]>([]);
  const [health, setHealth] = useState<Map<string, WorkerHealth[]>>(new Map());
  /** 실행 중 문장에 조인되지 않는 락 수(X11) — 재시작 다이얼로그의 orphan 경고. */
  const [orphanLocks, setOrphanLocks] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [toast, showToast] = useToast();
  /** SQL을 펼친 Statement ID. 한 번에 하나만 연다 — 여러 개가 겹치면 읽을 수 없다. */
  const [openSql, setOpenSql] = useState<QueryRow | null>(null);
  /** 재시작 대상 워커. */
  const [restart, setRestart] = useState<string | null>(null);
  /** 내역을 펼친 통계 카드. */
  const [detail, setDetail] = useState<StatKind | null>(null);
  /** kill 접수된 stmt_id → 억제 만료 시각(ms). 폴링이 exporter 반영을 앞지르는
      한 주기 동안 행이 되살아나지 않게 한다 (X6). */
  const killedRef = useRef(new Map<string, number>());
  // ===== 20260908 추가 시작 : Main Dashboard 드릴다운 - 직접 REST 성능 시계열 상태 =====
  const [performanceRows, setPerformanceRows] = useState<MainPerformancePointDto[]>([]);
  const [performanceFailed, setPerformanceFailed] = useState(false);
  // ===== 20260908 추가 끝 : Main Dashboard 드릴다운 - 직접 REST 성능 시계열 상태 =====

  const handleKilled = (id: string) => {
    killedRef.current.set(id, Date.now() + KILL_SUPPRESS_MS);
    // 낙관적 제거 — 다음 폴링을 기다리지 않는다. Top Queries도 같은 문장이다.
    setQueries((cur) => cur.filter((r) => r.id !== id));
    setTop((cur) => cur.filter((r) => r.id !== id));
  };

  // ===== 20260908 추가 시작 : Main Dashboard 드릴다운 - PromQL 제거 / 직접 REST 조회 =====
  const resolveWindow = () => {
    const endMs = filters.endMs ?? pinnedMs ?? Date.now();
    const startMs = endMs - rangeSec * 1000;
    return { startMs, endMs };
  };

  // ===== 20260908 추가 시작 : Main Dashboard - Node/GPU/Worker 필터를 MQuery REST에 전달 =====
  const mainApiFilters = {
    hostname: filters.server || undefined,
    gpuId: filters.gpu || undefined,
    // Worker 셀렉트의 mig 값(0~7)을 DB mig_instance_id 조건으로 사용.
    migInstanceId: filters.mig || undefined,
  };
  // ===== 20260908 추가 끝 : Main Dashboard - Node/GPU/Worker 필터를 MQuery REST에 전달 =====

  usePolling(async (signal) => {
    const { startMs, endMs } = resolveWindow();
    try {
      const data = await fetchMainDrilldown(startMs, endMs, mainApiFilters, signal);
      setKpis({
        sessions: Number(data.activeSessions ?? 0),
        queries: Number(data.runningQueries ?? 0),
        cpu: data.cpuUsagePercent == null ? NaN : Number(data.cpuUsagePercent),
        gpu: data.gpuMemoryUsagePercent == null ? NaN : Number(data.gpuMemoryUsagePercent),
      });
      setStats({
        users: Number(data.connectedUsers ?? 0),
        failed: Number(data.failedQueries1h ?? 0),
        spool: data.diskSpillBytes == null ? NaN : Number(data.diskSpillBytes),
      });
      const killed = killedRef.current;
      const nowMs = Date.now();
      for (const [id, until] of killed) if (until <= nowMs) killed.delete(id);
      const mapped = (data.queries ?? []).filter((r) => !killed.has(r.statementId ?? "")).map((r) => ({
        connectionId: r.connectionId ?? "",
        id: r.statementId ?? "", user: r.user || "--", node: displayNode(r.node ?? "") || "--",
        worker: r.worker || "--", service: r.service || "--", status: r.status || "--",
        elapsed: Number(r.elapsed ?? 0), prog: Number(r.progress ?? 0), qid: r.qid ?? "", qidTags: r.qidTags ?? "",
        startEpoch: r.startEpoch == null ? NaN : Number(r.startEpoch),
      }));
      setQueries(mapped);
      setTop((data.topQueries ?? []).filter((r) => !killed.has(r.statementId ?? "")).map((r) => ({
        id: r.statementId ?? "", node: displayNode(r.node ?? "") || "--", worker: r.worker || "--",
        cpuTime: Number(r.elapsed ?? 0), gpu: Number(r.gpuUtilization ?? 0),
        scanned: Number(r.dataScannedBytes ?? 0), memory: r.memoryBytes == null ? NaN : Number(r.memoryBytes),
      })));
      const byNode = new Map<string, WorkerHealth[]>();
      for (const r of data.workers ?? []) {
        const node = displayNode(r.node ?? "");
        byNode.set(node, [...(byNode.get(node) ?? []), {
          name: r.worker || "--", healthy: Boolean(r.healthy), healthStatus: r.healthStatus || "UNHEALTHY",
          grEngineActivePercent: Number(r.grEngineActivePercent ?? 0), alert: r.alert ?? null,
        }]);
      }
      setHealth(byNode);
      setOrphanLocks(Number(data.orphanLocks ?? 0));
      setFailed(false); setLoaded(true);
    } catch (error) { setFailed(true); throw error; }
  }, pinnedMs === null ? refreshMs : 0, [refreshMs, pinnedMs, filters.endMs, rangeSec, filters.server, filters.gpu, filters.mig]);

  usePolling(async (signal) => {
    const { startMs, endMs } = resolveWindow();
    try {
      setPerformanceRows(await fetchMainPerformance(startMs, endMs, mainApiFilters, signal));
      setPerformanceFailed(false);
    } catch (error) { setPerformanceFailed(true); throw error; }
  }, refreshMs, [refreshMs, filters.endMs, rangeSec, filters.server, filters.gpu, filters.mig]);
  // ===== 20260908 추가 끝 : Main Dashboard 드릴다운 - PromQL 제거 / 직접 REST 조회 =====

  /* 재시작 가이드 입력(X11) — 매 렌더 최신 상태에서 재파생한다(X10F3-01 교훈).
     복구되면(healthy) null → 다이얼로그가 저절로 닫힌다. 실행 문장은 Query
     Overview의 running 목록에서 워커로 역참조한다(qid·세대 토큰 포함). */
  const guideInfo: RestartGuideInfo | null = useMemo(() => {
    if (restart === null) return null;
    for (const [node, list] of health.entries()) {
      const w = list.find((i) => i.name === restart);
      if (w !== undefined && !w.healthy) {
        const query = queries.find((r) => r.worker === restart);
        return {
          worker: restart,
          node, // kill 명령의 실행 위치 표기(X15)
          query: query === undefined ? undefined : {
            id: query.id, qid: query.qid,
            startEpoch: query.startEpoch, prog: query.prog,
          },
          // 알람 이름 → 유형(X14): WorkerDown=crash / WorkerUnresponsive=hang / 부재=stopped
          kind: w.alert === "WorkerDown" ? "crash"
            : w.alert === "WorkerUnresponsive" ? "hang" : "stopped",
          orphanLocks,
        };
      }
    }
    return null;
  }, [restart, health, queries, orphanLocks]);
  useEffect(() => {
    if (restart !== null && guideInfo === null) setRestart(null);
  }, [restart, guideInfo]);

  /* 지표 선택 (기존 UI 유지). */
  const [selectedMetric, setSelectedMetric] = useState<MetricLabel>("CPU Usage");

  // ===== 20260908 추가 시작 : Main Dashboard 드릴다운 - 직접 REST Cluster Performance 변환 =====
  const perfSeries = useMemo<TimeSeries>(() => {
    // ===== 20260908 추가 시작 : Cluster Performance 응답 배열 안전 처리 =====
    const safePerformanceRows: MainPerformancePointDto[] =
      Array.isArray(performanceRows) ? performanceRows : [];
    // ===== 20260908 추가 끝 : Cluster Performance 응답 배열 안전 처리 =====

    const times = [...new Set(safePerformanceRows.map((r) => new Date(r.collectTime).getTime()).filter(Number.isFinite))].sort((a,b)=>a-b);
    const nodes = [...new Set(safePerformanceRows.map((r) => displayNode(r.node ?? "")).filter(Boolean))].sort();
    const valueOf = (r: MainPerformancePointDto, metric: MetricLabel): number | null => {
      const v = metric === "CPU Usage" ? r.cpuUsagePercent
        : metric === "GPU Usage" ? r.gpuUsagePercent
        : metric === "RAM Usage" ? r.ramUsagePercent : r.diskUsagePercent;
      return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
    };
    const avgLine = (metric: MetricLabel, colorKey: string) => ({
      id: metric, label: metric, colorKey, values: times.map((t) => {
        const vals = safePerformanceRows.filter((r) => new Date(r.collectTime).getTime() === t).map((r)=>valueOf(r,metric)).filter((v):v is number=>v!==null);
        return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
      }),
    });
    const lines = [
      avgLine("CPU Usage","blue"), avgLine("GPU Usage","info"), avgLine("RAM Usage","purple"), avgLine("Disk I/O","warning"),
      ...nodes.map((node) => ({ id: `${selectedMetric}/${node}`, label: node, colorKey: `classic-${node}`, values: times.map((t) => {
        const r = safePerformanceRows.find((x) => displayNode(x.node ?? "") === node && new Date(x.collectTime).getTime() === t);
        return r ? valueOf(r, selectedMetric) : null;
      }) })),
    ];
    return { x: times, lines };
  }, [performanceRows, selectedMetric]);
  const perfQ = { focus: perfSeries, context: perfSeries, failed: performanceFailed, zoom: null, setZoom: (_z: unknown) => {} };
  const isNodeLine = (l: { label: string }) => EXPECTED_NODES.includes(l.label);
  const lastOf = (label: string): number => {
    const line = perfSeries.lines.find((l) => l.label === label);
    if (!line) return NaN;
    for (let i=line.values.length-1;i>=0;i-=1) { const v=line.values[i]; if (v!==null && Number.isFinite(v)) return v; }
    return NaN;
  };
  const latest: Latest = { cpu:lastOf("CPU Usage"), gpu:lastOf("GPU Usage"), ram:lastOf("RAM Usage"), disk:lastOf("Disk I/O") };
  // ===== 20260908 추가 끝 : Main Dashboard 드릴다운 - 직접 REST Cluster Performance 변환 =====

  /* 기본 정렬은 원래 화면이 쓰던 것 그대로다 — Query Overview는 경과 시간 내림차순,
     Top Queries는 GPU 사용률 내림차순(topk가 이미 그 순서로 준다). */
  /* 실행 중 최장 쿼리 (X14-f1) — Longest Running 카드의 원천. 폴링 결과에서
     파생하며 고정 시점도 그대로 따른다(queries가 이미 그 시점 값이다). */
  const longest = queries.reduce<QueryRow | null>(
    (best, r) => (best === null || r.elapsed > best.elapsed ? r : best), null);

  const qSort = useTableSort<QueryRow>({
    id: (r) => r.id, user: (r) => r.user, node: (r) => r.node,
    // X17: Worker·Service는 **표시값 기준** 정렬 — In Queue 행의 Worker 공란("")과
    // 실행 전 "compile" 표기가 셀과 같은 순서로 잡히게 한다.
    worker: (r) => r.worker,
    service: (r) => r.service,
    // ===== 20260908 추가 : MQuery Worker Log의 실제 종료상태 기준 정렬 =====
    status: (r) => r.status,
    elapsed: (r) => r.elapsed, prog: (r) => r.prog,
  }, { key: "elapsed", desc: true });
  const topSort = useTableSort<TopRow>({
    id: (r) => r.id, node: (r) => r.node, worker: (r) => r.worker,
    cpuTime: (r) => r.cpuTime, gpu: (r) => r.gpu, memory: (r) => r.memory,
    scanned: (r) => r.scanned,
  }, { key: "gpu", desc: true });

  const pct = (v: number) => (failed || !Number.isFinite(v) ? "--" : formatPercent(v, 0));
  /* 스트립은 **차트 상태만** 본다. KPI 쪽 instant 질의 실패에 끌려가면 차트가 멀쩡한데
     값이 "--"로 지워진다(codex CDX-S3D-03). Disk I/O가 이미 그렇게 동작하고 있었다. */
  const chartPct = (v: number) =>
    (perfQ.failed || !Number.isFinite(v) ? "--" : formatPercent(v, 0));
  const dash = (n: number) => (failed ? "--" : formatInt(n));

  return (
    <div className="sqm-page">
      {/* 나머지 9화면과 같은 자리에 이름을 둔다. 예전엔 이 화면만 본문 제목이
          없어서 툴바에만 이름이 있었다(2026-08-10 통일). */}
      <PageHead title={title} />

      <div className="sqm-grid sqm-grid--kpi4">
        <Kpi icon="🖥" tone="blue" label="ACTIVE SESSIONS" value={dash(kpis.sessions)} />
        <Kpi icon="⚡" tone="blue" label="RUNNING QUERIES" value={dash(kpis.queries)} />
        <Kpi icon="▣" tone="blue" label="CPU USAGE" value={pct(kpis.cpu)} />
        <Kpi icon="▦" tone="green" label="GPU MEMORY USAGE" value={pct(kpis.gpu)}
          alert={!failed && Number.isFinite(kpis.gpu) && kpis.gpu > 0} />
      </div>

      <div className="sqm-grid sqm-grid--wide-left">
        <div>
          {/* 고정 칩은 **고정을 만든 차트의 카드**에 붙는다(인간 지시 2026-08-10).
              전폭 띠였을 때는 화면 제목 위를 가로질러 거슬렸다. */}
          <Card
            title="Cluster Performance"
            aside={<>{`조회기간 ${Math.round(rangeSec / 60)} min`} <PinChip pinnedMs={pinnedMs} onClear={onClearPin} /></>}
            body={false}
          >
            {/* X7-b (인간 확정 2026-08-18): 선택 지표 1개를 노드 3개 누적 면적으로.
                단일 지표라 y2가 필요 없다 — 축 단위는 선택 지표가 정한다.
                key: C3 축·그룹은 생성 시 한 번 굳는다(codex U1-01과 같은 이유) —
                지표가 바뀌면 리마운트로 다시 굳힌다. */}
            <DrilldownChart key={`perf-${selectedMetric}`}
              onPickTime={onPickTime} pinnedMs={pinnedMs}
              series={{ ...perfQ.focus, lines: perfQ.focus.lines.filter(isNodeLine) }}
              context={{ ...perfQ.context, lines: perfQ.context.lines.filter(isNodeLine) }}
              zoom={perfQ.zoom} onZoom={perfQ.setZoom}
              failed={perfQ.failed} ariaLabel="Cluster Performance"
              stacked y2Keys={[]} variant="grafana"
              unit="percent" />
            {/* 현재값 스트립 — 정적 `.summary-strip`. 값은 **클러스터 평균**의 마지막
                유효 값이다(차트의 노드별 값과 다른 게 설계다). 버튼은 라디오 — 누른
                지표가 차트에 노드 누적으로 실린다 (X7-b). */}
            <div className="sqm-summary">
              {([
                { label: "CPU Usage", color: "var(--info)", text: chartPct(latest.cpu) },
                { label: "GPU Usage", color: "var(--green)", text: chartPct(latest.gpu) },
                { label: "RAM Usage", color: "var(--purple)", text: chartPct(latest.ram) },
                { label: "Disk I/O", color: "var(--orange)",
                  text: chartPct(latest.disk) },
              ] as const).map((it) => (
                <button
                  key={it.label} type="button"
                  className={`sqm-summary__toggle${selectedMetric === it.label ? "" : " is-off"}`}
                  aria-pressed={selectedMetric === it.label}
                  title="이 지표를 노드별 누적으로 표시"
                  onClick={() => setSelectedMetric(it.label)}
                >
                  <i style={{ background: it.color }} />{it.label}:{" "}
                  <b style={{ color: it.color }}>{it.text}</b>
                </button>
              ))}
            </div>
          </Card>

          <Card className="sqm-mt" title="Session Statistics">
            <div className="sqm-statboxes">
              <StatBox tone="blue" label="Connected Users" value={dash(stats.users)}
                onClick={() => setDetail("users")} />
              <StatBox tone="red" label="Failed Queries (1h)" value={dash(stats.failed)}
                onClick={() => setDetail("failed")} />
              {/* X14-f1(인간 지시): Queued Queries 카드 삭제 — 실제 시스템은
                  1초 이상 대기하는 쿼리를 정지·에러 처리해 큐 표시가 의미
                  없다. 자리는 Longest Running(실행 중 최장 쿼리 — 인간 확정):
                  값은 경과, 클릭은 그 쿼리의 팝업(X6 재사용, 내역 모달 아님). */}
              <StatBox tone="orange" label="Longest Running"
                value={longest ? clock(longest.elapsed) : "--"}
                onClick={longest ? () => setOpenSql(longest) : undefined} />
              {/* 캐시 적중률 대신 Disk Spill — 메모리가 모자라 디스크로 샌 양이다.
                  0이 정상이고 커지면 워커 메모리 한도를 다시 볼 신호다. */}
              <StatBox tone="green" label="Disk Spill"
                value={failed || !Number.isFinite(stats.spool) ? "--" : formatBytes(stats.spool)}
                onClick={() => setDetail("spool")} />
            </div>
            <p className="sqm-dim" style={{ fontSize: 11, marginTop: 10 }}>
              카드를 누르면 내역이 열립니다. 실패 쿼리는 최근 12건까지 보관합니다 —
              그보다 오래된 것은 보관 DB 소관입니다.
            </p>
          </Card>
        </div>

        {/* 높이를 왼쪽 열에서 빌린다(`.sqm-fillcell`) — 표가 길어도 카드는 안 늘어난다. */}
        <div className="sqm-fillcell">
        <Card title="Query Overview" body={false} aside={<SortReset sort={qSort} />}>
          {/* 표가 길어도 카드가 세로로 늘어나지 않는다 — 머리글은 스크롤해도 남는다. */}
          <div className="sqm-scrollbox">
          <Table
            head={[qSort.th("id", "Statement ID"),
              qSort.th("user", "User"), qSort.th("node", "Node"),
              qSort.th("worker", "Worker"), qSort.th("service", "Service"),
              qSort.th("status", "Status"),
              qSort.th("elapsed", "Elapsed"), qSort.th("prog", "Progress")]}
            loading={!loaded && !failed}
            error={failed ? "쿼리 조회 실패 — 데이터 소스에 연결할 수 없습니다." : undefined}
            empty={queries.length === 0 ? "실행 중인 쿼리 없음" : undefined}
          >
            {qSort.apply(queries).map((r) => {
              return (
              <tr key={`${r.id}/${r.worker}`}>
                <td>
                  {/* 누르면 SQL을 펼친다. 메트릭에는 원문이 없어 목업 문장을 만든다 —
                      라벨에 SQL을 실으면 시계열 카디널리티가 폭발한다. */}
                  <button
                    type="button" className="sqm-linkbtn"
                    aria-expanded={openSql?.id === r.id}
                    onClick={() => setOpenSql((cur) => (cur?.id === r.id ? null : r))}
                  >
                    {r.id}
                  </button>
                </td>
                <td>{r.user}</td>
                <td>{r.node}</td>
                <td>{r.worker}</td>
                <td>{r.service}</td>
                {/* ===== 20260908 추가 : Worker Log MQuery의 실제 query_termination_status 표시 ===== */}
                <td><Pill tone={/fail|error|kill|terminated/i.test(r.status) ? "red" : "green"}>{r.status}</Pill></td>
                <td>{clock(r.elapsed)}</td>
                <td>
                  <div className="sqm-barcell">
                    <div className="sqm-barcell__track">
                      <div className="sqm-barcell__fill"
                        style={{ width: `${Math.round(r.prog * 100)}%`, background: "var(--info)" }} />
                    </div>
                    <span className="sqm-barcell__text">{Math.round(r.prog * 100)}%</span>
                  </div>
                </td>
              </tr>
              );
            })}
          </Table>
          </div>
        </Card>
        </div>
      </div>

      {/* 아래 두 카드는 한 행 2열이다 — 각각 전폭이면 Node Health가 가로를 다 먹고
          Top Queries가 화면 밖으로 밀렸다(인간 지시 2026-08-10). */}
      <div className="sqm-grid sqm-grid--half sqm-mt">
      <Card title="Node Health">
        <div className="sqm-nodehealth">
          {(filters.server ? [displayNode(filters.server)] : EXPECTED_NODES).map((node) => {
            const items = health.get(node) ?? [];
            const healthy = items.filter((i) => i.healthy).length;
            const percent = items.length ? Math.round((healthy / items.length) * 100) : 0;
            const tone = percent >= 80 ? "green" : percent >= 50 ? "yellow" : "red";
            return (
              <section key={node} className="sqm-nodehealth__col">
                <div className="sqm-nodehealth__sum">
                  <b>{node}</b>
                  <strong style={{ color: `var(--${tone === "green" ? "green" : tone === "yellow" ? "yellow" : "red"})` }}>
                    {percent}%
                  </strong>
                </div>
                <div className="sqm-nodehealth__workers">
                  {items.length === 0 ? (
                    // ===== 20260908 추가 시작 : Worker 무데이터 시에도 4칸 contract 구조 유지 =====
                    <div className="sqm-workerhealth">
                      <span className="sqm-workerhealth__icon is-bad">-</span>
                      <b>--</b>
                      <span className="sqm-dim">Worker 데이터 없음</span>
                      <button
                        type="button"
                        className="sqm-btn sqm-btn--tiny"
                        disabled
                        title="Worker 데이터 없음"
                      >
                        Recovery
                      </button>
                    </div>
                    // ===== 20260908 추가 끝 : Worker 무데이터 시에도 4칸 contract 구조 유지 =====
                  ) : items.map((i) => (
                    <div key={i.name} className="sqm-workerhealth">
                      <span className={`sqm-workerhealth__icon ${i.healthy ? "is-ok" : "is-bad"}`}>
                        {i.healthy ? "✓" : i.healthStatus === "NOT_HEALTHY" ? "!" : "✕"}
                      </span>
                      <b>{i.name}</b>
                      {/* ===== 20260908 추가 : gr_engine_active_percent 기준 3단계 Health ===== */}
                      <span className={i.healthy ? "sqm-ok" : "sqm-bad"}>
                        {i.healthStatus === "HEALTHY" ? "Healthy" : i.healthStatus === "NOT_HEALTHY" ? "Not Healthy" : "Unhealthy"}
                        {` (${Math.round(i.grEngineActivePercent)}%)`}
                      </span>
                      {/* Healthy는 비활성 — exporter가 다운 워커만 받는다(404
                          fail-closed, X9-f3). 고정 시점(pin)도 비활성 — 과거
                          스냅숏의 Unhealthy로 현재 시스템에 명령을 보내면 안
                          된다(codex X9F4-01). 버튼 자체는 유지해 행 4칸 계약을
                          지킨다(drilldown.contract). */}
                      <button
                        type="button" className="sqm-btn sqm-btn--tiny"
                        disabled
                        title="MQuery GPU/MIG Health 지표 — Recovery 명령 대상 아님"
                      >
                        Recovery
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </Card>

      <Card title="Top Queries by Resource Usage" body={false}
        aside={<SortReset sort={topSort} />}>
        <Table
          head={[topSort.th("id", "Statement ID"), topSort.th("node", "Node"),
            topSort.th("worker", "Worker"), topSort.th("cpuTime", "CPU Time*"),
            topSort.th("gpu", "GPU Utilization"),
            topSort.th("memory", "RAM Memory Utilization"),
            topSort.th("scanned", "Data Scanned")]}
          loading={!loaded && !failed}
          error={failed ? "Top Query 조회 실패 — 데이터 소스에 연결할 수 없습니다." : undefined}
          empty={top.length === 0 ? "실행 중인 쿼리 없음" : undefined}
        >
          {topSort.apply(top).map((r) => (
            <tr key={`top-${r.id}`}>
              <td><b>{r.id}</b></td>
              <td>{r.node}</td>
              <td>{r.worker}</td>
              {/* CPU Time은 초 반올림 — 정적과 같다(HH:MM:SS가 아니다). */}
              <td>{Math.round(r.cpuTime)}s</td>
              <td>
                <div className="sqm-barcell">
                  <div className="sqm-barcell__track">
                    <div className="sqm-barcell__fill"
                      style={{ width: `${Math.min(100, Math.max(0, Math.round(r.gpu)))}%`,
                        background: "var(--green)" }} />
                  </div>
                  <span className="sqm-barcell__text">
                    {Number.isFinite(r.gpu) ? `${Math.round(r.gpu)}%` : "--"}
                  </span>
                </div>
              </td>
              <td><MemCell bytes={r.memory} /></td>
              <td>{formatBytes(r.scanned)}</td>
            </tr>
          ))}
        </Table>
      </Card>
      </div>

      {/* ===== 20260908 추가 시작 : Statement ID 클릭 -> Worker Log 쿼리문/실행계획 ===== */}
      {openSql !== null && (
        <MainStatementDetailModal
          connectionId={openSql.connectionId}
          statementId={openSql.id}
          onClose={() => setOpenSql(null)}
        />
      )}
      {/* ===== 20260908 추가 끝 : Statement ID 클릭 -> Worker Log 쿼리문/실행계획 ===== */}

      {/* X9-f4 → X15: 유형별 Recovery 다이얼로그(hang=정지/kill 병렬·crash=자동
          기동 서사) — Worker Monitoring과 같은 다이얼로그(드리프트 방지). */}
      {guideInfo !== null && (
        <RestartGuideDialog
          info={guideInfo}
          onClose={() => setRestart(null)}
          onKilled={handleKilled}
          showToast={showToast}
        />
      )}
      {detail !== null && (
        <StatDetail kind={detail} atMs={pinnedMs} onClose={() => setDetail(null)} />
      )}
      {toast}
    </div>
  );
}

/**
 * 쿼리 메모리 사용률 — 분모는 워커당 한도 `limitQueryMemoryGB = 314GB`.
 *
 * 한도를 넘으면 빨강이다. 목업 값으로는 안 넘지만 현장 설정이 다를 수 있어
 * 눈에 바로 띄게 둔다.
 */
function MemCell({ bytes }: { bytes: number }) {
  const limit = `한도 ${WORKER_MEM_LIMIT_GB}GB/워커`;
  if (!Number.isFinite(bytes)) return <span className="sqm-dim" title={limit}>--</span>;

  const percent = (bytes / WORKER_MEM_LIMIT_BYTES) * 100;
  const over = percent > 100;
  return (
    <div className="sqm-barcell" title={limit}>
      <div className="sqm-barcell__track">
        <div
          className="sqm-barcell__fill"
          style={{
            width: `${Math.min(100, Math.max(0, percent))}%`,
            background: over ? "var(--red)" : "var(--purple)",
          }}
        />
      </div>
      <span className="sqm-barcell__text" style={over ? { color: "var(--red)" } : undefined}>
        {percent.toFixed(1)}% ({formatBytes(bytes)})
      </span>
    </div>
  );
}

function StatBox({ tone, label, value, onClick }: {
  tone: "blue" | "red" | "orange" | "green";
  label: string;
  value: string;
  /** 누르면 내역을 연다. 없으면 그냥 표시용이다. */
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="sqm-statbox__lbl">{label}</div>
      <div className="sqm-statbox__val">{value}</div>
    </>
  );
  if (!onClick) return <div className={`sqm-statbox sqm-statbox--${tone}`}>{body}</div>;
  /* 누를 수 있으면 button이어야 한다 — div에 onClick만 달면 키보드로 도달할 수 없다. */
  return (
    <button
      type="button"
      className={`sqm-statbox sqm-statbox--${tone} sqm-statbox--clickable`}
      onClick={onClick}
    >
      {body}
    </button>
  );
}
