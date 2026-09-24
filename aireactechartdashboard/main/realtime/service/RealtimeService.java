package com.apptomo.v4.aireactechartdashboard.main.realtime.service;
import com.apptomo.v4.aireactechartdashboard.main.realtime.dto.RealtimeQueryDto;
import com.apptomo.v4.aireactechartdashboard.main.realtime.dto.StatementDetailDto;
import com.apptomo.v4.aireactechartdashboard.main.realtime.repository.RealtimeRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.List;
// ===== 20260916 추가 시작 : 실시간 조회 서비스 =====
@Service @RequiredArgsConstructor
public class RealtimeService {
 private final RealtimeRepository repository;
 public List<RealtimeQueryDto> findRealtime(String s,String e,String h,Integer g,Integer gi){return repository.findRealtime(s,e,h,g,gi);}
 public StatementDetailDto findDetail(Long c,Long s){return repository.findStatementDetail(c,s);}
}
// ===== 20260916 추가 끝 : 실시간 조회 서비스 =====
