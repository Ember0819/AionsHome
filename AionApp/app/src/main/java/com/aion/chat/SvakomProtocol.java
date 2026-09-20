package com.aion.chat;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/** Pure parser/encoder for the SAVKOM SL278H BLE protocol. */
public final class SvakomProtocol {
    public static final int MAX_DURATION_SECONDS = 3600;
    public static final int MAX_HOLD_SECONDS = 999;
    public static final int MAX_TIMELINE_EVENTS = 64;
    public enum Kind { STRETCH, VIBRATE, FLAP, HEAT, HOLD, STOP, SEQUENCE }

    public static final class Command {
        public final Kind kind;
        public final int value;
        public final int durationSeconds;
        public final String scope;
        public final List<Event> events;
        public final String raw;
        public int vibrateLevel;

        private Command(Kind kind, int value, int durationSeconds, String scope, List<Event> events, String raw) {
            this.kind = kind;
            this.value = value;
            this.durationSeconds = durationSeconds;
            this.scope = scope == null ? "" : scope;
            this.events = events == null ? Collections.emptyList() : Collections.unmodifiableList(events);
            this.raw = raw;
        }

        public boolean enabled() { return value != 0; }
    }

    public static final class Event {
        public final int offsetSeconds;
        public final List<Command> actions;

        private Event(int offsetSeconds, List<Command> actions) {
            this.offsetSeconds = offsetSeconds;
            this.actions = Collections.unmodifiableList(actions);
        }
    }

    private SvakomProtocol() {}

    public static boolean acceptsDeviceName(String name) {
        if (name == null) return false;
        String normalized = name.trim().toUpperCase(Locale.US);
        return normalized.equals("SL278H") || normalized.startsWith("SL278H-") || normalized.startsWith("SL278H_");
    }

    public static String encodeStretch(int mode) {
        if (mode < 0 || mode > 7) throw new IllegalArgumentException("stretch mode must be 0..7");
        return "55080000" + byteHex(mode) + "0000";
    }

    public static String encodeVibrate(int mode) {
        if (mode < 0 || mode > 10) throw new IllegalArgumentException("vibrate mode must be 0..10");
        return encodeVibrate(mode, 2);
    }

    public static String encodeVibrate(int mode, int level) {
        if (mode < 0 || mode > 10 || level < 1 || level > 10) throw new IllegalArgumentException("invalid vibration settings");
        int intensity = mode == 0 ? 0 : level;
        return "55030000" + byteHex(mode) + byteHex(intensity) + "00";
    }

    public static String encodeHeat(boolean enabled) {
        return enabled ? "55050137000000" : "55050000000000";
    }

    /** Factory SL278H-F v20 packet; strength is selected by mode 1..7, not byte 5. */
    public static String encodeFlap(int mode) {
        if (mode < 0 || mode > 7) throw new IllegalArgumentException("flap mode must be 0..7");
        return "55070000" + byteHex(mode) + "0000";
    }

    public static String encode(Command command) {
        if (command == null) throw new IllegalArgumentException("command is required");
        switch (command.kind) {
            case STRETCH: return encodeStretch(command.value);
            case VIBRATE: return encodeVibrate(command.value, command.vibrateLevel > 0 ? command.vibrateLevel : 2);
            case FLAP: return encodeFlap(command.value);
            case HEAT: return encodeHeat(command.enabled());
            default: throw new IllegalArgumentException("command has no single packet: " + command.kind);
        }
    }

    public static Command parse(String text) {
        String raw = unwrap(text);
        if (raw.isEmpty()) throw new IllegalArgumentException("empty SAVKOM command");
        if (raw.equals("STOP")) return command(Kind.STOP, 0, 0, "", raw);
        if (raw.startsWith("SEQ:")) return parseSequence(raw);
        if (raw.startsWith("LOOP:")) return parseLoop(raw);

        if (raw.startsWith("HOLD:")) {
            String[] pieces = raw.split("\\|", -1);
            if (pieces.length != 2) throw new IllegalArgumentException("invalid HOLD syntax");
            String scope = pieces[0].substring(5);
            if (!isScope(scope)) throw new IllegalArgumentException("invalid HOLD scope");
            int seconds = parseBoundedInt(pieces[1], 1, MAX_HOLD_SECONDS, "HOLD duration");
            return command(Kind.HOLD, 0, seconds, scope, raw);
        }

        return parseOrdinary(raw, true);
    }

