package com.aion.chat;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class TtsAudioUrlResolverTest {
    @Test
    public void resolvesServerRelativeTtsUrlAgainstCurrentPage() {
        assertEquals(
                "https://home.example.com/api/tts/audio/message_s0",
                TtsAudioUrlResolver.resolve(
                        "https://home.example.com/chat?room=1",
                        "/api/tts/audio/message_s0"));
    }

    @Test
    public void rejectsNonHttpPlaybackSources() {
        assertNull(TtsAudioUrlResolver.resolve(
                "https://home.example.com/chat",
                "file:///sdcard/private.mp3"));
        assertNull(TtsAudioUrlResolver.resolve(
                "https://home.example.com/chat",
                "javascript:alert(1)"));
    }
}
