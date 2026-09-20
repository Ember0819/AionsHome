package com.aion.chat;

import android.content.Context;
import android.media.MediaPlayer;
import android.media.audiofx.LoudnessEnhancer;
import android.util.Log;

/** The phone's shared loudness setting for speech and camera cues. */
final class PlaybackLoudness {
    private static final String PREF = "tts_loudness_db";

    static int getGainDb(Context context) {
        return clamp(context.getSharedPreferences("aion_prefs", Context.MODE_PRIVATE)
                .getInt(PREF, 0));
    }

    static int setGainDb(Context context, int gainDb) {
        int saved = clamp(gainDb);
        context.getSharedPreferences("aion_prefs", Context.MODE_PRIVATE)
                .edit().putInt(PREF, saved).apply();
        return saved;
    }

    private static int clamp(int value) {
        return Math.max(0, Math.min(30, value));
    }

    static LoudnessEnhancer attach(Context context, MediaPlayer player) {
        int gainDb = getGainDb(context);
        if (gainDb == 0) return null;
        LoudnessEnhancer enhancer = null;
        try {
            int sessionId = player.getAudioSessionId();
            if (sessionId == 0) return null;
            enhancer = new LoudnessEnhancer(sessionId);
            enhancer.setTargetGain(gainDb * 100);
            if (enhancer.setEnabled(true) != 0) {
                throw new IllegalStateException("Loudness effect could not be enabled");
            }
            Log.i("AionAudio", "Loudness enabled: +" + gainDb + " dB, session=" + sessionId);
            return enhancer;
        } catch (RuntimeException exception) {
            if (enhancer != null) enhancer.release();
            Log.w("AionAudio", "Loudness unavailable; continuing normal playback", exception);
            return null;
        }
    }
}
