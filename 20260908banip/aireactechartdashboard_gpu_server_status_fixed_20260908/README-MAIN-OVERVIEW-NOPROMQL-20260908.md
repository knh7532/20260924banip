# GPU/SQream 기본 화면 직접 API 매핑 (20260908)

대상 화면: `react/src/screens/GpuDashboard.tsx` (`http://localhost:8082` 기본 화면)

이 화면에서 PromQL 호출을 제거하고 Spring DTO API로 직접 연결했습니다.

## Spring 패키지
`src/main/java/com/apptomo/v4/aireactechartdashboard/main/`

추가 DTO:
- MainOverviewResponseDto
- MainOverviewStatementDto
- MainOverviewPerformanceDto
- MainOverviewServerDto
- MainOverviewKpiDto
- MainOverviewChartResponseDto
- MainOverviewGpuPointDto
- MainOverviewQueryTimelineDto
- MainOverviewXViewEventDto
- MainOverviewLiveStatDto

## 직접 API
- `GET /api/aireactechartdashboard/main/overview?startTime=...&endTime=...`
- `GET /api/aireactechartdashboard/main/charts?startTime=...&endTime=...`
- `GET /api/aireactechartdashboard/main/xview?startTime=...&endTime=...`
- `GET /api/aireactechartdashboard/main/live-stats?startTime=...&endTime=...`

## DB 매핑
- 실행 쿼리/상태: `ax_metrics_sqream_server_status`
- 쿼리 상세/타임라인: `ax_metrics_sqream_query_runtime`
- Worker/종료상태: `ax_metrics_sqream_worker_log`
- GPU 시계열/서버 카드: `ax_dcgmi_metric` + `ax_nvidia_smi_info`

## React 변경
- `src/api/aiReactEchartMainApi.ts` 추가
- `src/hooks/useDashboardData.ts` 직접 DTO 조회
- `src/hooks/useCharts.ts` 직접 차트 DTO 조회
- `src/hooks/useXViewEvents.ts` 직접 완료 이벤트 조회
- `src/screens/GpuDashboard.tsx` 상세 팝업 live 조회에서 `promQuery()` 제거

위 4개 흐름은 `prom.ts`, `promQuery`, `promQueryRange`를 사용하지 않습니다.

모든 신규/변경 핵심 구간에 `20260908 추가` 주석을 표시했습니다.
