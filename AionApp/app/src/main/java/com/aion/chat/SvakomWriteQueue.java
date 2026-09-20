package com.aion.chat;

import java.util.concurrent.ThreadPoolExecutor;

/** Keep only the latest unsent vibration frame; OFF supersedes pending intensity frames. */
final class SvakomWriteQueue {
    private final ThreadPoolExecutor executor;
    private Runnable pendingVibration;

    SvakomWriteQueue(ThreadPoolExecutor executor) { this.executor = executor; }

    synchronized void enqueue(String hex, Runnable write) {
        if (hex.regionMatches(true, 0, "55030000", 0, 8) && hex.length() == 14) {
            if (pendingVibration != null) executor.remove(pendingVibration);
            pendingVibration = hex.substring(8, 10).equals("00") ? null : write;
        }
        executor.execute(write);
    }
}
