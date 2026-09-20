package com.aion.chat;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;

import static org.junit.Assert.*;

public class SvakomCommandSchedulerTest {
    @Test public void loopIncludesRestAndStopsWithoutResuming() {
        FakeClock clock = new FakeClock();
        List<String> writes = new ArrayList<>();
        SvakomCommandScheduler scheduler = new SvakomCommandScheduler(hex -> { writes.add(hex); return true; }, clock, null);
        scheduler.execute("LOOP:1,1,2,3,2;1,0,0,0,0");
        clock.advance(1000);
        assertEquals(0, scheduler.getStretch());
        assertEquals(0, scheduler.getVibrate());
        assertEquals(0, scheduler.getFlap());
        clock.advance(1000);
        assertEquals(1, scheduler.getStretch());
        assertEquals(2, scheduler.getFlap());
        scheduler.stop();
        int stopped = writes.size();
        clock.advance(6000);
        assertEquals(stopped, writes.size());
    }
    @Test
    public void liveVibrationLevelPreservesDeadlineAndOtherChannels() {
        FakeClock clock = new FakeClock();
        List<String> writes = new ArrayList<>();
        SvakomCommandScheduler scheduler = new SvakomCommandScheduler(hex -> { writes.add(hex); return true; }, clock, null);
        scheduler.updateVibrationLevel(8);
        assertTrue(writes.isEmpty());
        scheduler.execute("STRETCH:3");
        scheduler.execute("FLAP:2");
        scheduler.execute("VIBRATE:1:2|5");
        clock.advance(2000);
        scheduler.updateVibrationLevel(8);
        assertEquals("55030000010800", writes.get(writes.size() - 1));
        assertEquals(3, scheduler.getStretch());
        assertEquals(2, scheduler.getFlap());
        clock.advance(3000);
        assertEquals(0, scheduler.getVibrate());
        assertEquals("55030000000000", writes.get(writes.size() - 1));
        int stopped = writes.size();
        scheduler.updateVibrationLevel(4);
        assertEquals(stopped, writes.size());
        scheduler.execute("SEQ:0=VIBRATE:1:2;5=STOP");
        scheduler.updateVibrationLevel(6);
        assertTrue(scheduler.isTimelineRunning());
        scheduler.execute("HOLD:VIBRATE|1");
        int held = writes.size();
        scheduler.updateVibrationLevel(9);
        assertEquals(held, writes.size());
        clock.advance(1000);
        assertEquals("55030000010600", writes.get(writes.size() - 1));
        clock.advance(4000);
        assertEquals(0, scheduler.getVibrate());
    }
    @Test
    public void timelinePreservesUntouchedChannelDeadline() {
        FakeClock clock = new FakeClock();
        SvakomCommandScheduler scheduler = new SvakomCommandScheduler(hex -> true, clock, null);
        scheduler.execute("FLAP:1|5");
        scheduler.execute("STRETCH:2|3");
        scheduler.execute("SEQ:0=STRETCH:1;10=STOP");
        clock.advance(5000);
        assertEquals(0, scheduler.getFlap());
        assertEquals(1, scheduler.getStretch());
        scheduler.stop();
    }
    @Test
    public void independentFlapUsesFactoryPacketAndStopsWithoutRecovery() {
        FakeClock clock = new FakeClock();
        List<String> writes = new ArrayList<>();
        SvakomCommandScheduler scheduler = new SvakomCommandScheduler(hex -> { writes.add(hex); return true; }, clock, null);
        for (int mode = 1; mode <= 7; mode++) {
            assertEquals("550700000" + mode + "0000", SvakomProtocol.encode(SvakomProtocol.parse("FLAP:" + mode)));
        }
        scheduler.execute("FLAP:1|5");
        assertEquals(0, scheduler.getStretch());
        assertEquals(0, scheduler.getVibrate());
        clock.advance(4999);
        assertEquals(1, writes.size());
        clock.advance(1);
        assertEquals("55070000000000", writes.get(writes.size() - 1));
        scheduler.execute("FLAP:7");
        scheduler.execute("HOLD:FLAP|2");
        scheduler.stop();
        int stopped = writes.size();
        clock.advance(10000);
        assertEquals(stopped, writes.size());
        assertEquals(0, clock.activeTasks());
        scheduler.execute("FLAP:1|2");
        scheduler.execute("HOLD:FLAP|3");
        clock.advance(5000);
        assertEquals(0, scheduler.getFlap());
    }
    private static final class FakeClock implements SvakomCommandScheduler.Clock {
        private static final class Task implements SvakomCommandScheduler.Cancellation {
            final long at;
            final Runnable runnable;
            boolean cancelled;
            Task(long at, Runnable runnable) { this.at = at; this.runnable = runnable; }
            @Override public void cancel() { cancelled = true; }
        }

