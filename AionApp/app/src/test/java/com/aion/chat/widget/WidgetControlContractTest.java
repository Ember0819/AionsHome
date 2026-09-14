package com.aion.chat.widget;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import javax.xml.parsers.DocumentBuilderFactory;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class WidgetControlContractTest {
    @Test
    public void widgetUsesIndependentDoubleTapTargetsAndKeepsMicrophoneSeparate() throws Exception {
        String provider = read("src/main/java/com/aion/chat/widget/CompanionWidgetProvider.java");
        String controller = read("src/main/java/com/aion/chat/widget/WidgetInteractionController.java");
        String renderer = read("src/main/java/com/aion/chat/widget/CompanionWidgetRenderer.java");

        assertTrue(provider.contains("ACTION_WIDGET_TAP_LEFT"));
        assertTrue(provider.contains("ACTION_WIDGET_TAP_RIGHT"));
        assertTrue(provider.contains("ACTION_WIDGET_TAP_BANNER"));
        assertTrue(controller.contains("DOUBLE_TAP_MILLIS = 450L"));
        assertTrue(controller.contains("TARGET_LEFT") && controller.contains("\"connor\""));
        assertTrue(controller.contains("TARGET_RIGHT") && controller.contains("\"aion\""));
        assertTrue(renderer.contains("widget_companion_left"));
        assertTrue(renderer.contains("widget_companion_right"));
        assertTrue(renderer.contains("widget_banner_container"));
        assertTrue(renderer.contains("widget_microphone"));
    }

    @Test
    public void syncIsOneShotAndUsesWidgetControlApiAndPushRefresh() throws Exception {
        String sync = read("src/main/java/com/aion/chat/widget/WidgetStateSyncClient.java");
        String service = read("src/main/java/com/aion/chat/AionPushService.java");
        String activity = read("src/main/java/com/aion/chat/WebViewActivity.java");

        assertTrue(sync.contains("/api/widget-control/state"));
        assertTrue(sync.contains("/api/widget-control/actors/"));
        assertTrue(sync.contains("/api/widget-control/banner/clear"));
        assertFalse(sync.contains("extends Service"));
        assertTrue(service.contains("case \"widget_state_changed\""));
        assertTrue(service.contains("WidgetStateSyncClient.sync"));
        assertTrue(activity.contains("WidgetStateSyncClient.sync(this)"));
    }

    @Test
    public void bannerPersistsAndRendererLoadsDownloadedCharacterArt() throws Exception {
        String banner = read("src/main/java/com/aion/chat/widget/WidgetBannerState.java");
        String renderer = read("src/main/java/com/aion/chat/widget/CompanionWidgetRenderer.java");

        assertFalse(banner.contains("DISPLAY_MILLIS"));
        assertFalse(banner.contains("KEY_EXPIRES_AT"));
        assertTrue(renderer.contains("WidgetStateStore"));
        assertTrue(renderer.contains("setImageViewBitmap"));
        assertTrue(renderer.contains("setImageViewResource"));
    }

    @Test
    public void characterSlotsPrioritizeAConsistentVisualHeight() throws Exception {
        String layout = read("src/main/res/layout/widget_companion.xml");
        assertTrue(characterBlock(layout, "widget_companion_left")
                .contains("android:layout_width=\"180dp\""));
        assertTrue(characterBlock(layout, "widget_companion_right")
                .contains("android:layout_width=\"180dp\""));
    }

    @Test
    public void narrowCharactersStayAnchoredToTheirOuterEdges() throws Exception {
        Document layout = DocumentBuilderFactory.newInstance().newDocumentBuilder()
                .parse(Paths.get("src/main/res/layout/widget_companion.xml").toFile());
        assertEquals("fitStart", imageScaleType(layout, "@+id/widget_companion_left"));
        assertEquals("fitEnd", imageScaleType(layout, "@+id/widget_companion_right"));
    }

    @Test
    public void memoAreaCentersEmptyOneOrTwoVisibleRows() throws Exception {
        Document layout = DocumentBuilderFactory.newInstance().newDocumentBuilder()
                .parse(Paths.get("src/main/res/layout/widget_companion.xml").toFile());
        Element area = elementById(layout, "@+id/widget_memo_area");
        Element hint = elementById(layout, "@+id/widget_empty_hint");
        Element first = elementById(layout, "@+id/widget_memo_first");
        Element second = elementById(layout, "@+id/widget_memo_second");

        assertEquals("LinearLayout", area.getTagName());
        assertEquals("center", area.getAttribute("android:gravity"));
        assertEquals("vertical", area.getAttribute("android:orientation"));
        assertEquals("#FFFFFF", hint.getAttribute("android:textColor"));
        assertEquals(area, hint.getParentNode());
        assertEquals(area, first.getParentNode());
        assertEquals(area, second.getParentNode());
    }

    @Test
    public void bannerTextCentersOneOrTwoLinesOnCloth() throws Exception {
        Document layout = DocumentBuilderFactory.newInstance().newDocumentBuilder()
                .parse(Paths.get("src/main/res/layout/widget_companion.xml").toFile());
        Element topSpace = elementById(layout, "@+id/widget_banner_top_space");
        Element text = elementById(layout, "@+id/widget_banner_text");
        Element bottomSpace = elementById(layout, "@+id/widget_banner_bottom_space");

        assertEquals("55", topSpace.getAttribute("android:layout_weight"));
        assertEquals("30", text.getAttribute("android:layout_weight"));
        assertEquals("15", bottomSpace.getAttribute("android:layout_weight"));
        assertEquals("center", text.getAttribute("android:gravity"));
        assertEquals("2", text.getAttribute("android:maxLines"));
        assertEquals("18sp", text.getAttribute("android:textSize"));
    }

    @Test
    public void backgroundSyncInitializesWebCookieAccessOnMainThread() throws Exception {
        String sync = read("src/main/java/com/aion/chat/widget/WidgetStateSyncClient.java");
        assertTrue(sync.contains("readCookieOnMainThread"));
        assertTrue(sync.contains("new Handler(Looper.getMainLooper())"));
        assertTrue(sync.contains("CountDownLatch"));
    }

    private static String characterBlock(String layout, String id) {
        int start = layout.indexOf("@+id/" + id);
        int end = layout.indexOf("/>", start);
        return start < 0 || end < 0 ? "" : layout.substring(start, end);
    }

    private static String imageScaleType(Document layout, String id) {
        NodeList images = layout.getElementsByTagName("ImageView");
        for (int i = 0; i < images.getLength(); i++) {
            Element image = (Element) images.item(i);
            if (id.equals(image.getAttribute("android:id"))) {
                return image.getAttribute("android:scaleType");
            }
        }
        return "";
    }

    private static Element elementById(Document layout, String id) {
        NodeList all = layout.getElementsByTagName("*");
        for (int i = 0; i < all.getLength(); i++) {
            Element element = (Element) all.item(i);
            if (id.equals(element.getAttribute("android:id"))) return element;
        }
        throw new AssertionError("Missing view " + id);
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8);
    }
}
