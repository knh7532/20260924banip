# GPU 서버 목록 상태 수정 (20260908)

- Prometheus/PromQL 서버 카드 조회 제거
- `/api/aireactechartdashboard/common/status` PostgreSQL 직접 호출
- 서버 상태: `ax_nvidia_smi_info`의 hostname별 최신 collect_time이 기준시각 30분 이내면 정상
- GPU 전체/사용중: 최신 `ax_nvidia_smi_info.id`에 연결된 `ax_dcgmi_metric`에서 `gpu_id` 집계
- 사용중 GPU: `COALESCE(gr_engine_active_percent, gpu_util_percent, 0) > 0`
- `0 / 4 GPU 사용 중`이어도 최신 NVIDIA 수집이 있으면 서버는 `정상`으로 표시
- DrilldownTopbar의 Prometheus 호출도 공통 PostgreSQL REST API로 교체
