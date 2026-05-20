package com.nablarch.visualizer;

import com.fasterxml.jackson.annotation.JsonProperty;

public class MetaInfo {
    @JsonProperty("nablarch_version")
    public String nablarchVersion;
    @JsonProperty("analyzed_at")
    public String analyzedAt;
    @JsonProperty("commit_sha")
    public String commitSha;
    @JsonProperty("total_classes")
    public int totalClasses;
    @JsonProperty("total_relations")
    public int totalRelations;
    @JsonProperty("total_artifacts")
    public int totalArtifacts;
    @JsonProperty("duration_seconds")
    public double durationSeconds;
    @JsonProperty("tool_version")
    public String toolVersion;
    public String status;
    @JsonProperty("error_message")
    public String errorMessage;

    public MetaInfo(String nablarchVersion, String analyzedAt, String commitSha,
                    int totalClasses, int totalRelations, int totalArtifacts,
                    double durationSeconds, String toolVersion, String status, String errorMessage) {
        this.nablarchVersion = nablarchVersion;
        this.analyzedAt = analyzedAt;
        this.commitSha = commitSha;
        this.totalClasses = totalClasses;
        this.totalRelations = totalRelations;
        this.totalArtifacts = totalArtifacts;
        this.durationSeconds = durationSeconds;
        this.toolVersion = toolVersion;
        this.status = status;
        this.errorMessage = errorMessage;
    }
}
