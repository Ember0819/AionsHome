package com.aion.chat;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class AttentionCallTest {
    @Test
    public void routesBothLiveAndBackgroundCommandsToTheirSourceConversation() {
        assertEquals("/chat?conv=private-1", AttentionCall.conversationPath("private", "private-1"));
        assertEquals("/chat?conv=private-2", AttentionCall.conversationPath("background_private", "private-2"));
        assertEquals("/chatroom?room=room-1", AttentionCall.conversationPath("chatroom", "room-1"));
        assertEquals("/chatroom?room=room-2", AttentionCall.conversationPath("background_chatroom", "room-2"));
        assertEquals("/chatroom?room=room%20%26%3F%23", AttentionCall.conversationPath("chatroom", "room &?#"));
    }
}
