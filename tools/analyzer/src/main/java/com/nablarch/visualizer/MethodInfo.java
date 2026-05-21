package com.nablarch.visualizer;

import java.util.List;

public class MethodInfo {
    public String name;
    public String returnType;
    public List<String> params;
    public String access;
    public boolean isStatic;
    public boolean isAbstract;

    public MethodInfo(String name, String returnType, List<String> params,
                      String access, boolean isStatic, boolean isAbstract) {
        this.name = name;
        this.returnType = returnType;
        this.params = params;
        this.access = access;
        this.isStatic = isStatic;
        this.isAbstract = isAbstract;
    }
}
