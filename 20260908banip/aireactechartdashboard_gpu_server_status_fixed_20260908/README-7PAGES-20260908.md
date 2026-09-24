# React ECharts GPU/SQream 7개 페이지 매핑 - 20260908

이번 패키지는 아래 7개 페이지만 대상으로 정리했습니다.

- Main Dashboard -> `com.apptomo.v4.aireactechartdashboard.main`
- Worker Monitoring -> `com.apptomo.v4.aireactechartdashboard.worker`
- Query Analytics -> `com.apptomo.v4.aireactechartdashboard.query`
- Log Monitoring -> `com.apptomo.v4.aireactechartdashboard.log`
- Session Monitoring -> `com.apptomo.v4.aireactechartdashboard.session`
- Table Usage -> `com.apptomo.v4.aireactechartdashboard.table`
- Table Activity -> `com.apptomo.v4.aireactechartdashboard.activity`
- 공통 시리즈 유틸 -> `com.apptomo.v4.aireactechartdashboard.common`

## Java 적용 경로

`backend/aireactechartdashboard` 아래 폴더들을 다음 경로에 복사합니다.

`src/main/java/com/apptomo/v4/aireactechartdashboard/`

## React

`react/` 폴더는 수정된 전체 React 프로젝트입니다. `src/api/prom.ts` 라우팅은 위 7개 페이지 API만 사용하도록 정리했습니다.

페이지 API:

- `/api/aireactechartdashboard/main/**`
- `/api/aireactechartdashboard/worker/**`
- `/api/aireactechartdashboard/query/**`
- `/api/aireactechartdashboard/log/**`
- `/api/aireactechartdashboard/session/**`
- `/api/aireactechartdashboard/table/**`
- `/api/aireactechartdashboard/activity/**`

모든 추가/변경 구간은 `20260908 추가` 주석으로 표시했습니다.

## 실행

`.env` 예:

`VITE_PORTAL_API_BASE=http://localhost:25231`

그 다음 React 폴더에서:

`npm install`

`npm run dev`

React 개발 서버는 기존 설정대로 8082를 사용합니다.
