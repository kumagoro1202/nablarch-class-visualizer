package com.nablarch.visualizer;

public class ArtifactInfo {
    public String artifactId;
    public String groupId;
    public String version;
    public String repository;
    public String colorHex;

    public ArtifactInfo(String artifactId, String groupId, String version,
                        String repository, String colorHex) {
        this.artifactId = artifactId;
        this.groupId = groupId;
        this.version = version;
        this.repository = repository;
        this.colorHex = colorHex;
    }
}
