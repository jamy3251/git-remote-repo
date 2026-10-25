package kr.ac.seoil.motionaffect;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Bundle;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.ComponentActivity;

import java.util.Locale;

/**
 * 감정 격자(Affect Grid, Russell 1989) 입력 화면.
 * 가로 = 불쾌(-1)…유쾌(+1) 정서가, 세로 = 차분(-1)…흥분(+1) 각성. 격자 전체가 연속 색이라
 * '끌리는 색을 한 번 누르면' 정서가·각성·세기(중심에서의 거리) 세 값이 한꺼번에 기록된다.
 * K-EmoPhone ESM과 같은 두 축이라 단말 모델을 사용자 자신의 데이터로 바로 평가·재학습할 수 있다.
 * 누른 뒤 감정 이름(8개, 격자 위 위치에 미리 표시)은 가장 가까운 것이 자동 선택되고 바꿀 수 있다.
 * 서비스가 '지금 어떠세요?' 질문으로 띄운 경우 단말 추정(각성·기분 확률)을 같이 보여 주고 맞아요/아니에요를 받는다.
 * 저장 → LifeLogService ACTION_AFFECT (events.csv 의 type=affect, value="v=..;a=..;i=..;e=..;j=..;pa=..;pv=..;src=..")
 */
public class AffectGridActivity extends ComponentActivity {
    static final String EXTRA_PA = "pa", EXTRA_PV = "pv", EXTRA_SRC = "src", EXTRA_PSA = "psa", EXTRA_PSV = "psv";

    /** 이름, 정서가, 각성 (격자 위 표시 위치). */
    static final String[] NAMES = {"설렘", "기쁨", "평온", "나른", "지루", "슬픔", "불안", "짜증"};
    static final float[][] POS = {{0.55f, 0.75f}, {0.8f, 0.3f}, {0.7f, -0.6f}, {0.2f, -0.85f},
            {-0.5f, -0.7f}, {-0.8f, -0.3f}, {-0.6f, 0.6f}, {-0.35f, 0.85f}};

    private float v = Float.NaN, a = Float.NaN;
    private int emotion = -1;
    private String judge = "";
    private double pa = Double.NaN, pv = Double.NaN, psa = Double.NaN, psv = Double.NaN;
    private String src = "manual";
    private TextView readout;
    private final TextView[] chips = new TextView[NAMES.length];
    private final TextView[] judgeBtns = new TextView[3];
    private GridView grid;

    @Override
    protected void onCreate(Bundle s) {
        super.onCreate(s);
        Intent in = getIntent();
        pa = in.getDoubleExtra(EXTRA_PA, Double.NaN);
        pv = in.getDoubleExtra(EXTRA_PV, Double.NaN);
        psa = in.getDoubleExtra(EXTRA_PSA, Double.NaN);
        psv = in.getDoubleExtra(EXTRA_PSV, Double.NaN);
        if (in.getStringExtra(EXTRA_SRC) != null) src = in.getStringExtra(EXTRA_SRC);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(250, 250, 250));
        int pad = dp(16);
        root.setPadding(pad, pad, pad, pad);

        TextView title = text("지금 끌리는 색을 한 번 누르세요", 17, Color.rgb(30, 30, 30));
        root.addView(title);

        if (!Double.isNaN(pa)) {
            TextView est = text(String.format(Locale.US, "폰 추정 — 각성 %.2f · 기분 %.2f (손목 모델, 참고용)", pa, pv), 13,
                    Color.rgb(90, 90, 90));
            est.setPadding(0, dp(4), 0, dp(4));
            root.addView(est);
            LinearLayout jrow = new LinearLayout(this);
            String[] jl = {"맞아요", "아니에요", "모르겠음"};
            String[] jv = {"yes", "no", "unsure"};
            for (int i = 0; i < 3; i++) {
                TextView b = chip(jl[i]);
                final int k = i;
                b.setOnClickListener(x -> {
                    judge = jv[k];
                    for (int j = 0; j < 3; j++) style(judgeBtns[j], j == k);
                });
                judgeBtns[i] = b;
                jrow.addView(b, chipLp());
            }
            root.addView(jrow);
        }

