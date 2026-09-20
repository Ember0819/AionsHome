package com.aion.chat;

import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Android-independent SAVKOM scheduler. The Android bridge supplies a Handler-backed Clock
 * and a serialized GATT Writer; unit tests supply deterministic fakes.
 */
public final class SvakomCommandScheduler {
    public interface Writer { boolean write(String hex); }
    public interface Cancellation { void cancel(); }
    public interface Clock {
        long now();
        Cancellation schedule(Runnable runnable, long delayMs);
    }
    public interface Listener {
        void onAction(String action);
        void onError(String message);
    }

    private static final class HoldRecord {
        Cancellation cancellation;
        final int generation;
        final List<SvakomProtocol.Command> restores;
        HoldRecord(int generation, List<SvakomProtocol.Command> restores) {
            this.generation = generation;
            this.restores = restores;
        }
    }

    private static final class Timeline {
        final SvakomProtocol.Command sequence;
        final int generation;
        int index;
        Cancellation next;
        long nextDueAt;
        Timeline(SvakomProtocol.Command sequence, int generation) {
            this.sequence = sequence;
            this.generation = generation;
        }
    }

    private final Writer writer;
    private final Clock clock;
    private final Listener listener;
    private final Map<SvakomProtocol.Kind, Cancellation> timers = new EnumMap<>(SvakomProtocol.Kind.class);
    private final Map<String, HoldRecord> holds = new HashMap<>();
    private int stopGeneration;
    private int timelineGeneration;
    private int stretch;
    private int vibrate;
    private int flap;
    private boolean heat;
    private Timeline timeline;
    private final Map<SvakomProtocol.Kind, SvakomProtocol.Command> desired = new EnumMap<>(SvakomProtocol.Kind.class);

    public SvakomCommandScheduler(Writer writer, Clock clock, Listener listener) {
        if (writer == null || clock == null) throw new IllegalArgumentException("writer and clock are required");
        this.writer = writer;
        this.clock = clock;
        this.listener = listener;
    }

    public synchronized void execute(String raw) {
        SvakomProtocol.Command command = SvakomProtocol.parse(raw);
        switch (command.kind) {
            case STOP:
                stop();
                return;
            case HOLD:
                hold(command.scope, command.durationSeconds, true);
                return;
            case SEQUENCE:
                startSequence(command);
                return;
            default:
                cancelTimeline();
                cancelTimer(command.kind);
                cancelHoldsFor(command.kind);
                writeOrdinary(command);
                scheduleDuration(command);
        }
    }

    /** Update only the active vibration channel, preserving timers, HOLD and Timeline. */
    public synchronized void updateVibrationLevel(int level) {
        if (level < 1 || level > 10) throw new IllegalArgumentException("vibration level must be 1..10");
        if (vibrate == 0) return;
        writeOrdinary(SvakomProtocol.parse("VIBRATE:" + vibrate + ":" + level));
    }

    public synchronized void stop() {
        stopGeneration += 1;
        cancelTimeline();
        cancelAllTimers();
        cancelAllHolds();
        boolean ok = writer.write(SvakomProtocol.encodeStretch(0));
        ok = writer.write(SvakomProtocol.encodeVibrate(0)) && ok;
        ok = writer.write(SvakomProtocol.encodeFlap(0)) && ok;
        ok = writer.write(SvakomProtocol.encodeHeat(false)) && ok;
        stretch = 0;
        vibrate = 0;
        flap = 0;
        heat = false;
        notifyAction("STOP");
        if (!ok) throw new IllegalStateException("one or more SAVKOM STOP writes failed");
    }

    /** Cancel all future work after a transport loss without attempting writes. */
    public synchronized void cancelPending() {
        stopGeneration += 1;
        cancelTimeline();
        cancelAllTimers();
        cancelAllHolds();
        stretch = 0;
        vibrate = 0;
        flap = 0;
        heat = false;
    }

