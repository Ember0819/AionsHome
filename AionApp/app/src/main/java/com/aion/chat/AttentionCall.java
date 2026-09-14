package com.aion.chat;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;

/** Conversation destination and intent keys for supervision attention calls. */
final class AttentionCall {
    static final String EXTRA_MESSAGE = "attention_call_message";

    private AttentionCall() {}

    static boolean isAttentionAction(String action) {
        return "come_home".equals(action) || "look_at_me".equals(action);
    }

    static String conversationPath(String sourceKind, String sourceRef) {
        boolean chatroom = sourceKind != null && sourceKind.contains("chatroom");
        String path = chatroom ? "/chatroom" : "/chat";
        if (sourceRef == null || sourceRef.trim().isEmpty()) return path;
        try {
            return path + (chatroom ? "?room=" : "?conv=")
                    + URLEncoder.encode(sourceRef, "UTF-8").replace("+", "%20");
        } catch (UnsupportedEncodingException impossible) {
            throw new AssertionError(impossible);
        }
    }
}
