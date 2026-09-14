package com.aion.chat.widget;

import org.junit.Test;

import java.util.Calendar;
import java.util.TimeZone;

import static org.junit.Assert.assertEquals;

public class WidgetTimeThemeTest {
    @Test
    public void mapsEveryThemeBoundary() {
        assertEquals(WidgetTimeTheme.Period.NIGHT, WidgetTimeTheme.periodForMinutes(4 * 60 + 59));
        assertEquals(WidgetTimeTheme.Period.DAWN, WidgetTimeTheme.periodForMinutes(5 * 60));
        assertEquals(WidgetTimeTheme.Period.DAWN, WidgetTimeTheme.periodForMinutes(8 * 60 + 29));
        assertEquals(WidgetTimeTheme.Period.MORNING, WidgetTimeTheme.periodForMinutes(8 * 60 + 30));
        assertEquals(WidgetTimeTheme.Period.MORNING, WidgetTimeTheme.periodForMinutes(11 * 60 + 29));
        assertEquals(WidgetTimeTheme.Period.NOON, WidgetTimeTheme.periodForMinutes(11 * 60 + 30));
        assertEquals(WidgetTimeTheme.Period.NOON, WidgetTimeTheme.periodForMinutes(13 * 60 + 59));
        assertEquals(WidgetTimeTheme.Period.AFTERNOON, WidgetTimeTheme.periodForMinutes(14 * 60));
        assertEquals(WidgetTimeTheme.Period.AFTERNOON, WidgetTimeTheme.periodForMinutes(17 * 60 + 59));
        assertEquals(WidgetTimeTheme.Period.NIGHT, WidgetTimeTheme.periodForMinutes(18 * 60));
    }

    @Test
    public void returnsNextBoundaryInLocalTimezone() {
        TimeZone zone = TimeZone.getTimeZone("Asia/Shanghai");
        Calendar now = Calendar.getInstance(zone);
        now.set(2026, Calendar.AUGUST, 25, 8, 29, 30);
        now.set(Calendar.MILLISECOND, 0);

        Calendar expected = Calendar.getInstance(zone);
        expected.set(2026, Calendar.AUGUST, 25, 8, 30, 0);
        expected.set(Calendar.MILLISECOND, 0);

        assertEquals(expected.getTimeInMillis(),
                WidgetTimeTheme.nextBoundaryMillis(now.getTimeInMillis(), zone));
    }

    @Test
    public void wrapsNightBoundaryToNextMorning() {
        TimeZone zone = TimeZone.getTimeZone("Asia/Shanghai");
        Calendar now = Calendar.getInstance(zone);
        now.set(2026, Calendar.AUGUST, 25, 23, 0, 0);
        now.set(Calendar.MILLISECOND, 0);

        Calendar expected = Calendar.getInstance(zone);
        expected.set(2026, Calendar.AUGUST, 26, 5, 0, 0);
        expected.set(Calendar.MILLISECOND, 0);

        assertEquals(expected.getTimeInMillis(),
                WidgetTimeTheme.nextBoundaryMillis(now.getTimeInMillis(), zone));
    }

    @Test
    public void bannerNoLongerAddsAnExpiryAlarm() {
        assertEquals(0L, WidgetBannerState.activeExpiry(null, 10_000L));
    }
}
