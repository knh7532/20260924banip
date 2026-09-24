-- ===== 20260908 추가 시작 : Main Dashboard MQuery (PostgreSQL / 화면 필터용) =====
-- :startTime, :endTime, :hostname, :gpuId, :migInstanceId 는 NamedParameterJdbcTemplate 파라미터다.
-- hostname/gpuId/migInstanceId NULL = All.
--
-- 중요: 사용자 제공 MQuery는 GPU PEAK를 hostname 단위 1건으로 만들었지만,
-- Main Dashboard의 Worker(mig_instance_id) 필터와 Node Health를 지원하려면
-- hostname + gpu_id + mig_instance_id별 PEAK가 필요하므로 아래처럼 확장했다.
WITH sqream_log AS (
    SELECT sl.*
    FROM public.ax_metrics_sqream_worker_log sl
    WHERE sl.query_start_time >= :startTime
      AND sl.query_end_time <= :endTime
      AND (:hostname IS NULL OR sl.hostname = :hostname)
),
node_peak AS (
    SELECT *
    FROM (
        SELECT nm.hostname, nm.collect_time, nm.cpu_usage_percent,
               nm.memory_used_bytes, nm.memory_total_bytes, nm.memory_usage_percent,
               nm.disk_used_bytes, nm.disk_total_bytes, nm.disk_usage_percent,
               nm.load_avg_1m, nm.load_avg_5m, nm.load_avg_15m,
               ROW_NUMBER() OVER (
                   PARTITION BY nm.hostname
                   ORDER BY nm.cpu_usage_percent DESC NULLS LAST,
                            nm.collect_time DESC NULLS LAST
               ) rn
        FROM public.ax_metrics_node nm
        WHERE nm.collect_time >= :startTime - INTERVAL '5 minutes'
          AND nm.collect_time <= :endTime + INTERVAL '5 minutes'
          AND nm.success = true
          AND nm.cpu_usage_percent IS NOT NULL
          AND (:hostname IS NULL OR nm.hostname = :hostname)
    ) x
    WHERE rn = 1
),
gpu_peak AS (
    SELECT *
    FROM (
        SELECT dcm.gpu_id, dcm.gi_id, dcm.ci_id, dcm.gpu_uuid, dcm.mig_uuid,
               dcm.mig_instance_id, dcm.device_name, dcm.driver_version,
               dcm.gpu_util_percent, dcm.sm_active_percent, dcm.gr_engine_active_percent,
               dcm.memory_used_mib, dcm.memory_total_mib,
               dcm.temperature_c, dcm.power_usage_w, dcm.snapshot_time,
               nsi.hostname AS nvidia_hostname,
               nsi.hostip AS nvidia_hostip,
               CAST(nsi.global_uuid AS varchar) AS nvidia_global_uuid,
               ROW_NUMBER() OVER (
                   PARTITION BY nsi.hostname, dcm.gpu_id, dcm.mig_instance_id
                   ORDER BY dcm.gr_engine_active_percent DESC NULLS LAST,
                            dcm.snapshot_time DESC NULLS LAST
               ) rn
        FROM public.ax_dcgmi_metric dcm
        INNER JOIN public.ax_nvidia_smi_info nsi
                ON dcm.nvidia_smi_id = nsi.id
        WHERE nsi.collect_time >= :startTime - INTERVAL '10 minutes'
          AND nsi.collect_time <= :endTime + INTERVAL '10 minutes'
          AND dcm.gr_engine_active_percent IS NOT NULL
          AND (:hostname IS NULL OR nsi.hostname = :hostname)
          AND (:gpuId IS NULL OR dcm.gpu_id = :gpuId)
          AND (:migInstanceId IS NULL OR dcm.mig_instance_id = :migInstanceId)
    ) x
    WHERE rn = 1
),
mquery_expanded AS (
    SELECT sl.*,
           np.cpu_usage_percent AS peak_cpu_usage_percent,
           np.memory_used_bytes AS peak_memory_used_bytes,
           np.memory_total_bytes AS peak_memory_total_bytes,
           np.memory_usage_percent AS peak_memory_usage_percent,
           np.disk_used_bytes AS peak_disk_used_bytes,
           np.disk_total_bytes AS peak_disk_total_bytes,
           np.disk_usage_percent AS peak_disk_usage_percent,
           np.load_avg_1m AS peak_load_avg_1m,
           np.load_avg_5m AS peak_load_avg_5m,
           np.load_avg_15m AS peak_load_avg_15m,
           gp.gpu_id, gp.gi_id, gp.ci_id, gp.gpu_uuid, gp.mig_uuid,
           gp.mig_instance_id, gp.device_name, gp.driver_version,
           gp.gpu_util_percent, gp.sm_active_percent, gp.gr_engine_active_percent,
           gp.memory_used_mib, gp.memory_total_mib,
           gp.temperature_c, gp.power_usage_w, gp.snapshot_time AS gpu_peak_snapshot_time,
           gp.nvidia_hostname, gp.nvidia_hostip, gp.nvidia_global_uuid
    FROM sqream_log sl
    LEFT JOIN node_peak np ON sl.hostname = np.hostname
    LEFT JOIN gpu_peak gp ON sl.hostname = gp.nvidia_hostname
)
SELECT DISTINCT ON (id) *
FROM mquery_expanded
ORDER BY id, gr_engine_active_percent DESC NULLS LAST, gpu_peak_snapshot_time DESC NULLS LAST;
-- ===== 20260908 추가 끝 : Main Dashboard MQuery (PostgreSQL / 화면 필터용) =====
