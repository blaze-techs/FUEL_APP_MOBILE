package com.fuelpro.app;

import android.os.Build;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onStart() {
        super.onStart();
        lockWebView();
    }

    @Override
    public void onResume() {
        super.onResume();
        lockWebView();
    }

    /**
     * Disable Android's automatic dark-mode inversion in the WebView so the
     * app's own CSS/Tailwind dark classes (forced via the index.html boot
     * script) fully control the look. Android's FORCE_DARK/algorithmic
     * darkening would otherwise wash out the fixed dark canvas with a
     * system theme the app did not choose.
     *
     * All calls are feature-gated + caught so a WebView API drift on a
     * future Android/WebView version can never crash startup.
     */
    private void lockWebView() {
        try {
            Bridge bridge = getBridge();
            if (bridge == null) return;
            WebView wv = bridge.getWebView();
            if (wv == null) return;

            WebSettings settings = wv.getSettings();
            // Viewport rendering parity with the PWA (desktop viewport behavior
            // has no place in the fixed 9:20 APK frame).
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);

            // API 33+: opt out of algorithmic auto-darkening.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                try {
                    wv.getSettings().setAlgorithmicDarkeningAllowed(false);
                } catch (Throwable ignored) {
                }
            }

            // Older APIs via androidx.webkit compat shim.
            if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
                try {
                    WebSettingsCompat.setForceDark(wv.getSettings(), WebSettingsCompat.FORCE_DARK_OFF);
                } catch (Throwable ignored) {
                }
            }
        } catch (Throwable ignored) {
        }
    }
}
