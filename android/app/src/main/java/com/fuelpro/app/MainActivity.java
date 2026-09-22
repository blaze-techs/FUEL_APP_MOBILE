package com.fuelpro.app;

import android.annotation.SuppressLint;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.HashSet;
import java.util.Set;
import androidx.core.content.FileProvider;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

/**
 * FuelPro Android shell.
 *
 * The web app owns fullscreen presentation state. This native bridge only
 * supplies the Android capabilities the browser sandbox cannot provide:
 * immersive system-bar control, real PrintManager printing, and file saving.
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

            // Expose only the capabilities below to the trusted FuelPro page.
            // The page never receives a Context or arbitrary native API.
            wv.addJavascriptInterface(new FullscreenBridge(), "FuelProNativeFullscreen");
            wv.addJavascriptInterface(new PrintBridge(), "FuelProNativePrint");
            wv.addJavascriptInterface(new FilesBridge(), "FuelProNativeFiles");
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

    /**
     * Native file-save bridge.
     *
     * Android WebView does not implement `URL.createObjectURL` + `<a download>`
     * and has no DownloadListener here, so every PDF/Excel/CSV/text export in
     * the web app was a silent no-op inside the APK. The page hands the bytes
     * over base64-encoded and this writes a real file to the device.
     *
     * Both methods return a JSON string so the page can confirm accurately
     * whether the document actually reached the device.
     */
    private final class FilesBridge {
        @JavascriptInterface
        public String saveBytes(String base64, String filename, String mimeType) {
            return saveBytesResult(base64, filename, mimeType, true);
        }

        @JavascriptInterface
        public String saveAndShareBytes(String base64, String filename, String mimeType) {
            return shareBytesResult(base64, filename, mimeType, true);
        }

        @JavascriptInterface
        public String shareBytes(String base64, String filename, String mimeType) {
            return shareBytesResult(base64, filename, mimeType, false);
        }

        /** Capability probe so the page can pick the right save path. */
        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }
    }

    private String saveBytesResult(
        String base64,
        String filename,
        String mimeType,
        boolean fallbackToShare
    ) {
        File written = writeBytesToDisk(base64, filename, mimeType);
        if (written == null) {
            JSONObject failure = new JSONObject();
            try {
                failure.put("ok", false);
                failure.put("error", "Could not write the file to this device");
            } catch (Throwable ignored) {
            }
            return failure.toString();
        }
        if (fallbackToShare) {
            // Surface the system share sheet so the user can hand the file to
            // a printer, Drive, WhatsApp or email with no extra step.
            shareFile(written, mimeType, false);
        }
        return successJson(written, mimeType);
    }

    private String shareBytesResult(
        String base64,
        String filename,
        String mimeType,
        boolean alsoSave
    ) {
        File written = writeBytesToDisk(base64, filename, mimeType);
        if (written == null) {
            JSONObject failure = new JSONObject();
            try {
                failure.put("ok", false);
                failure.put("error", "Could not write the file to this device");
            } catch (Throwable ignored) {
            }
            return failure.toString();
        }
        shareFile(written, mimeType, alsoSave);
        return successJson(written, mimeType);
    }

    private String successJson(File file, String mimeType) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", true);
            result.put("filename", file.getName());
            result.put("mimeType", mimeType == null ? "" : mimeType);
            result.put("savedToDownloads", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q);
            result.put("path", file.getAbsolutePath());
        } catch (Throwable ignored) {
        }
        return result.toString();
    }

    /**
     * Base64 (no data-URL prefix) -> real file. Uses MediaStore on Android 10+
     * so the file lands in the public Downloads collection with no runtime
     * permission, and the app-specific external directory on older releases
     * (which need no permission either).
     */
    private File writeBytesToDisk(String base64, String filename, String mimeType) {
        if (base64 == null || base64.isEmpty()) return null;
        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (Throwable error) {
            Log.e("FuelProFiles", "Not valid base64", error);
            return null;
        }
        String safeName = sanitizeFilename(filename);
        String safeMime = (mimeType == null || mimeType.trim().isEmpty())
            ? "application/octet-stream"
            : mimeType;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            File viaMediaStore = writeViaMediaStore(bytes, safeName, safeMime);
            if (viaMediaStore != null) return viaMediaStore;
        }
        return writeViaFileSystem(bytes, safeName);
    }

    private File writeViaMediaStore(byte[] bytes, String safeName, String safeMime) {
        OutputStream out = null;
        Uri uri = null;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, safeMime);
            values.put(
                MediaStore.MediaColumns.RELATIVE_PATH,
                Environment.DIRECTORY_DOWNLOADS
            );
            uri = getContentResolver().insert(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                values
            );
            if (uri == null) return null;
            out = getContentResolver().openOutputStream(uri);
            if (out == null) return null;
            out.write(bytes);
            out.flush();
            return fileForMediaStoreUri(uri, safeName);
        } catch (Throwable error) {
            Log.e("FuelProFiles", "MediaStore write failed", error);
            // Clean up the dangling row so it cannot show as a broken entry.
            if (uri != null) {
                try {
                    getContentResolver().delete(uri, null, null);
                } catch (Throwable ignored) {
                }
            }
            return null;
        } finally {
            closeQuietly(out);
        }
    }

    /**
     * MediaStore gives a content:// URI, but the share sheet is happier with a
     * real file. The Downloads directory is readable to the app, so resolve the
     * on-disk path; if that is unavailable fall back to the app cache.
     */
    private File fileForMediaStoreUri(Uri uri, String safeName) {
        try {
            String[] projection = {MediaStore.MediaColumns.DATA};
            try (android.database.Cursor cursor =
                    getContentResolver().query(uri, projection, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(MediaStore.MediaColumns.DATA);
                    if (index >= 0) {
                        String path = cursor.getString(index);
                        if (path != null && !path.isEmpty()) {
                            File resolved = new File(path);
                            if (resolved.exists()) return resolved;
                        }
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        // No readable path: mirror into the cache so sharing still works.
        File cached = new File(getCacheDir(), safeName);
        try (java.io.InputStream in = getContentResolver().openInputStream(uri);
             FileOutputStream out = new FileOutputStream(cached)) {
            if (in == null) return null;
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) > 0) {
                out.write(buffer, 0, read);
            }
            return cached;
        } catch (Throwable error) {
            Log.e("FuelProFiles", "Could not resolve saved file", error);
            return null;
        }
    }

    private File writeViaFileSystem(byte[] bytes, String safeName) {
        try {
            File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) dir = new File(getFilesDir(), "exports");
            if (!dir.exists() && !dir.mkdirs()) return null;
            File target = new File(dir, safeName);
            try (FileOutputStream out = new FileOutputStream(target)) {
                out.write(bytes);
                out.flush();
            }
            return target;
        } catch (Throwable error) {
            Log.e("FuelProFiles", "File-system write failed", error);
            return null;
        }
    }

    private void shareFile(File file, String mimeType, boolean alsoSave) {
        String safeMime = (mimeType == null || mimeType.trim().isEmpty())
            ? "application/octet-stream"
            : mimeType;
        // The bridge is called on the WebView (JavaScript) thread; the chooser
        // must be started from the UI thread.
        runOnUiThread(() -> {
            try {
                Uri shareUri = FileProvider.getUriForFile(
                    MainActivity.this,
                    getPackageName() + ".fileprovider",
                    file
                );
                if (shareUri == null) return;
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(safeMime);
                send.putExtra(Intent.EXTRA_STREAM, shareUri);
                send.putExtra(Intent.EXTRA_SUBJECT, file.getName());
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(send, "Share " + file.getName());
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(chooser);
            } catch (Throwable error) {
                Log.e("FuelProFiles", "Share failed", error);
                if (alsoSave) {
                    // Sharing is best-effort; the file is already on disk.
                    Log.i("FuelProFiles", "File saved without sharing: " + file.getName());
                }
            }
        });
    }

    private void closeQuietly(OutputStream stream) {
        if (stream == null) return;
        try {
            stream.close();
        } catch (Throwable ignored) {
        }
    }

    /** Keep the name filesystem- and printer-safe. */
    private String sanitizeFilename(String filename) {
        String base = (filename == null || filename.trim().isEmpty())
            ? "FuelPro-Document"
            : filename.trim();
        base = base.replaceAll("[\\\\/:*?\"<>|\\r\\n\\t]", "-");
        base = base.replaceAll("\\s+", " ");
        if (base.length() > 120) {
            base = base.substring(0, 120);
        }
        return base;
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
