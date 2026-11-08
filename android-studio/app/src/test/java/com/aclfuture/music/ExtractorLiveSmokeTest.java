package com.aclfuture.music;

import org.junit.Test;
import static org.junit.Assert.*;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.InfoItem;
import org.schabi.newpipe.extractor.search.SearchInfo;
import org.schabi.newpipe.extractor.stream.StreamInfo;
import org.schabi.newpipe.extractor.stream.StreamInfoItem;
import org.schabi.newpipe.extractor.stream.AudioStream;

import java.util.Collections;
import java.util.List;

/** Live integration smoke test: will fail if YouTube blocks the CI runner. */
public class ExtractorLiveSmokeTest {
    @Test public void musicOriginalSearchAndAudioStream() throws Exception {
        NewPipe.init(new ACLDownloader());
        SearchInfo info=SearchInfo.getInfo(ServiceList.YouTube,
            ServiceList.YouTube.getSearchQHFactory().fromQuery(
                "Engenheiros do Hawaii Infinita Highway",Collections.singletonList("music_songs"),""));
        int matching=0; String first="";
        for(InfoItem item:info.getRelatedItems()){
            if(!(item instanceof StreamInfoItem))continue;
            StreamInfoItem s=(StreamInfoItem)item;
            if(s.getName()!=null&&s.getName().toLowerCase().contains("infinita highway")){
                matching++;
                if(first.isEmpty())first=s.getUrl();
            }
        }
        System.out.println("ACLFUTURE LIVE TEST: Search matches = "+matching+", URL = "+first);
        assertTrue("Music search must find a real original title",matching>0);
        StreamInfo data=StreamInfo.getInfo(first);
        List<AudioStream> streams=data.getAudioStreams();
        System.out.println("ACLFUTURE LIVE TEST: Audio stream candidates = "+(streams==null?0:streams.size()));
        assertNotNull("Audio stream extraction requires a playable source",streams);
        assertFalse("Audio streams cannot be empty",streams.isEmpty());
        assertTrue("At least one HTTPS media URL",streams.stream().anyMatch(a->a.isUrl()&&a.getContent().startsWith("https://")));
    }
}
