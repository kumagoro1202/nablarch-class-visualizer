package com.nablarch.visualizer;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.io.File;
import java.io.IOException;
import java.util.List;

public class JsonOutputWriter {

    private final ObjectMapper mapper;

    public JsonOutputWriter() {
        this.mapper = new ObjectMapper();
        this.mapper.enable(SerializationFeature.INDENT_OUTPUT);
    }

    public void writeClasses(File outputDir, List<ClassInfo> classes) throws IOException {
        mapper.writeValue(new File(outputDir, "classes.json"), new ClassesWrapper(classes));
    }

    public void writeRelations(File outputDir, List<RelationInfo> relations) throws IOException {
        mapper.writeValue(new File(outputDir, "relations.json"), new RelationsWrapper(relations));
    }

    public void writeArtifacts(File outputDir, List<ArtifactInfo> artifacts) throws IOException {
        mapper.writeValue(new File(outputDir, "artifacts.json"), new ArtifactsWrapper(artifacts));
    }

    public void writeMeta(File outputDir, MetaInfo meta) throws IOException {
        mapper.writeValue(new File(outputDir, "meta.json"), meta);
    }

    private static class ClassesWrapper {
        public final List<ClassInfo> nodes;
        ClassesWrapper(List<ClassInfo> nodes) { this.nodes = nodes; }
    }

    private static class RelationsWrapper {
        public final List<RelationInfo> edges;
        RelationsWrapper(List<RelationInfo> edges) { this.edges = edges; }
    }

    private static class ArtifactsWrapper {
        public final List<ArtifactInfo> artifacts;
        ArtifactsWrapper(List<ArtifactInfo> artifacts) { this.artifacts = artifacts; }
    }
}
