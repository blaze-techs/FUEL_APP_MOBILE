package com.fuelpro.app;

import android.annotation.SuppressLint;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.content.Context;
import java.util.HashSet;
import java.util.Set;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

/**
 * FuelPro Android shell.
 *
 * The web app owns fullscreen presentation state. This native bridge only
 * supplies the Android capability the browser sandbox cannot provide: hiding
 * the status/navigation system bars in immersive mode.
 */
public class MainActivity extends BridgeActivity {
    private boolean nativeFullscreen = false;
    private final Set<WebView> activePrintWebViews = new HashSet<>();

    @Override
    public void onStart() {
        super.onStart();
        lockWebView();
    }

    @Override
    public void onResume() {
        super.onResume();
        lockWebView();
        if (nativeFullscreen) {
            enterImmersiveMode();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && nativeFullscreen) {
            enterImmersiveMode();
        }
    }

    @Override
    public void onDestroy() {
        nativeFullscreen = false;
        showSystemBars();
        super.onDestroy();
    }

    /**
     * Disable Android's automatic dark-mode inversion in the WebView so the
     * app's own CSS/Tailwind dark classes fully control the look.
     */
    @SuppressLint("SetJavaScriptEnabled")
    private void lockWebView() {
        try {
            Bridge bridge = getBridge();
            if (bridge == null) return;
            WebView wv = bridge.getWebView();
            if (wv == null) return;

            WebSettings settings = wv.getSettings();
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                try {
                    settings.setAlgorithmicDarkeningAllowed(false);
                } catch (Throwable ignored) {
                }
            }

            if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
                try {
                    WebSettingsCompat.setForceDark(
                        settings,
                        WebSettingsCompat.FORCE_DARK_OFF
                    );
                } catch (Throwable ignored) {
                }
            }

            // Expose only the fullscreen capability to the trusted FuelPro
            // page. The page never receives a Context or arbitrary native API.
            wv.addJavascriptInterface(new FullscreenBridge(), "FuelProNativeFullscreen");
            wv.addJavascriptInterface(new PrintBridge(), "FuelProNativePrint");
        } catch (Throwable ignored) {
        }
    }

    private void enterImmersiveMode() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                final android.view.WindowInsetsController controller =
                    getWindow().getInsetsController();
                if (controller != null) {
                    controller.setSystemBarsBehavior(
                        android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    );
                    controller.hide(
                        android.view.WindowInsets.Type.statusBars()
                            | android.view.WindowInsets.Type.navigationBars()
                    );
                    return;
                }
            }

            // Android 10 and older fallback. IMMERSIVE_STICKY keeps system bars
            // hidden until the user intentionally reveals them with a gesture.
            getWindow().getDecorView().setSystemUiVisibility(
                android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        } catch (Throwable ignored) {
        }
    }

    private void showSystemBars() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                final android.view.WindowInsetsController controller =
                    getWindow().getInsetsController();
                if (controller != null) {
                    controller.show(
                        android.view.WindowInsets.Type.statusBars()
                            | android.view.WindowInsets.Type.navigationBars()
                    );
                    return;
                }
            }
            getWindow().getDecorView().setSystemUiVisibility(
                android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        } catch (Throwable ignored) {
        }
    }

    /**
     * Native Android printing bridge. Android WebView does not reliably
     * implement window.print(), so documents are handed to Android's real
     * PrintManager instead of attempting to print through a hidden iframe.
     */
    private final class PrintBridge {
        @JavascriptInterface
        public boolean printHtml(String html, String title) {
            if (html == null || html.trim().isEmpty()) return false;
            runOnUiThread(() -> printHtmlNative(html, title));
            return true;
        }
    }

    private void printHtmlNative(String html, String title) {
        try {
            final WebView printWebView = new WebView(this);
            activePrintWebViews.add(printWebView);
            printWebView.getSettings().setJavaScriptEnabled(false);
            printWebView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    try {
                        PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                        if (printManager == null) throw new IllegalStateException("Android PrintManager unavailable");
                        String jobName = (title == null || title.trim().isEmpty()) ? "FuelPro Document" : title.trim();
                        PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                        printManager.print(jobName, adapter, new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                            .build());
                    } catch (Throwable error) {
                        android.util.Log.e("FuelProPrint", "Native print failed", error);
                    }
                }
            });
            printWebView.loadDataWithBaseURL(
                "https://fuel-app-mobile.pages.dev/",
                html,
                "text/html",
                "UTF-8",
                null
            );
        } catch (Throwable error) {
            android.util.Log.e("FuelProPrint", "Could not create print WebView", error);
        }
    }

    private final class FullscreenBridge {
        @JavascriptInterface
        public boolean enter() {
            runOnUiThread(() -> {
                nativeFullscreen = true;
                enterImmersiveMode();
            });
            return true;
        }

        @JavascriptInterface
        public boolean exit() {
            runOnUiThread(() -> {
                nativeFullscreen = false;
                showSystemBars();
            });
            return true;
        }
    }
}
