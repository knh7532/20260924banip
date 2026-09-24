/**
 * Log Monitoring (`#/drilldown/logs`) — 정적 `res/sqream/mockup/logs.html`의 React 이관.
 *
 * KPI 4종과 레벨 분포 차트는 **실데이터**(`sqm_log_entries_total`, Counter)에서 온다.
 * 로그 **원문 표는 고정 목업**이다 — 로그 저장소는 이 계약 밖이고(실제 시스템은 F4 담당),
 * 정적 화면도 같은 12건을 박아 두고 있다. 필터·검색·CSV 내보내기는 그 12건에 대해 동작한다.
 */
import { useMemo, useState } from "react";

import { promQuery, scalarOf } from "../../api/prom";
import { logDistribution, logMonitoring } from "../../api/queries";
import { Card, Kpi, Pager, Pill, Table, type PillTone } from "../../components/drilldown/primitives";
import { useToast } from "../../components/drilldown/useToast";
import { usePolling } from "../../hooks/usePolling";
import { SortReset } from "../../components/drilldown/SortReset";
import { useTableSort } from "../../components/drilldown/useTableSort";
import { PinChip } from "../../components/drilldown/PinChip";
import type { DrilldownScreenProps } from "../DrilldownDashboard";
import { formatInt } from "../../lib/format";
import { DrilldownChart } from "./DrilldownChart";
import { useFocusContext } from "./useFocusContext";
import { PageHead } from "../../components/drilldown/PageHead";

/** 고정 목업 로그 (원본 제안서 화면의 메시지 재현) — 실제로는 로그 저장소 담당.
    6번째 원소는 SQream 로그 message type 번호 — 공식 Logging 가이드(docs.sqream.com,
    operational_guides/logging)의 번호 체계를 메시지 내용에 맞춰 배정했다(2026-08-25). */
const MOCK_LOGS: ReadonlyArray<readonly [string, string, string, string, string, number]> = [
  ["2026-08-07 21:54:21", "icspreamh2gpu03", "sqream302", "Error", "Failed to connect to the external data source.", 500],
  ["2026-08-07 20:42:51", "icspreamh2gpu01", "sqream111", "Warning", "Query QID1839 failed due to insufficient GPU memory.", 21],
  ["2026-08-07 18:37:39", "icspreamh2gpu02", "sqream221", "Warning", "Disk I/O rate is reaching high threshold.", 30],
  ["2026-08-07 17:10:22", "icspreamh2gpu02", "sqream212", "Warning", "Slow query detected QID1823 (03:05 elapsed time).", 200],
  ["2026-08-07 15:08:11", "icspreamh2gpu02", "sqream201", "Info", "New user analyst01 connected from IP 192.168.1.23.", 100],
  ["2026-08-07 14:22:59", "icspreamh2gpu03", "sqream312", "Info", "Index rebuilt on table sales_data, public schema.", 10],
  ["2026-08-07 13:22:49", "icspreamh2gpu01", "sqream122", "Info", "Data loaded successfully from source data.csv (245 MB processed).", 10],
  ["2026-08-07 12:32:58", "icspreamh2gpu03", "sqream321", "Info", "Background job completed. Query ID QID1772 archived 14 TB.", 10],
  ["2026-08-07 11:16:29", "icspreamh2gpu01", "sqream131", "Info", "Metadata backup completed Success.", 1002],
  ["2026-08-07 10:44:02", "icspreamh2gpu01", "sqream102", "Warning", "Long Query detected stmt_id:1823.", 200],
  ["2026-08-07 09:31:47", "icspreamh2gpu02", "sqream232", "Info", "Worker sqream232 Active.", 1000],
  ["2026-08-07 08:05:13", "icspreamh2gpu01", "sqream101", "Info", "Rechunk completed on table web_traffic (chunks 106K -> 90K).", 10],
];

/** message type 번호 → 공식 가이드 서술 (셀 title 툴팁 — 표기는 번호만). */
const TYPE_DESC: Record<number, string> = {
  10: "Statement execution completed",
  21: "Execution error",
  30: "Size of data read from disk",
  100: "Session start - client IP",
  200: "SHOW_NODE_INFO periodic output",
  500: "Exception occurred in a statement",
  1000: "Worker startup message",
  1002: "Metadata",
};

const LEVEL_TONE: Record<string, PillTone> = { Error: "red", Warning: "yellow", Info: "green" };
const NODES_IN_LOGS = [...new Set(MOCK_LOGS.map((r) => r[1]))].sort();

interface Kpis { total: number; errors: number; warnings: number; info: number }
const ZERO: Kpis = { total: 0, errors: 0, warnings: 0, info: 0 };

