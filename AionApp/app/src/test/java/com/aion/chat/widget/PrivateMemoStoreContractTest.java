package com.aion.chat.widget;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class PrivateMemoStoreContractTest {
    @Test
    public void usesDedicatedPrivateTableAndReturnsLatestRows() throws Exception {
        String source = read("src/main/java/com/aion/chat/widget/PrivateMemoStore.java");
        assertTrue(source.contains("widget_private_memos.db"));
        assertTrue(source.contains("DB_VERSION = 2"));
        assertTrue(source.contains("CREATE TABLE private_memos"));
        assertTrue(source.contains("status='active'"));
        assertTrue(source.contains("server_id"));
        assertTrue(source.contains("sync_state"));
        assertTrue(source.contains("ORDER BY updated_at DESC, id DESC LIMIT ?"));
        assertTrue(source.contains("Math.max(1, limit)"));
    }

    @Test
    public void doesNotDependOnServerOrAiMemoryStorage() throws Exception {
        String source = read("src/main/java/com/aion/chat/widget/PrivateMemoStore.java");
        assertFalse(source.contains("OkHttp"));
        assertFalse(source.contains("/api/"));
        assertFalse(source.contains("memories"));
    }

    @Test
    public void recorderUsesShortLivedVoiceRecognitionAudioAndWavOutput() throws Exception {
        String source = read("src/main/java/com/aion/chat/widget/WidgetAudioRecorder.java");
        assertTrue(source.contains("SAMPLE_RATE = 16000"));
        assertTrue(source.contains("MediaRecorder.AudioSource.VOICE_RECOGNITION"));
        assertTrue(source.contains("recorder.release()"));
        assertTrue(source.contains("writeWav"));
    }

    @Test
    public void asrClientReusesSavedRouteAndExistingEndpoint() throws Exception {
        String source = read("src/main/java/com/aion/chat/widget/WidgetAsrClient.java");
        assertTrue(source.contains("saved_url"));
        assertTrue(source.contains("/api/voice/transcribe"));
        assertTrue(source.contains("CookieManager.getInstance()"));
        assertFalse(source.contains("/api/memories"));
    }

    @Test
    public void widgetLayoutSupportsTwoLineBannerAndBottomAlignedMicrophone() throws Exception {
        String layout = read("src/main/res/layout/widget_companion.xml");
        assertTrue(layout.contains("@+id/widget_banner_container"));
        assertTrue(layout.contains("@+id/widget_banner_text"));
        assertTrue(layout.contains("android:maxLines=\"2\""));
        assertTrue(layout.contains("android:layout_alignParentBottom=\"true\""));
        assertTrue(layout.contains("android:layout_width=\"72dp\""));
        assertTrue(layout.contains("android:textSize=\"14sp\""));
    }

    @Test
    public void memoSyncIsOneShotAndRecorderIsSharedWithWebView() throws Exception {
        String sync = read("src/main/java/com/aion/chat/widget/PrivateMemoSyncClient.java");
        String bridge = read("src/main/java/com/aion/chat/widget/PrivateMemoBridge.java");
        assertTrue(sync.contains("/api/private-memos"));
        assertFalse(sync.contains("Service"));
        assertTrue(bridge.contains("WidgetRecordActivity.class"));
        assertTrue(bridge.contains("@JavascriptInterface"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8);
    }
}
