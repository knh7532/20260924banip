/**
 * Query Analytics (`#/drilldown/query`) — 정적 `res/sqream/mockup/query-analytics.html`.
 *
 * 정적본에서 그대로 지키는 것:
 *  - Heavy 집계는 **stmt 단위**다(`count(count by (stmt_id)(... > 80))`) — worker 시리즈
 *    수를 세면 한 쿼리가 여러 번 잡힌다(정적본 CDX-0.8-02).
 *  - 조인은 `stmt_id` 기준. 락은 statement 단위 라벨이라 존재 여부만 본다.
 *  - Slow Query는 **라이브 목록**이다. 완료 이력은 Prometheus 카디널리티상 보존하지
 *    않는다(보관 DB 소관) — 추세는 카운터로만 본다.
 *  - EXPLAIN은 **모달**로 목업 실행계획을 보여 준다(M3 재현). 실제 계획은 receiver가
 *    SQream `explain`을 조회해 제공한다 — 여기는 상태를 바꾸지 않는다.
 *  - Slow 표는 락 표시(🔒)와 지속시간 임계(≥180s 빨강, 그 밖 노랑)를 유지한다.
 */
import { useState } from "react";

import { promQuery, scalarOf } from "../../api/prom";
import { queryAnalytics } from "../../api/queries";
import { Card, Kpi, Pill, Table } from "../../components/drilldown/primitives";
import { usePolling } from "../../hooks/usePolling";
import { SortReset } from "../../components/drilldown/SortReset";
import { useTableSort } from "../../components/drilldown/useTableSort";
import { PinChip } from "../../components/drilldown/PinChip";
import type { DrilldownScreenProps } from "../DrilldownDashboard";
import { displayNode, formatBytes, formatInt } from "../../lib/format";
import { DrilldownChart } from "./DrilldownChart";
import { explainPlan } from "./mockQueryDetail";
import { useFocusContext } from "./useFocusContext";
import { PageHead } from "../../components/drilldown/PageHead";

const GiB = 1024 ** 3;

// 목업 실행계획(explainPlan)은 X6에서 mockQueryDetail.ts로 옮겼다 — Query 상세
// 팝업(플랜 탭)과 공유한다. qid 없이 부르면 옮기기 전과 같은 출력이다.

/** Slow 표의 지속시간 색 — 정적 `cls` 규칙과 같다. */
function slowTone(sec: number | undefined): "red" | "yellow" {
  return sec !== undefined && Number.isFinite(sec) && sec >= 180 ? "red" : "yellow";
}

interface Query {
  id: string; user: string; node: string; worker: string;
  dur?: number; cpu?: number; gpu?: number; mem?: number; scan?: number; locked: boolean;
}
interface Kpis { running: number; avgDur: number; heavy: number; scanned: number; slow5m: number }
const ZERO: Kpis = { running: 0, avgDur: NaN, heavy: 0, scanned: 0, slow5m: 0 };

