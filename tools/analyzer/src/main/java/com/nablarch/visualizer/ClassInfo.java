package com.nablarch.visualizer;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.ArrayList;
import java.util.List;

public class ClassInfo {
    public String id;
    public String fqcn;
    public String simpleName;
    public String artifactId;
    @JsonProperty("package")
    public String packageName;
    public String type;
    public List<String> modifiers;
    public Double x;
    public Double y;
    public List<FieldInfo> fields;
    public List<MethodInfo> methods;

    @JsonIgnore
    public boolean isTest;

    public ClassInfo(String fqcn, String type, String packageName, String artifactId,
                     List<String> modifiers, boolean isTest) {
        this.id = fqcn;
        this.fqcn = fqcn;
        this.simpleName = fqcn.contains(".") ? fqcn.substring(fqcn.lastIndexOf('.') + 1) : fqcn;
        this.artifactId = artifactId;
        this.packageName = packageName;
        this.type = type;
        this.modifiers = modifiers;
        this.x = null;
        this.y = null;
        this.isTest = isTest;
        this.fields = new ArrayList<>();
        this.methods = new ArrayList<>();
    }
}
