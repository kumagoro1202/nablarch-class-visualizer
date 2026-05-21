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
        private ClassInfo classInfo;
        private String className;
        private boolean skip = false;

        ClassInfoVisitor(String artifactName) {
            super(Opcodes.ASM9);
            this.artifactName = artifactName;
        }

        @Override
        public void visit(int version, int access, String name, String signature,
                          String superName, String[] interfaces) {
            this.className = name.replace('/', '.');
            if (className.startsWith("module-info") || className.startsWith("package-info")) {
                this.skip = true;
                return;
            }
            String packageName = className.contains(".")
                    ? className.substring(0, className.lastIndexOf('.'))
                    : "";
            String classType = determineType(access);
            List<String> modifiers = determineModifiers(access);
            boolean testByName = isTestByName(className);
            this.classInfo = new ClassInfo(className, classType, packageName, artifactName,
                    modifiers, testByName);
        }

        @Override
        public AnnotationVisitor visitAnnotation(String descriptor, boolean visible) {
            if (TEST_ANNOTATIONS.contains(descriptor) && classInfo != null) {
                classInfo.isTest = true;
            }
            return null;
        }

        @Override
        public FieldVisitor visitField(int access, String name, String descriptor,
                                       String signature, Object value) {
            if (classInfo == null) return null;
            if (name.startsWith("this$") || name.equals("$VALUES")) return null;
            boolean isSynthetic = (access & Opcodes.ACC_SYNTHETIC) != 0;
            if (isSynthetic) return null;
            String type = descriptorToShortType(descriptor);
            String acc = accessToSymbol(access);
            boolean isStatic = (access & Opcodes.ACC_STATIC) != 0;
            classInfo.fields.add(new FieldInfo(name, type, acc, isStatic));
            return null;
        }

        @Override
        public MethodVisitor visitMethod(int access, String name, String descriptor,
                                         String signature, String[] exceptions) {
            if (classInfo == null) return null;
            if (name.equals("<clinit>")) return null;
            boolean isSynthetic = (access & Opcodes.ACC_SYNTHETIC) != 0;
            boolean isBridge = (access & Opcodes.ACC_BRIDGE) != 0;
            if (isSynthetic || isBridge) return null;

            String returnType = descriptorToReturnType(descriptor);
            List<String> params = descriptorToParamTypes(descriptor);
            String acc = accessToSymbol(access);
            boolean isStatic = (access & Opcodes.ACC_STATIC) != 0;
            boolean isAbstract = (access & Opcodes.ACC_ABSTRACT) != 0;
            classInfo.methods.add(new MethodInfo(name, returnType, params, acc, isStatic, isAbstract));
            return null;
        }

        ClassInfo getClassInfo() {
            if (skip || classInfo == null) return null;
            return classInfo;
        }

        private boolean isTestByName(String name) {
            String simpleName = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1) : name;
            return simpleName.startsWith("Test") || simpleName.endsWith("Test")
                    || simpleName.endsWith("Tests") || simpleName.endsWith("IT")
                    || simpleName.endsWith("Spec");
        }

        private String determineType(int access) {
            if ((access & Opcodes.ACC_ANNOTATION) != 0) return "ANNOTATION";
            if ((access & Opcodes.ACC_RECORD) != 0) return "RECORD";
            if ((access & Opcodes.ACC_INTERFACE) != 0) return "INTERFACE";
            if ((access & Opcodes.ACC_ENUM) != 0) return "ENUM";
            return "CLASS";
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

        private String descriptorToShortType(String desc) {
            if (desc.startsWith("[")) return descriptorToShortType(desc.substring(1)) + "[]";
            switch (desc) {
                case "I": return "int";
                case "J": return "long";
                case "D": return "double";
                case "F": return "float";
                case "Z": return "boolean";
                case "B": return "byte";
                case "C": return "char";
                case "S": return "short";
                case "V": return "void";
            }
            if (desc.startsWith("L") && desc.endsWith(";")) {
                String fqcn = desc.substring(1, desc.length() - 1).replace('/', '.');
                return fqcn.contains(".") ? fqcn.substring(fqcn.lastIndexOf('.') + 1) : fqcn;
            }
            return desc;
        }

        private String descriptorToReturnType(String methodDesc) {
            int paren = methodDesc.lastIndexOf(')');
            return descriptorToShortType(methodDesc.substring(paren + 1));
        }

        private List<String> descriptorToParamTypes(String methodDesc) {
            List<String> params = new ArrayList<>();
            int i = 1;
            while (i < methodDesc.length() && methodDesc.charAt(i) != ')') {
                int start = i;
                while (methodDesc.charAt(i) == '[') i++;
                if (methodDesc.charAt(i) == 'L') {
                    i = methodDesc.indexOf(';', i) + 1;
                } else {
                    i++;
                }
                params.add(descriptorToShortType(methodDesc.substring(start, i)));
            }
            return params;
        }

        private String accessToSymbol(int access) {
            if ((access & Opcodes.ACC_PUBLIC) != 0) return "+";
            if ((access & Opcodes.ACC_PRIVATE) != 0) return "-";
            if ((access & Opcodes.ACC_PROTECTED) != 0) return "#";
            return "~";
        }
    }
}