    public synchronized int getStretch() { return stretch; }
    public synchronized int getVibrate() { return vibrate; }
    public synchronized int getFlap() { return flap; }
    public synchronized boolean isHeatOn() { return heat; }
    public synchronized boolean isTimelineRunning() { return timeline != null; }

    private void writeOrdinary(SvakomProtocol.Command command) {
        if (!writer.write(SvakomProtocol.encode(command))) {
            cancelTimeline();
            notifyError("SAVKOM write rejected: " + command.raw);
            throw new IllegalStateException("SAVKOM write rejected: " + command.raw);
        }
        desired.put(command.kind, command);
        if (command.kind == SvakomProtocol.Kind.STRETCH) stretch = command.value;
        else if (command.kind == SvakomProtocol.Kind.VIBRATE) vibrate = command.value;
        else if (command.kind == SvakomProtocol.Kind.FLAP) flap = command.value;
        else if (command.kind == SvakomProtocol.Kind.HEAT) heat = command.enabled();
        notifyAction(command.raw);
    }

    private void scheduleDuration(SvakomProtocol.Command command) {
        if (command.durationSeconds <= 0) return;
        final SvakomProtocol.Kind kind = command.kind;
        final int generation = stopGeneration;
        Cancellation cancellation = clock.schedule(() -> {
            synchronized (SvakomCommandScheduler.this) {
                if (generation != stopGeneration || !timers.containsKey(kind)) return;
                timers.remove(kind);
                cancelHoldsFor(kind);
                writeOrdinary(offCommand(kind));
            }
        }, command.durationSeconds * 1000L);
        timers.put(kind, cancellation);
    }

    private void hold(String scope, int seconds, boolean external) {
        final String key = scope.toUpperCase();
        cancelHold(key);
        final int generation = stopGeneration;
        long pausedTimelineDelay = -1L;
        int pausedTimelineNextIndex = -1;
        int pausedTimelineGeneration = -1;
        if (external && key.equals("ALL") && timeline != null && timeline.next != null) {
            pausedTimelineDelay = Math.max(0L, timeline.nextDueAt - clock.now());
            pausedTimelineNextIndex = timeline.index + 1;
            pausedTimelineGeneration = timeline.generation;
            timeline.next.cancel();
            timeline.next = null;
        }
        final java.util.ArrayList<SvakomProtocol.Command> restores = new java.util.ArrayList<>();
        if (key.equals("ALL") || key.equals("STRETCH")) {
            if (stretch > 0) restores.add(desired.get(SvakomProtocol.Kind.STRETCH));
            writeOrdinary(SvakomProtocol.parse("STRETCH:OFF"));
        }
        if (key.equals("ALL") || key.equals("VIBRATE")) {
            if (vibrate > 0) restores.add(desired.get(SvakomProtocol.Kind.VIBRATE));
            writeOrdinary(SvakomProtocol.parse("VIBRATE:OFF"));
        }
        if (key.equals("ALL") || key.equals("FLAP")) {
            if (flap > 0) restores.add(desired.get(SvakomProtocol.Kind.FLAP));
            writeOrdinary(SvakomProtocol.parse("FLAP:OFF"));
        }
        if (key.equals("ALL") || key.equals("HEAT")) {
            if (heat) restores.add(SvakomProtocol.parse("HEAT:ON"));
            writeOrdinary(SvakomProtocol.parse("HEAT:OFF"));
        }
        HoldRecord record = new HoldRecord(generation, restores);
        record.cancellation = clock.schedule(() -> {
            synchronized (SvakomCommandScheduler.this) {
                if (generation != stopGeneration || holds.get(key) != record) return;
                holds.remove(key);
                for (SvakomProtocol.Command restore : record.restores) writeOrdinary(restore);
            }
        }, seconds * 1000L);
        holds.put(key, record);
        if (pausedTimelineDelay >= 0L && timeline != null
                && timeline.generation == pausedTimelineGeneration) {
            scheduleTimelineEvent(pausedTimelineNextIndex,
                    pausedTimelineGeneration,
                    seconds * 1000L + pausedTimelineDelay);
        }
    }

