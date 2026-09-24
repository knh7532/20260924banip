package com.apptomo.v4.aireactechartdashboard.main.realstatus.repository;

import com.apptomo.v4.aireactechartdashboard.main.realstatus.dto.RealStatusDto;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

// 20260916 추가 - ax_metrics_sqream_server_status 실데이터 상태 집계
@Repository
@RequiredArgsConstructor
public class RealStatusRepository {

    private final NamedParameterJdbcTemplate jdbc;

    // 20260916 추가 - collect_time 시간범위 + hostname 기준 statement_status 집계
    public RealStatusDto countStatementStatuses(String startTime, String endTime, String hostname) {
        String sql =
            "SELECT " +
            "count(*) FILTER (WHERE lower(btrim(statement_status)) = 'in queue') AS in_queue, " +
            "count(*) FILTER (WHERE lower(btrim(statement_status)) = 'preparing') AS preparing, " +
            "count(*) FILTER (WHERE lower(btrim(statement_status)) = 'initializing') AS initializing, " +
            "count(*) FILTER (WHERE lower(btrim(statement_status)) = 'executing') AS executing, " +
            "count(*) FILTER (WHERE lower(btrim(statement_status)) = 'stopped') AS stopped " +
            "FROM public.ax_metrics_sqream_server_status " +
            "WHERE collect_time >= CAST(:startTime AS timestamp) " +
            "AND collect_time <= CAST(:endTime AS timestamp) " +
            (hasText(hostname) ? "AND hostname = :hostname " : "");

        MapSqlParameterSource params = new MapSqlParameterSource()
            .addValue("startTime", startTime)
            .addValue("endTime", endTime);

        if (hasText(hostname)) {
            params.addValue("hostname", hostname);
        }

        return jdbc.queryForObject(sql, params, (rs, rowNum) -> new RealStatusDto(
            rs.getLong("in_queue"),
            rs.getLong("preparing"),
            rs.getLong("initializing"),
            rs.getLong("executing"),
            rs.getLong("stopped")
        ));
    }

    private boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }
}
