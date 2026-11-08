package com.aclfuture.music;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
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

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.Locale;

/** ACLFUTURE Music — a music search and Android-native player, no external app launch. */
public final class MainActivity extends Activity {
    private static final String HOST="appassets.androidplatform.net";
    private static final String HOME="https://"+HOST+"/index.html";
    private static final int PICK_FILE_CODE=4901;
    private WebView web;
    private CatalogBridge catalogBridge;
    private YouTubeBridge youtubeBridge;
    private PlayerBridge playerBridge;
    private ValueCallback<Uri[]> uploadCallback;
    private int rendererRestarts=0;

    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.rgb(15,10,34));
        getWindow().setNavigationBarColor(Color.rgb(15,10,34));
        setupWeb();
    }
    private void setupWeb(){
        web=new WebView(this);
        web.setBackgroundColor(Color.rgb(11,9,27));
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        setContentView(web);
        WebSettings s=web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if(Build.VERSION.SDK_INT>=26)s.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                return bundledAsset(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                if(!request.isForMainFrame())return false;
                return !isLocal(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,String url){
                return !isLocal(Uri.parse(url));
            }
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){
                if(view!=web)return false;
                cleanUp();
                if(rendererRestarts++ >=1){
                    new AlertDialog.Builder(MainActivity.this).setTitle("Reprodutor interrompido")
                       .setMessage("O mecanismo de interface foi reiniciado mais de uma vez. Reabra o aplicativo.")
                       .setPositiveButton("Fechar",(d,w)->finish()).show();
                }else{
                    Toast.makeText(MainActivity.this,"Restaurando sua biblioteca...",Toast.LENGTH_LONG).show();
                    setupWeb();
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> cb,FileChooserParams params){
                if(uploadCallback!=null)uploadCallback.onReceiveValue(null);
                uploadCallback=cb;
                try{Intent pick=params.createIntent();pick.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(pick,PICK_FILE_CODE);return true;
                }catch(ActivityNotFoundException|SecurityException e){
                    uploadCallback=null;cb.onReceiveValue(null);
                    Toast.makeText(MainActivity.this,"Seletor de arquivos indisponível",Toast.LENGTH_LONG).show();return true;
                }
            }
        });
        catalogBridge=new CatalogBridge(this,web);
        web.addJavascriptInterface(catalogBridge,"ACLCatalog");
        youtubeBridge=new YouTubeBridge(this,web);
        web.addJavascriptInterface(youtubeBridge,"ACLYT");
        playerBridge=new PlayerBridge(this,web);
        web.addJavascriptInterface(playerBridge,"ACLPlayer");
        web.loadUrl(HOME);
    }
    private static boolean isLocal(Uri uri){
        return uri!=null&&"https".equalsIgnoreCase(uri.getScheme())&&HOST.equalsIgnoreCase(uri.getHost());
    }
    private WebResourceResponse bundledAsset(Uri uri){
        if(!isLocal(uri))return null;
        String path=uri.getPath();
        if(path==null||path.isEmpty()||"/".equals(path))path="/index.html";
        if(path.contains("..")||path.contains("\\")||path.indexOf((char)0)>=0)return notFound();
        String relative=path.substring(1);
        try{InputStream in=getAssets().open("www/"+relative);
            return new WebResourceResponse(mime(relative),"UTF-8",in);
        }catch(IOException e){return notFound();}
    }
    private static WebResourceResponse notFound(){
        return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
    }
    private static String mime(String name){
        String n=name.toLowerCase(Locale.ROOT);
        if(n.endsWith(".html"))return "text/html";
        if(n.endsWith(".js"))return "application/javascript";
        if(n.endsWith(".css"))return "text/css";
        if(n.endsWith(".png"))return "image/png";
        if(n.endsWith(".jpeg")||n.endsWith(".jpg"))return "image/jpeg";
        if(n.endsWith(".webmanifest")||n.endsWith(".json"))return "application/json";
        return "application/octet-stream";
    }
    @Override protected void onActivityResult(int code,int result,Intent data){
        super.onActivityResult(code,result,data);
        if(code!=PICK_FILE_CODE||uploadCallback==null)return;
        uploadCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));
        uploadCallback=null;
    }
    @Override public void onConfigurationChanged(Configuration c){super.onConfigurationChanged(c);}
    @Override public void onBackPressed(){
        if(playerBridge!=null&&playerBridge.isEmbeddedOpen()){playerBridge.closeEmbedded();return;}
        if(web==null){super.onBackPressed();return;}
        web.evaluateJavascript("(function(){if(!document.querySelector('#modal').hidden){document.querySelector('#modalClose').click();return true}if(document.querySelector('#sidebar').classList.contains('open')){document.querySelector('#overlay').click();return true}if(state.view!=='inicio'){navigate('inicio');return true}return false})()",v->{if("false".equals(v))MainActivity.super.onBackPressed();});
    }
    private void cleanUp(){
        if(uploadCallback!=null){uploadCallback.onReceiveValue(null);uploadCallback=null;}
        if(catalogBridge!=null){catalogBridge.close();catalogBridge=null;}
        if(youtubeBridge!=null){youtubeBridge.close();youtubeBridge=null;}
        if(playerBridge!=null){playerBridge.close();playerBridge=null;}
        if(web!=null){web.destroy();web=null;}
    }
    @Override protected void onDestroy(){cleanUp();super.onDestroy();}
}
