package kr.ac.seoil.motionaffect;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

/** 화면 공통 스타일(2026-10-25): 밝은 바탕, 둥근 카드, 알약 모양 칩·버튼. 레이아웃 XML 없이 코드로만 만든다. */
final class Ui {
    static final int BG = Color.rgb(246, 247, 251);
    static final int SURFACE = Color.WHITE;
    static final int INK = Color.rgb(20, 22, 28);
    static final int MUTED = Color.rgb(107, 114, 128);
    static final int LINE = Color.rgb(229, 231, 235);
    static final int PRIMARY = Color.rgb(47, 107, 255);
    static final int PRIMARY_SOFT = Color.rgb(232, 239, 255);
    static final int CHIP = Color.rgb(240, 242, 247);
    static final int OK = Color.rgb(22, 163, 74);
    static final int OK_SOFT = Color.rgb(220, 252, 231);

    private Ui() {}

    static int dp(Context c, int d) {
        return Math.round(d * c.getResources().getDisplayMetrics().density);
    }

    static GradientDrawable rounded(Context c, int fill, int radiusDp, int stroke) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(dp(c, radiusDp));
        if (stroke != 0) g.setStroke(dp(c, 1), stroke);
        return g;
    }

    static TextView text(Context c, String s, int sp, int color, boolean bold) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    static TextView title(Context c, String s) { return text(c, s, 26, INK, true); }

    static TextView caption(Context c, String s) { return text(c, s, 13, MUTED, false); }

    /** 둥근 흰 카드. */
    static LinearLayout card(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        int p = dp(c, 16);
        l.setPadding(p, p, p, p);
        l.setBackground(rounded(c, SURFACE, 20, LINE));
        return l;
    }

    static LinearLayout.LayoutParams block(Context c, int topDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(c, topDp);
        return lp;
    }

    /** 알약 칩. on이면 진한 바탕에 흰 글씨. */
    static TextView chip(Context c, String s) {
        TextView t = text(c, s, 14, INK, false);
        t.setGravity(Gravity.CENTER);
        t.setPadding(dp(c, 10), dp(c, 11), dp(c, 10), dp(c, 11));
        chipState(c, t, false);
        return t;
    }

    static void chipState(Context c, TextView t, boolean on) {
        t.setBackground(rounded(c, on ? INK : CHIP, 999, 0));
        t.setTextColor(on ? Color.WHITE : INK);
        t.setTypeface(on ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
    }

    /** 채운 기본 버튼 / 테두리 보조 버튼. */
    static TextView button(Context c, String s, boolean primary) {
        TextView t = text(c, s, 15, primary ? Color.WHITE : INK, true);
        t.setGravity(Gravity.CENTER);
        t.setPadding(dp(c, 16), dp(c, 14), dp(c, 16), dp(c, 14));
        t.setBackground(primary ? rounded(c, PRIMARY, 999, 0) : rounded(c, SURFACE, 999, LINE));
        return t;
    }

    static LinearLayout.LayoutParams weighted(Context c, int gapDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lp.setMargins(dp(c, gapDp), dp(c, gapDp), dp(c, gapDp), dp(c, gapDp));
        return lp;
    }

    /** 작은 상태 알약(예: 기록 중). */
    static TextView pill(Context c, String s, int fg, int bg) {
        TextView t = text(c, s, 12, fg, true);
        t.setPadding(dp(c, 10), dp(c, 4), dp(c, 10), dp(c, 4));
        t.setBackground(rounded(c, bg, 999, 0));
        return t;
    }

    /** 카드 안의 안쪽 상자(연회색). */
    static LinearLayout inner(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        int p = dp(c, 12);
        l.setPadding(p, p, p, p);
        l.setBackground(rounded(c, CHIP, 12, 0));
        return l;
    }

    /** 1dp 구분선. */
    static android.view.View divider(Context c, int vMarginDp) {
        android.view.View v = new android.view.View(c);
        v.setBackgroundColor(LINE);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(c, 1));
        lp.topMargin = lp.bottomMargin = dp(c, vMarginDp);
        v.setLayoutParams(lp);
        return v;
    }

    /** 가로 두 버튼용: 바깥 가장자리는 카드와 맞추고 사이만 띄운다. */
    static LinearLayout.LayoutParams pair(Context c, boolean first) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        if (first) lp.rightMargin = dp(c, 5); else lp.leftMargin = dp(c, 5);
        return lp;
    }

    /** 라벨 + 값 한 줄(상태 카드용). */
    static LinearLayout row(Context c, String label, String value, int valueColor) {
        LinearLayout r = new LinearLayout(c);
        r.setOrientation(LinearLayout.HORIZONTAL);
        TextView l = text(c, label, 15, MUTED, false);
        TextView v = text(c, value, 15, valueColor, true);
        v.setGravity(Gravity.END);
        r.addView(l, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        r.addView(v, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        r.setPadding(0, dp(c, 8), 0, dp(c, 8));
        return r;
    }

    /** 0~1 값을 보여 주는 얇은 막대. */
    static LinearLayout bar(Context c, String label, double p, int color) {
        LinearLayout wrap = new LinearLayout(c);
        wrap.setOrientation(LinearLayout.VERTICAL);
        LinearLayout head = new LinearLayout(c);
        TextView l = text(c, label, 13, MUTED, false);
        TextView v = text(c, Double.isNaN(p) ? "–" : String.format(java.util.Locale.US, "%.2f", p), 13, INK, true);
        v.setGravity(Gravity.END);
        head.addView(l, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        head.addView(v);
        wrap.addView(head);
        LinearLayout track = new LinearLayout(c);
        track.setBackground(rounded(c, CHIP, 999, 0));
        LinearLayout fill = new LinearLayout(c);
        fill.setBackground(rounded(c, color, 999, 0));
        float w = Double.isNaN(p) ? 0f : (float) Math.max(0.02, Math.min(1, p));
        track.addView(fill, new LinearLayout.LayoutParams(0, dp(c, 8), w));
        track.addView(new LinearLayout(c), new LinearLayout.LayoutParams(0, dp(c, 8), 1f - w));
        LinearLayout.LayoutParams tlp = block(c, 6);
        wrap.addView(track, tlp);
        return wrap;
    }
}