        grid = new GridView(this);
        LinearLayout.LayoutParams glp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        glp.topMargin = dp(8);
        root.addView(grid, glp);

        readout = text("", 14, Color.rgb(60, 60, 60));
        readout.setPadding(0, dp(6), 0, dp(6));
        root.addView(readout);

        LinearLayout row1 = new LinearLayout(this), row2 = new LinearLayout(this);
        for (int i = 0; i < NAMES.length; i++) {
            TextView c = chip(NAMES[i]);
            final int k = i;
            c.setOnClickListener(x -> selectEmotion(k));
            chips[i] = c;
            (i < 4 ? row1 : row2).addView(c, chipLp());
        }
        root.addView(row1);
        root.addView(row2);

        LinearLayout actions = new LinearLayout(this);
        TextView skip = chip("건너뛰기");
        skip.setOnClickListener(x -> finish());
        TextView save = chip("저장");
        style(save, true);
        save.setOnClickListener(x -> save());
        actions.addView(skip, chipLp());
        actions.addView(save, chipLp());
        LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        alp.topMargin = dp(10);
        root.addView(actions, alp);
        setContentView(root);
    }

    private void onTap(float vv, float aa) {
        v = Math.max(-1, Math.min(1, vv));
        a = Math.max(-1, Math.min(1, aa));
        int best = 0;
        double bd = 1e9;
        for (int i = 0; i < NAMES.length; i++) {
            double d = Math.hypot(POS[i][0] - v, POS[i][1] - a);
            if (d < bd) { bd = d; best = i; }
        }
        selectEmotion(best);
        updateReadout();
        grid.invalidate();
    }

    private void selectEmotion(int k) {
        emotion = k;
        for (int i = 0; i < NAMES.length; i++) style(chips[i], i == k);
        updateReadout();
    }

    private void updateReadout() {
        if (Float.isNaN(v)) return;
        double inten = Math.min(1, Math.hypot(v, a));
        readout.setText(String.format(Locale.US, "%s %.2f · %s %.2f · 세기 %.2f%s",
                v >= 0 ? "유쾌" : "불쾌", Math.abs(v), a >= 0 ? "흥분" : "차분", Math.abs(a), inten,
                emotion >= 0 ? " · " + NAMES[emotion] : ""));
    }

    private void save() {
        if (Float.isNaN(v)) {
            readout.setText("먼저 격자를 한 번 눌러 주세요");
            return;
        }
        double inten = Math.min(1, Math.hypot(v, a));
        String value = String.format(Locale.US, "v=%.3f;a=%.3f;i=%.3f;e=%s;j=%s;pa=%s;pv=%s;src=%s;psa=%s;psv=%s",
                v, a, inten, emotion >= 0 ? NAMES[emotion] : "", judge,
                Double.isNaN(pa) ? "" : String.format(Locale.US, "%.3f", pa),
                Double.isNaN(pv) ? "" : String.format(Locale.US, "%.3f", pv), src,
                Double.isNaN(psa) ? "" : String.format(Locale.US, "%.3f", psa),
                Double.isNaN(psv) ? "" : String.format(Locale.US, "%.3f", psv));
        startService(new Intent(this, LifeLogService.class).setAction(LifeLogService.ACTION_AFFECT)
                .putExtra("value", value));
        finish();
    }

    // ---------- 격자 ----------
    /** 각도(정서가·각성 평면) → 색상. 유쾌=노랑, 흥분·유쾌=주황/빨강, 흥분·불쾌=자주, 불쾌=보라, 차분·불쾌=파랑, 차분·유쾌=초록. */
    static int colorAt(float v, float a) {
        double r = Math.min(1, Math.hypot(v, a));
        double theta = Math.toDegrees(Math.atan2(a, v));
        if (theta < 0) theta += 360;
        // 45도 간격 앵커 색상(hue), 연속이 되도록 단조 감소 열로 두고 마지막에 360으로 나눈다.
        double[] anchors = {55, 25, 0, -60, -90, -140, -170, -230, -305};
        int k = (int) (theta / 45);
        double f = theta / 45 - k;
        double hue = anchors[k] + (anchors[Math.min(k + 1, 8)] - anchors[k]) * f;
        hue = ((hue % 360) + 360) % 360;
        float sat = (float) (0.12 + 0.78 * r);
        float val = (float) (0.97 - 0.22 * r * (a < 0 ? 1 - 0.5 * (a + 1) : 0.3));
        return Color.HSVToColor(new float[]{(float) hue, sat, val});
    }

    private class GridView extends View {
        private Bitmap bmp;
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint txt = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int side, ox, oy;

        GridView(android.content.Context c) {
            super(c);
            txt.setColor(Color.argb(190, 30, 30, 30));
            txt.setTextAlign(Paint.Align.CENTER);
        }

        @Override
        protected void onSizeChanged(int w, int h, int ow, int oh) {
            side = Math.min(w, h);
            ox = (w - side) / 2;
            oy = (h - side) / 2;
            int n = 96;
            Bitmap small = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888);
            for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                    small.setPixel(x, y, colorAt((x + 0.5f) / n * 2 - 1, 1 - (y + 0.5f) / n * 2));
            bmp = Bitmap.createScaledBitmap(small, side, side, true);
            txt.setTextSize(side / 22f);
        }

        @Override
        protected void onDraw(Canvas c) {
            if (bmp == null) return;
            c.drawBitmap(bmp, ox, oy, null);
            p.setStyle(Paint.Style.STROKE);
            p.setColor(Color.argb(70, 0, 0, 0));
            p.setStrokeWidth(2);
            c.drawLine(ox + side / 2f, oy, ox + side / 2f, oy + side, p);
            c.drawLine(ox, oy + side / 2f, ox + side, oy + side / 2f, p);
            for (int i = 0; i < NAMES.length; i++)
                c.drawText(NAMES[i], px(POS[i][0]), py(POS[i][1]) + txt.getTextSize() / 3, txt);
            txt.setTextSize(side / 26f);
            c.drawText("흥분", ox + side / 2f, oy + txt.getTextSize() * 1.1f, txt);
            c.drawText("차분", ox + side / 2f, oy + side - txt.getTextSize() * 0.4f, txt);
            c.drawText("불쾌", ox + txt.getTextSize() * 1.3f, oy + side / 2f - txt.getTextSize() * 0.4f, txt);
            c.drawText("유쾌", ox + side - txt.getTextSize() * 1.3f, oy + side / 2f - txt.getTextSize() * 0.4f, txt);
            txt.setTextSize(side / 22f);
            if (!Float.isNaN(v)) {
                p.setStyle(Paint.Style.FILL);
                p.setColor(Color.WHITE);
                c.drawCircle(px(v), py(a), side / 36f, p);
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(4);
                p.setColor(Color.BLACK);
                c.drawCircle(px(v), py(a), side / 36f, p);
            }
        }

        private float px(float vv) { return ox + (vv + 1) / 2 * side; }
        private float py(float aa) { return oy + (1 - aa) / 2 * side; }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            if (e.getAction() == MotionEvent.ACTION_DOWN || e.getAction() == MotionEvent.ACTION_MOVE) {
                onTap((e.getX() - ox) / side * 2 - 1, 1 - (e.getY() - oy) / side * 2);
                return true;
            }
            return super.onTouchEvent(e);
        }
    }

    // ---------- 작은 위젯 ----------
    private TextView text(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        return t;
    }

    private TextView chip(String s) {
        TextView t = text(s, 14, Color.rgb(40, 40, 40));
        t.setGravity(Gravity.CENTER);
        t.setPadding(dp(6), dp(10), dp(6), dp(10));
        style(t, false);
        return t;
    }

    private void style(TextView t, boolean on) {
        t.setBackgroundColor(on ? Color.rgb(31, 95, 168) : Color.rgb(232, 232, 232));
        t.setTextColor(on ? Color.WHITE : Color.rgb(40, 40, 40));
    }

    private LinearLayout.LayoutParams chipLp() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lp.setMargins(dp(3), dp(3), dp(3), dp(3));
        return lp;
    }

    private int dp(int d) {
        return Math.round(d * getResources().getDisplayMetrics().density);
    }
}
