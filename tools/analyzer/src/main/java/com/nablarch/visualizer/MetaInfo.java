package com.nablarch.visualizer;

public class MetaInfo {
    public int totalClasses;
    public int totalRelations;
    public int totalArtifacts;
    public String extractedAt;
    public String version;

    public MetaInfo(int totalClasses, int totalRelations, int totalArtifacts,
                    String extractedAt, String version) {
        this.totalClasses = totalClasses;
        this.totalRelations = totalRelations;
        this.totalArtifacts = totalArtifacts;
        this.extractedAt = extractedAt;
        this.version = version;
    }
}
