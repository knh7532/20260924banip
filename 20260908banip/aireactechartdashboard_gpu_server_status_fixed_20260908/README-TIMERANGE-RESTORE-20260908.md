# 20260908 시간 범위 프리셋 복원

원본 `react(1).zip`에 있던 `시간 범위` 셀렉트를 조회기간 시작/끝 UI 오른쪽에 복원했습니다.

- Last 5 minutes
- Last 30 minutes
- Last 1 hour
- Last 6 hours

프리셋 선택 시 현재 시각 기준으로 시작/끝 입력값도 같이 갱신됩니다.
직접 날짜를 입력하고 조회하면 시간 범위 셀렉트는 `직접 지정`으로 표시됩니다.

변경 파일:
- react/src/components/FilterBar.tsx
- react/src/components/drilldown/DrilldownToolbar.tsx

모든 신규 구간에 `20260908 추가 시작/끝` 주석을 넣었습니다.
