package com.shopbookidris.app;

import android.app.Activity;
import android.content.res.Resources;
import android.graphics.Color;
import android.graphics.Typeface;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.core.content.res.ResourcesCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.WebViewListener;

/**
 * The opening screen, played by Android itself, over the page while it loads.
 *
 * Grocery app: the app icon on brand green (see build()), the same picture as
 * the launch window and Android 12's system splash, so nothing jumps. It
 * leaves once the page has painted AND SHOW_MS has passed.
 * A flavor with its own scene (R.bool.scene_splash, «دفتر المقاول») plays a
 * self-contained HTML file instead (buildScene()).
 */
final class NativeSplash {

    private static final int GREEN = 0xFF1B5E20;
    private static final long SHOW_MS = 600;    // at least this long, so it never flickers
    private static final long GIVE_UP_MS = 8000; // a page that never reports in

    // A flavor's own scene (R.bool.scene_splash): a self-contained HTML file
    // from the web build, played in a WebView of its own. SCENE_MS must match
    // `scene.ms` in src/flavors/ — the file's timeline is 6 s.
    private static final String SCENE_URL = "file:///android_asset/public/splash/loader.html";
    private static final long SCENE_MS = 6200;

    private final Activity activity;
    private final Bridge bridge;
    private final long startedAt = System.currentTimeMillis();
    private FrameLayout overlay;
    private WebView sceneWeb;
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
        boolean scene = activity.getResources().getBoolean(R.bool.scene_splash);
        long showMs = scene ? SCENE_MS : SHOW_MS;
        overlay = scene ? buildScene() : build();
        content.addView(overlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                // A few more frames, so the page is fully drawn when uncovered.
                view.postDelayed(() -> { pageReady = true; maybeLeave(); }, 200);
            }
        });
        overlay.postDelayed(() -> { shown = true; maybeLeave(); }, showMs);
        overlay.postDelayed(() -> { pageReady = true; shown = true; maybeLeave(); },
                Math.max(GIVE_UP_MS, showMs + 2000));
    }

    private void maybeLeave() {
        if (leaving || !pageReady || !shown) return;
        leaving = true;
        overlay.animate().alpha(0f).setDuration(350).withEndAction(() -> {
            ViewGroup parent = (ViewGroup) overlay.getParent();
            if (parent != null) parent.removeView(overlay);
            if (sceneWeb != null) { sceneWeb.destroy(); sceneWeb = null; }
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

    private TextView text(String value, float sizeDp, int color, Typeface face) {
        TextView t = new TextView(activity);
        t.setText(value);
        t.setTextSize(TypedValue.COMPLEX_UNIT_DIP, sizeDp);
        t.setTextColor(color);
        t.setTypeface(face);
        t.setIncludeFontPadding(false);
        return t;
    }

    /**
     * The scene splash. Its own WebView, not the app's: the app's page takes
     * ~1.5 s to start, while this file is pure CSS and paints at once. Until it
     * does, the overlay shows the scene's own background colour, which is also
     * the launch window's — so there is still nothing to flash.
     */
    private FrameLayout buildScene() {
        int bg = activity.getResources().getColor(R.color.splashBackground, null);
        FrameLayout root = new FrameLayout(activity);
        root.setBackgroundColor(bg);
        root.setClickable(true);
        WebView web = sceneWeb = new WebView(activity);
        web.setBackgroundColor(bg);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOnTouchListener((v, e) -> true); // a picture, not a page
        web.loadUrl(SCENE_URL);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return root;
    }

    /**
     * The opening screen: the APP ICON on brand green, the name small at the
     * bottom — the picture the user just tapped, in the same size and spot as
     * the launch window and Android 12's system splash (splash_app_icon.xml).
     * It fits every kind of business (owner's choice, 2026-11-20; it used to be
     * a shopping basket with a 3.6 s animation). It leaves as soon as the page
     * has painted — no artificial wait beyond SHOW_MS.
     */
    private FrameLayout build() {
        Typeface bold = font(R.font.tajawal_bold);

        FrameLayout root = new FrameLayout(activity);
        root.setBackgroundColor(GREEN);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setClickable(true); // nothing behind it can be tapped while it shows

        ImageView icon = new ImageView(activity);
        icon.setImageResource(R.drawable.splash_app_icon);
        root.addView(icon, new FrameLayout.LayoutParams(dp(160), dp(160), Gravity.CENTER));

        TextView name = text("فليكتب | Shopbook", 16, 0xE0FFFFFF, bold);
        name.setGravity(Gravity.CENTER_HORIZONTAL);
        FrameLayout.LayoutParams nameLp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        nameLp.bottomMargin = dp(48);
        root.addView(name, nameLp);
        name.setAlpha(0f);
        name.animate().alpha(1f).setDuration(250).start();
        return root;
    }
}
