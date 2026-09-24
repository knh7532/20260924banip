# 20260908 Worker + Table Usage 직접 매핑

## Java 적용 경로
`backend/aireactechartdashboard/*` -> `src/main/java/com/apptomo/v4/aireactechartdashboard/*`

이번 변경 핵심:
- Worker Monitoring: `GET /api/aireactechartdashboard/worker/overview`
  - `ax_metrics_sqream_worker_log` + `ax_metrics_node` CPU PEAK + `ax_nvidia_smi_info` + `ax_dcgmi_metric` GR Engine PEAK(MQuery)
  - Node별 카드, GPU0~3 / MIG Worker 행
  - Statement ID 클릭 시 기존 `/api/aisqreamboard/worker_log/statement_detail` 재사용
- Table Usage: `GET /api/aireactechartdashboard/table/usage`
  - `ax_metrics_sqream_table` 직접 조회
  - 조회기간 내 database/schema/table별 최신 행 사용
  - TOTAL TABLES / TOTAL ROWS / DELETED ROWS / RECHUNK TARGETS
- 두 React 화면 모두 `promQuery`, `promQueryRange` 사용하지 않음.

## React 직접 API 파일
- `react/src/api/aiReactEchartWorkerApi.ts`
- `react/src/api/aiReactEchartTableApi.ts`

## 화면 파일
- `react/src/screens/drilldown/WorkerMonitoring.tsx`
- `react/src/screens/drilldown/TableUsage.tsx`

## 주의
Worker MQuery는 Worker Log와 GPU PEAK를 hostname으로 JOIN하기 때문에 Worker Log 자체에 GPU/MIG 직접 키가 없다면 같은 최신 Worker Log가 각 GPU/MIG PEAK 행에 결합될 수 있다. 이는 현재 사용자가 지정한 MQuery JOIN 규칙을 그대로 따른 것이다.

전체 Spring/React 실제 빌드는 실행하지 못했다. 패키지에 node_modules와 전체 Spring 빌드 환경이 없어서 정적 확인만 수행했다.
