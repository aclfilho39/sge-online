package com.aclfuture.music;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayInputStream;
import java.util.Collections;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    private static final int FILE_PICKER_CODE = 4901;
    private WebView web;
    private CatalogBridge catalogBridge;
    private ValueCallback<Uri[]> uploadCallback;
    private int rendererRestarts = 0;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(9,14,18));
        getWindow().setNavigationBarColor(Color.rgb(9,14,18));
        setupWeb();
    }

    private void setupWeb() {
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(9,14,18));
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); // Required by bundled, trusted UI only.
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Android file picker returns content:// URI.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(false); // Next track / async offline read.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return bundledAsset(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return externalLink(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return externalLink(Uri.parse(url));
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if(view != web) return false;
                if (uploadCallback != null) { uploadCallback.onReceiveValue(null); uploadCallback = null; }
                if(catalogBridge != null) { catalogBridge.close(); catalogBridge = null; }
                web.destroy();
                web = null;
                if(rendererRestarts++ >= 1) {
                    new AlertDialog.Builder(MainActivity.this)
                        .setTitle("O reprodutor parou")
                        .setMessage("O mecanismo de reprodução falhou novamente. Feche o aplicativo e tente reabrir.")
                        .setPositiveButton("Fechar", (dialog, which) -> finish()).show();
                } else {
                    Toast.makeText(MainActivity.this, "Restaurando reprodutor...", Toast.LENGTH_LONG).show();
                    setupWeb();
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if(uploadCallback != null) uploadCallback.onReceiveValue(null);
                uploadCallback = callback;
                try {
                    Intent pick = params.createIntent();
                    pick.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(pick, FILE_PICKER_CODE);
                    return true;
                } catch (ActivityNotFoundException | SecurityException ex) {
                    uploadCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "Nenhum seletor de arquivos disponível", Toast.LENGTH_LONG).show();
                    return true;
                }
            }
        });
        catalogBridge = new CatalogBridge(this,web);
        web.addJavascriptInterface(catalogBridge,"ACLCatalog");
        web.loadUrl(HOME);
    }

    private WebResourceResponse bundledAsset(Uri uri) {
        if(!"https".equalsIgnoreCase(uri.getScheme()) || !HOST.equalsIgnoreCase(uri.getHost())) return null;
        String path = uri.getPath();
        if(path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
        // Restrict path resolution to exact bundled web files, no traversal or decoding of filename tricks.
        if(path.contains("..") || path.contains("\\") || path.indexOf((char) 0) >= 0) return missingAsset();
        String relative = path.substring(1);
        String mime = mimeType(relative);
        try {
            InputStream input = getAssets().open("www/" + relative);
            return new WebResourceResponse(mime, "UTF-8", input);
        } catch (IOException ignored) {
            return missingAsset();
        }
    }

    private static WebResourceResponse missingAsset() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeType(String name) {
        String n = name.toLowerCase(Locale.US);
        if(n.endsWith(".html")) return "text/html";
        if(n.endsWith(".js")) return "application/javascript";
        if(n.endsWith(".css")) return "text/css";
        if(n.endsWith(".png")) return "image/png";
        if(n.endsWith(".jpg")||n.endsWith(".jpeg")) return "image/jpeg";
        if(n.endsWith(".webmanifest")||n.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    private boolean externalLink(Uri uri) {
        if(uri == null) return true;
        if("https".equalsIgnoreCase(uri.getScheme()) && HOST.equalsIgnoreCase(uri.getHost())) return false;
        String scheme = uri.getScheme();
        if(!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) return true;
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(view);
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, "Nenhum navegador foi encontrado", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if(requestCode != FILE_PICKER_CODE || uploadCallback == null) return;
        Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        uploadCallback.onReceiveValue(result);
        uploadCallback = null;
    }

    @Override public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
    }

    @Override public void onBackPressed() {
        if(web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript("(function(){if(!document.querySelector('#modal').hidden){document.querySelector('#modalClose').click();return true}if(document.querySelector('#sidebar').classList.contains('open')){document.querySelector('#overlay').click();return true}if(state.view!=='inicio'){navigate('inicio');return true}return false})()", handled -> {
            if("false".equals(handled)) MainActivity.super.onBackPressed();
        });
    }

    @Override protected void onDestroy() {
        if(uploadCallback != null) { uploadCallback.onReceiveValue(null); uploadCallback = null; }
        if(catalogBridge != null) { catalogBridge.close(); catalogBridge = null; }
        if(web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
