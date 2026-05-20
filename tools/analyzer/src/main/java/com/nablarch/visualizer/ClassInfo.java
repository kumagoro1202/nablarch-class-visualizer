package com.nablarch.visualizer;

import java.util.List;

public class ClassInfo {
    public String name;
    public String type;
    public String pkg;
    public String artifact;
    public List<String> modifiers;
    public List<String> annotations;
    public boolean isTest;

    public ClassInfo(String name, String type, String pkg, String artifact,
                     List<String> modifiers, List<String> annotations, boolean isTest) {
        this.name = name;
        this.type = type;
        this.pkg = pkg;
        this.artifact = artifact;
        this.modifiers = modifiers;
        this.annotations = annotations;
        this.isTest = isTest;
    }
}
