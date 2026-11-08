package com.aclfuture.music;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.AudioAttributes;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import org.json.JSONObject;

/** ACLFUTURE Android-native player. ExoPlayer plays stream URLs inside this app. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class PlayerBridge {
    private final Activity activity;
    private final WebView interfaceView;
    private final ExoPlayer player;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private volatile boolean closed=false;
    private int activeId=0;
    private Dialog embedDialog;
    private WebView embedWeb;
    private boolean playingRequested=false;
    private final Runnable pulse=new Runnable(){
        @Override public void run(){
            if(closed)return;
            if(activeId>0)emitState("progress");
            handler.postDelayed(this,900);
        }
    };

    PlayerBridge(Activity context,WebView web){
        activity=context;interfaceView=web;
        DefaultHttpDataSource.Factory http=new DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(11000).setReadTimeoutMs(22000)
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent("Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36");
        DefaultDataSource.Factory data=new DefaultDataSource.Factory(context,http);
        player=new ExoPlayer.Builder(context).setMediaSourceFactory(new DefaultMediaSourceFactory(data)).build();
        player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),true);
        player.addListener(new Player.Listener(){
            @Override public void onIsPlayingChanged(boolean playing){emitState("state");}
            @Override public void onPlaybackStateChanged(int state){
                if(activeId<=0)return;
                if(state==Player.STATE_ENDED){emitState("ended");return;}
                emitState("state");
            }
            @Override public void onPlayerError(PlaybackException error){
                android.util.Log.e("ACL_Music_Player","ExoPlayer: " + error.getErrorCodeName(), error);
                emit("error",activeId,0,0,false,false);
            }
        });
        handler.postDelayed(pulse,900);
    }
    @JavascriptInterface public void play(String url,int reqId){
        if(reqId<=0||url==null||url.length()>5000||!url.startsWith("https://"))return;
        activity.runOnUiThread(()->{
            if(closed)return;
            closeEmbeddedInternal();
            activeId=reqId;playingRequested=true;
            try{
                player.stop();player.clearMediaItems();
                player.setMediaItem(MediaItem.fromUri(url));
                player.prepare();player.play();emitState("state");
            }catch(Exception e){android.util.Log.e("ACL_Music_Player","Start failed",e);emit("error",reqId,0,0,false,false);}
        });
    }
    @JavascriptInterface public void playOffline(String id,int reqId){
        if(id==null||id.length()>250||reqId<=0)return;
        activity.runOnUiThread(()->{
            if(closed)return;
            java.io.File audioFile=OfflineBridge.getSavedFile(activity,id);
            if(audioFile==null){emit("error",reqId,0,0,false,false);return;}
            try{
                closeEmbeddedInternal();activeId=reqId;playingRequested=true;
                player.stop();player.clearMediaItems();
                player.setMediaItem(MediaItem.fromUri(android.net.Uri.fromFile(audioFile)));
                player.prepare();player.play();emitState("state");
            }catch(Exception e){android.util.Log.e("ACL_Music_Player","Saved file failed",e);emit("error",reqId,0,0,false,false);}
        });
    }
    @JavascriptInterface public void pause(){activity.runOnUiThread(()->{if(!closed){player.pause();playingRequested=false;emitState("state");}});}
    @JavascriptInterface public void resume(){activity.runOnUiThread(()->{if(!closed){player.play();playingRequested=true;emitState("state");}});}
    @JavascriptInterface public void stop(){activity.runOnUiThread(()->{if(!closed){activeId=0;playingRequested=false;player.stop();player.clearMediaItems();closeEmbeddedInternal();}});}
    @JavascriptInterface public void seekTo(long ms){activity.runOnUiThread(()->{if(!closed&&ms>=0)player.seekTo(ms);});}
    @JavascriptInterface public void setVolume(float value){activity.runOnUiThread(()->{if(!closed&&Float.isFinite(value))player.setVolume(Math.max(0f,Math.min(1f,value)));});}

    private void emitState(String type){
        if(activeId<=0||closed)return;
        long pos=Math.max(0,player.getCurrentPosition());
        long dur=Math.max(0,player.getDuration());
        boolean loading=player.getPlaybackState()==Player.STATE_BUFFERING||player.getPlaybackState()==Player.STATE_IDLE;
        emit(type,activeId,pos,dur,player.isPlaying(),loading);
    }
    private void emit(String type,int id,long position,long duration,boolean playing,boolean loading){
        if(closed)return;
        JSONObject payload=new JSONObject();
        try{
            payload.put("type",type);payload.put("requestId",id);payload.put("position",position);
            payload.put("duration",duration);payload.put("playing",playing);payload.put("loading",loading);
        }catch(Exception ignored){}
        String call="window.__aclfutureNativePlayerEvent && window.__aclfutureNativePlayerEvent("+JSONObject.quote(payload.toString())+");";
        activity.runOnUiThread(()->{
            if(closed||interfaceView.getParent()==null)return;
            interfaceView.evaluateJavascript(call,null);
        });
    }
    @JavascriptInterface public void openEmbedded(String videoId,String title,String artist){
        if(videoId==null||!videoId.matches("[a-zA-Z0-9_-]{11}"))return;
        activity.runOnUiThread(()->{
            if(closed)return;
            player.pause();activeId=0;closeEmbeddedInternal();
            embedDialog=new Dialog(activity);
            LinearLayout root=new LinearLayout(activity);root.setOrientation(LinearLayout.VERTICAL);
            root.setPadding(dp(13),dp(13),dp(13),dp(15));
            GradientDrawable backdrop=new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                    new int[]{Color.rgb(20,35,51),Color.rgb(8,15,25)});
            backdrop.setCornerRadius(dp(21));root.setBackground(backdrop);
            LinearLayout head=new LinearLayout(activity);head.setOrientation(LinearLayout.HORIZONTAL);
            head.setGravity(Gravity.CENTER_VERTICAL);
            TextView label=new TextView(activity);
            label.setText("▶  ACLFUTURE  •  REPRODUÇÃO INTERNA");label.setTextColor(Color.rgb(241,198,112));
            label.setTextSize(12f);label.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
            head.addView(label,new LinearLayout.LayoutParams(0,dp(48),1));
            Button close=new Button(activity);close.setText("✕");close.setTextColor(Color.WHITE);
            close.setBackgroundColor(Color.TRANSPARENT);head.addView(close,new LinearLayout.LayoutParams(dp(48),dp(48)));
            root.addView(head);
            TextView song=new TextView(activity);song.setText((artist==null?"":artist)+" — "+(title==null?"":title));
            song.setTextColor(Color.WHITE);song.setTextSize(14);song.setMaxLines(2);
            song.setPadding(dp(4),0,dp(4),dp(12));root.addView(song);
            embedWeb=new WebView(activity);
            WebSettings settings=embedWeb.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setAllowFileAccess(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);
            settings.setSupportMultipleWindows(false);
            embedWeb.setBackgroundColor(Color.BLACK);
            embedWeb.setWebChromeClient(new android.webkit.WebChromeClient());
            embedWeb.setWebViewClient(new WebViewClient(){
                @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                    if(!request.isForMainFrame())return false;
                    String url=request.getUrl().toString();
                    return !url.startsWith("https://www.youtube.com/embed/")&&!url.startsWith("https://www.youtube-nocookie.com/embed/");
                }
                @Override public boolean shouldOverrideUrlLoading(WebView view,String url){
                    return !url.startsWith("https://www.youtube.com/embed/")&&!url.startsWith("https://www.youtube-nocookie.com/embed/");
                }
            });
            root.addView(embedWeb,new LinearLayout.LayoutParams(-1,dp(266)));
            TextView note=new TextView(activity);
            note.setText("O vídeo é incorporado neste aplicativo. Anúncios ou limitações podem ser exibidos pela plataforma.");
            note.setTextColor(Color.rgb(177,170,202));note.setTextSize(11);
            note.setPadding(dp(5),dp(12),dp(5),dp(3));root.addView(note);
            embedDialog.setContentView(root);
            Window w=embedDialog.getWindow();
            if(w!=null){w.setBackgroundDrawableResource(android.R.color.transparent);w.setLayout(-1,-2);w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);}
            close.setOnClickListener(v->closeEmbeddedInternal());
            embedDialog.setOnDismissListener(v->{if(embedWeb!=null){embedWeb.destroy();embedWeb=null;}embedDialog=null;});
            embedDialog.show();
            Window shown=embedDialog.getWindow();if(shown!=null)shown.setLayout((int)(activity.getResources().getDisplayMetrics().widthPixels*.96),-2);
            String url="https://www.youtube.com/embed/"+videoId+"?autoplay=1&playsinline=1&controls=1&enablejsapi=1";
            embedWeb.loadUrl(url);
        });
    }
    @JavascriptInterface public void closeEmbedded(){activity.runOnUiThread(this::closeEmbeddedInternal);}
    private int dp(int size){return (int)(size*activity.getResources().getDisplayMetrics().density+.5f);}
    private void closeEmbeddedInternal(){
        Dialog existing=embedDialog;
        if(existing!=null){try{existing.setOnDismissListener(null);existing.dismiss();}catch(Exception ignored){}embedDialog=null;}
        if(embedWeb!=null){try{embedWeb.stopLoading();embedWeb.destroy();}catch(Exception ignored){}embedWeb=null;}
    }
    boolean isEmbeddedOpen(){return embedDialog!=null&&embedDialog.isShowing();}
    void close(){
        if(closed)return;
        closed=true;
        handler.removeCallbacks(pulse);
        activity.runOnUiThread(()->{closeEmbeddedInternal();player.release();});
    }
}
