package com.aclfuture.music;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;
import org.schabi.newpipe.extractor.Image;
import org.schabi.newpipe.extractor.InfoItem;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.search.SearchInfo;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.StreamInfo;
import org.schabi.newpipe.extractor.stream.StreamInfoItem;

import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/** Experimental native music search and audio stream resolver. GPL-3.0 dependency. */
final class YouTubeBridge {
    private final Activity activity;
    private final WebView web;
    private final ExecutorService pool=Executors.newFixedThreadPool(2);
    private final AtomicInteger generation=new AtomicInteger(0);
    YouTubeBridge(Activity a,WebView v){
        activity=a;web=v;
        NewPipe.init(new ACLDownloader());
    }
    @JavascriptInterface public void search(String q,int req){
        if(req<=0||q==null||q.trim().isEmpty()||q.length()>120){deliver("__aclfutureYouTubeResponse",req,error("Pesquisa inválida"));return;}
        generation.set(req);
        pool.execute(()->{
            try{
                SearchInfo info=SearchInfo.getInfo(ServiceList.YouTube,
                    ServiceList.YouTube.getSearchQHFactory().fromQuery(q, Collections.singletonList("music_songs"),""));
                JSONArray tracks=new JSONArray();
                for(InfoItem item:info.getRelatedItems()){
                    if(!(item instanceof StreamInfoItem))continue;
                    StreamInfoItem s=(StreamInfoItem)item;
                    String title=s.getName(),artist=s.getUploaderName();
                    if(title==null||title.isEmpty()||s.getUrl()==null)continue;
                    JSONObject o=new JSONObject();
                    o.put("id",s.getUrl());o.put("url",s.getUrl());o.put("title",title);
                    o.put("artist",artist==null?"":artist);o.put("duration",s.getDuration());
                    List<Image> imgs=s.getThumbnails();
                    if(imgs!=null && !imgs.isEmpty())o.put("image",imgs.get(0).getUrl());
                    tracks.put(o);
                    if(tracks.length()>=60)break;
                }
                if(req==generation.get())deliver("__aclfutureYouTubeResponse",req,new JSONObject().put("results",tracks));
            }catch(Exception ex){if(req==generation.get())deliver("__aclfutureYouTubeResponse",req,error("O YouTube Music não respondeu. Tente novamente ou use o catálogo mundial."));}
        });
    }
    @JavascriptInterface public void resolve(String streamUrl,int req){
        if(req<=0||streamUrl==null||streamUrl.length()>600 || !streamUrl.startsWith("https://")){
            deliver("__aclfutureResolveResponse",req,error("URL inválida"));return;
        }
        pool.execute(()->{
            try{
                StreamInfo data=StreamInfo.getInfo(streamUrl);
                String best="";int rate=-1;
                List<AudioStream> streams=data.getAudioStreams();
                if(streams==null||streams.isEmpty())throw new IllegalStateException("Nenhum fluxo de áudio disponível");
                for(AudioStream a:streams){
                    if(!a.isUrl() || !a.getContent().startsWith("https://"))continue;
                    int abr=a.getAverageBitrate();
                    if(abr>=rate){rate=abr;best=a.getContent();}
                }
                if(best.isEmpty())throw new IllegalStateException("Nenhum áudio compatível");
                deliver("__aclfutureResolveResponse",req,new JSONObject().put("playUrl",best));
            } catch(Exception ex){deliver("__aclfutureResolveResponse",req,error("Esta gravação não pode ser reproduzida pelo extrator. Abra no navegador."));}
        });
    }
    private JSONObject error(String m){JSONObject r=new JSONObject();try{r.put("error",m);}catch(Exception ignored){}return r;}
    private void deliver(String cb,int id,JSONObject val){
        activity.runOnUiThread(()->{
            if(web.getParent()==null)return;
            web.evaluateJavascript("window."+cb+" && window."+cb+"("+id+","+JSONObject.quote(val.toString())+");",null);
        });
    }
    void close(){pool.shutdownNow();}
}
