# 20260908 Main Dashboard MQuery 재매핑

## 적용 경로

Java:
`src/main/java/com/apptomo/v4/aireactechartdashboard/main/`

React 변경 파일:
- `react/src/api/aiReactEchartDrilldownMainApi.ts`
- `react/src/screens/drilldown/MainDashboard.tsx`
- `react/src/screens/drilldown/MainStatementDetailModal.tsx`
- `react/src/styles/drilldown.css`

## Main Dashboard 매핑

- 조회기간: Worker Log `query_start_time >= startTime AND query_end_time <= endTime`
- Node Peak: 조회기간 ±5분, `cpu_usage_percent` PEAK ROW
- GPU Peak: NVIDIA 조회기간 ±10분, `gr_engine_active_percent` PEAK ROW
- Node/GPU/Worker 필터: `hostname`, `gpuId`, `migInstanceId`; 빈 값은 All
- Active Sessions: `ax_metrics_sqream_server_status`의 미완료 최신 상태에서 `COUNT(DISTINCT server_id)`
- Running Queries: 같은 상태의 `COUNT(*)`
- CPU Usage: 필터 적용 MQuery의 Peak CPU 최대값
- GPU MEMORY USAGE 카드: 사용자 지정대로 필터 적용 MQuery의 `gr_engine_active_percent`
- Cluster Performance: MQuery Query Start를 x축으로 CPU / GPU-memory-used÷total / RAM / Disk 사용률
- Query Overview: MQuery Worker Log 결과
- Node Health: MIG별 `gr_engine_active_percent >=90 Healthy`, `>=50 Not Healthy`, `<50 Unhealthy`
- Top Queries: Query Overview 중 `gr_engine_active_percent` 내림차순 20건

## Statement ID 클릭

React에서 기존 Worker Log 상세 API를 그대로 호출한다.
`GET /api/aisqreamboard/worker_log/statement_detail?connectionId=...&statementId=...`

팝업은 현재 React 다크 스타일을 사용하고 `쿼리문 / 실행 계획` 두 탭으로 구성한다.
실행 계획은 Rows / Chunks / Chunk Per Rows / 소요시간 / 상태 컬럼을 사용한다.

## MQuery 조정 사항

사용자 제공 원본 MQuery의 GPU PEAK가 `PARTITION BY hostname`이면 Node마다 가장 높은 MIG 한 건만 남아서 Worker(mig_instance_id) 필터와 Node Health를 구현할 수 없다.
그래서 이 화면에서는 `PARTITION BY hostname, gpu_id, mig_instance_id`로 GPU PEAK를 만든 뒤, Query Overview에서는 로그 ID별로 가장 높은 `gr_engine_active_percent` 한 건을 선택한다.

## server_status 컬럼 주의

현재 확인된 `ax_metrics_sqream_server_status` 스키마에는 `query_termination_status`, `success` 컬럼이 없다. 따라서 Active Sessions / Running Queries의 "미완료 + 성공" 조건은 실제 존재하는 `statement_status`에서 complete/success/fail/error/kill/terminated/stop 계열을 제외하는 방식으로 구현했다.
실제 DB에 별도 `query_termination_status` 또는 `success` 컬럼이 있다면 해당 조건으로 교체하면 된다.
