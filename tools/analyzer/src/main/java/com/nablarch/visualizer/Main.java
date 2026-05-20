package com.nablarch.visualizer;

import org.apache.commons.cli.*;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.*;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.stream.Collectors;

public class Main {

    private static final String[] TABLEAU_10 = {
        "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F",
        "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC"
    };

    private static final String TOOL_VERSION = "1.0.0";

    public static void main(String[] args) {
        Options options = buildOptions();
        CommandLineParser parser = new DefaultParser();
        HelpFormatter formatter = new HelpFormatter();

        CommandLine cmd;
        try {
            cmd = parser.parse(options, args);
        } catch (ParseException e) {
            System.err.println("Error: " + e.getMessage());
            formatter.printHelp("nablarch-class-extractor", options);
            System.exit(1);
            return;
        }

        if (cmd.hasOption("help")) {
            formatter.printHelp("nablarch-class-extractor", options);
            return;
        }

        String jarsPath = cmd.getOptionValue("jars");
        String outputPath = cmd.getOptionValue("output");
        String nablarchVersion = cmd.getOptionValue("version", "unknown");
        boolean excludeTest = cmd.hasOption("exclude-test");

        File jarsDir = new File(jarsPath);
        File outputDir = new File(outputPath);

        if (!jarsDir.exists() || !jarsDir.isDirectory()) {
            System.err.println("Error: --jars must be a directory: " + jarsPath);
            System.exit(1);
        }

        outputDir.mkdirs();

        List<File> jarFiles = findJars(jarsDir);
        if (jarFiles.isEmpty()) {
            System.err.println("Error: no JAR files found in " + jarsPath);
            System.exit(1);
        }

        System.out.println("Found " + jarFiles.size() + " JAR file(s)");

        long startNanos = System.nanoTime();
        String analyzedAt = Instant.now().toString();

        JsonOutputWriter writer = new JsonOutputWriter();

        MetaInfo analyzingMeta = new MetaInfo(
                nablarchVersion, "", "", 0, 0, 0, 0, TOOL_VERSION, "analyzing", "");
        try {
            writer.writeMeta(outputDir, analyzingMeta);
        } catch (IOException e) {
            System.err.println("Warning: failed to write initial meta.json: " + e.getMessage());
        }

        ClassMetadataExtractor classExtractor = new ClassMetadataExtractor();
        RelationExtractor relationExtractor = new RelationExtractor();

        List<ClassInfo> allClasses = new ArrayList<>();
        List<MavenInfo> mavenInfoList = new ArrayList<>();

        for (File jar : jarFiles) {
            System.out.println("Scanning: " + jar.getName());
            MavenInfo mvn = parsePomInfo(jar);
            mavenInfoList.add(mvn);
            try {
                List<ClassInfo> classes = classExtractor.extractFromJar(jar, mvn.artifactId);
                if (excludeTest) {
                    classes = classes.stream()
                            .filter(c -> !c.isTest)
                            .collect(Collectors.toList());
                }
                allClasses.addAll(classes);
            } catch (IOException e) {
                System.err.println("Failed to scan " + jar.getName() + ": " + e.getMessage());
            }
        }

        System.out.println("Total classes extracted: " + allClasses.size());

        Set<String> knownClassNames = allClasses.stream()
                .map(c -> c.id)
                .collect(Collectors.toSet());

        List<RelationInfo> allRelations = new ArrayList<>();
        for (File jar : jarFiles) {
            try {
                List<RelationInfo> relations = relationExtractor.extractFromJar(jar, knownClassNames);
                allRelations.addAll(relations);
            } catch (IOException e) {
                System.err.println("Failed to extract relations from " + jar.getName() + ": " + e.getMessage());
            }
        }

        System.out.println("Total relations extracted: " + allRelations.size());

        List<ArtifactInfo> artifacts = buildArtifacts(mavenInfoList);

        long durationNanos = System.nanoTime() - startNanos;
        double durationSeconds = durationNanos / 1_000_000_000.0;

        MetaInfo meta = new MetaInfo(
                nablarchVersion,
                analyzedAt,
                "",
                allClasses.size(),
                allRelations.size(),
                artifacts.size(),
                Math.round(durationSeconds * 10.0) / 10.0,
                TOOL_VERSION,
                "done",
                ""
        );

        try {
            writer.writeClasses(outputDir, allClasses);
            writer.writeRelations(outputDir, allRelations);
            writer.writeArtifacts(outputDir, artifacts);
            writer.writeMeta(outputDir, meta);
            System.out.println("Output written to: " + outputDir.getAbsolutePath());
            System.out.println("  classes.json:   " + allClasses.size() + " entries");
            System.out.println("  relations.json: " + allRelations.size() + " entries");
            System.out.println("  artifacts.json: " + artifacts.size() + " entries");
        } catch (IOException e) {
            System.err.println("Failed to write output: " + e.getMessage());
            System.exit(1);
        }
    }