    private static Command parseLoop(String raw) {
        String[] rows = raw.substring(5).split(";", -1);
        if (rows.length < 1 || rows.length > 63) throw new IllegalArgumentException("loop needs 1..63 phases");
        List<Event> events = new ArrayList<>();
        int seconds = 0;
        for (String row : rows) {
            String[] fields = row.split(",", -1);
            if (fields.length != 5) throw new IllegalArgumentException("loop phase needs five fields");
            int duration = parseBoundedInt(fields[0], 1, 3600, "phase duration");
            int stretch = parseBoundedInt(fields[1], 0, 7, "stretch");
            int vibrate = parseBoundedInt(fields[2], 0, 10, "vibrate");
            int level = parseBoundedInt(fields[3], vibrate == 0 ? 0 : 1, vibrate == 0 ? 0 : 10, "level");
            int flap = parseBoundedInt(fields[4], 0, 7, "flap");
            List<Command> actions = new ArrayList<>();
            actions.add(parse(stretch == 0 ? "STRETCH:OFF" : "STRETCH:" + stretch));
            actions.add(parse(vibrate == 0 ? "VIBRATE:OFF" : "VIBRATE:" + vibrate + ":" + level));
            actions.add(parse(flap == 0 ? "FLAP:OFF" : "FLAP:" + flap));
            events.add(new Event(seconds, actions));
            seconds += duration;
            if (seconds > 3600) throw new IllegalArgumentException("loop exceeds 3600 seconds");
        }
        // Positive duration on a SEQUENCE denotes its loop period; ordinary SEQ remains one-shot.
        return new Command(Kind.SEQUENCE, 0, seconds, "", events, raw);
    }

    private static Command parseSequence(String raw) {
        String spec = raw.substring(4);
        String[] entries = spec.split(";", -1);
        if (entries.length < 2 || entries.length > MAX_TIMELINE_EVENTS) {
            throw new IllegalArgumentException("timeline must contain 2..64 events");
        }
        List<Event> events = new ArrayList<>();
        int previous = -1;
        for (String entry : entries) {
            int equals = entry.indexOf('=');
            if (equals <= 0 || equals == entry.length() - 1) throw new IllegalArgumentException("timeline event is incomplete");
            int offset = parseBoundedInt(entry.substring(0, equals), 0, MAX_DURATION_SECONDS, "timeline offset");
            if (offset <= previous) throw new IllegalArgumentException("timeline offsets must increase");
            String[] actionTexts = entry.substring(equals + 1).split("\\+", -1);
            List<Command> actions = new ArrayList<>();
            for (String actionText : actionTexts) actions.add(parseSequenceAction(actionText));
            if (contains(actions, Kind.HOLD) && actions.size() != 1) throw new IllegalArgumentException("HOLD must occupy its own event");
            if (contains(actions, Kind.STOP) && actions.size() != 1) throw new IllegalArgumentException("STOP must occupy its own event");
            events.add(new Event(offset, actions));
            previous = offset;
        }
        if (events.get(0).offsetSeconds != 0) throw new IllegalArgumentException("timeline must start at zero");
        for (int i = 0; i < events.size() - 1; i++) {
            if (contains(events.get(i).actions, Kind.STOP)) throw new IllegalArgumentException("STOP can only be last");
        }
        Event last = events.get(events.size() - 1);
        if (last.actions.size() != 1 || last.actions.get(0).kind != Kind.STOP) {
            throw new IllegalArgumentException("timeline must end with STOP");
        }
        return new Command(Kind.SEQUENCE, 0, 0, "", events, raw);
    }

