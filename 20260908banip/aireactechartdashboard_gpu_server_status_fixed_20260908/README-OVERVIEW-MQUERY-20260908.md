# 20260908 Overview Dashboard MQuery 매핑

## 적용 내용
- 상태 카드 5개: `ax_metrics_sqream_server_status.statement_status`의 최신 상태를 `in queue / preparing / initializing / executing / stopping`으로 각각 COUNT.
- 실행 중인 SQream DB 쿼리: 사용자 정의 MQuery의 `ax_metrics_sqream_worker_log + ax_metrics_node CPU PEAK + ax_nvidia_smi_info + ax_dcgmi_metric GR Engine PEAK` 결과를 직접 매핑.
- GPU 사용률: MQuery `gr_engine_active_percent`.
- 메모리 사용률: MQuery `memory_used_mib / memory_total_mib * 100`.
- 온도: `ax_gpu_device.temperature_c`. 시간축은 부모 `ax_nvidia_smi_info.collect_time`.
- 전력사용량: `ax_gpu_device.power_usage_w`. 시간축은 부모 `ax_nvidia_smi_info.collect_time`.
- Node/GPU/Worker(All 포함) 필터를 `/api/aireactechartdashboard/main/overview`, `/charts`에 전달.
- Statement ID/행 클릭 시 기존 `/api/aisqreamboard/worker_log/statement_detail`을 사용하는 React 스타일 SQL/실행계획 팝업 연결.
- PromQL 사용 없음.

## Java 적용 경로
`src/main/java/com/apptomo/v4/aireactechartdashboard/main/`

## React 주요 변경 파일
- `src/api/aiReactEchartMainApi.ts`
- `src/hooks/useDashboardData.ts`
- `src/hooks/useCharts.ts`
- `src/screens/GpuDashboard.tsx`

## 주의
`ax_gpu_device`에는 자체 `snapshot_time` 컬럼이 없으므로 NVIDIA 부모 레코드의 `collect_time`을 온도/전력 차트 시간축으로 사용합니다.
