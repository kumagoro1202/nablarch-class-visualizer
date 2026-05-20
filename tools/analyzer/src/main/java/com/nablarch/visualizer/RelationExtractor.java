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
        List<RelationInfo> results = new ArrayList<>();
        try (JarFile jar = new JarFile(jarFile)) {
            Enumeration<JarEntry> entries = jar.entries();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                if (!entry.getName().endsWith(".class")) continue;
                try (InputStream is = jar.getInputStream(entry)) {
                    results.addAll(analyzeRelations(is, knownClasses));
                } catch (Exception e) {
                    System.err.println("Warning: failed to analyze relations in " + entry.getName() + ": " + e.getMessage());
                }
            }
        }
        return results;
    }

    private List<RelationInfo> analyzeRelations(InputStream is, Set<String> knownClasses) throws IOException {
        ClassReader reader = new ClassReader(is);
        RelationVisitor visitor = new RelationVisitor(knownClasses);
        reader.accept(visitor, ClassReader.SKIP_CODE | ClassReader.SKIP_FRAMES);
        return visitor.getRelations();
    }

    private static class RelationVisitor extends ClassVisitor {
        private final Set<String> knownClasses;
        private String className;
        private final List<RelationInfo> relations = new ArrayList<>();

        RelationVisitor(Set<String> knownClasses) {
            super(Opcodes.ASM9);
            this.knownClasses = knownClasses;
        }

        @Override
        public void visit(int version, int access, String name, String signature,
                          String superName, String[] interfaces) {
            this.className = name.replace('/', '.');

            if (superName != null && !superName.equals("java/lang/Object")) {
                String superClassName = superName.replace('/', '.');
                if (knownClasses.contains(superClassName)) {
                    relations.add(new RelationInfo(className, superClassName, "EXTENDS"));
                }
            }

            if (interfaces != null) {
                for (String iface : interfaces) {
                    String ifaceName = iface.replace('/', '.');
                    if (knownClasses.contains(ifaceName)) {
                        relations.add(new RelationInfo(className, ifaceName, "IMPLEMENTS"));
                    }
                }
            }
        }

        List<RelationInfo> getRelations() {
            return relations;
        }
    }
}
