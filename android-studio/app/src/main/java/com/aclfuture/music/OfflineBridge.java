package com.aclfuture.music;

import android.app.Activity;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.SystemClock;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.StreamInfo;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Private offline audio store. Android adaptation of the Codex desktop DownloadMP3 queue ideas. */
final class OfflineBridge {
    private static final long MAX_AUDIO_BYTES=160L*1024*1024;
    private static final String PREFS="acl_music_offline_v19";
    private final Activity activity;
    private final WebView web;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final SharedPreferences prefs;
    private final AtomicBoolean cancelCurrent=new AtomicBoolean(false);
    private volatile boolean closed=false;
    private final Object mutex=new Object();

    OfflineBridge(Activity activity,WebView web){
        this.activity=activity;this.web=web;
        this.prefs=activity.getSharedPreferences(PREFS,Activity.MODE_PRIVATE);
    }
    private static String hash(String id) throws Exception {
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(id.getBytes(StandardCharsets.UTF_8));
        StringBuilder b=new StringBuilder();for(byte c:digest)b.append(String.format(Locale.ROOT,"%02x",c&255));
        return b.toString();
    }
    private static boolean youtubePage(String u){
        try{
            Uri uri=Uri.parse(u);
            if(!"https".equalsIgnoreCase(uri.getScheme()))return false;
            String host=uri.getHost();if(host==null)return false;host=host.toLowerCase(Locale.ROOT);
            return host.equals("youtu.be")||host.equals("youtube.com")||host.endsWith(".youtube.com");
        }catch(Exception e){return false;}
    }
    private JSONObject readManifest(){
        try{return new JSONObject(prefs.getString("songs","{}"));}catch(Exception e){return new JSONObject();}
    }
    private File storage(){File dir=new File(activity.getFilesDir(),"music_offline_v19");if(!dir.exists())dir.mkdirs();return dir;}
    private File storedFile(JSONObject item){
        String file=item.optString("file","");
        if(!file.matches("[a-f0-9]{64}\\.(m4a|webm|mp3|opus|ogg)"))return null;
        return new File(storage(),file);
    }
    static File getSavedFile(Activity activity,String id){
        try{
            JSONObject data=new JSONObject(activity.getSharedPreferences(PREFS,Activity.MODE_PRIVATE).getString("songs","{}"));
            JSONObject item=data.optJSONObject(id);if(item==null)return null;
            String name=item.optString("file","");
            if(!name.matches("[a-f0-9]{64}\\.(m4a|webm|mp3|opus|ogg)"))return null;
            File file=new File(new File(activity.getFilesDir(),"music_offline_v19"),name);
            return file.isFile()&&file.length()>128?file:null;
        }catch(Exception e){return null;}
    }
    private void send(JSONObject msg){
        if(closed)return;
        final String js="window.__aclfutureOfflineNativeEvent && window.__aclfutureOfflineNativeEvent("+JSONObject.quote(msg.toString())+");";
        activity.runOnUiThread(()->{if(!closed&&web.getParent()!=null)web.evaluateJavascript(js,null);});
    }
    private void event(String type,int requestId,String id,String message,int pct,JSONObject item){
        try{
            JSONObject j=new JSONObject();j.put("type",type);j.put("requestId",requestId);j.put("id",id);
            j.put("message",message);j.put("progress",pct);
            if(item!=null)j.put("item",item);
            send(j);
        }catch(Exception ignored){}
    }
    @JavascriptInterface public void list(int requestId){
        if(requestId<=0)return;
        worker.execute(()->{
            try{
                JSONArray result=new JSONArray();
                synchronized(mutex){
                    JSONObject data=readManifest();JSONArray keys=data.names();
                    if(keys!=null)for(int i=0;i<keys.length();i++){
                        String id=keys.optString(i);JSONObject item=data.optJSONObject(id);
                        File f=item==null?null:storedFile(item);
                        if(f!=null&&f.isFile()&&f.length()>128)result.put(item);
                    }
                }
                JSONObject data=new JSONObject();data.put("type","list");data.put("requestId",requestId);data.put("items",result);send(data);
            }catch(Exception e){event("error",requestId,"","Nao foi possivel ler downloads offline",0,null);}
        });
    }
    @JavascriptInterface public void remove(String id,int requestId){
        if(id==null||id.length()>250)return;
        worker.execute(()->{
            try{
                synchronized(mutex){
                    JSONObject all=readManifest();JSONObject item=all.optJSONObject(id);
                    if(item!=null){File f=storedFile(item);if(f!=null&&f.exists()&&!f.delete())throw new Exception("Falha ao apagar arquivo");}
                    all.remove(id);if(!prefs.edit().putString("songs",all.toString()).commit())throw new Exception("Falha de registro");
                }
                event("removed",requestId,id,"Removido",100,null);
            }catch(Exception e){event("error",requestId,id,"Falha ao excluir arquivo offline",0,null);}
        });
    }
    @JavascriptInterface public void cancel(){cancelCurrent.set(true);}
    @JavascriptInterface public void download(String id,String youtubeUrl,String title,String artist,String image,String source,int requestId){
        if(requestId<=0||id==null||id.isEmpty()||id.length()>250||!youtubePage(youtubeUrl)){
            event("error",requestId,id==null?"":id,"Endereco de musica invalido",0,null);return;
        }
        if(title==null)title="Faixa";if(artist==null)artist="";if(image==null)image="";if(source==null)source="youtube";
        final String fTitle=title.substring(0,Math.min(180,title.length()));
        final String fArtist=artist.substring(0,Math.min(180,artist.length()));
        final String fImage=image.substring(0,Math.min(900,image.length()));
        final String fSource=source.substring(0,Math.min(30,source.length()));
        worker.execute(()->runDownload(id,youtubeUrl,fTitle,fArtist,fImage,fSource,requestId));
    }
    private void runDownload(String id,String url,String title,String artist,String image,String source,int req){
        File tmp=null;HttpURLConnection conn=null;cancelCurrent.set(false);
        try{
            synchronized(mutex){
                JSONObject old=readManifest().optJSONObject(id);
                File saved=old==null?null:storedFile(old);
                if(saved!=null&&saved.isFile()&&saved.length()>128){event("complete",req,id,"Ja salva no dispositivo",100,old);return;}
            }
            event("progress",req,id,"Localizando audio",0,null);
            StreamInfo info=StreamInfo.getInfo(url);
            List<AudioStream> options=info.getAudioStreams();
            if(options==null||options.isEmpty())throw new Exception("O provedor nao forneceu audio");
            AudioStream choice=null;int bestRate=-1;
            for(AudioStream a:options){
                if(a==null||!a.isUrl()||!a.getContent().startsWith("https://"))continue;
                int bit=a.getAverageBitrate();if(bit>bestRate){bestRate=bit;choice=a;}
            }
            if(choice==null)throw new Exception("Stream de audio indisponivel");
            String mediaUrl=choice.getContent();
            String format=String.valueOf(choice.getFormat()).toLowerCase(Locale.ROOT);
            String suffix=(format.contains("webm")||format.contains("weba"))?".webm":(format.contains("opus")?".opus":".m4a");
            File output=new File(storage(),hash(id)+suffix);
            tmp=new File(storage(),hash(id)+".part");
            if(tmp.exists())tmp.delete();
            conn=(HttpURLConnection)new URL(mediaUrl).openConnection();
            conn.setConnectTimeout(16000);conn.setReadTimeout(20000);conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent","Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36");
            conn.setRequestProperty("Accept","*/*");
            int http=conn.getResponseCode();if(http<200||http>=300)throw new Exception("Audio indisponivel: HTTP "+http);
            String type=conn.getContentType();if(type!=null&&type.toLowerCase(Locale.ROOT).matches("(?s).*(text/html|application/json|text/plain|application/xml).*"))throw new Exception("O servidor nao enviou audio");
            long size=conn.getContentLengthLong();if(size>MAX_AUDIO_BYTES)throw new Exception("Arquivo maior que 160 MB");
            if(size>0&&activity.getFilesDir().getUsableSpace()<size+5L*1024*1024)throw new Exception("Espaco insuficiente no aparelho");
            long bytes=0,last=0;long start=SystemClock.elapsedRealtime();
            try(InputStream in=conn.getInputStream();FileOutputStream out=new FileOutputStream(tmp)){
                byte[] buffer=new byte[32768];int n;
                while((n=in.read(buffer))!=-1){
                    if(cancelCurrent.get()||Thread.currentThread().isInterrupted())throw new InterruptedException("Cancelado");
                    bytes+=n;
                    if(bytes>MAX_AUDIO_BYTES)throw new Exception("Download ultrapassou 160 MB");
                    if(SystemClock.elapsedRealtime()-start>5*60*1000L)throw new Exception("Tempo limite de 5 minutos");
                    out.write(buffer,0,n);
                    int progress=size>0?(int)Math.min(99,(100*bytes)/size):0;
                    if(SystemClock.elapsedRealtime()-last>450){event("progress",req,id,size>0?"Baixando audio":"Baixando "+(bytes/1024)+" KB",progress,null);last=SystemClock.elapsedRealtime();}
                }
                out.flush();out.getFD().sync();
            }
            if(bytes<512)throw new Exception("Arquivo incompleto");
            try(FileInputStream check=new FileInputStream(tmp)){
                byte[] header=new byte[16];int n=check.read(header);
                if(n<4)throw new Exception("Resposta de audio invalida");
                String h=new String(header,0,n,StandardCharsets.ISO_8859_1);
                boolean valid=h.startsWith("ID3")||h.startsWith("OggS")||h.startsWith("fLaC")||(n>=8&&h.substring(4,8).equals("ftyp"))||(header[0]==26&&(header[1]&255)==69&&(header[2]&255)==223&&(header[3]&255)==163)||(header[0]==(byte)255);
                if(!valid)throw new Exception("Conteudo retornado nao parece audio");
            }
            if(output.exists()&&!output.delete())throw new Exception("Arquivo antigo inacessivel");
            if(!tmp.renameTo(output))throw new Exception("Falha ao gravar arquivo definitivo");
            tmp=null;
            JSONObject item=new JSONObject();item.put("id",id);item.put("title",title);item.put("artist",artist);
            item.put("image",image);item.put("source",source);item.put("nativeSaved",true);item.put("downloadable",false);
            item.put("duration",Math.max(0,info.getDuration()));item.put("bytes",output.length());
            item.put("savedAt",System.currentTimeMillis());item.put("file",output.getName());item.put("playUrl","");
            item.put("originUrl",url);item.put("license","Copia offline do usuario");
            synchronized(mutex){JSONObject manifest=readManifest();manifest.put(id,item);
                if(!prefs.edit().putString("songs",manifest.toString()).commit()){output.delete();throw new Exception("Nao foi possivel registrar a faixa");}
            }
            event("complete",req,id,"Musica disponivel offline",100,item);
        }catch(InterruptedException e){Thread.currentThread().interrupt();event("error",req,id,"Download cancelado",0,null);
        }catch(Exception e){android.util.Log.w("ACL_Offline","Erro ao baixar faixa: "+e.getMessage());event("error",req,id,e.getMessage()==null?"Falha no download":e.getMessage(),0,null);
        }finally{if(conn!=null)conn.disconnect();if(tmp!=null&&tmp.exists())tmp.delete();}
    }
    void close(){closed=true;cancelCurrent.set(true);worker.shutdownNow();}
}
