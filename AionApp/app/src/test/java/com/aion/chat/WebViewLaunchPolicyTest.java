package com.aion.chat;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class WebViewLaunchPolicyTest {
    @Test
    public void addressPickerSelectionWins() {
        assertEquals(
                "http://selected/chat",
                WebViewLaunchPolicy.resolveUrl(
                        "http://selected/chat",
                        true,
                        "http://saved/chat"));
    }

    @Test
    public void desktopColdLaunchUsesRememberedAddress() {
        assertEquals(
                "http://saved/chat",
                WebViewLaunchPolicy.resolveUrl(
                        null,
                        true,
                        "http://saved/chat"));
    }

    @Test
    public void desktopColdLaunchWithoutRememberedChoiceShowsAddressPicker() {
        assertNull(WebViewLaunchPolicy.resolveUrl(
                null,
                false,
                "http://saved/chat"));
    }

    @Test
    public void coldAndWarmFeatureLaunchesKeepTheChatShell() {
        String destination = "https://selected/chatroom?room=room%20%26%3F%23";
        String expected = "https://selected/chat?page=%2Fchatroom%3Froom%3Droom%2520%2526%253F%2523";
        assertEquals(expected, WebViewLaunchPolicy.resolveUrl(destination, false, null));
        assertEquals(expected, WebViewLaunchPolicy.toShellUrl(destination));
        assertEquals(expected, WebViewLaunchPolicy.resolveUrl(null, true, destination));
        assertEquals(expected, WebViewLaunchPolicy.toShellUrl(expected));
    }

    @Test
    public void homeAndOtherFeaturesShareTheSameShellEntry() {
        assertEquals("http://selected:8080/chat",
                WebViewLaunchPolicy.toShellUrl("http://selected:8080/"));
        assertEquals("http://selected:8080/chat?page=%2Ftheater%3Fid%3Dstory-1%23scene-2",
                WebViewLaunchPolicy.toShellUrl("http://selected:8080/theater?id=story-1#scene-2"));
        assertEquals("http://selected/chat?conv=private-1",
                WebViewLaunchPolicy.toShellUrl("http://selected/chat?conv=private-1"));
    }
}
