package com.apptomo.v4.aireactechartdashboard.main.realtime.controller;
import com.apptomo.v4.aireactechartdashboard.main.realtime.dto.RealtimeQueryDto;
import com.apptomo.v4.aireactechartdashboard.main.realtime.dto.StatementDetailDto;
import com.apptomo.v4.aireactechartdashboard.main.realtime.service.RealtimeService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
// ===== 20260916 추가 시작 : 실시간 Query API =====
@RestController @RequiredArgsConstructor
@RequestMapping("/api/aireactechartdashboard/main/realtime")
public class RealtimeController {
 private final RealtimeService service;
 @GetMapping public List<RealtimeQueryDto> list(@RequestParam String startTime,@RequestParam String endTime,@RequestParam(required=false) String hostname,@RequestParam(required=false) Integer gpuId,@RequestParam(required=false) Integer giId){return service.findRealtime(startTime,endTime,hostname,gpuId,giId);}
 @GetMapping("/statement") public ResponseEntity<StatementDetailDto> detail(@RequestParam Long connectionId,@RequestParam Long statementId){StatementDetailDto d=service.findDetail(connectionId,statementId);return d==null?ResponseEntity.notFound().build():ResponseEntity.ok(d);}
}
// ===== 20260916 추가 끝 : 실시간 Query API =====
