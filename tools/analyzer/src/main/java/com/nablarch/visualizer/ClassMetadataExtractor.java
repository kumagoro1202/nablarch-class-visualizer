package com.nablarch.visualizer;

import org.objectweb.asm.*;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.*;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

public class ClassMetadataExtractor {

    private static final Set<String> TEST_ANNOTATIONS = Set.of(
            "Lorg/junit/Test;",
            "Lorg/junit/jupiter/api/Test;",
            "Lorg/testng/annotations/Test;"
    );

    public List<ClassInfo> extractFromJar(File jarFile, String artifactName) throws IOException {
        List<ClassInfo> results = new ArrayList<>();
        try (JarFile jar = new JarFile(jarFile)) {
            Enumeration<JarEntry> entries = jar.entries();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                if (!entry.getName().endsWith(".class")) continue;
                try (InputStream is = jar.getInputStream(entry)) {
                    ClassInfo info = analyzeClass(is, artifactName);
                    if (info != null) {
                        results.add(info);
                    }
                } catch (Exception e) {
                    System.err.println("Warning: failed to analyze " + entry.getName() + ": " + e.getMessage());
                }
            }
        }
        return results;
    }

    private ClassInfo analyzeClass(InputStream is, String artifactName) throws IOException {
        ClassReader reader = new ClassReader(is);
        ClassInfoVisitor visitor = new ClassInfoVisitor(artifactName);
        reader.accept(visitor, ClassReader.SKIP_CODE | ClassReader.SKIP_FRAMES);
        return visitor.getClassInfo();
    }

    private static class ClassInfoVisitor extends ClassVisitor {
        private final String artifactName;
        private String className;
        private String classType;
        private String packageName;
        private List<String> modifiers;
        private List<String> annotations = new ArrayList<>();
        private boolean isTest = false;

        ClassInfoVisitor(String artifactName) {
            super(Opcodes.ASM9);
            this.artifactName = artifactName;
        }

        @Override
        public void visit(int version, int access, String name, String signature,
                          String superName, String[] interfaces) {
            this.className = name.replace('/', '.');
            this.packageName = className.contains(".")
                    ? className.substring(0, className.lastIndexOf('.'))
                    : "";
            this.classType = determineType(access);
            this.modifiers = determineModifiers(access);
        }

        @Override
        public AnnotationVisitor visitAnnotation(String descriptor, boolean visible) {
            String annotationName = descriptorToName(descriptor);
            annotations.add("@" + annotationName);
            if (TEST_ANNOTATIONS.contains(descriptor)) {
                isTest = true;
            }
            return null;
        }

        ClassInfo getClassInfo() {
            if (className == null || className.startsWith("module-info") || className.startsWith("package-info")) {
                return null;
            }
            boolean testByName = isTestByName(className);
            return new ClassInfo(className, classType, packageName, artifactName,
                    modifiers, annotations, isTest || testByName);
        }

        private boolean isTestByName(String name) {
            String simpleName = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1) : name;
            return simpleName.startsWith("Test") || simpleName.endsWith("Test")
                    || simpleName.endsWith("Tests") || simpleName.endsWith("IT")
                    || simpleName.endsWith("Spec");
        }

        private String determineType(int access) {
            if ((access & Opcodes.ACC_ANNOTATION) != 0) return "annotation";
            if ((access & Opcodes.ACC_INTERFACE) != 0) return "interface";
            if ((access & Opcodes.ACC_ENUM) != 0) return "enum";
            if ((access & Opcodes.ACC_ABSTRACT) != 0) return "abstract";
            return "class";
        }

        private List<String> determineModifiers(int access) {
            List<String> mods = new ArrayList<>();
            if ((access & Opcodes.ACC_PUBLIC) != 0) mods.add("public");
            if ((access & Opcodes.ACC_PROTECTED) != 0) mods.add("protected");
            if ((access & Opcodes.ACC_PRIVATE) != 0) mods.add("private");
            if ((access & Opcodes.ACC_STATIC) != 0) mods.add("static");
            if ((access & Opcodes.ACC_FINAL) != 0) mods.add("final");
            if ((access & Opcodes.ACC_ABSTRACT) != 0 && (access & Opcodes.ACC_INTERFACE) == 0) {
                mods.add("abstract");
            }
            return mods;
        }

        private String descriptorToName(String descriptor) {
            if (descriptor.startsWith("L") && descriptor.endsWith(";")) {
                return descriptor.substring(1, descriptor.length() - 1).replace('/', '.');
            }
            return descriptor;
        }
    }
}
