package com.nablarch.visualizer;

import org.objectweb.asm.*;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.*;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

public class RelationExtractor {

    public List<RelationInfo> extractFromJar(File jarFile, Set<String> knownClasses) throws IOException {
        List<RelationInfo> raw = new ArrayList<>();
        try (JarFile jar = new JarFile(jarFile)) {
            Enumeration<JarEntry> entries = jar.entries();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                if (!entry.getName().endsWith(".class")) continue;
                try (InputStream is = jar.getInputStream(entry)) {
                    raw.addAll(analyzeRelations(is, knownClasses));
                } catch (Exception e) {
                    System.err.println("Warning: failed to analyze relations in " + entry.getName() + ": " + e.getMessage());
                }
            }
        }
        return deduplicate(raw);
    }

    private List<RelationInfo> analyzeRelations(InputStream is, Set<String> knownClasses) throws IOException {
        ClassReader reader = new ClassReader(is);
        RelationVisitor visitor = new RelationVisitor(knownClasses);
        // SKIP_CODE removed: visitMethodInsn (DEPENDS) requires method body traversal
        reader.accept(visitor, ClassReader.SKIP_FRAMES | ClassReader.SKIP_DEBUG);
        return visitor.getRelations();
    }

    private List<RelationInfo> deduplicate(List<RelationInfo> relations) {
        Set<String> seen = new LinkedHashSet<>();
        List<RelationInfo> result = new ArrayList<>();
        for (RelationInfo r : relations) {
            String key = r.from + "|" + r.to + "|" + r.relationType;
            if (seen.add(key)) {
                result.add(r);
            }
        }
        return result;
    }

    private static String descriptorToClassName(String desc) {
        int i = 0;
        while (i < desc.length() && desc.charAt(i) == '[') i++;
        if (i < desc.length() && desc.charAt(i) == 'L') {
            int end = desc.indexOf(';', i);
            if (end > 0) {
                return desc.substring(i + 1, end).replace('/', '.');
            }
        }
        return null;
    }

    private static class RelationVisitor extends ClassVisitor {
        private final Set<String> knownClasses;
        private String className;
        private String internalName;
        private final List<RelationInfo> relations = new ArrayList<>();

        RelationVisitor(Set<String> knownClasses) {
            super(Opcodes.ASM9);
            this.knownClasses = knownClasses;
        }

        @Override
        public void visit(int version, int access, String name, String signature,
                          String superName, String[] interfaces) {
            this.internalName = name;
            this.className = name.replace('/', '.');

            if (superName != null && !superName.equals("java/lang/Object")) {
                String superFqcn = superName.replace('/', '.');
                if (knownClasses.contains(superFqcn)) {
                    relations.add(new RelationInfo(className, superFqcn, "EXTENDS"));
                }
            }

            if (interfaces != null) {
                for (String iface : interfaces) {
                    String ifaceFqcn = iface.replace('/', '.');
                    if (knownClasses.contains(ifaceFqcn)) {
                        relations.add(new RelationInfo(className, ifaceFqcn, "IMPLEMENTS"));
                    }
                }
            }
        }

        @Override
        public void visitInnerClass(String name, String outerName, String innerName, int access) {
            // Emit CONTAINS only when visiting the outer class (outerName == current class)
            if (outerName != null && outerName.equals(internalName)) {
                String innerFqcn = name.replace('/', '.');
                if (knownClasses.contains(innerFqcn) && !innerFqcn.equals(className)) {
                    relations.add(new RelationInfo(className, innerFqcn, "CONTAINS"));
                }
            }
        }

        @Override
        public FieldVisitor visitField(int access, String name, String desc, String signature, Object value) {
            String fieldType = descriptorToClassName(desc);
            if (fieldType != null && knownClasses.contains(fieldType) && !fieldType.equals(className)) {
                relations.add(new RelationInfo(className, fieldType, "USES"));
            }
            return null;
        }

        @Override
        public MethodVisitor visitMethod(int access, String name, String desc, String signature, String[] exceptions) {
            return new DependsMethodVisitor(className, knownClasses, relations);
        }

        List<RelationInfo> getRelations() {
            return relations;
        }
    }

    private static class DependsMethodVisitor extends MethodVisitor {
        private final String className;
        private final Set<String> knownClasses;
        private final List<RelationInfo> relations;

        DependsMethodVisitor(String className, Set<String> knownClasses, List<RelationInfo> relations) {
            super(Opcodes.ASM9);
            this.className = className;
            this.knownClasses = knownClasses;
            this.relations = relations;
        }

        @Override
        public void visitMethodInsn(int opcode, String owner, String name, String desc, boolean isInterface) {
            if (owner == null || owner.isEmpty() || owner.charAt(0) == '[') return;
            String ownerFqcn = owner.replace('/', '.');
            if (knownClasses.contains(ownerFqcn) && !ownerFqcn.equals(className)) {
                relations.add(new RelationInfo(className, ownerFqcn, "DEPENDS"));
            }
        }
    }
}
