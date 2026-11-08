package com.aclfuture.music;

import org.schabi.newpipe.extractor.downloader.Downloader;
import org.schabi.newpipe.extractor.downloader.Request;
import org.schabi.newpipe.extractor.downloader.Response;
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;

/** Network adapter for the GPL-3.0 NewPipeExtractor. No DRM bypass. */
final class ACLDownloader extends Downloader {
    @Override public Response execute(Request request) throws IOException, ReCaptchaException {
        URL url=new URL(request.url());
        if(!"https".equalsIgnoreCase(url.getProtocol()))throw new IOException("Apenas HTTPS");
        HttpURLConnection c=(HttpURLConnection)url.openConnection();
        try {
            c.setConnectTimeout(9500);
            c.setReadTimeout(15000);
            c.setInstanceFollowRedirects(true);
            c.setRequestMethod(request.httpMethod());
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36");
            for(Map.Entry<String, List<String>> e : request.headers().entrySet()) {
                if(e.getKey()==null||e.getValue()==null)continue;
                for(String val:e.getValue())if(val!=null)c.addRequestProperty(e.getKey(),val);
            }
            byte[] payload=request.dataToSend();
            if(payload!=null){
                c.setDoOutput(true);
                try(OutputStream output=c.getOutputStream()){output.write(payload);}
            }
            int code=c.getResponseCode();
            String text="";
            if(!"HEAD".equals(request.httpMethod())){
                try(InputStream raw=code>=400?c.getErrorStream():c.getInputStream()){
                    if(raw!=null){
                        InputStream input="gzip".equalsIgnoreCase(c.getContentEncoding())?new GZIPInputStream(raw):raw;
                        ByteArrayOutputStream buffer=new ByteArrayOutputStream();byte[] tmp=new byte[8192];int n,total=0;
                        while((n=input.read(tmp))!=-1){total+=n;if(total>8_000_000)throw new IOException("Resposta muito grande");buffer.write(tmp,0,n);}
                        text=buffer.toString(StandardCharsets.UTF_8.name());
                    }
                }
            }
            return new Response(code,c.getResponseMessage(),c.getHeaderFields(),text,c.getURL().toString());
        } finally {c.disconnect();}
    }
}