    private static Command parseSequenceAction(String raw) {
        if (raw.equals("STOP")) return command(Kind.STOP, 0, 0, "", raw);
        if (raw.startsWith("HOLD:")) {
            String[] pieces = raw.split(":", -1);
            if (pieces.length != 3 || !isScope(pieces[1])) throw new IllegalArgumentException("invalid timeline HOLD");
            int seconds = parseBoundedInt(pieces[2], 1, MAX_HOLD_SECONDS, "HOLD duration");
            return command(Kind.HOLD, 0, seconds, pieces[1], raw);
        }
        return parseOrdinary(raw, false);
    }

    private static Command parseOrdinary(String raw, boolean allowDuration) {
        String[] durationParts = raw.split("\\|", -1);
        if (durationParts.length > (allowDuration ? 2 : 1)) throw new IllegalArgumentException("invalid duration syntax");
        int duration = durationParts.length == 2
                ? parseBoundedInt(durationParts[1], 1, MAX_DURATION_SECONDS, "duration") : 0;
        String base = durationParts[0];
        if (base.startsWith("STRETCH:")) {
            String value = base.substring(8);
            if (value.equals("OFF")) {
                if (duration != 0) throw new IllegalArgumentException("OFF cannot have duration");
                return command(Kind.STRETCH, 0, 0, "", raw);
            }
            return command(Kind.STRETCH, parseBoundedInt(value, 1, 7, "stretch mode"), duration, "", raw);
        }
        if (base.startsWith("VIBRATE:")) {
            String value = base.substring(8);
            if (value.equals("OFF")) {
                if (duration != 0) throw new IllegalArgumentException("OFF cannot have duration");
                return command(Kind.VIBRATE, 0, 0, "", raw);
            }
            String[] settings = value.split(":", -1);
            if (settings.length > 2) throw new IllegalArgumentException("invalid vibration settings");
            Command result = command(Kind.VIBRATE, parseBoundedInt(settings[0], 1, 10, "vibrate mode"), duration, "", raw);
            if (settings.length == 2) result.vibrateLevel = parseBoundedInt(settings[1], 1, 10, "vibration level");
            return result;
        }
        if (base.startsWith("FLAP:")) {
            String value = base.substring(5);
            if (value.equals("OFF")) {
                if (duration != 0) throw new IllegalArgumentException("OFF cannot have duration");
                return command(Kind.FLAP, 0, 0, "", raw);
            }
            return command(Kind.FLAP, parseBoundedInt(value, 1, 7, "flap mode"), duration, "", raw);
        }
        if (base.equals("HEAT:ON")) return command(Kind.HEAT, 1, duration, "", raw);
        if (base.equals("HEAT:OFF")) {
            if (duration != 0) throw new IllegalArgumentException("OFF cannot have duration");
            return command(Kind.HEAT, 0, 0, "", raw);
        }
        throw new IllegalArgumentException("unknown SAVKOM action: " + raw);
    }

    private static Command command(Kind kind, int value, int duration, String scope, String raw) {
        return new Command(kind, value, duration, scope, null, raw);
    }

    private static boolean contains(List<Command> commands, Kind kind) {
        for (Command command : commands) if (command.kind == kind) return true;
        return false;
    }

    private static boolean isScope(String value) {
        return value.equals("ALL") || value.equals("STRETCH") || value.equals("VIBRATE") || value.equals("FLAP") || value.equals("HEAT");
    }

    private static int parseBoundedInt(String value, int minimum, int maximum, String label) {
        try {
            if (!value.matches("\\d+")) throw new NumberFormatException();
            int parsed = Integer.parseInt(value);
            if (parsed < minimum || parsed > maximum) throw new NumberFormatException();
            return parsed;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException(label + " must be " + minimum + ".." + maximum);
        }
    }

    private static String unwrap(String text) {
        String raw = text == null ? "" : text.trim().toUpperCase(Locale.US);
        if (raw.startsWith("[TOY:") && raw.endsWith("]")) raw = raw.substring(5, raw.length() - 1).trim();
        return raw;
    }

    private static String byteHex(int value) {
        return String.format(Locale.US, "%02x", value & 0xff);
    }
}
