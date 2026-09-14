package com.aion.chat;

import android.app.Activity;
import android.app.Dialog;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** An acknowledgement inside the app, independent of the device focus timer. */
final class AttentionCallDialog {
    private AttentionCallDialog() {}

    static Dialog show(Activity activity, String message, Runnable onConfirm) {
        boolean dark = (activity.getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int ink = dark ? Color.rgb(244, 240, 255) : Color.rgb(48, 40, 64);
        int accent = dark ? Color.rgb(187, 169, 229) : Color.rgb(113, 88, 155);
        Dialog dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setCancelable(false);
        configureAttentionVibration(activity, dialog);

        LinearLayout card = new LinearLayout(activity);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        int padding = dp(activity, 28);
        card.setPadding(padding, padding, padding, dp(activity, 24));
        card.setBackground(rounded(dark ? Color.rgb(35, 31, 47) : Color.rgb(253, 250, 255), dp(activity, 24)));

        TextView heading = new TextView(activity);
        heading.setText("此刻，看着我");
        heading.setTextSize(14);
        heading.setTextColor(accent);
        heading.setGravity(Gravity.CENTER);
        card.addView(heading);

        TextView words = new TextView(activity);
        words.setText(message);
        words.setTextSize(28);
        words.setTextColor(ink);
        words.setGravity(Gravity.CENTER);
        words.setLineSpacing(dp(activity, 7), 1f);
        words.setPadding(0, dp(activity, 22), 0, dp(activity, 26));
        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(false);
        scroll.addView(words);
        // Keep the confirmation reachable even with a long sentence or large system fonts.
        card.addView(scroll, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        Button confirm = new Button(activity);
        confirm.setText("确认");
        confirm.setTextSize(17);
        confirm.setTextColor(dark ? Color.rgb(35, 31, 47) : Color.WHITE);
        confirm.setBackground(rounded(accent, dp(activity, 16)));
        card.addView(confirm, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(activity, 52)));
        confirm.setOnClickListener(view -> {
            onConfirm.run();
            dialog.dismiss();
        });

        dialog.setContentView(card);
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawableResource(android.R.color.transparent);
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            WindowManager.LayoutParams params = window.getAttributes();
            params.dimAmount = 0.55f;
            params.gravity = Gravity.CENTER;
            window.setAttributes(params);
        }
        dialog.show();
        if (window != null) {
            int screenWidth = activity.getResources().getDisplayMetrics().widthPixels;
            int screenHeight = activity.getResources().getDisplayMetrics().heightPixels;
            int width = Math.min(screenWidth - dp(activity, 40), dp(activity, 440));
            card.measure(android.view.View.MeasureSpec.makeMeasureSpec(width, android.view.View.MeasureSpec.EXACTLY),
                    android.view.View.MeasureSpec.makeMeasureSpec((int) (screenHeight * 0.75f), android.view.View.MeasureSpec.AT_MOST));
            window.setLayout(width, Math.min(Math.max(card.getMeasuredHeight(), dp(activity, 280)),
                    (int) (screenHeight * 0.75f)));
        }
        return dialog;
    }

    @SuppressWarnings("deprecation")
    private static void configureAttentionVibration(Activity activity, Dialog dialog) {
        Vibrator vibrator = activity.getSystemService(Vibrator.class);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        // OnShow follows any previous dialog's OnDismiss, so replacing a call
        // stops the old vibration before starting this one.
        dialog.setOnShowListener(ignored -> {
            try {
                long[] timings = {0, 600, 200, 600};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(
                            timings, new int[]{0, 255, 0, 255}, -1), attributes);
                } else {
                    vibrator.vibrate(timings, -1, attributes);
                }
            } catch (RuntimeException error) {
                Log.w("AttentionCall", "Vibration unavailable", error);
            }
        });
        dialog.setOnDismissListener(ignored -> vibrator.cancel());
    }

    private static GradientDrawable rounded(int color, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(radius);
        return shape;
    }

    private static int dp(Activity activity, int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}
