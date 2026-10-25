package kr.ac.seoil.motionaffect;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.junit.Test;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.util.List;

public class PendingEventsTest {
    @Test
    public void appendThenDrainKeepsRowsAndDeletesFile() throws IOException {
        File dir = Files.createTempDirectory("life").toFile();
        PendingEvents.append(dir, 10L, 20L, "affect", "v=0.1;a=-0.2;i=0.2;e=평온;j=;pa=;pv=;src=overlay");
        PendingEvents.append(dir, 11L, 21L, "rate", "like");
        File events = new File(dir, "events.csv");
        try (BufferedWriter w = new BufferedWriter(new FileWriter(events))) {
            w.write("t_ns,wall_ms,type,app,media,value\n");
            assertEquals(2, PendingEvents.drainInto(dir, w));
        }
        List<String> lines = Files.readAllLines(events.toPath());
        assertEquals(3, lines.size());
        assertEquals("10,20,affect,,,v=0.1;a=-0.2;i=0.2;e=평온;j=;pa=;pv=;src=overlay", lines.get(1));
        assertEquals("11,21,rate,,,like", lines.get(2));
        assertFalse(new File(dir, PendingEvents.FILE).exists());
    }

    @Test
    public void drainWithoutFileIsNoop() throws IOException {
        File dir = Files.createTempDirectory("life2").toFile();
        try (BufferedWriter w = new BufferedWriter(new FileWriter(new File(dir, "events.csv")))) {
            assertEquals(0, PendingEvents.drainInto(dir, w));
        }
    }
}
