package com.shopbookidris.app;

import android.app.Activity;
import android.content.res.Resources;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.res.ResourcesCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.WebViewListener;

/**
 * The opening screen, played by Android itself.
 *
 * It used to be a web page (SplashIntro.tsx) — but the page needs about 1.5s
 * to start on the owner's Note 9, so Android had to show its own basket
 * meanwhile and then hand over to the page's basket: two baskets, and a black
 * flash at the hand-over. Here the whole animation runs natively, over the
 * page, from the very first frame. The page loads behind it unseen, and the
 * overlay leaves only once BOTH the animation has finished AND the page has
 * painted. One basket, no hand-over.
 *
 * The first frame matches the launch window exactly (launch_green.xml): brand
 * green, the basket tile at the centre of the content area. The animation and
 * its timings are the ones the owner approved in the web preview.
 */
final class NativeSplash {

    private static final int GREEN = 0xFF1B5E20;
    private static final long SHOW_MS = 3600;   // basket + name, then the sample book
    private static final long GIVE_UP_MS = 8000; // a page that never reports in

    private final Activity activity;
    private final Bridge bridge;
    private final long startedAt = System.currentTimeMillis();
    private FrameLayout overlay;
    private boolean pageReady = false;
    private boolean shown = false;
    private boolean leaving = false;

    private NativeSplash(Activity activity, Bridge bridge) {
        this.activity = activity;
        this.bridge = bridge;
    }

    static void show(Activity activity, Bridge bridge) {
        new NativeSplash(activity, bridge).start();
    }