        long now;
        final List<Task> tasks = new ArrayList<>();

        @Override public long now() { return now; }
        @Override public SvakomCommandScheduler.Cancellation schedule(Runnable runnable, long delayMs) {
            Task task = new Task(now + delayMs, runnable);
            tasks.add(task);
            return task;
        }
        void advance(long milliseconds) {
            long target = now + milliseconds;
            while (true) {
                Task next = tasks.stream().filter(task -> !task.cancelled && task.at <= target)
                        .min(Comparator.comparingLong(task -> task.at)).orElse(null);
                if (next == null) break;
                tasks.remove(next);
                now = next.at;
                next.runnable.run();
            }
            now = target;
            for (Iterator<Task> iterator = tasks.iterator(); iterator.hasNext();) {
                if (iterator.next().cancelled) iterator.remove();
            }
        }
        int activeTasks() {
            int count = 0;
            for (Task task : tasks) if (!task.cancelled) count++;
            return count;
        }
    }

    @Test
    public void durationReplacementHoldAndStopAreGenerationSafe() {
        FakeClock clock = new FakeClock();
        List<String> writes = new ArrayList<>();
        SvakomCommandScheduler scheduler = new SvakomCommandScheduler(hex -> { writes.add(hex); return true; }, clock, null);

        scheduler.execute("STRETCH:1|10");
        clock.advance(5000);
        scheduler.execute("STRETCH:2|10");
        clock.advance(5000);
        assertEquals(2, scheduler.getStretch());
        clock.advance(5000);
        assertEquals("55080000000000", writes.get(writes.size() - 1));

        scheduler.execute("STRETCH:3");
        scheduler.execute("HOLD:STRETCH|3");
        assertEquals("55080000000000", writes.get(writes.size() - 1));
        clock.advance(3000);
        assertEquals("55080000030000", writes.get(writes.size() - 1));

        scheduler.execute("HOLD:STRETCH|3");
        scheduler.stop();
        int writesAfterStop = writes.size();
        clock.advance(5000);
        assertEquals(writesAfterStop, writes.size());
        assertEquals(0, clock.activeTasks());
        assertEquals("55050000000000", writes.get(writes.size() - 1));
    }

    @Test
    public void timelineRunsLocallyAndManualActionCancelsTheRemainder() {
        FakeClock clock = new FakeClock();
        List<String> writes = new ArrayList<>();
        SvakomCommandScheduler scheduler = new SvakomCommandScheduler(hex -> { writes.add(hex); return true; }, clock, null);

        scheduler.execute("SEQ:0=STRETCH:1;5=VIBRATE:2;8=STOP");
        assertEquals("55080000010000", writes.get(writes.size() - 1));
        clock.advance(5000);
        assertEquals("55030000020200", writes.get(writes.size() - 1));

        scheduler.execute("HEAT:ON");
        int afterOverride = writes.size();
        clock.advance(10000);
        assertEquals("independent modes need no background refresh", afterOverride, writes.size());
        assertEquals(1, scheduler.getStretch());
    }

