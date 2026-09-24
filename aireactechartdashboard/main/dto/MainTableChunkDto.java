package com.apptomo.v4.aireactechartdashboard.main.dto;

// ===== 20260916 추가 시작 : Overview Table Chunk 크기 시각화 =====
public class MainTableChunkDto {
    public String hostname;
    public Long tableId;
    public String databaseName;
    public String schemaName;
    public String tableName;
    public Long compressedTableSizeByte;
    public Long uncompressedTableSizeByte;
    public Double savingsRate;
    public Double compressionRatio;
    public String collectTime;
}
// ===== 20260916 추가 끝 : Overview Table Chunk 크기 시각화 =====
