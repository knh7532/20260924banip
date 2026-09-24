package com.apptomo.v4.aireactechartdashboard.main.realtime.repository;

import com.apptomo.v4.aireactechartdashboard.main.realtime.dto.RealtimeQueryDto;
import com.apptomo.v4.aireactechartdashboard.main.realtime.dto.StatementDetailDto;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
@RequiredArgsConstructor
public class RealtimeRepository {
    private final NamedParameterJdbcTemplate jdbc;

    // ===== 20260916 추가 시작 : 실시간 server_status 기준 조회 =====
    public List<RealtimeQueryDto> findRealtime(String startTime, String endTime, String hostname, Integer gpuId, Integer giId) {
        String sql =
            "WITH latest_status AS ( " +
            " SELECT DISTINCT ON (ss.connection_id, ss.statement_id) ss.* " +
            " FROM public.ax_metrics_sqream_server_status ss " +
            " WHERE ss.collect_time >= CAST(:startTime AS timestamp) " +
            "   AND ss.collect_time <= CAST(:endTime AS timestamp) " +
            (hasText(hostname) ? " AND ss.hostname = :hostname " : "") +
            " ORDER BY ss.connection_id, ss.statement_id, ss.collect_time DESC " +
            ") " +
            "SELECT ss.hostname, ss.hostip, ss.server_port, ss.instance_id, ss.service, " +
            "       ss.connection_id, ss.statement_id, ss.statement_start_time, ss.statement_status, " +
            "       GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ss.statement_status_start)))::bigint AS statement_status_time_seconds, " +
            "       ss.classified_state, ss.is_long_running, " +
            "       dcm.gpu_id, dcm.gi_id, " +
            "       nm.cpu_usage_percent, nm.memory_used_bytes, nm.memory_total_bytes, nm.memory_usage_percent, " +
            "       nm.disk_used_bytes, nm.disk_total_bytes, nm.disk_usage_percent, " +
            "       dcm.memory_used_mib AS gpu_memory_used_mib, dcm.memory_total_mib AS gpu_memory_total_mib, " +
            "       CASE WHEN COALESCE(dcm.memory_total_mib,0) > 0 THEN dcm.memory_used_mib * 100.0 / dcm.memory_total_mib END AS gpu_memory_usage_percent, " +
            "       dcm.gr_engine_active_percent " +
            "FROM latest_status ss " +
            "LEFT JOIN LATERAL ( " +
            " SELECT n.* FROM public.ax_metrics_node n " +
            " WHERE n.hostname = ss.hostname AND n.collect_time <= ss.collect_time " +
            " ORDER BY n.collect_time DESC LIMIT 1 " +
            ") nm ON TRUE " +
            "LEFT JOIN LATERAL ( " +
            " SELECT d.gpu_id, d.gi_id, d.memory_used_mib, d.memory_total_mib, d.gr_engine_active_percent, d.snapshot_time " +
            " FROM public.ax_metrics_gpu_dcgmi_metric d " +
            // ===== 20260916 추가 시작 : NVIDIA SMI hostname 임시 JOIN =====
            // TODO: ax_metrics_gpu_dcgmi_metric.hostname 컬럼 추가 완료 후 아래 JOIN 삭제하고 nsi.hostname을 d.hostname으로 변경
            " JOIN public.ax_metrics_gpu_nvidia_smi_info nsi ON nsi.id = d.nvidia_smi_id " +
            // ===== 20260916 추가 끝 : NVIDIA SMI hostname 임시 JOIN =====
            " WHERE nsi.hostname = ss.hostname " +
            "   AND d.gpu_id IS NOT NULL AND d.gi_id IS NOT NULL " +
            "   AND ('sqream' || CASE WHEN nsi.hostname ~ 'gpu[0-9]+$' THEN substring(nsi.hostname from '([0-9])$') ELSE '4' END " +
            "        || d.gpu_id::text || d.gi_id::text) = ss.instance_id " +
            "   AND d.snapshot_time <= ss.collect_time " +
            (gpuId != null ? " AND d.gpu_id = :gpuId " : "") +
            (giId != null ? " AND d.gi_id = :giId " : "") +
            " ORDER BY d.snapshot_time DESC LIMIT 1 " +
            ") dcm ON TRUE " +
            "WHERE 1=1 " +
            (gpuId != null ? " AND dcm.gpu_id = :gpuId " : "") +
            (giId != null ? " AND dcm.gi_id = :giId " : "") +
            "ORDER BY ss.hostname, ss.statement_start_time DESC, ss.statement_id";

        MapSqlParameterSource p = new MapSqlParameterSource().addValue("startTime", startTime).addValue("endTime", endTime);
        if (hasText(hostname)) p.addValue("hostname", hostname);
        if (gpuId != null) p.addValue("gpuId", gpuId);
        if (giId != null) p.addValue("giId", giId);
        return jdbc.query(sql, p, (rs, i) -> new RealtimeQueryDto(
            rs.getString("hostname"), rs.getString("hostip"), intObj(rs,"server_port"), rs.getString("instance_id"), rs.getString("service"),
            longObj(rs,"connection_id"), longObj(rs,"statement_id"), str(rs,"statement_start_time"), rs.getString("statement_status"), longObj(rs,"statement_status_time_seconds"),
            rs.getString("classified_state"), boolObj(rs,"is_long_running"), intObj(rs,"gpu_id"), intObj(rs,"gi_id"), dblObj(rs,"cpu_usage_percent"),
            longObj(rs,"memory_used_bytes"), longObj(rs,"memory_total_bytes"), dblObj(rs,"memory_usage_percent"), longObj(rs,"disk_used_bytes"), longObj(rs,"disk_total_bytes"),
            dblObj(rs,"disk_usage_percent"), dblObj(rs,"gpu_memory_used_mib"), dblObj(rs,"gpu_memory_total_mib"), dblObj(rs,"gpu_memory_usage_percent"), dblObj(rs,"gr_engine_active_percent")
        ));
    }
    // ===== 20260916 추가 끝 : 실시간 server_status 기준 조회 =====

