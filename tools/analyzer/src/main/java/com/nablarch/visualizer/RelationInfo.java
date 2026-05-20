package com.nablarch.visualizer;

import com.fasterxml.jackson.annotation.JsonProperty;

public class RelationInfo {
    public String from;
    public String to;
    @JsonProperty("relation_type")
    public String relationType;
    public String detail;

    public RelationInfo(String from, String to, String relationType) {
        this.from = from;
        this.to = to;
        this.relationType = relationType;
        this.detail = "";
    }
}
