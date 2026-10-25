package kr.ac.seoil.motionaffect;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.ComponentActivity;

import java.util.Locale;

/**
 * 감정 격자(Affect Grid, Russell 1989) 입력 화면. 앱 안 이름은 "기분 지도".
 * 가로 = 불쾌(-1)…유쾌(+1) 정서가, 세로 = 차분(-1)…흥분(+1) 각성. 격자 전체가 연속 색이라
 * '끌리는 색을 한 번 누르면' 정서가·각성·세기(중심에서의 거리) 세 값이 한꺼번에 기록된다.
 * K-EmoPhone ESM과 같은 두 축이라 단말 모델을 사용자 자신의 데이터로 바로 평가·재학습할 수 있다.
 * 누른 뒤 감정 이름(8개, 격자 위 위치에 미리 표시)은 가장 가까운 것이 자동 선택되고 바꿀 수 있다.
 * 서비스가 '지금 어떠세요?' 질문으로 띄운 경우 단말 추정(각성·기분 확률)을 같이 보여 주고 맞아요/아니에요를 받는다.
 * 저장 → LifeLogService ACTION_AFFECT (events.csv 의 type=affect, value="v=..;a=..;i=..;e=..;j=..;pa=..;pv=..;src=..")
 * 2026-10-25 화면 다듬기(Ui.java, 디자인 리뷰 반영): 격자를 주인공으로(카드 압축), 글자 sp 고정·알약 배경, 선택 마커 후광,
 * 앱 화면이 앞에 있을 때 오버레이 숨김. 색 함수 colorAt·POS·NAMES·기록 형식은 그대로.
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
        root.setBackgroundColor(Ui.BG);
        int pad = dp(20);
        root.setPadding(pad, dp(12), pad, dp(12));

        root.addView(Ui.text(this, src.startsWith("ask") ? "폰이 묻는 질문" : "기분 지도", 12, Ui.MUTED, false));
        root.addView(Ui.title(this, "지금 기분은 어떤가요?"), Ui.block(this, 4));
        root.addView(Ui.text(this, "끌리는 색을 한 번 누르면 유쾌·흥분 정도가 기록됩니다", 13, Ui.MUTED, false), Ui.block(this, 4));

        if (!Double.isNaN(pa)) {
            LinearLayout est = Ui.card(this);
            est.setPadding(dp(14), dp(12), dp(14), dp(12));
            est.addView(Ui.text(this, "폰의 추정 · 최근 30분 움직임, 맞나요?", 12, Ui.MUTED, false));
            LinearLayout bars = new LinearLayout(this);
            bars.addView(Ui.bar(this, "흥분", pa, Ui.PRIMARY), Ui.pair(this, true));
            bars.addView(Ui.bar(this, "유쾌", pv, Ui.PRIMARY), Ui.pair(this, false));
            est.addView(bars, Ui.block(this, 6));
            LinearLayout jrow = new LinearLayout(this);
            String[] jl = {"맞아요", "아니에요", "모르겠음"};
            String[] jv = {"yes", "no", "unsure"};
            for (int i = 0; i < 3; i++) {
                TextView b = Ui.chip(this, jl[i]);
                b.setPadding(dp(10), dp(8), dp(10), dp(8));
                final int k = i;
                b.setOnClickListener(x -> {
                    judge = jv[k];
                    for (int j = 0; j < 3; j++) Ui.chipState(this, judgeBtns[j], j == k);
                });
                judgeBtns[i] = b;
                jrow.addView(b, edge(i, 3, 2));
            }
            est.addView(jrow, Ui.block(this, 8));
            root.addView(est, Ui.block(this, 10));
        }

        grid = new GridView(this);
        LinearLayout.LayoutParams glp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        glp.topMargin = dp(10);
        root.addView(grid, glp);

        readout = Ui.text(this, "", 13, Ui.MUTED, false);
        readout.setGravity(Gravity.CENTER);
        readout.setPadding(0, dp(6), 0, 0);
        readout.setVisibility(View.GONE);
        root.addView(readout);

        LinearLayout row1 = new LinearLayout(this), row2 = new LinearLayout(this);
        for (int i = 0; i < NAMES.length; i++) {
            TextView c = Ui.chip(this, NAMES[i]);
            c.setTextSize(13);
            c.setPadding(dp(10), dp(8), dp(10), dp(8));
            final int k = i;
            c.setOnClickListener(x -> selectEmotion(k));
            chips[i] = c;
            (i < 4 ? row1 : row2).addView(c, edge(i % 4, 4, 2));
        }
        root.addView(row1, Ui.block(this, 8));
        root.addView(row2, Ui.block(this, 4));

        LinearLayout actions = new LinearLayout(this);
        TextView skip = Ui.button(this, "건너뛰기", false);
        skip.setOnClickListener(x -> finish());
        TextView save = Ui.button(this, "저장", true);
        save.setOnClickListener(x -> save());
        actions.addView(skip, Ui.pair(this, true));
        actions.addView(save, Ui.pair(this, false));
        root.addView(actions, Ui.block(this, 10));
        setContentView(root);
        getWindow().setStatusBarColor(Ui.BG);
        getWindow().setNavigationBarColor(Ui.BG);
        root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    }

    /** 가로 줄의 첫·끝 요소는 바깥 마진 0(카드·격자와 가장자리 정렬). */
    private LinearLayout.LayoutParams edge(int i, int n, int gapDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        lp.leftMargin = i == 0 ? 0 : dp(gapDp);
        lp.rightMargin = i == n - 1 ? 0 : dp(gapDp);
        return lp;
    }

    @Override
    protected void onStart() {
        super.onStart();
        sendBroadcast(new Intent(LifeLogService.ACTION_OVERLAY).setPackage(getPackageName()).putExtra("show", false));
    }

    @Override
    protected void onStop() {
        super.onStop();
        sendBroadcast(new Intent(LifeLogService.ACTION_OVERLAY).setPackage(getPackageName()).putExtra("show", true));
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
        for (int i = 0; i < NAMES.length; i++) Ui.chipState(this, chips[i], i == k);
        updateReadout();
    }

    private void updateReadout() {
        if (Float.isNaN(v)) return;
        readout.setVisibility(View.VISIBLE);
        double inten = Math.min(1, Math.hypot(v, a));
        readout.setText(String.format(Locale.US, "%s%s %.2f · %s %.2f · 세기 %.2f",
                emotion >= 0 ? NAMES[emotion] + " · " : "",
                v >= 0 ? "유쾌" : "불쾌", Math.abs(v), a >= 0 ? "흥분" : "차분", Math.abs(a), inten));
    }

    private void save() {
        if (Float.isNaN(v)) {
            readout.setVisibility(View.VISIBLE);
            readout.setText("먼저 지도를 한 번 눌러 주세요");
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
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint pill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint txt = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF rect = new RectF();
        private int side, ox, oy, radius;

        GridView(android.content.Context c) {
            super(c);
            txt.setTextAlign(Paint.Align.CENTER);
            txt.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            pill.setColor(Color.argb(200, 255, 255, 255));
        }

        private float sp(float s) {
            return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, s, getResources().getDisplayMetrics());
        }

        @Override
        protected void onSizeChanged(int w, int h, int ow, int oh) {
            side = Math.min(w, h);
            ox = (w - side) / 2;
            oy = (h - side) / 2;
            radius = dp(20);
            int n = 96;
            Bitmap small = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888);
            for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                    small.setPixel(x, y, colorAt((x + 0.5f) / n * 2 - 1, 1 - (y + 0.5f) / n * 2));
            bmp = Bitmap.createScaledBitmap(small, side, side, true);
            BitmapShader sh = new BitmapShader(bmp, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
            android.graphics.Matrix m = new android.graphics.Matrix();
            m.postTranslate(ox, oy);
            sh.setLocalMatrix(m);
            fill.setShader(sh);
            rect.set(ox, oy, ox + side, oy + side);
        }

        @Override
        protected void onDraw(Canvas c) {
            if (bmp == null) return;
            c.drawRoundRect(rect, radius, radius, fill);
            p.setStyle(Paint.Style.STROKE);
            p.setColor(Color.argb(60, 0, 0, 0));
            p.setStrokeWidth(2);
            c.drawLine(ox + side / 2f, oy + radius / 2f, ox + side / 2f, oy + side - radius / 2f, p);
            c.drawLine(ox + radius / 2f, oy + side / 2f, ox + side - radius / 2f, oy + side / 2f, p);
            // 감정 이름 8개: 흰 반투명 알약 위 잉크 글자(어떤 색 위에서도 대비 고정)
            txt.setTextSize(sp(13));
            txt.setColor(Ui.INK);
            float ts = txt.getTextSize();
            for (int i = 0; i < NAMES.length; i++) {
                float tw = txt.measureText(NAMES[i]);
                float cx = px(POS[i][0]), cy = py(POS[i][1]);
                c.drawRoundRect(cx - tw / 2 - dp(8), cy - ts * 0.75f, cx + tw / 2 + dp(8), cy + ts * 0.75f, dp(12), dp(12), pill);
                c.drawText(NAMES[i], cx, cy + ts / 3, txt);
            }
            // 축 끝 라벨 4개: 바탕 밝기에 따라 잉크/흰색
            txt.setTextSize(sp(11));
            axisLabel(c, "흥분", ox + side / 2f, oy + sp(11) * 1.5f, 0f, 0.95f);
            axisLabel(c, "차분", ox + side / 2f, oy + side - sp(11) * 0.7f, 0f, -0.95f);
            axisLabel(c, "불쾌", ox + sp(11) * 1.6f, oy + side / 2f - sp(11) * 0.5f, -0.95f, 0f);
            axisLabel(c, "유쾌", ox + side - sp(11) * 1.6f, oy + side / 2f - sp(11) * 0.5f, 0.95f, 0f);
            if (!Float.isNaN(v)) {
                p.setStyle(Paint.Style.FILL);
                p.setColor(Color.argb(90, 255, 255, 255));
                c.drawCircle(px(v), py(a), dp(18), p);
                p.setColor(Color.WHITE);
                c.drawCircle(px(v), py(a), dp(9), p);
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(dp(2));
                p.setColor(Ui.INK);
                c.drawCircle(px(v), py(a), dp(9), p);
            }
        }

        private void axisLabel(Canvas c, String s, float x, float y, float vv, float aa) {
            int bg = colorAt(vv, aa);
            int luma = (299 * Color.red(bg) + 587 * Color.green(bg) + 114 * Color.blue(bg)) / 1000;
            if (luma > 150) {
                txt.setColor(Color.argb(210, 20, 22, 28));
                txt.clearShadowLayer();
            } else {
                txt.setColor(Color.WHITE);
                txt.setShadowLayer(dp(2), 0, dp(1), Color.argb(110, 0, 0, 0));
            }
            c.drawText(s, x, y, txt);
            txt.clearShadowLayer();
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

    private int dp(int d) {
        return Ui.dp(this, d);
    }
}
