package com.nablarch.visualizer;

import org.apache.commons.cli.*;

import java.io.File;
import java.io.IOException;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

public class Main {

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
        String version = cmd.getOptionValue("version", "unknown");
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

        ClassMetadataExtractor classExtractor = new ClassMetadataExtractor();
        RelationExtractor relationExtractor = new RelationExtractor();
        JsonOutputWriter writer = new JsonOutputWriter();

        List<ClassInfo> allClasses = new ArrayList<>();
        List<ArtifactInfo> artifacts = new ArrayList<>();

        for (File jar : jarFiles) {
            System.out.println("Scanning: " + jar.getName());
            try {
                List<ClassInfo> classes = classExtractor.extractFromJar(jar, jar.getName());
                if (excludeTest) {
                    classes = classes.stream()
                            .filter(c -> !c.isTest)
                            .collect(Collectors.toList());
                }
                allClasses.addAll(classes);
                artifacts.add(new ArtifactInfo(jar.getName(), jar.getAbsolutePath(), classes.size()));
            } catch (IOException e) {
                System.err.println("Failed to scan " + jar.getName() + ": " + e.getMessage());
            }
        }

        System.out.println("Total classes extracted: " + allClasses.size());

        Set<String> knownClassNames = allClasses.stream()
                .map(c -> c.name)
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

        MetaInfo meta = new MetaInfo(
                allClasses.size(),
                allRelations.size(),
                artifacts.size(),
                Instant.now().toString(),
                version
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

    private static Options buildOptions() {
        Options options = new Options();
        options.addRequiredOption("j", "jars", true, "Directory containing JAR files to scan");
        options.addRequiredOption("o", "output", true, "Output directory for JSON files");
        options.addOption("v", "version", true, "Version label for meta.json (default: unknown)");
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
}
