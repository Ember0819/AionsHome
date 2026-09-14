package com.aion.chat.widget;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class WidgetMemoPresentationTest {
    @Test
    public void emptyListShowsOnlyTheSmallHint() {
        WidgetMemoPresentation view = WidgetMemoPresentation.from(Collections.emptyList());

        assertTrue(view.emptyHintVisible);
        assertFalse(view.firstVisible);
        assertFalse(view.secondVisible);
        assertEquals("", view.firstText);
        assertEquals("", view.secondText);
    }

    @Test
    public void oneMemoShowsOneCardWithoutPlaceholder() {
        WidgetMemoPresentation view = WidgetMemoPresentation.from(
                Collections.singletonList(memo("买牛奶")));

        assertFalse(view.emptyHintVisible);
        assertTrue(view.firstVisible);
        assertFalse(view.secondVisible);
        assertEquals("买牛奶", view.firstText);
        assertEquals("", view.secondText);
    }

    @Test
    public void twoMemosShowBothRealCards() {
        WidgetMemoPresentation view = WidgetMemoPresentation.from(
                Arrays.asList(memo("第一条"), memo("第二条")));

        assertFalse(view.emptyHintVisible);
        assertTrue(view.firstVisible);
        assertTrue(view.secondVisible);
        assertEquals("第一条", view.firstText);
        assertEquals("第二条", view.secondText);
    }

    private static PrivateMemo memo(String content) {
        return new PrivateMemo(0L, "id", content, "active", "app",
                0L, 0L, "synced");
    }
}