export function LogMonitoring({ refreshMs, filters, title, pinnedMs, onPickTime, onClearPin }: DrilldownScreenProps) {
  const { rangeSec } = filters;
  const [kpis, setKpis] = useState<Kpis>(ZERO);
  const [failed, setFailed] = useState(false);
  const [toast, showToast] = useToast();

  const [level, setLevel] = useState("");
  const [node, setNode] = useState("");
  const [worker, setWorker] = useState("");
  const [search, setSearch] = useState("");

  usePolling(async (signal) => {
    // 고정 시점이 있으면 그 시각의 값을 묻는다(instant 전용).
    const at = pinnedMs ?? undefined;
    const q = logMonitoring();
    try {
      const [total, errors, warnings, info] = await Promise.all([
        promQuery(q.total24h, signal, at),
        promQuery(q.errors24h, signal, at),
        promQuery(q.warnings24h, signal, at),
        promQuery(q.info24h, signal, at),
      ]);
      setKpis({
        total: scalarOf(total), errors: scalarOf(errors),
        warnings: scalarOf(warnings), info: scalarOf(info),
      });
      setFailed(false);
    } catch (error) {
      setKpis(ZERO);
      setFailed(true);
      throw error;
    }
  }, pinnedMs === null ? refreshMs : 0, [refreshMs, pinnedMs]);

  const dist = logDistribution();
  const seriesQ = useFocusContext([
    { expr: dist.info, label: "Info", colorKey: "info" },
    { expr: dist.warning, label: "Warning", colorKey: "warning" },
    { expr: dist.error, label: "Error", colorKey: "error" },
  ], rangeSec, refreshMs);

  /* 워커 옵션은 선택한 노드에 있는 것만 — 정적 `syncWorkerFilter`와 같다. */
  const workerOptions = useMemo(
    () => [...new Set(MOCK_LOGS.filter((r) => !node || r[1] === node).map((r) => r[2]))].sort(),
    [node]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return MOCK_LOGS.filter(([, n, w, lv, msg]) =>
      (!level || lv === level)
      && (!node || n === node)
      && (!worker || w === worker)
      && (!needle || (n + w + msg).toLowerCase().includes(needle)));
  }, [level, node, worker, search]);

  /* 로그 행은 `[ts, node, worker, level, message]` 튜플이다 — 인덱스로 뽑는다.
     기본은 원본 순서(최신 우선)이고 초기화하면 그리로 돌아온다. */
  const sort = useTableSort<(typeof MOCK_LOGS)[number]>({
    ts: (r) => r[0], node: (r) => r[1], worker: (r) => r[2], level: (r) => r[3],
    type: (r) => r[5],
  });

  const clearFilters = () => {
    setLevel(""); setNode(""); setWorker(""); setSearch("");
  };

  const exportCsv = () => {
    const csv = "Timestamp,Node,Worker,Level,Message\n"
      + MOCK_LOGS.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "sqream-logs.csv";
    a.click();
    URL.revokeObjectURL(url);
    showToast(`📄 로그 ${MOCK_LOGS.length}건을 CSV로 내보냈습니다.`);
  };

  const dash = (n: number) => (failed ? "--" : formatInt(n));

  return (
    <div className="sqm-page">
      <PageHead title={title} />

      <div className="sqm-grid sqm-grid--kpi4">
        <Kpi icon="📄" tone="blue" label="TOTAL LOG ENTRIES (24h)" value={dash(kpis.total)} />
        <Kpi icon="⚠" tone="red" label="ERRORS" value={dash(kpis.errors)} />
        <Kpi icon="⚠" tone="orange" label="WARNINGS" value={dash(kpis.warnings)}
          alert={!failed && kpis.warnings > 0} />
        <Kpi icon="ℹ" tone="green" label="INFO" value={dash(kpis.info)} />
      </div>

      <Card
        title="Log Level Distribution"
        aside={<>{`Last ${Math.round(rangeSec / 60)} min`} <PinChip pinnedMs={pinnedMs} onClear={onClearPin} /></>}
        body={false}
      >
        <DrilldownChart onPickTime={onPickTime} pinnedMs={pinnedMs} series={seriesQ.focus} failed={seriesQ.failed}
          context={seriesQ.context} zoom={seriesQ.zoom} onZoom={seriesQ.setZoom} ariaLabel="Log Level Distribution" />
      </Card>

      <Card
        className="sqm-mt"
        title="Recent Logs"
        aside={`Showing ${filtered.length} of 2,481 entries`}
        body={false}
      >
        <div className="sqm-card__body">
          <div className="sqm-filters">
            <select aria-label="레벨" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">Error, Warning, Info</option>
              <option>Error</option><option>Warning</option><option>Info</option>
            </select>
            <select
              aria-label="노드"
              value={node}
              onChange={(e) => {
                setNode(e.target.value);
                setWorker(""); // 노드가 바뀌면 워커 선택은 무효 — 정적과 같다
              }}
            >
              <option value="">All Nodes</option>
              {NODES_IN_LOGS.map((n) => <option key={n}>{n}</option>)}
            </select>
            <select aria-label="워커" value={worker} onChange={(e) => setWorker(e.target.value)}>
              <option value="">All Workers</option>
              {workerOptions.map((w) => <option key={w}>{w}</option>)}
            </select>
            <input
              type="text" aria-label="로그 검색" placeholder="Search logs..."
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" className="sqm-btn" onClick={clearFilters}>CLEAR FILTERS</button>
            <SortReset sort={sort} />
            <button type="button" className="sqm-btn sqm-btn--orange" onClick={exportCsv}>
              EXPORT LOGS
            </button>
          </div>

          <Table
            head={[sort.th("ts", "Timestamp"), sort.th("node", "Node"),
              sort.th("worker", "Worker"), sort.th("type", "Type"),
              sort.th("level", "Level"), "Message"]}
            empty={filtered.length === 0 ? "조건에 맞는 로그 없음" : undefined}
          >
            {sort.apply(filtered).map(([ts, n, w, lv, msg, type]) => (
              <tr key={ts}>
                <td>{ts}</td><td>{n}</td><td>{w}</td>
                <td title={TYPE_DESC[type]}>{type}</td>
                <td><Pill tone={LEVEL_TONE[lv] ?? "grey"}>{lv}</Pill></td>
                <td>{msg}</td>
              </tr>
            ))}
          </Table>
        </div>
        <Pager pages={[1, 2, 3, 4, "…", 240]} />
      </Card>
      {toast}
    </div>
  );
}