    // ===== 20260916 추가 시작 : Statement 상세 팝업 =====
    public StatementDetailDto findStatementDetail(Long connectionId, Long statementId) {
        String sql = "SELECT ss.hostip, ss.server_port, ss.instance_id, ss.service, ss.connection_id, ss.statement_id, " +
            "ss.statement_start_time, ss.statement_status, GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ss.statement_status_start)))::bigint AS statement_status_time_seconds, " +
            "ss.classified_state, ss.statement, ss.client_ip, ss.user_name AS user_id " +
            "FROM public.ax_metrics_sqream_server_status ss WHERE ss.connection_id=:connectionId AND ss.statement_id=:statementId " +
            "ORDER BY ss.collect_time DESC LIMIT 1";
        MapSqlParameterSource p=new MapSqlParameterSource().addValue("connectionId",connectionId).addValue("statementId",statementId);
        List<StatementDetailDto> rows=jdbc.query(sql,p,(rs,i)->new StatementDetailDto(rs.getString("hostip"),intObj(rs,"server_port"),rs.getString("instance_id"),rs.getString("service"),longObj(rs,"connection_id"),longObj(rs,"statement_id"),str(rs,"statement_start_time"),rs.getString("statement_status"),longObj(rs,"statement_status_time_seconds"),rs.getString("classified_state"),rs.getString("statement"),rs.getString("client_ip"),rs.getString("user_id")));
        return rows.isEmpty()?null:rows.get(0);
    }
    // ===== 20260916 추가 끝 : Statement 상세 팝업 =====

    private boolean hasText(String s){return s!=null&&!s.trim().isEmpty();}
    private String str(java.sql.ResultSet r,String c)throws java.sql.SQLException{Object v=r.getObject(c);return v==null?null:String.valueOf(v);}
    private Integer intObj(java.sql.ResultSet r,String c)throws java.sql.SQLException{Object v=r.getObject(c);return v==null?null:((Number)v).intValue();}
    private Long longObj(java.sql.ResultSet r,String c)throws java.sql.SQLException{Object v=r.getObject(c);return v==null?null:((Number)v).longValue();}
    private Double dblObj(java.sql.ResultSet r,String c)throws java.sql.SQLException{Object v=r.getObject(c);return v==null?null:((Number)v).doubleValue();}
    private Boolean boolObj(java.sql.ResultSet r,String c)throws java.sql.SQLException{Object v=r.getObject(c);return v==null?null:(Boolean)v;}
}
