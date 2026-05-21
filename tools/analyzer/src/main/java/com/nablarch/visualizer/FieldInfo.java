package com.nablarch.visualizer;

public class FieldInfo {
    public String name;
    public String type;
    public String access;
    public boolean isStatic;

    public FieldInfo(String name, String type, String access, boolean isStatic) {
        this.name = name;
        this.type = type;
        this.access = access;
        this.isStatic = isStatic;
    }
}