    private void startSequence(SvakomProtocol.Command sequence) {
        cancelTimeline();
        timelineGeneration += 1;
        timeline = new Timeline(sequence, timelineGeneration);
        runTimelineEvent(0, timelineGeneration);
    }

    private void runTimelineEvent(int index, int generation) {
        synchronized (this) {
            if (timeline == null || timeline.generation != generation || generation != timelineGeneration) return;
            SvakomProtocol.Event event = timeline.sequence.events.get(index);
            timeline.index = index;
            SvakomProtocol.Command first = event.actions.get(0);
            long extraDelay = 0L;
            if (first.kind == SvakomProtocol.Kind.STOP) {
                stop();
                return;
            }
            if (first.kind == SvakomProtocol.Kind.HOLD) {
                hold(first.scope, first.durationSeconds, false);
                if (first.scope.equals("ALL")) extraDelay = first.durationSeconds * 1000L;
            } else {
                for (SvakomProtocol.Command action : event.actions) {
                    cancelTimer(action.kind);
                    cancelHoldsFor(action.kind);
                    writeOrdinary(action);
                }
            }
            if (timeline == null || timeline.generation != generation) return;
            int nextIndex = index + 1;
            if (nextIndex >= timeline.sequence.events.size()) {
                if (timeline.sequence.durationSeconds > 0) {
                    scheduleTimelineEvent(0, generation, (timeline.sequence.durationSeconds - event.offsetSeconds) * 1000L);
                } else cancelTimeline();
                return;
            }
            SvakomProtocol.Event nextEvent = timeline.sequence.events.get(nextIndex);
            long delay = (nextEvent.offsetSeconds - event.offsetSeconds) * 1000L + extraDelay;
            scheduleTimelineEvent(nextIndex, generation, delay);
        }
    }

    private void scheduleTimelineEvent(int index, int generation, long delayMs) {
        if (timeline == null || timeline.generation != generation) return;
        timeline.nextDueAt = clock.now() + delayMs;
        timeline.next = clock.schedule(() -> runTimelineEvent(index, generation), delayMs);
    }

    private SvakomProtocol.Command offCommand(SvakomProtocol.Kind kind) {
        if (kind == SvakomProtocol.Kind.STRETCH) return SvakomProtocol.parse("STRETCH:OFF");
        if (kind == SvakomProtocol.Kind.VIBRATE) return SvakomProtocol.parse("VIBRATE:OFF");
        if (kind == SvakomProtocol.Kind.FLAP) return SvakomProtocol.parse("FLAP:OFF");
        return SvakomProtocol.parse("HEAT:OFF");
    }

    private void cancelTimer(SvakomProtocol.Kind kind) {
        Cancellation timer = timers.remove(kind);
        if (timer != null) timer.cancel();
    }

    private void cancelAllTimers() {
        for (Cancellation timer : timers.values()) timer.cancel();
        timers.clear();
    }

    private void cancelHold(String key) {
        HoldRecord hold = holds.remove(key);
        if (hold != null && hold.cancellation != null) hold.cancellation.cancel();
    }

    private void cancelHoldsFor(SvakomProtocol.Kind kind) {
        cancelHold(kind.name());
        HoldRecord all = holds.get("ALL");
        if (all != null) all.restores.removeIf(action -> action.kind == kind);
    }

    private void cancelAllHolds() {
        for (HoldRecord hold : holds.values()) if (hold.cancellation != null) hold.cancellation.cancel();
        holds.clear();
    }

    private void cancelTimeline() {
        if (timeline != null && timeline.next != null) timeline.next.cancel();
        timeline = null;
        timelineGeneration += 1;
    }

    private void notifyAction(String action) {
        if (listener != null) listener.onAction(action);
    }

    private void notifyError(String message) {
        if (listener != null) listener.onError(message);
    }
}
