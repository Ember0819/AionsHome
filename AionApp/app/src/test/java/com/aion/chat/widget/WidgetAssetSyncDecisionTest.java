package com.aion.chat.widget;

import org.junit.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class WidgetAssetSyncDecisionTest {
    @Test
    public void changedBannerVersionRequiresFreshDownload() throws Exception {
        Path cached = Files.createTempFile("widget-banner", ".png");
        try {
            assertTrue(WidgetAssetSyncDecision.needsDownload(
                    "old-version", cached.toString(), "new-version"));
            assertFalse(WidgetAssetSyncDecision.needsDownload(
                    "new-version", cached.toString(), "new-version"));
        } finally {
            Files.deleteIfExists(cached);
        }
    }

    @Test
    public void missingCachedFileRequiresDownloadEvenWhenVersionMatches() {
        assertTrue(WidgetAssetSyncDecision.needsDownload(
                "same", "Z:/missing/widget-banner.png", "same"));
    }
}