    @Test
    public void externalHoldAllPausesAndShiftsTheRemainingTimeline() {
        FakeClock clock = new FakeClock();
        List<String> writes = new ArrayList<>();
        SvakomCommandScheduler scheduler = new SvakomCommandScheduler(hex -> { writes.add(hex); return true; }, clock, null);

        scheduler.execute("SEQ:0=STRETCH:1;10=VIBRATE:2;20=STOP");
        clock.advance(3000);
        scheduler.execute("HOLD:ALL|5");
        assertEquals(0, scheduler.getStretch());
        clock.advance(5000);
        assertEquals(1, scheduler.getStretch());
        clock.advance(6999);
        assertEquals(0, scheduler.getVibrate());
        clock.advance(1);
        assertEquals(2, scheduler.getVibrate());
    }

    @Test
    public void factoryBodyModeNeedsNoLinkedRefresh() {
        FakeClock clock = new FakeClock();
        List<String> writes = new ArrayList<>();
        SvakomCommandScheduler scheduler = new SvakomCommandScheduler(hex -> { writes.add(hex); return true; }, clock, null);

        scheduler.execute("STRETCH:1");
        assertEquals(1, writes.size());
        clock.advance(5000);
        assertEquals(1, writes.size());
        scheduler.stop();
        int afterStop = writes.size();
        clock.advance(5000);
        assertEquals(afterStop, writes.size());
    }

    @Test(expected = IllegalStateException.class)
    public void failedWriteDoesNotContinueTheTimeline() {
        FakeClock clock = new FakeClock();
        SvakomCommandScheduler scheduler = new SvakomCommandScheduler(hex -> false, clock, null);
        scheduler.execute("SEQ:0=STRETCH:1;5=STOP");
    }

    @Test
    public void channelsAndDurationsRemainIndependent() {
        FakeClock clock = new FakeClock();
        List<String> writes = new ArrayList<>();
        SvakomCommandScheduler scheduler = new SvakomCommandScheduler(hex -> { writes.add(hex); return true; }, clock, null);
        scheduler.execute("STRETCH:3|10");
        scheduler.execute("VIBRATE:10:2|8");
        scheduler.execute("FLAP:1|5");
        assertEquals(java.util.Arrays.asList("55080000030000", "550300000a0200", "55070000010000"), writes);
        clock.advance(5000);
        assertEquals(3, scheduler.getStretch());
        assertEquals(10, scheduler.getVibrate());
        assertEquals(0, scheduler.getFlap());
        assertEquals(4, writes.size());
        clock.advance(5000);
        assertEquals(0, scheduler.getStretch());
        assertEquals(0, scheduler.getVibrate());
        assertEquals(0, clock.activeTasks());
        scheduler.execute("SEQ:0=STRETCH:3+VIBRATE:10:2+FLAP:1;2=VIBRATE:OFF+FLAP:4;5=STOP");
        clock.advance(2000);
        assertEquals(3, scheduler.getStretch());
        assertEquals(0, scheduler.getVibrate());
        assertEquals(4, scheduler.getFlap());
        clock.advance(3000);
        assertEquals(0, scheduler.getStretch());
        assertEquals(0, scheduler.getFlap());
        scheduler.execute("STRETCH:1");
        scheduler.execute("FLAP:2");
        scheduler.execute("HOLD:ALL|3");
        scheduler.execute("FLAP:OFF");
        clock.advance(3000);
        assertEquals(1, scheduler.getStretch());
        assertEquals(0, scheduler.getFlap());
        scheduler.stop();
    }

    @Test
    public void disconnectCancellationDropsCallbacksWithoutWritingStops() {
        FakeClock clock = new FakeClock();
        List<String> writes = new ArrayList<>();
        SvakomCommandScheduler scheduler = new SvakomCommandScheduler(hex -> { writes.add(hex); return true; }, clock, null);
        scheduler.execute("STRETCH:2|10");
        int beforeCancel = writes.size();
        scheduler.cancelPending();
        clock.advance(20000);
        assertEquals(beforeCancel, writes.size());
        assertEquals(0, clock.activeTasks());
    }
}
