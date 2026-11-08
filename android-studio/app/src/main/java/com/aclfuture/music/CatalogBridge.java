package com.aclfuture.music;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Narrow native bridge used exclusively by the bundled https://appassets... origin.
 * No arbitrary-URL fetching and no content extraction from playback services.
 */
final class CatalogBridge {
    private final Activity activity;
    private final WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(2);
    private final AtomicInteger latestSearch = new AtomicInteger(0);
    private static final int MAX_RESPONSE_BYTES = 2_000_000;

    CatalogBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    @JavascriptInterface
    public void search(String searchText, int reqId, String kind) {
        if(reqId <= 0) return;
        final String query = searchText == null ? "" : searchText.trim();
        if(query.isEmpty() || query.length() > 120 || !("artist".equals(kind) || "song".equals(kind))) {
            answer(reqId, "{\"error\":\"Pesquisa inválida\",\"results\":[]}");
            return;
        }
        latestSearch.set(reqId);
        pool.execute(() -> {
            try {
                String response = fetchCatalog(query, kind, "BR");
                JSONObject parsed = new JSONObject(response);
                if(parsed.optJSONArray("results") == null) throw new IllegalStateException("Catálogo não retornou lista");
                // Second market as fallback for artists without a Brazilian catalog entry.
                if(parsed.optJSONArray("results").length() == 0 && reqId == latestSearch.get()) {
                    response = fetchCatalog(query, kind, "US");
                }
                if(reqId == latestSearch.get()) answer(reqId,response);
            } catch (Exception err) {
                if(reqId == latestSearch.get()) answer(reqId,
                    "{\"error\":\"Não foi possível consultar o catálogo. Verifique sua conexão e tente novamente.\",\"results\":[]}");
            }
        });
    }

    private String fetchCatalog(String query, String kind, String country) throws Exception {
        String endpoint = "https://itunes.apple.com/search?media=music&entity=song&country=" + country
            + "&limit=100&attribute=" + ("artist".equals(kind) ? "artistTerm" : "songTerm")
            + "&term=" + URLEncoder.encode(query, "UTF-8");
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        try {
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(8500);
            conn.setReadTimeout(12000);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "ACLFUTURE-Music/1.3 Android");
            if(conn.getResponseCode() != 200) throw new java.io.IOException("Catálogo HTTP " + conn.getResponseCode());
            String type=conn.getContentType();
            if(type!=null && !type.contains("json") && !type.contains("text/javascript"))
                throw new java.io.IOException("Resposta inesperada");
            try(InputStream input=conn.getInputStream(); ByteArrayOutputStream output=new ByteArrayOutputStream()) {
                byte[] buffer=new byte[8192]; int read; int count=0;
                while((read=input.read(buffer)) != -1){
                    count+=read;
                    if(count > MAX_RESPONSE_BYTES)throw new java.io.IOException("Resposta excessiva");
                    output.write(buffer,0,read);
                }
                return new String(output.toByteArray(),StandardCharsets.UTF_8);
            }
        } finally {
            conn.disconnect();
        }
    }

    private void answer(int reqId,String json) {
        activity.runOnUiThread(() -> {
            if(web.getParent() == null) return;
            web.evaluateJavascript("window.__aclfutureCatalogResponse && window.__aclfutureCatalogResponse("
                    + reqId + "," + JSONObject.quote(json) + ");", null);
        });
    }

    void close(){pool.shutdownNow();}
}
