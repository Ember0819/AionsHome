package com.aion.chat;

import org.junit.Test;

import static org.junit.Assert.*;

public class SvakomProtocolTest {
    @Test
    public void recognizesSl278FamilyWithoutAcceptingOtherDevices() {
        assertTrue(SvakomProtocol.acceptsDeviceName("SL278H"));
        assertTrue(SvakomProtocol.acceptsDeviceName("sl278h-01"));
        assertFalse(SvakomProtocol.acceptsDeviceName("SL278K"));
        assertFalse(SvakomProtocol.acceptsDeviceName("SL278"));
        assertFalse(SvakomProtocol.acceptsDeviceName("SL999X"));
        assertFalse(SvakomProtocol.acceptsDeviceName("SOSEXY"));
    }

    @Test
    public void encodesReferencePacketsExactly() {
        assertEquals("55080000010000", SvakomProtocol.encodeStretch(1));
        assertEquals("55080000070000", SvakomProtocol.encodeStretch(7));
        assertEquals("55080000000000", SvakomProtocol.encodeStretch(0));
        assertEquals("55030000080200", SvakomProtocol.encodeVibrate(8));
        assertEquals("550300000a0a00", SvakomProtocol.encode(SvakomProtocol.parse("VIBRATE:10:10")));
        assertEquals("55030000000000", SvakomProtocol.encodeVibrate(0));
        assertEquals("55050137000000", SvakomProtocol.encodeHeat(true));
        assertEquals("55050000000000", SvakomProtocol.encodeHeat(false));
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsOutOfRangeStretchMode() {
        SvakomProtocol.encodeStretch(8);
    }

    @Test
    public void parsesTimedHoldAndSequenceCommands() {
        SvakomProtocol.Command timed = SvakomProtocol.parse("[TOY:STRETCH:3|30]");
        assertEquals(SvakomProtocol.Kind.STRETCH, timed.kind);
        assertEquals(3, timed.value);
        assertEquals(30, timed.durationSeconds);

        SvakomProtocol.Command hold = SvakomProtocol.parse("HOLD:ALL|5");
        assertEquals(SvakomProtocol.Kind.HOLD, hold.kind);
        assertEquals("ALL", hold.scope);
        assertEquals(5, hold.durationSeconds);

        SvakomProtocol.Command sequence = SvakomProtocol.parse("SEQ:0=STRETCH:1;5=VIBRATE:2;8=STOP");
        assertEquals(SvakomProtocol.Kind.SEQUENCE, sequence.kind);
        assertEquals(3, sequence.events.size());
        assertEquals(0, sequence.events.get(0).offsetSeconds);
        assertEquals(SvakomProtocol.Kind.STOP, sequence.events.get(2).actions.get(0).kind);
    }

    @Test
    public void rejectsMalformedSequencesBeforeExecution() {
        assertParseFails("TUNE:100:40:2");
        assertParseFails("STRETCH:3:100:40");
        assertParseFails("VIBRATE:11");
        assertParseFails("SEQ:1=STRETCH:1;8=STOP");
        assertParseFails("SEQ:0=STRETCH:1;5=VIBRATE:2;5=STOP");
        assertParseFails("SEQ:0=HOLD:ALL:3+VIBRATE:1;8=STOP");
        assertParseFails("SEQ:0=STRETCH:1;8=VIBRATE:OFF");
    }

    private static void assertParseFails(String command) {
        try {
            SvakomProtocol.parse(command);
            fail("Expected parse failure for " + command);
        } catch (IllegalArgumentException expected) {
            assertNotNull(expected.getMessage());
        }
    }
}