function clock(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "--";
  const s = Math.max(0, Math.floor(seconds));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function Bar({ value, color }: { value?: number; color: string }) {
  const ok = value !== undefined && Number.isFinite(value);
  const pct = ok ? Math.min(100, Math.max(0, Math.round(value))) : 0;
  return (
    <div className="sqm-barcell">
      <div className="sqm-barcell__track">
        <div className="sqm-barcell__fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="sqm-barcell__text">{ok ? `${Math.round(value)}%` : "--"}</span>
    </div>
  );
}

export function QueryAnalytics({ refreshMs, filters, title, pinnedMs, onPickTime, onClearPin }: DrilldownScreenProps) {
  const { rangeSec } = filters;
  const [kpis, setKpis] = useState<Kpis>(ZERO);
  const [rows, setRows] = useState<Query[]>([]);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  /** EXPLAIN 모달 — 열려 있으면 대상 쿼리. */
  const [explain, setExplain] = useState<Query | null>(null);

  usePolling(async (signal) => {
    // 고정 시점이 있으면 그 시각의 값을 묻는다(instant 전용).
    const at = pinnedMs ?? undefined;
    const q = queryAnalytics();
    try {
      const [running, avgDur, heavy, scanned, slow5m,
        statements, durations, cpu, gpu, mem, scan, locks] = await Promise.all([
        promQuery(q.running, signal, at), promQuery(q.avgDuration, signal, at),
        promQuery(q.heavyCount, signal, at), promQuery(q.scanned, signal, at),
        promQuery(q.slow5m, signal, at),
        promQuery(q.statements, signal, at), promQuery(q.duration, signal, at),
        promQuery(q.cpu, signal, at), promQuery(q.gpu, signal, at), promQuery(q.memory, signal, at),
        promQuery(q.scannedBytes, signal, at), promQuery(q.locks, signal, at),
      ]);
      setKpis({
        running: scalarOf(running), avgDur: scalarOf(avgDur, NaN),
        heavy: scalarOf(heavy), scanned: scalarOf(scanned), slow5m: scalarOf(slow5m),
      });

      const byStmt = (series: typeof durations) => {
        const map = new Map<string, number>();
        for (const r of series) {
          const v = Number(r.value?.[1]);
          if (Number.isFinite(v)) map.set(r.metric.stmt_id ?? "", v);
        }
        return map;
      };
      const durMap = byStmt(durations);
      const cpuMap = byStmt(cpu);
      const gpuMap = byStmt(gpu);
      const memMap = byStmt(mem);
      const scanMap = byStmt(scan);
      const locked = new Set(locks.map((r) => r.metric.stmt_id ?? ""));

      setRows(statements
        .map((r) => {
          const id = r.metric.stmt_id ?? "";
          return {
            id,
            user: r.metric.sqream_user ?? "",
            node: displayNode(r.metric.node ?? ""),
            worker: r.metric.worker ?? "--",
            dur: durMap.get(id), cpu: cpuMap.get(id), gpu: gpuMap.get(id),
            mem: memMap.get(id), scan: scanMap.get(id),
            locked: locked.has(id),
          };
        })
        .sort((a, b) =>
          (Number.isFinite(b.gpu) ? (b.gpu as number) : -Infinity)
          - (Number.isFinite(a.gpu) ? (a.gpu as number) : -Infinity)));
      setFailed(false);
      setLoaded(true);
    } catch (error) {
      setFailed(true);
      throw error;
    }
  }, pinnedMs === null ? refreshMs : 0, [refreshMs, pinnedMs]);

  const q = queryAnalytics();
  const usageQ = useFocusContext([
    { expr: q.avgCpu, label: "CPU", colorKey: "blue" },
    { expr: q.avgGpu, label: "GPU", colorKey: "info" },
    { expr: q.running, label: "Running Queries", colorKey: "warning" },
  ], rangeSec, refreshMs);
  const lockSeriesQ = useFocusContext([
    { expr: q.maxLock, label: "Longest Lock", colorKey: "warning" },
  ], rangeSec, refreshMs);

  const slow = rows
    .filter((r) => r.dur !== undefined && Number.isFinite(r.dur) && r.dur > 60)
    .sort((a, b) => (b.dur as number) - (a.dur as number));
  const dash = (n: number, fmt: (v: number) => string) => (failed ? "--" : fmt(n));

  const runSort = useTableSort<Query>({
    id: (r) => r.id, user: (r) => r.user, node: (r) => r.node, worker: (r) => r.worker,
    dur: (r) => r.dur, cpu: (r) => r.cpu, gpu: (r) => r.gpu, mem: (r) => r.mem,
    scan: (r) => r.scan,
  }, { key: "dur", desc: true });
  const slowSort = useTableSort<Query>({
    id: (r) => r.id, user: (r) => r.user, node: (r) => r.node, worker: (r) => r.worker,
    dur: (r) => r.dur, gpu: (r) => r.gpu,
  }, { key: "dur", desc: true });

  return (
    <div className="sqm-page">
      <PageHead title={title}>
        <a className="sqm-btn" href="/grafana/d/sqm-query-analytics/" target="_blank" rel="noopener">
          Grafana 원본으로 열기 ↗
        </a>
      </PageHead>

      <div className="sqm-grid sqm-grid--kpi4">
        <Kpi icon="⚡" tone="blue" label="RUNNING QUERIES" value={dash(kpis.running, formatInt)} />
        <Kpi icon="⏱" tone="blue" label="AVG DURATION"
          value={failed || !Number.isFinite(kpis.avgDur) ? "--" : `${kpis.avgDur.toFixed(1)}s`} />
        <Kpi icon="🔥" tone="orange" label="HEAVY QUERIES (GPU > 80%)"
          value={dash(kpis.heavy, formatInt)} alert={!failed && kpis.heavy > 0} />
        <Kpi icon="▦" tone="green" label="DATA SCANNED (RUNNING)"
          value={dash(kpis.scanned, formatBytes)} />
      </div>

      <div className="sqm-grid sqm-grid--two">
        <Card title="Query Resource Usage" body={false} aside={<PinChip pinnedMs={pinnedMs} onClear={onClearPin} />}>
          {/* Running Queries는 건수라 %와 축을 나눈다 — 정적본의 axis:"right"와 같다. */}
          <DrilldownChart onPickTime={onPickTime} pinnedMs={pinnedMs} series={usageQ.focus} failed={usageQ.failed} ariaLabel="Query Resource Usage"
            context={usageQ.context} zoom={usageQ.zoom} onZoom={usageQ.setZoom}
            y2Keys={["Running Queries"]} unit="percent" y2Unit="number" />
        </Card>
        <Card title="Lock Held — Long Query 락 감시" body={false}>
          <DrilldownChart onPickTime={onPickTime} pinnedMs={pinnedMs} series={lockSeriesQ.focus} failed={lockSeriesQ.failed} ariaLabel="Lock Held"
            context={lockSeriesQ.context} zoom={lockSeriesQ.zoom} onZoom={lockSeriesQ.setZoom}
            unit="seconds" />
        </Card>
      </div>

      <Card
        className="sqm-mt"
        title="Running Queries"
        aside={<>{failed ? "조회 실패" : `${rows.length} running`} <SortReset sort={runSort} /></>}
        body={false}
      >
        <Table
          head={[runSort.th("id", "Statement ID"), runSort.th("user", "User"),
            runSort.th("node", "Node"), runSort.th("worker", "Worker"), "Status",
            runSort.th("dur", "Duration"), runSort.th("cpu", "CPU"),
            runSort.th("gpu", "GPU"), runSort.th("mem", "Memory"),
            runSort.th("scan", "Data Scanned"), ""]}
          loading={!loaded && !failed}
          error={failed ? "쿼리 조회 실패 — Spring API에 연결할 수 없습니다." : undefined}
          empty={rows.length === 0 ? "실행 중인 쿼리 없음" : undefined}
        >
          {runSort.apply(rows).map((r) => {
            const heavy = r.gpu !== undefined && Number.isFinite(r.gpu) && r.gpu > 80;
            const long = r.dur !== undefined && Number.isFinite(r.dur) && r.dur > 60;
            return (
              <tr key={`${r.id}/${r.worker}`} className={heavy ? "sqm-row--heavy" : undefined}>
                <td><b>{r.id}</b></td>
                <td>{r.user}</td>
                <td>{r.node}</td>
                <td>{r.worker}</td>
                <td>
                  <Pill tone={long ? "yellow" : "green"}>{long ? "Long Query" : "Running"}</Pill>
                  {r.locked && " 🔒"}
                </td>
                <td>{clock(r.dur)}</td>
                <td><Bar value={r.cpu} color="var(--blue)" /></td>
                <td><Bar value={r.gpu} color="var(--green)" /></td>
                <td>{r.mem !== undefined && Number.isFinite(r.mem) ? `${(r.mem / GiB).toFixed(1)} GB` : "--"}</td>
                <td>{r.scan !== undefined && Number.isFinite(r.scan) ? formatBytes(r.scan) : "--"}</td>
                <td style={{ textAlign: "right" }}>
                  <button type="button" className="sqm-btn" onClick={() => setExplain(r)}>
                    EXPLAIN
                  </button>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card
        className="sqm-mt"
        title="Slow Queries — running > 60s"
        aside={<>
          {failed ? "조회 실패" : `${slow.length} running > 60s · 최근 5분 ${formatInt(kpis.slow5m)}건`}
          {" "}<SortReset sort={slowSort} />
        </>}
        body={false}
      >
        <Table
          head={[slowSort.th("id", "Statement ID"), slowSort.th("user", "User"),
            slowSort.th("node", "Node"), slowSort.th("worker", "Worker"),
            slowSort.th("dur", "Duration"), slowSort.th("gpu", "GPU")]}
          loading={!loaded && !failed}
          error={failed ? "느린 쿼리 조회 실패 — 데이터 소스에 연결할 수 없습니다." : undefined}
          empty={slow.length === 0 ? "60초를 넘긴 쿼리 없음" : undefined}
        >
          {slowSort.apply(slow).map((r) => (
            <tr key={`slow-${r.id}/${r.worker}`}>
              <td><b>{r.id}</b>{r.locked && " 🔒"}</td>
              <td>{r.user}</td>
              <td>{r.node}</td>
              <td>{r.worker}</td>
              <td><Pill tone={slowTone(r.dur)}>{clock(r.dur)}</Pill></td>
              <td>{r.gpu !== undefined && Number.isFinite(r.gpu) ? `${Math.round(r.gpu)}%` : "--"}</td>
            </tr>
          ))}
        </Table>
      </Card>
      {explain !== null && (
        <div className="sqm-modal-backdrop" role="dialog" aria-modal="true"
          aria-label={`EXPLAIN Statement ${explain.id}`}>
          <div className="sqm-modal sqm-modal--wide">
            <h3>
              📋 Execution Plan <span style={{ color: "var(--accent)" }}>Statement {explain.id}</span>
            </h3>
            <pre className="sqm-plan">{explainPlan(explain)}</pre>
            <div className="sqm-modal__actions">
              <button type="button" className="sqm-btn" onClick={() => setExplain(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
