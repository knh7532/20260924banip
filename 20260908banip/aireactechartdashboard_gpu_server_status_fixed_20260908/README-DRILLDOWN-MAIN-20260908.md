# 20260908 Main Dashboard (#/drilldown/main) 직접 REST 매핑

대상 화면: `/#/drilldown/main`

기존 문제:
- 이 화면은 `react/src/screens/drilldown/MainDashboard.tsx`이며 기존 `promQuery()/promQueryRange()`를 계속 사용하고 있었음.
- 이전 수정은 `GpuDashboard.tsx` 기본 Overview 화면 위주였기 때문에 Drilldown Main Dashboard는 데이터 연결 실패가 발생할 수 있었음.

이번 변경:
- `MainDashboard.tsx`에서 PromQL 호출 제거
- 직접 REST API 추가
  - `GET /api/aireactechartdashboard/main/drilldown`
  - `GET /api/aireactechartdashboard/main/performance`
  - 기존 `GET /api/aireactechartdashboard/main/live-stats` 재사용
- 조회기간은 Drilldown Toolbar의 `rangeSec + endMs`를 그대로 사용
- Java 패키지: `com.apptomo.v4.aireactechartdashboard.main`
- 모든 신규 구간에 `20260908 추가` 표시

DB 매핑:
- KPI/세션/쿼리: `ax_metrics_sqream_server_status`, `ax_metrics_sqream_query_runtime`
- 실패 쿼리/Worker/Read 데이터: `ax_metrics_sqream_worker_log`
- CPU/RAM/Disk Usage: `ax_metrics_node`
- GPU 사용률/메모리: `ax_dcgmi_metric` + `ax_nvidia_smi_info`

주의:
- 현재 제공된 DB 스키마에 Query별 Disk Spill과 Lock 원천이 확인되지 않아 해당 값은 `--`/0으로 유지합니다.
- Cluster Performance의 Disk 항목은 현재 DB에서 확인 가능한 `disk_usage_percent`를 표시합니다. 기존 Prometheus의 disk I/O bytes/sec와 의미가 다릅니다.
- 전체 Spring 프로젝트 의존성을 포함한 실제 컴파일은 이 환경에서 실행하지 않았습니다.
