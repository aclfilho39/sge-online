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
import java.text.Normalizer;
import org.json.JSONArray;
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
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private final AtomicInteger latestSearch = new AtomicInteger(0);
    private final AtomicInteger latestArtistSuggest = new AtomicInteger(0);
    private final AtomicInteger latestSongSuggest = new AtomicInteger(0);
    private final AtomicInteger latestFuzzySuggest = new AtomicInteger(0);
    private static final Object FUZZY_LOCK = new Object();
    private static long lastMusicBrainzCall = 0;
    private static final int MAX_RESPONSE_BYTES = 2_000_000;

    CatalogBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    @JavascriptInterface
    public void search(String searchText, int reqId, String kind) {
        if(reqId <= 0) return;
        final String query = searchText == null ? "" : searchText.trim();
        if(query.isEmpty() || query.length() > 120 || !("artist".equals(kind) || "song".equals(kind) || "all".equals(kind))) {
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

    @JavascriptInterface
    public void suggest(String searchText, int reqId, String kind) {
        final String q=searchText==null?"":searchText.trim();
        if(reqId<=0||q.length()<2||q.length()>120||!("artist".equals(kind)||"song".equals(kind))){
            answerSuggestion(reqId,"{\"results\":[]}");return;
        }
        final AtomicInteger latest="song".equals(kind)?latestSongSuggest:latestArtistSuggest;
        latest.set(reqId);
        pool.execute(() -> {
            if(reqId!=latest.get())return;
            try {
                String response=fetchSuggestions(q,kind,"BR");
                JSONObject parsed=new JSONObject(response);
                if(parsed.optJSONArray("results")==null)throw new IllegalStateException("Sugestões inválidas");
                if(parsed.optJSONArray("results").length()==0 && reqId==latest.get())
                    response=fetchSuggestions(q,kind,"US");
                if(reqId==latest.get())answerSuggestion(reqId,response);
            }catch(Exception e){
                if(reqId==latest.get())answerSuggestion(reqId,"{\"results\":[]}");
            }
        });
    }

    /** Search nearby spellings in MusicBrainz, used only if ordinary suggestions fail. */
    @JavascriptInterface
    public void suggestFuzzy(String queryText, int reqId) {
        final String query = queryText == null ? "" : queryText.trim();
        if(reqId <= 0 || query.length() < 4 || query.length() > 120) {
            answerSuggestion(reqId,"{\"results\":[]}"); return;
        }
        latestFuzzySuggest.set(reqId);
        pool.execute(() -> {
            if(reqId != latestFuzzySuggest.get())return;
            try {
                String lucene = buildFuzzyQuery(query);
                if(lucene.isEmpty()) { answerSuggestion(reqId,"{\"results\":[]}");return; }
                // Public MusicBrainz API policy: at most one query/second per client.
                synchronized (FUZZY_LOCK) {
                    long wait = Math.max(0, 1150 - (System.currentTimeMillis() - lastMusicBrainzCall));
                    if(wait > 0)Thread.sleep(wait);
                    lastMusicBrainzCall=System.currentTimeMillis();
                }
                if(reqId != latestFuzzySuggest.get())return;
                String endpoint="https://musicbrainz.org/ws/2/artist/?query="
                    + URLEncoder.encode(lucene,"UTF-8") + "&fmt=json&limit=30";
                JSONObject response = new JSONObject(fetchUrl(endpoint));
                JSONArray names = response.optJSONArray("artists");
                JSONArray results = new JSONArray();
                if(names != null) for(int i=0;i<names.length();i++) {
                    JSONObject item=names.optJSONObject(i);
                    if(item==null)continue;
                    String name=item.optString("name", "").trim();
                    if(name.length()<2||name.length()>140)continue;
                    results.put(new JSONObject().put("artistName", name));
                }
                if(reqId==latestFuzzySuggest.get())
                    answerSuggestion(reqId,new JSONObject().put("results",results).toString());
            } catch(Exception err) {
                if(reqId==latestFuzzySuggest.get())answerSuggestion(reqId,"{\"results\":[]}");
            }
        });
    }

    static String buildFuzzyQuery(String typed) {
        String normalized=Normalizer.normalize(typed==null?"":typed,Normalizer.Form.NFD)
            .replaceAll("\\p{M}","").toLowerCase(java.util.Locale.ROOT)
            .replaceAll("[^a-z0-9 ]"," ").trim();
        if(normalized.isEmpty())return "";
        StringBuilder lucene=new StringBuilder();
        int used=0;
        for(String term:normalized.split("\\s+")) {
            if(term.length()<2||used>=4)continue;
            if(used++>0)lucene.append(" AND ");
            lucene.append("artist:").append(term).append(term.length()<=3?"*":"~1");
        }
        return lucene.toString();
    }

    private String fetchSuggestions(String query,String kind,String country) throws Exception {
        String endpoint="https://itunes.apple.com/search?media=music&entity="
            + ("song".equals(kind)?"song":"musicArtist")+"&country="+country
            +"&limit=40&term="+URLEncoder.encode(query,"UTF-8");
        return fetchUrl(endpoint);
    }

    private void answerSuggestion(int reqId,String json){
        activity.runOnUiThread(() -> {
            if(web.getParent()==null)return;
            web.evaluateJavascript("window.__aclfutureSuggestResponse && window.__aclfutureSuggestResponse("
                +reqId+","+JSONObject.quote(json)+");",null);
        });
    }

    private String fetchCatalog(String query, String kind, String country) throws Exception {
        String endpoint = "https://itunes.apple.com/search?media=music&entity=song&country=" + country
            + "&limit=100" + ("all".equals(kind)?"":"&attribute=" + ("artist".equals(kind)?"artistTerm":"songTerm"))
            + "&term=" + URLEncoder.encode(query, "UTF-8");
        return fetchUrl(endpoint);
    }

    private String fetchUrl(String endpoint) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        try {
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(8500);
            conn.setReadTimeout(12000);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "ACLFUTURE-Music/1.8 (https://github.com/aclfilho39/sge-online)");
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
