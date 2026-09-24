# Overview 조회기간 직접 지정 - 20260908

기본 GPU/SQream Overview 화면의 `시간 범위` 셀렉트를 `조회기간 시작 ~ 조회기간 끝 + 조회` UI로 변경했습니다.

- 조회 버튼 클릭 시 `startTime`, `endTime`을 그대로 `/api/aireactechartdashboard/main/overview`, `/charts`, `/xview`, `/live-stats`에 전달합니다.
- 과거 구간 조회 시 자동 갱신은 Off(0초)로 변경합니다.
- `전체 구간(30분)으로 리셋` 시 직접 지정 기간을 해제하고 최근 30분 기준으로 복귀합니다.
- PromQL은 사용하지 않습니다.

변경 파일:
- react/src/components/FilterBar.tsx
- react/src/hooks/useFilters.ts
- react/src/hooks/useDashboardData.ts
- react/src/hooks/useCharts.ts
- react/src/hooks/useXViewEvents.ts
- react/src/screens/GpuDashboard.tsx
- react/src/styles/app.css

Java `MainDashboardController`의 overview/charts/xview/live-stats는 이미 `startTime`, `endTime`을 받고 있어 추가 Java 변경은 없습니다.
