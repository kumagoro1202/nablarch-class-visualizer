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
        mapper.writeValue(new File(outputDir, "classes.json"), classes);
    }

    public void writeRelations(File outputDir, List<RelationInfo> relations) throws IOException {
        mapper.writeValue(new File(outputDir, "relations.json"), relations);
    }

    public void writeArtifacts(File outputDir, List<ArtifactInfo> artifacts) throws IOException {
        mapper.writeValue(new File(outputDir, "artifacts.json"), artifacts);
    }

    public void writeMeta(File outputDir, MetaInfo meta) throws IOException {
        mapper.writeValue(new File(outputDir, "meta.json"), meta);
    }
}
