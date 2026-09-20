package com.aion.chat;

import org.junit.Test;
import java.util.concurrent.*;
import java.util.*;
import static org.junit.Assert.*;

public class SvakomWriteQueueTest {
    @Test public void slowWriterKeepsLatestVibrationAndOffDiscardsIt() throws Exception {
        ThreadPoolExecutor executor = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>());
        CountDownLatch release = new CountDownLatch(1);
        List<String> sent = Collections.synchronizedList(new ArrayList<>());
        executor.execute(() -> { try { release.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); } });
        try {
            SvakomWriteQueue queue = new SvakomWriteQueue(executor);
            queue.enqueue("55030000010200", () -> sent.add("old"));
            queue.enqueue("55070000020000", () -> sent.add("flap"));
            queue.enqueue("55030000010800", () -> sent.add("latest"));
            assertEquals(2, executor.getQueue().size());
            queue.enqueue("55030000000000", () -> sent.add("off"));
            assertEquals(2, executor.getQueue().size());
        } finally {
            release.countDown();
            executor.shutdown();
            assertTrue(executor.awaitTermination(2, TimeUnit.SECONDS));
        }
        assertEquals(Arrays.asList("flap", "off"), sent);
    }
}