    private static List<ArtifactInfo> buildArtifacts(List<MavenInfo> mavenInfoList) {
        List<MavenInfo> sorted = mavenInfoList.stream()
                .sorted(Comparator.comparing(m -> m.artifactId))
                .collect(Collectors.toList());

        List<ArtifactInfo> result = new ArrayList<>();
        for (int i = 0; i < sorted.size(); i++) {
            MavenInfo mvn = sorted.get(i);
            String colorHex = TABLEAU_10[i % TABLEAU_10.length];
            result.add(new ArtifactInfo(
                    mvn.artifactId,
                    mvn.groupId,
                    mvn.version,
                    "nablarch/" + mvn.artifactId,
                    colorHex
            ));
        }
        return result;
    }

    private static MavenInfo parsePomInfo(File jar) {
        try (JarFile jarFile = new JarFile(jar)) {
            Enumeration<JarEntry> entries = jarFile.entries();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                if (entry.getName().startsWith("META-INF/maven/") && entry.getName().endsWith("/pom.properties")) {
                    Properties props = new Properties();
                    try (InputStream is = jarFile.getInputStream(entry)) {
                        props.load(is);
                    }
                    return new MavenInfo(
                            props.getProperty("artifactId", extractArtifactId(jar.getName())),
                            props.getProperty("groupId", "unknown"),
                            props.getProperty("version", extractVersion(jar.getName()))
                    );
                }
            }
        } catch (IOException e) {
            // fall through to name-based extraction
        }
        return new MavenInfo(
                extractArtifactId(jar.getName()),
                "unknown",
                extractVersion(jar.getName())
        );
    }

    private static String extractArtifactId(String jarName) {
        String base = jarName.endsWith(".jar") ? jarName.substring(0, jarName.length() - 4) : jarName;
        int idx = base.length();
        while ((idx = base.lastIndexOf('-', idx - 1)) > 0) {
            if (Character.isDigit(base.charAt(idx + 1))) {
                return base.substring(0, idx);
            }
        }
        return base;
    }

    private static String extractVersion(String jarName) {
        String base = jarName.endsWith(".jar") ? jarName.substring(0, jarName.length() - 4) : jarName;
        int idx = base.length();
        while ((idx = base.lastIndexOf('-', idx - 1)) > 0) {
            if (Character.isDigit(base.charAt(idx + 1))) {
                return base.substring(idx + 1);
            }
        }
        return "unknown";
    }

    private static Options buildOptions() {
        Options options = new Options();
        options.addRequiredOption("j", "jars", true, "Directory containing JAR files to scan");
        options.addRequiredOption("o", "output", true, "Output directory for JSON files");
        options.addOption("v", "version", true, "Nablarch version label for meta.json (default: unknown)");
        options.addOption(null, "exclude-test", false, "Exclude test classes from output");
        options.addOption("h", "help", false, "Show this help message");
        return options;
    }

    private static List<File> findJars(File dir) {
        List<File> jars = new ArrayList<>();
        File[] files = dir.listFiles();
        if (files == null) return jars;
        for (File f : files) {
            if (f.isDirectory()) {
                jars.addAll(findJars(f));
            } else if (f.getName().endsWith(".jar")) {
                jars.add(f);
            }
        }
        return jars;
    }

    private static class MavenInfo {
        final String artifactId;
        final String groupId;
        final String version;

        MavenInfo(String artifactId, String groupId, String version) {
            this.artifactId = artifactId;
            this.groupId = groupId;
            this.version = version;
        }
    }
}