    private void start() {
        ViewGroup content = activity.findViewById(android.R.id.content);
        overlay = build();
        content.addView(overlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                // A few more frames, so the page is fully drawn when uncovered.
                view.postDelayed(() -> { pageReady = true; maybeLeave(); }, 200);
            }
        });
        overlay.postDelayed(() -> { shown = true; maybeLeave(); }, SHOW_MS);
        overlay.postDelayed(() -> { pageReady = true; shown = true; maybeLeave(); }, GIVE_UP_MS);
    }

    private void maybeLeave() {
        if (leaving || !pageReady || !shown) return;
        leaving = true;
        overlay.animate().alpha(0f).setDuration(350).withEndAction(() -> {
            ViewGroup parent = (ViewGroup) overlay.getParent();
            if (parent != null) parent.removeView(overlay);
            // The fingerprint lock waits for this (whenSplashDone, SplashIntro.tsx).
            bridge.getWebView().evaluateJavascript(
                    "window.__nativeSplashDone=true;"
                            + "window.dispatchEvent(new Event('nativesplashdone'));", null);
        }).start();
    }

    // ---- Building the picture ----

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, activity.getResources().getDisplayMetrics()));
    }

    private Typeface font(int id) {
        try {
            Typeface t = ResourcesCompat.getFont(activity, id);
            return t != null ? t : Typeface.DEFAULT_BOLD;
        } catch (Resources.NotFoundException e) {
            return Typeface.DEFAULT_BOLD;
        }
    }

    private static GradientDrawable rounded(int color, float radiusPx) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(radiusPx);
        return d;
    }

    private TextView text(String value, float sizeDp, int color, Typeface face) {
        TextView t = new TextView(activity);
        t.setText(value);
        t.setTextSize(TypedValue.COMPLEX_UNIT_DIP, sizeDp);
        t.setTextColor(color);
        t.setTypeface(face);
        t.setIncludeFontPadding(false);
        return t;
    }

    private FrameLayout build() {
        Typeface bold = font(R.font.tajawal_bold);

        FrameLayout root = new FrameLayout(activity);
        root.setBackgroundColor(GREEN);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setClickable(true); // nothing behind it can be tapped while it plays

        // The tile with the basket — same size and place as the launch window's.
        FrameLayout tile = new FrameLayout(activity);
        tile.setBackground(rounded(0x24FFFFFF, dp(26)));
        ImageView cart = new ImageView(activity);
        cart.setImageResource(R.drawable.splash_cart);
        tile.addView(cart, new FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER));
        root.addView(tile, new FrameLayout.LayoutParams(dp(96), dp(96), Gravity.CENTER));

        // Name, line under it, a filling bar — starting 66dp below the centre.
        LinearLayout below = new LinearLayout(activity);
        below.setOrientation(LinearLayout.VERTICAL);
        below.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView name = text("دفتر البقالة", 34, Color.WHITE, bold);
        TextView tag = text("ديونك ودفعاتك، في دفتر واحد", 15, 0xC7FFFFFF, bold);
        FrameLayout bar = new FrameLayout(activity);
        bar.setBackground(rounded(0x2EFFFFFF, dp(2)));
        View fill = new View(activity);
        fill.setBackground(rounded(Color.WHITE, dp(2)));
        bar.addView(fill, new FrameLayout.LayoutParams(dp(120), dp(3)));
        below.addView(name, wrap(0));
        below.addView(tag, wrap(dp(14)));
        LinearLayout.LayoutParams barLp = new LinearLayout.LayoutParams(dp(120), dp(3));
        barLp.topMargin = dp(14);
        below.addView(bar, barLp);
        root.addView(below, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP));
        root.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) ->
                below.setY((b - t) / 2f + dp(66)));

        // The sample book: the last beat before the real app.
        LinearLayout book = buildBook(bold);
        root.addView(book, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // ---- The sequence (ms from launch) ----
        tile.animate().scaleX(1.12f).scaleY(1.12f).setStartDelay(100).setDuration(260)
                .withEndAction(() -> tile.animate().scaleX(1f).scaleY(1f).setDuration(390)
                        .setInterpolator(new OvershootInterpolator(2f)).start())
                .start();

        name.setAlpha(0f);
        name.setTranslationY(dp(14));
        name.animate().alpha(1f).translationY(0f).setStartDelay(700).setDuration(500)
                .setInterpolator(new DecelerateInterpolator()).start();

        tag.setAlpha(0f);
        tag.animate().alpha(1f).setStartDelay(1000).setDuration(450).start();

        bar.setAlpha(0f);
        bar.animate().alpha(1f).setStartDelay(1100).setDuration(200).start();
        fill.setPivotX(dp(120)); // fills right to left, the way Arabic reads
        fill.setScaleX(0f);
        fill.animate().scaleX(1f).setStartDelay(1150).setDuration(1100).start();

        book.setAlpha(0f);
        book.animate().alpha(1f).setStartDelay(2400).setDuration(350).start();

        return root;
    }

    private static LinearLayout.LayoutParams wrap(int topMargin) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = topMargin;
        return lp;
    }

    // Sample names only — never the owner's own contacts on a screen anyone can
    // see at launch. Wording and colours as on the real list.
    private LinearLayout buildBook(Typeface bold) {
        LinearLayout book = new LinearLayout(activity);
        book.setOrientation(LinearLayout.VERTICAL);
        book.setBackgroundColor(0xFFF6F8F6);

        TextView header = text("دفتر الديون", 20, Color.WHITE, bold);
        header.setBackgroundColor(GREEN);
        header.setPadding(dp(18), dp(18), dp(18), dp(14));
        book.addView(header, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        book.addView(row("محمد", "100 ريال سعودي له", GREEN, bold));
        book.addView(row("فاطمة", "مسدد", 0xFF7A857B, bold));
        book.addView(row("علي", "3,000 ريال له", GREEN, bold));
        return book;
    }

    private LinearLayout row(String who, String amount, int amountColor, Typeface bold) {
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setBackground(rounded(Color.WHITE, dp(14)));
        row.setElevation(dp(1));
        row.setPadding(dp(16), dp(14), dp(16), dp(14));
        TextView name = text(who, 16, 0xFF1D2A1E, bold);
        TextView value = text(amount, 16, amountColor, bold);
        row.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(value);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(14), dp(10), dp(14), 0);
        row.setLayoutParams(lp);
        return row;
    }
}
