/* ACLFUTURE Music — reprodutor PWA gratuito. Sem publicidade/analytics. */
'use strict';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const safe=(s='')=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const urlSafe=(value)=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}};
const readStore=(key,def)=>{try{const v=JSON.parse(localStorage.getItem(key));return v??def}catch{return def}};
const writeStore=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch(e){console.warn('Storage indisponível',e)}};
const fmt=t=>{if(!Number.isFinite(t)||t<0)return '—';const s=Math.floor(t);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};
const prettySource={youtube:'YouTube Music',catalog:'Gravação original',audius:'Audius',openverse:'Openverse',ftu:'Free To Use',local:'Meus arquivos'};
const musicTag=tag=>String(tag||'').replace(/\s+/g,' ').trim();
const audio=$('#audio');let toastTimer,searchTimer,requestNumber=0,playRequest=0,installPrompt=null,dbPromise,catalogRequestId=0,ytRequestId=0;const activeDownloads=new Set();const pendingCatalog=new Map(),pendingYT=new Map(),pendingYTResolve=new Map();
const state={view:'inicio',source:'catalog',query:'',searchKind:'artist',page:1,hasMore:false,sourceHasMore:{},tracks:[],allResults:[],queue:[],current:null,idx:-1,shuffle:false,repeat:false,loading:false,favorites:readStore('acl_music_favorites',{}),playlists:readStore('acl_music_playlists',{}),playlistId:null,offline:[],sourceErrors:[],loadingCount:0};

// Banco local IndexedDB: áudio e metadados permanecem no dispositivo. Nenhum arquivo é enviado a servidores nossos.
// V2: metadados são separados dos Blobs. A listagem não carrega todas as músicas na memória.
function db(){
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
  if(!('indexedDB' in window))return reject(Error('Armazenamento não suportado'));
  const req=indexedDB.open('aclfuture-music-offline',2);
  req.onupgradeneeded=(event)=>{
   const d=req.result;
   const music=d.objectStoreNames.contains('music')?req.transaction.objectStore('music'):d.createObjectStore('music',{keyPath:'id'});
   const meta=d.objectStoreNames.contains('metadata')?req.transaction.objectStore('metadata'):d.createObjectStore('metadata',{keyPath:'id'});
   if(event.oldVersion<2){
    const cursor=music.openCursor();
    cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;const {blob,...m}=c.value;meta.put(m);c.continue()};
   }
  };
  req.onerror=()=>reject(req.error||Error('Não foi possível abrir biblioteca'));
  req.onblocked=()=>reject(Error('A biblioteca está aberta em outra aba. Feche as outras abas e tente novamente.'));
  req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result)};
 }).catch(e=>{dbPromise=null;throw e});
 return dbPromise;
}
async function tx(method,entry){
 const d=await db();
 return new Promise((resolve,reject)=>{
  const writable=method==='put'||method==='delete';
  const t=d.transaction(method==='all'?['metadata']:writable?['music','metadata']:['music'],writable?'readwrite':'readonly');
  let value;
  t.oncomplete=()=>resolve(value);
  t.onerror=()=>reject(t.error||Error('Falha na biblioteca'));
  t.onabort=()=>reject(t.error||Error('Operação de armazenamento cancelada'));
  const music=method==='all'?null:t.objectStore('music');
  let r;
  if(method==='all')r=t.objectStore('metadata').getAll();
  else if(method==='get')r=music.get(entry);
  else if(method==='put'){
   const {blob,...m}=entry;
   r=music.put(entry);t.objectStore('metadata').put(m);
  }else if(method==='delete'){r=music.delete(entry);t.objectStore('metadata').delete(entry)}
  else {t.abort();return}
  r.onsuccess=()=>{value=r.result};
 });
}
async function refreshOffline(){
 try{
  state.offline=(await tx('all')).sort((a,b)=>(b.savedAt||0)-(a.savedAt||0));
  $('#offlineCountSide').textContent=state.offline.length;
  const bytes=state.offline.reduce((sum,t)=>sum+(t.bytes||0),0);
  const size=bytes<1048576?Math.round(bytes/1024)+' KB':(bytes/1048576).toFixed(1)+' MB';
  const element=$('#offlineStorageInfo');if(element)element.textContent=`${state.offline.length} faixa(s) · ${size} no aparelho`;
  return state.offline;
 }catch(e){console.warn('Offline:',e);state.offline=[];const el=$('#offlineStorageInfo');if(el)el.textContent='Armazenamento indisponível';toast('Não foi possível acessar a biblioteca offline neste navegador.');return []}
}
function isSaved(id){return state.offline.some(t=>t.id===id)}
function toast(msg){clearTimeout(toastTimer);$('#toast').textContent=msg;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3900)}
function setNet(){const on=navigator.onLine;$('#netStatus').classList.toggle('offline',!on);$('#netStatus').innerHTML=`<span></span> ${on?'ONLINE':'OFFLINE'}`;if(!on)toast('Sem internet. Sua coleção offline continua disponível.')}

function normalizeOpenverse(x){const u=urlSafe(x.url);if(!x.id||!u)return null;const license=String(x.license||'').toLowerCase();const allowed=['cc0','by','by-sa','by-nc','by-nd','by-nc-nd','by-nc-sa','pdm'].includes(license);return {id:'ov:'+x.id,title:musicTag(x.title)||'Faixa sem título',artist:musicTag(x.creator)||'Artista independente',image:urlSafe(x.thumbnail),source:'openverse',playUrl:u,downloadUrl:allowed?u:null,downloadable:allowed,license:license?license.toUpperCase():'Licença não identificada',licenseUrl:urlSafe(x.license_url),originUrl:urlSafe(x.foreign_landing_url)||`https://openverse.org/audio/${encodeURIComponent(x.id)}`,duration:Number(x.duration)>0?Number(x.duration)/1000:0,attribution:String(x.attribution||''),genre:Array.isArray(x.genres)?x.genres.join(', '):''}}
function normalizeAudius(x){if(!x.id||!x.title)return null;const id=encodeURIComponent(x.id);const cover=x.artwork||{};const art=cover['480x480']||cover['150x150']||cover['1000x1000']||'';if(x.is_stream_gated||x.isStreamGated||x.stream_conditions||x.streamConditions||x.is_unlisted||x.isUnlisted||x.is_delete||x.isDelete)return null;const canDl=!!(x.is_downloadable??x.isDownloadable)&&!x.download_conditions&&!x.downloadConditions;return {id:'au:'+x.id,title:musicTag(x.title),artist:musicTag(x.user?.name||x.user?.handle||x.artist_name)||'Artista Audius',image:urlSafe(art),source:'audius',playUrl:`https://api.audius.co/v1/tracks/${id}/stream?app_name=ACLFUTURE_Music`,downloadUrl:canDl?`https://api.audius.co/v1/tracks/${id}/download?app_name=ACLFUTURE_Music`:null,downloadable:canDl,license:'Permissão do artista',licenseUrl:'',originUrl:urlSafe(x.permalink?(x.permalink.startsWith('http')?x.permalink:`https://audius.co${x.permalink.startsWith('/')?'':'/'}${x.permalink}`):'https://audius.co'),duration:Number(x.duration)||0,genre:x.genre||''}}
function ftuTextArtist(x){
 if(typeof x.artist==='string')return x.artist;
 if(x.artist?.name)return x.artist.name;
 if(Array.isArray(x.artists))return x.artists.map(a=>Array.isArray(a)?(a[1]?.name||''):(typeof a==='string'?a:(a.name||a.title||''))).filter(Boolean).join(', ');
 return x.artist_name||'Artista independente';
}
function normalizeFTU(x){
 if(!x.id||x.is_premium)return null;
 const files=x.files||{};
 const artwork=x.thumbnails||x.artwork||x.cover||{};
 const mp3=urlSafe(files.mp3||x.audio_url||x.mp3_url||x.stream_url||x.file_url);
 if(!mp3)return null;
 return {id:'ft:'+x.id,title:musicTag(x.title||x.name)||'Faixa sem título',artist:musicTag(ftuTextArtist(x)),
 image:urlSafe(artwork.md||artwork.sm||artwork.lg||x.thumbnail||x.cover_url||x.image_url||''),
 source:'ftu',playUrl:mp3,downloadUrl:mp3,downloadable:true,
 license:'Free To Use (consulte condições)',licenseUrl:'https://freetouse.com/license',
 originUrl:'https://freetouse.com/',duration:Number(x.duration)||0,genre:x.genre||''};
}
async function apiFetch(url,ms=12000){const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),ms);try{const r=await fetch(url,{signal:abort.signal,headers:{Accept:'application/json'}});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(timeout)}}
async function fromOpenverse(query,page){const p=new URLSearchParams({q:query||'music',category:'music',page_size:'25',page:String(page),mature:'false'});const r=await apiFetch('https://api.openverse.org/v1/audio/?'+p.toString());const entries=Array.isArray(r.results)?r.results:[];return {items:entries.map(normalizeOpenverse).filter(Boolean),hasMore:typeof r.page_count==='number'?page<r.page_count:entries.length===25}}
async function fromAudius(query,page){const p=new URLSearchParams({limit:'25',offset:String((page-1)*25),app_name:'ACLFUTURE_Music'});let endpoint;if(query){p.set('query',query);endpoint='https://api.audius.co/v1/tracks/search?'+p.toString()}else{p.set('time','week');endpoint='https://api.audius.co/v1/tracks/trending?'+p.toString()};const r=await apiFetch(endpoint);const entries=Array.isArray(r.data)?r.data:(r.data?.tracks||r.results||[]);return {items:entries.map(normalizeAudius).filter(Boolean),hasMore:entries.length===25}}
async function fromFTU(query,page){const p=new URLSearchParams({limit:'25',offset:String((page-1)*25),order:query?'release_date':'plays',sort:'desc'});if(query)p.set('query',query);const ep=query?'search':'all';const r=await apiFetch('https://api.freetouse.com/v3/music/tracks/'+ep+'?'+p.toString());if(r.ok===false)throw Error(r.error||'Erro Free To Use');const entries=Array.isArray(r.data)?r.data:(r.data?.tracks||r.results||[]);const total=Number(r.pagination?.count);return {items:entries.map(normalizeFTU).filter(Boolean),hasMore:Number.isFinite(total)&&r.pagination?.count!=null?page*25<total:entries.length===25}}
// BUSCA GLOBAL: metadados de gravações comercializadas, não arquivos de áudio.
// No APK a requisição HTTPS é feita pela ponte nativa, sem chaves privadas ou scripts externos.
// No navegador, tenta a API pública da loja; o download das gravações comerciais não é habilitado.
function normalizeArtistName(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim()}
function sameCreditedArtist(credit,search){
 const a=normalizeArtistName(credit).replace(/\s+(?:feat|featuring|ft)\s+.*$/,'');
 const q=normalizeArtistName(search);
 if(!a||!q)return false;
 return a===q || a.startsWith(q+' feat ') || a.startsWith(q+' featuring ') || a.startsWith(q+' and ');
}
function normalizeCatalogTrack(t){
 const id=String(t.trackId||'');
 if(!id || !t.artistName || !t.trackName || t.kind!=='song')return null;
 return {id:'cat:'+id,title:musicTag(t.trackName),artist:musicTag(t.artistName),album:musicTag(t.collectionName),image:urlSafe((t.artworkUrl100||'').replace(/100x100[^/]*\.jpg/i,'600x600bb.jpg'))||urlSafe(t.artworkUrl100||''),source:'catalog',playUrl:'',downloadUrl:null,downloadable:false,
 license:'Catálogo comercial: reprodução conforme condições do provedor',licenseUrl:'',originUrl:urlSafe(t.trackViewUrl||t.collectionViewUrl)||'',duration:Math.max(0,Number(t.trackTimeMillis||0)/1000),previewUrl:urlSafe(t.previewUrl||''),genre:musicTag(t.primaryGenreName||''),catalogId:id,artistId:String(t.artistId||''),releaseDate:musicTag(t.releaseDate||'')};
}
window.__aclfutureCatalogResponse=function(reqId,jsonString){
 const pending=pendingCatalog.get(reqId);if(!pending)return;
 pendingCatalog.delete(reqId);clearTimeout(pending.timer);
 try{pending.resolve(JSON.parse(jsonString))}catch(e){pending.reject(Error('Resposta do catálogo inválida'))}
};
function fetchGlobalCatalog(query,kind){
 if(!query)return Promise.resolve({results:[]});
 const id=++catalogRequestId;
 if(window.ACLCatalog?.search){
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pendingCatalog.delete(id);reject(Error('Tempo limite da busca global'))},14000);
   pendingCatalog.set(id,{resolve,reject,timer});
   try{window.ACLCatalog.search(query.slice(0,120),id,kind)}catch(e){clearTimeout(timer);pendingCatalog.delete(id);reject(e)}
  });
 }
 const p=new URLSearchParams({term:query,country:'BR',media:'music',entity:'song',limit:'100',attribute:kind==='artist'?'artistTerm':'songTerm'});
 return apiFetch('https://itunes.apple.com/search?'+p,14000);
}
async function fromCatalog(query,page){
 if(!query.trim())return {items:[],hasMore:false};
 if(page>1)return {items:[],hasMore:false};
 const r=await fetchGlobalCatalog(query,state.searchKind);
 if(r.error)throw Error(String(r.error));
 const input=Array.isArray(r.results)?r.results:[];
 let items=input.map(normalizeCatalogTrack).filter(Boolean);
 if(state.searchKind==='artist')items=items.filter(x=>sameCreditedArtist(x.artist,query));
 const seen=new Set();items=items.filter(t=>{if(seen.has(t.id))return false;seen.add(t.id);return true});
 items.sort((a,b)=>{
  const first=(a.album||'').localeCompare((b.album||''),'pt-BR');
  return first||a.title.localeCompare(b.title,'pt-BR');
 });
 return {items,hasMore:false};
}
function openArtistRecording(t){if(t?.id)playTrack(t.id);}

// Experimental YouTube Music adapter, powered by the native open-source extractor.
// The browser build does not expose this provider and falls back to music metadata.
window.__aclfutureYouTubeResponse=function(id,data){
 const waiter=pendingYT.get(id);if(!waiter)return;
 clearTimeout(waiter.timer);pendingYT.delete(id);
 try{const parsed=JSON.parse(data);if(parsed.error)waiter.reject(Error(parsed.error));else waiter.resolve(parsed)}
 catch(e){waiter.reject(e)}
};
window.__aclfutureResolveResponse=function(id,data){
 const waiter=pendingYTResolve.get(id);if(!waiter)return;
 clearTimeout(waiter.timer);pendingYTResolve.delete(id);
 try{const parsed=JSON.parse(data);if(parsed.error)waiter.reject(Error(parsed.error));else waiter.resolve(parsed)}
 catch(e){waiter.reject(e)}
};
function queryYouTubeNative(query){
 if(!window.ACLYT?.search)return Promise.reject(Error('Extrator musical disponível apenas no APK Android experimental.'));
 const id=++ytRequestId;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pendingYT.delete(id);reject(Error('Busca do YouTube Music excedeu 25 segundos'))},25000);
  pendingYT.set(id,{resolve,reject,timer});
  try{window.ACLYT.search(query,id)}catch(e){pendingYT.delete(id);clearTimeout(timer);reject(e)}
 });
}
function resolveYouTubeNative(url){
 if(!window.ACLYT?.resolve)return Promise.reject(Error('Reprodutor experimental indisponível.'));
 const id=++ytRequestId;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pendingYTResolve.delete(id);reject(Error('Tempo limite ao carregar faixa.'))},22000);
  pendingYTResolve.set(id,{resolve,reject,timer});
  try{window.ACLYT.resolve(url,id)}catch(e){pendingYTResolve.delete(id);clearTimeout(timer);reject(e)}
 });
}
const badVersions=/\b(?:cover|tribute|karaok[eê]|reaction|reacts?|instrumental cover|fan made|parody|nightcore|slowed|sped up)\b/i;
function ytTrackFromResult(t){
 const url=urlSafe(t.url);
 if(!url||!t.title)return null;
 const artist=musicTag(t.artist||'Artista não identificado');
 let title=musicTag(t.title);
 if(title.toLowerCase().startsWith((artist+' - ').toLowerCase()))title=title.slice(artist.length+3).trim();
 return {id:'yt:'+String(t.id||url),title,artist,album:'',source:'youtube',image:urlSafe(t.image)||'',originUrl:url,playUrl:'',downloadable:false,downloadUrl:null,duration:Number(t.duration)||0,license:'Streaming disponibilizado pela plataforma de origem',licenseUrl:'',genre:''};
}
async function fromYouTube(query,page){
 if(page>1||!query.trim())return {items:[],hasMore:false};
 const response=await queryYouTubeNative(query.slice(0,120));
 let items=(response.results||[]).map(ytTrackFromResult).filter(Boolean).filter(t=>!badVersions.test(t.title+' '+t.artist));
 if(state.searchKind==='artist'){
   const wanted=normalizeArtistName(query);
   items=items.filter(t=>{
    const artist=normalizeArtistName(t.artist).replace(/\s+(official|topic|vevo)$/,'');
    const title=normalizeArtistName(t.title);
    return artist===wanted || artist.includes(wanted) || title.startsWith(wanted+' ');
   });
 }
 return {items:unique(items),hasMore:false};
}

function unique(tracks){const ids=new Set();return tracks.filter(t=>{if(!t||ids.has(t.id))return false;ids.add(t.id);return true})}
async function discover({append=false}={}){
 if(state.loading&&append)return;
 if(!append){state.page=1;state.tracks=[];state.sourceHasMore={};}
 else state.page++;
 const request=++requestNumber;
 if((state.source==='catalog'||state.source==='youtube')&&!state.query.trim()){state.loading=false;state.hasMore=false;state.sourceErrors=[];renderList();return}
 if(!navigator.onLine){state.loading=false;state.hasMore=false;state.sourceErrors=['Sem conexão com a internet'];renderList();return}
 state.loading=true;state.sourceErrors=[];
 if(!append)$('#trackList').innerHTML='<div class="list-loading"><div class="loading-orb"></div> '+(state.source==='youtube'?'Consultando YouTube Music...':state.source==='catalog'?'Buscando gravações no catálogo global...':'Buscando em catálogos de músicas livres...')+'</div>';
 $('#loadMore').hidden=true;
 const requested=(state.source==='all'?['audius','openverse','ftu']:state.source==='local'?[]:[state.source]).filter(src=>!append||state.sourceHasMore[src]);
 const runners={youtube:fromYouTube,catalog:fromCatalog,audius:fromAudius,openverse:fromOpenverse,ftu:fromFTU};
 try{
  const responses=await Promise.allSettled(requested.map(async src=>{if(src==='youtube'){try{const y=await fromYouTube(state.query,state.page);if(y.items.length)return y}catch(e){console.warn('Busca nativa:',e)}return fromCatalog(state.query,state.page)}return runners[src](state.query,state.page)}));
  if(request!==requestNumber)return;
  const records=[];
  responses.forEach((result,i)=>{
   const src=requested[i];
   if(result.status==='fulfilled'){
    records.push(...result.value.items);
    state.sourceHasMore[src]=result.value.hasMore;
   }else{
    console.warn(src,result.reason);
    state.sourceHasMore[src]=false;
    state.sourceErrors.push(prettySource[src]||src);
   }
  });
  state.tracks=unique(append?[...state.tracks,...records]:records);
  state.hasMore=Object.values(state.sourceHasMore).some(Boolean);
  if(state.source==='all')state.tracks.sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));
 }catch(e){console.error(e);state.sourceErrors=['Falha na busca'];state.hasMore=false;}
 finally{if(request===requestNumber){state.loading=false;renderList();$('#loadMore').hidden=!state.hasMore||!['buscar','inicio'].includes(state.view)}}
}

function cover(t,size='small'){const img=urlSafe(t.image);return `<div class="album-cover${size==='big'?' big':''}">${img?`<img src="${safe(img)}" loading="lazy" alt="" onerror="this.remove()">`:'♫'}</div>`}
function row(t,i){
 const active=state.current?.id===t.id,like=!!state.favorites[t.id],downloaded=isSaved(t.id),src=prettySource[t.source]||t.source;
 const catalog=t.source==='catalog';const youtube=t.source==='youtube';
 const label='Reproduzir dentro do ACLFUTURE: '+t.artist+' — '+t.title;
 const audioButton=(catalog||youtube)?`<button data-inline="${safe(t.id)}" title="Reproduzir aqui" aria-label="Reproduzir dentro do aplicativo" class="official-link">▶</button>`:`<button data-download="${safe(t.id)}" title="${downloaded?'Salva offline':t.downloadable?'Salvar offline':'Download não autorizado'}" aria-label="${downloaded?'Salva offline':t.downloadable?'Baixar faixa':'Download não autorizado'}" class="${downloaded?'saved':''}" ${!downloaded&&!t.downloadable?'disabled':''}>${downloaded?'✓':'↓'}</button>`;
 return `<div class="track-row ${active?'active':''} ${catalog?'catalog-row':''}" data-play="${safe(t.id)}" role="button" tabindex="0" aria-label="${safe(label)}"><span class="track-index">${active?'♫':i+1}</span><div class="track-title-cell">${cover(t)}<div class="song-words"><div class="song-name">${safe(t.title)}</div><div class="song-artist">${safe(t.artist)}${catalog&&t.album?` · ${safe(t.album)}`:''}</div></div></div><div class="hide-phone"><span class="source-tag">${safe(src)}</span></div><div class="track-duration hide-phone">${fmt(t.duration)}</div><div class="row-actions"><button data-like="${safe(t.id)}" title="${like?'Remover favorita':'Favoritar'}" aria-label="Favoritar" class="${like?'liked':''}">${like?'♥':'♡'}</button>${audioButton}<button data-menu="${safe(t.id)}" title="Mais opções" aria-label="Opções">⋮</button></div></div>`;
}
function contentForView(){if(state.view==='favoritos')return Object.values(state.favorites);if(state.view==='offline')return state.offline;if(state.view==='playlist-detail')return (state.playlists[state.playlistId]?.ids||[]).map(id=>lookup(id)||state.playlists[state.playlistId]?.tracks?.find(t=>t.id===id)).filter(Boolean);return state.source==='local'?state.offline:state.tracks.filter(t=>state.source==='all'||t.source===state.source||(state.source==='youtube'&&t.source==='catalog'))}
function lookup(id){return state.offline.find(x=>x.id===id)||state.tracks.find(x=>x.id===id)||state.queue.find(x=>x.id===id)||state.favorites[id]||null}
function updateHead(){const changes={inicio:['MÚSICAS ORIGINAIS','Sua música, sem covers','Pesquise os seus artistas e reproduza diretamente no ACLFUTURE Music.'],buscar:['BUSCA MUNDIAL',state.query?'Resultados para “'+state.query+'”':'O que vamos ouvir?',state.source==='youtube'?'Busque faixas e ouça com o reprodutor integrado. A disponibilidade varia por gravação.':state.source==='catalog'?'Faixas originais identificadas por álbum e artista. Toque para reproduzir aqui.':'Músicas independentes em catálogos de uso livre.'],favoritos:['SUA COLEÇÃO','Suas favoritas','Faixas que você marcou com o coração.'],offline:['SEMPRE COM VOCÊ','Disponíveis offline','Músicas guardadas neste dispositivo.'],playlists:['ORGANIZE SEU SOM','Minhas playlists','Monte seleções para cada momento.'],'playlist-detail':['SUAS PLAYLISTS',state.playlists[state.playlistId]?.name||'Playlist','Músicas escolhidas por você.']}[state.view]||[];$('#trackKicker').textContent=changes[0]||'';$('#tracksTitle').textContent=changes[1]||'';$('#trackSubtitle').textContent=changes[2]||'';$('#hero').hidden=state.view!=='inicio';$('#genresSection').hidden=state.view!=='inicio';$('.track-tools').hidden=['favoritos','offline','playlists','playlist-detail'].includes(state.view);$('.table-head').hidden=state.view==='playlists';$('#searchKind').hidden=!['youtube','catalog'].includes(state.source)||!['inicio','buscar'].includes(state.view);$('#catalogNotice').hidden=!['youtube','catalog'].includes(state.source)||!['inicio','buscar'].includes(state.view);$('#loadMore').hidden=!['buscar','inicio'].includes(state.view)||state.loading||!state.hasMore;$$('[data-view]').forEach(el=>el.classList.toggle('selected',el.dataset.view===state.view))}
function renderList(){updateHead();const el=$('#trackList');if(state.view==='playlists'){el.innerHTML=`<div class="playlist-grid"><button class="playlist-card" id="playlistNewCard"><div class="playlist-card-icon">＋</div><div><strong>Criar playlist</strong><p>Nova coleção de músicas</p></div></button>${Object.entries(state.playlists).map(([id,p])=>`<button class="playlist-card" data-playlist="${safe(id)}"><div class="playlist-card-icon">♫</div><div><strong>${safe(p.name)}</strong><p>${p.ids.length} músicas</p></div></button>`).join('')}</div>`;$('#playlistNewCard')?.addEventListener('click',createPlaylist);return}
 const tracks=contentForView();if(!tracks.length){const reason=state.loading?'Carregando músicas...':state.view==='offline'?'Suas músicas baixadas e importadas aparecerão aqui.':state.view==='favoritos'?'Toque no coração de uma música para encontrá-la aqui.':state.view==='playlist-detail'?'Adicione músicas pelo menu ⋮ das faixas.':state.sourceErrors.length?'Não foi possível carregar os catálogos: '+state.sourceErrors.join(', ')+'. Confira a conexão e tente outra fonte.':(state.source==='catalog'||state.source==='youtube')?(state.query?'Nenhuma gravação com esse artista ou título foi localizada. Experimente o modo Músicas ou busque pelo canal oficial no YouTube.':'Digite o nome de uma banda ou cantor para pesquisar gravações de todo o mundo.'):'Tente buscar outro artista, estilo ou palavra.';const action=state.view==='offline'?'<button data-import="1">Importar áudio do celular</button>':!['favoritos','playlist-detail'].includes(state.view)?'<button data-retry="1">Tentar buscar novamente</button>':'';el.innerHTML=`<div class="empty-state"><div class="empty-icon">♫</div><strong>${state.loading?'Buscando...':'Nenhuma música aqui por enquanto'}</strong><p>${safe(reason)}</p>${action}</div>`;return}
 el.innerHTML=tracks.map((t,i)=>row(t,i)).join('');if(state.sourceErrors.length&&['inicio','buscar'].includes(state.view))el.insertAdjacentHTML('beforeend',`<p class="error-text" style="font-size:10px;margin:10px 13px">Algumas fontes não responderam: ${safe(state.sourceErrors.join(', '))}. Os resultados disponíveis foram mantidos.</p>`);
}
function navigate(view){if(state.source==='local'&&view!=='offline'){state.source='catalog';$('#sourceSelect').value=state.source}state.view=view;state.playlistId=view!=='playlist-detail'?null:state.playlistId;$('#sidebar').classList.remove('open');$('#overlay').hidden=true;renderList();$('#main').querySelector('.main-body').scrollTop=0;if(view==='buscar')$('#searchInput').focus();if(view==='offline')refreshOffline().then(renderList);if(view==='inicio'&&!state.tracks.length)discover()}
function runSearch(q){if(state.source==='local'){state.source='catalog';$('#sourceSelect').value=state.source}state.query=(q||'').trim().slice(0,200);state.view='buscar';$('#searchInput').value=state.query;renderList();$('#pageBody').scrollTop=0;discover()}

function favorite(id){const t=lookup(id);if(!t)return;const was=!!state.favorites[id];if(was)delete state.favorites[id];else {const {blob,...metadata}=t;state.favorites[id]=metadata;}writeStore('acl_music_favorites',state.favorites);toast(was?'Removida das favoritas':'Adicionada às favoritas');renderList();updatePlayer()}
function trackQueue(){if(state.view==='offline'||state.view==='favoritos'||state.view==='playlist-detail')return contentForView();return state.tracks.length?state.tracks:state.queue}
let currentObjectURL='';
const nativePlayback={active:false,playing:false,position:0,duration:0,loading:false,videoId:'',mode:'none'};
function resetPlayers({closeEmbed=true}={}){
 audio.pause();
 if(window.ACLPlayer?.stop)try{window.ACLPlayer.stop()}catch(e){console.warn('Player:',e)}
 nativePlayback.active=false;nativePlayback.playing=false;nativePlayback.position=0;nativePlayback.duration=0;nativePlayback.loading=false;nativePlayback.mode='none';
 if(closeEmbed)try{window.ACLPlayer?.closeEmbedded?.()}catch(e){}
}
function parseVideoId(url){
 try{const u=new URL(url);const id=u.searchParams.get('v')||(/\/embed\/([a-zA-Z0-9_-]{11})/.exec(u.pathname)||[])[1]||(/youtu\.be$/.test(u.hostname)?u.pathname.slice(1):'');return /^[a-zA-Z0-9_-]{11}$/.test(id||'')?id:''}catch{return ''}
}
function youtubeScore(item,track){
 if(!item?.url||!item?.title)return -10000;
 const title=normalizeArtistName(item.title),artist=normalizeArtistName(item.artist),name=normalizeArtistName(track.artist),song=normalizeArtistName(track.title).replace(/\b(remaster|remastered|deluxe|live)\b/g,'').trim();
 if(badVersions.test(item.title+' '+item.artist))return -10000;
 let score=0;
 if(title.includes(song))score+=65;else if(song.split(' ').length>1&&song.split(' ').some(w=>w.length>4&&title.includes(w)))score+=8;
 if(artist===name||artist===name+' topic'||artist===name+' official'||artist===name+' vevo')score+=105;
 else if(artist.includes(name))score+=65;
 if(title.includes(name))score+=30;
 if(/\b(official audio|official video|audio only|topic|vevo)\b/i.test(item.title+' '+item.artist))score+=20;
 if(/\b(live|remix|sped up|slowed)\b/i.test(item.title)&&!(/\b(live|remix)\b/i.test(track.title)))score-=32;
 return score;
}
async function findOriginalStream(track){
 if(track.source==='youtube')return {originUrl:track.originUrl,title:track.title,artist:track.artist};
 const queries=[track.artist+' '+track.title+' official audio',track.artist+' '+track.title];
 let lastError=null;
 for(const q of queries){
  try{
   const result=await queryYouTubeNative(q.slice(0,120));
   const items=(result.results||[]).filter(t=>parseVideoId(t.url)).sort((a,b)=>youtubeScore(b,track)-youtubeScore(a,track));
   if(items.length&&youtubeScore(items[0],track)>=60)return {originUrl:items[0].url,title:items[0].title,artist:items[0].artist};
  }catch(e){lastError=e;break}
 }
 if(lastError)throw lastError;
 throw Error('Não foi localizada uma gravação compatível para reprodução interna.');
}
function showInAppVideo(track,id){
 if(!id){toast('Não foi possível identificar a gravação para o player interno.');return false}
 nativePlayback.active=true;nativePlayback.playing=true;nativePlayback.loading=false;nativePlayback.mode='embed';nativePlayback.videoId=id;
 if(window.ACLPlayer?.openEmbedded){try{window.ACLPlayer.openEmbedded(id,track.title,track.artist);updatePlayer();return true}catch(e){console.warn('Vídeo interno:',e)}}
 const panel=$('#embeddedPanel'),frame=$('#embeddedFrame');
 if(panel&&frame){frame.src='https://www.youtube.com/embed/'+encodeURIComponent(id)+'?autoplay=1&playsinline=1&controls=1&enablejsapi=1';panel.hidden=false;updatePlayer();return true}
 toast('Reprodução incorporada indisponível neste aparelho.');return false;
}
async function startLocalAudio(t,token,url=''){
 let src=url||t.playUrl,objectURL='';
 if(isSaved(t.id)||t.source==='local'){
  try{const rec=await tx('get',t.id);if(rec?.blob){objectURL=URL.createObjectURL(rec.blob);src=objectURL}}catch(e){console.warn('Áudio offline:',e)}
 }
 if(token!==playRequest){if(objectURL)URL.revokeObjectURL(objectURL);return}
 if(!src){toast('Áudio indisponível para reprodução dentro do app.');return}
 const old=currentObjectURL;currentObjectURL=objectURL;
 audio.pause();audio.src=src;audio.load();
 if(old)URL.revokeObjectURL(old);
 nativePlayback.active=false;nativePlayback.mode='none';
 try{await audio.play()}catch(e){if(token===playRequest&&e.name!=='AbortError'){toast('Reprodução não iniciada. Tente outra faixa.')}}
 if(token===playRequest){updatePlayer();updateMediaSession()}
}
async function playTrack(id,list){
 const t=(list||trackQueue()).find(x=>x.id===id)||lookup(id);
 if(!t){toast('Música não encontrada');return}
 const token=++playRequest;
 const q=(list||trackQueue()).slice();if(!q.some(x=>x.id===t.id))q.unshift(t);
 resetPlayers();state.current=t;state.queue=q;state.idx=q.findIndex(v=>v.id===t.id);
 updatePlayer();renderList();
 if(t.source==='catalog'||t.source==='youtube'){
   nativePlayback.active=true;nativePlayback.loading=true;nativePlayback.playing=false;nativePlayback.mode='native';
   updatePlayer();toast('Localizando a gravação e preparando o áudio...');
   let candidate=null;
   try{
    candidate=await findOriginalStream(t);if(token!==playRequest)return;
    const id=parseVideoId(candidate.originUrl);nativePlayback.videoId=id;
    let answer;
    try{answer=await resolveYouTubeNative(candidate.originUrl)}catch(err){console.warn('Extrator de áudio:',err);if(token===playRequest){if(showInAppVideo(t,id))return;throw err}return}
    if(token!==playRequest)return;
    const src=urlSafe(answer.playUrl);
    if(!src)throw Error('A gravação não forneceu fluxo de áudio.');
    if(window.ACLPlayer?.play){nativePlayback.active=true;nativePlayback.mode='native';window.ACLPlayer.play(src,token);updatePlayer();return}
    return startLocalAudio(t,token,src);
   }catch(e){
    if(token!==playRequest)return;
    console.warn('Reprodução interna:',e);
    if(candidate&&showInAppVideo(t,parseVideoId(candidate.originUrl)))return;
    nativePlayback.active=false;nativePlayback.mode='none';
    if(t.previewUrl){toast('Áudio integral não localizado. Tocando prévia oficial de até 30 segundos aqui.');await startLocalAudio(t,token,t.previewUrl);return}
    toast('Não foi possível obter o áudio desta faixa. Tente outra música.');
    updatePlayer();return;
   }
 }
 await startLocalAudio(t,token);
}
window.__aclfutureNativePlayerEvent=function(json){
 let e;try{e=typeof json==='string'?JSON.parse(json):json}catch{return}
 if(Number(e.requestId)!==playRequest)return;
 if(e.type==='progress'||e.type==='state'){
  nativePlayback.active=true;nativePlayback.mode='native';nativePlayback.playing=!!e.playing;
  nativePlayback.loading=!!e.loading;nativePlayback.position=Math.max(0,Number(e.position)||0);nativePlayback.duration=Math.max(0,Number(e.duration)||0);
  updateNativeProgress();updatePlayer();
 }else if(e.type==='ended'){
  if(state.repeat){try{window.ACLPlayer.seekTo(0);window.ACLPlayer.resume()}catch{}}else next();
 }else if(e.type==='error'){
  if(nativePlayback.videoId && showInAppVideo(state.current,nativePlayback.videoId))return;
  nativePlayback.playing=false;nativePlayback.loading=false;nativePlayback.active=false;
  toast('A fonte interrompeu o áudio. Tente outra música.');updatePlayer();
 }
};
function updateNativeProgress(){if(nativePlayback.mode!=='native')return;
 $('#timeNow').textContent=fmt(nativePlayback.position/1000);
 $('#timeTotal').textContent=fmt(nativePlayback.duration/1000);
 $('#progress').value=nativePlayback.duration?Math.round(1000*nativePlayback.position/nativePlayback.duration):0;
}
function updateMediaSession(){if(!('mediaSession'in navigator)||!state.current||nativePlayback.mode==='native')return;const t=state.current;try{navigator.mediaSession.metadata=new MediaMetadata({title:t.title,artist:t.artist,album:prettySource[t.source],artwork:t.image?[{src:t.image,sizes:'512x512'}]:[]});navigator.mediaSession.setActionHandler('play',togglePlay);navigator.mediaSession.setActionHandler('pause',togglePlay);navigator.mediaSession.setActionHandler('nexttrack',()=>next());navigator.mediaSession.setActionHandler('previoustrack',()=>previous());navigator.mediaSession.setActionHandler('seekto',({seekTime})=>{if(Number.isFinite(seekTime))audio.currentTime=seekTime});}catch(e){console.warn('MediaSession',e)}}
function updatePlayer(){const t=state.current;$('#playingTitle').textContent=t?.title||'Escolha uma música';$('#playingArtist').textContent=t?.artist||'Sua trilha começa aqui';$('#playerCover').innerHTML=t?.image?`<img src="${safe(urlSafe(t.image))}" alt="Capa da faixa" onerror="this.remove()">`:'<span>♫</span>';$('#playPauseBtn').textContent=nativePlayback.loading?'…':nativePlayback.active?(nativePlayback.playing?'Ⅱ':'▶'):(audio.paused?'▶':'Ⅱ');$('#playerLike').textContent=t&&state.favorites[t.id]?'♥':'♡';$('#playerLike').classList.toggle('active',!!(t&&state.favorites[t.id]));$('#shuffleBtn').classList.toggle('on',state.shuffle);$('#repeatBtn').classList.toggle('on',state.repeat);$('#downloadCurrent').disabled=!t||(!isSaved(t.id)&&!t.downloadable);$('#downloadCurrent').title=t&&isSaved(t.id)?'Disponível offline':t?.downloadable?'Salvar offline':'Download não autorizado'}
function next(){const q=state.queue;if(!q.length)return;let index;if(state.shuffle&&q.length>1){index=Math.floor(Math.random()*(q.length-1));if(index>=state.idx)index++}else index=(state.idx+1)%q.length;playTrack(q[index].id,q)}
function previous(){if(nativePlayback.mode==='native'&&nativePlayback.position>3000){window.ACLPlayer?.seekTo?.(0);return}if(nativePlayback.mode==='none'&&audio.currentTime>3){audio.currentTime=0;return}const q=state.queue;if(!q.length)return;playTrack(q[(state.idx-1+q.length)%q.length].id,q)}
function togglePlay(){
 if(!state.current){const t=trackQueue()[0];if(t)playTrack(t.id);else toast('Selecione uma música para começar');return}
 if(nativePlayback.mode==='native'){
  if(nativePlayback.playing){window.ACLPlayer?.pause?.();nativePlayback.playing=false}else{window.ACLPlayer?.resume?.();nativePlayback.playing=true}updatePlayer();return;
 }
 if(nativePlayback.mode==='embed'){
  // The integrated YouTube player has its own official controls in the in-app panel.
  toast('Use os controles do reprodutor integrado para pausar ou avançar.');return;
 }
 if(audio.paused)audio.play().catch(()=>toast('Não foi possível iniciar.'));else audio.pause();
}

// Limita a transferência, valida o tipo e só confirma sucesso após a transação concluir.
async function downloadTrack(id){
 const t=lookup(id);if(!t)return;
 if(isSaved(id)){toast('Esta música já está salva offline.');return}
 if(activeDownloads.has(id)){toast('Esta faixa já está sendo baixada.');return}
 if(!t.downloadable||!t.downloadUrl||t.source==='catalog'){toast('Esta gravação comercial não pode ser baixada por este catálogo.');return}
 activeDownloads.add(id);
 toast('Baixando faixa...');
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
 try{
  const resp=await fetch(t.downloadUrl,{mode:'cors',signal:controller.signal});
  if(!resp.ok)throw Error('HTTP '+resp.status);
  const max=40*1024*1024;
  const length=Number(resp.headers.get('content-length')||0);
  if(length>max)throw Error('Arquivo maior que 40 MB');
  const type=(resp.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(/^(text\/|application\/(json|xml|javascript|pdf)|image\/)/.test(type))throw Error('A fonte devolveu um documento, não áudio');
  let blob;
  if(resp.body?.getReader){
   const reader=resp.body.getReader(),parts=[];let total=0;
   try{
    while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>max)throw Error('O arquivo excedeu 40 MB');parts.push(value)}
   }finally{if(total>max)await reader.cancel().catch(()=>{});reader.releaseLock()}
   blob=new Blob(parts,{type:type||'application/octet-stream'});
  }else blob=await resp.blob();
  if(blob.size>max||blob.size<256)throw Error('Arquivo de áudio inválido');
  const head=new Uint8Array(await blob.slice(0,16).arrayBuffer());
  const magic=String.fromCharCode(...head);
  const plausible=/^audio\//.test(blob.type)||magic.startsWith('ID3')||magic.startsWith('OggS')||magic.startsWith('fLaC')||(magic.startsWith('RIFF')&&magic.slice(8,12)==='WAVE')||(head[0]===255&&(head[1]&224)===224);
  if(!plausible||/^\s*[<{]/.test(magic))throw Error('A fonte não devolveu áudio reconhecido');
  const {blob:oldBlob,...metadata}=t;
  await tx('put',{...metadata,blob,savedAt:Date.now(),bytes:blob.size});
  await refreshOffline();renderList();updatePlayer();
  toast('Música salva. Disponível offline neste dispositivo.');
 }catch(e){console.warn('Download offline:',e);showDownloadFallback(t)}
 finally{clearTimeout(timer);activeDownloads.delete(id)}
}

function showDownloadFallback(t){modal('Download não concluído',`<p class="modal-copy">O servidor de origem não permitiu que este navegador salvasse o áudio diretamente (ou ocorreu um erro de conexão). Isso depende da fonte e não indica que o download seja proibido.</p><p class="modal-copy"><b>${safe(t.title)}</b> — ${safe(t.artist)}</p><p class="modal-copy">Você pode consultar a faixa na página original e, se o site oferecer download, salvar o MP3 no celular. Depois use <b>Importar MP3</b> para ouvi-lo offline neste aplicativo.</p>${t.originUrl?`<a class="modal-link" href="${safe(t.originUrl)}" target="_blank" rel="noopener noreferrer">Abrir fonte oficial ↗</a>`:''}${t.downloadUrl?`<a class="modal-link" href="${safe(t.downloadUrl)}" target="_blank" rel="noopener noreferrer">Tentar link de download ↗</a>`:''}`)}
async function importFiles(files){if(!files?.length)return;let success=0;for(const file of Array.from(files)){if(!file.type.startsWith('audio/')&&!/\.(mp3|m4a|aac|ogg|wav|flac|opus)$/i.test(file.name))continue;if(file.size>60*1024*1024){toast('Arquivo ignorado por ultrapassar 60 MB: '+file.name);continue}const id='local:'+(crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`);const title=file.name.replace(/\.[^.]+$/,'').replace(/_/g,' ');const rec={id,title,artist:'Minha biblioteca',image:'',source:'local',playUrl:'',downloadUrl:'',downloadable:false,license:'Arquivo pessoal',licenseUrl:'',originUrl:'',duration:0,blob:file,savedAt:Date.now(),bytes:file.size};try{await tx('put',rec);success++}catch(e){console.error(e);toast('Erro ao salvar '+file.name)}}await refreshOffline();if(success)toast(`${success} arquivo(s) importado(s) com sucesso!`);state.view='offline';state.source='all';$('#sourceSelect').value='all';renderList();$('#fileInput').value=''}

function modal(title,body){$('#modalTitle').textContent=title;$('#modalContent').innerHTML=body;$('#modal').hidden=false}
function closeModal(){$('#modal').hidden=true}
function trackMenu(id){const t=lookup(id);if(!t)return;const pNames=Object.entries(state.playlists).map(([pid,p])=>`<button class="modal-row" data-addto="${safe(pid)}" data-song="${safe(t.id)}"><span>♫ ${safe(p.name)}</span><small>＋ Adicionar</small></button>`).join('');modal('Opções da música',`<div class="pill">${safe(prettySource[t.source]||t.source)}</div><h3 style="margin:4px 0 4px">${safe(t.title)}</h3><p class="modal-copy" style="margin-top:0">${safe(t.artist)}</p><button class="modal-row" data-like="${safe(t.id)}">${state.favorites[t.id]?'♥ Remover dos favoritos':'♡ Adicionar às favoritas'}</button>${(t.source==='catalog'||t.source==='youtube')?`<button class="modal-row" data-inline="${safe(t.id)}">▶ Reproduzir dentro do ACLFUTURE</button><p class="modal-copy">O reprodutor permanece no ACLFUTURE Music. A música integral depende de a fonte disponibilizar um stream compatível.</p>`:''}${!isSaved(t.id)&&t.downloadable?`<button class="modal-row" data-download="${safe(t.id)}">↓ Baixar e ouvir offline</button>`:''}${isSaved(t.id)?`<button class="modal-row" data-delete="${safe(t.id)}">Excluir cópia offline</button>`:''}<p class="modal-copy"><b>Adicionar à playlist</b></p>${pNames||'<p class="modal-copy">Você ainda não criou nenhuma playlist.</p>'}<button class="modal-row" data-create-add="${safe(t.id)}">＋ Criar playlist com esta faixa</button><p class="modal-copy">Licença/condições: <b>${safe(t.license||'Conferir com o artista')}</b></p>${t.attribution?`<p class="modal-copy"><b>Créditos:</b> ${safe(t.attribution)}</p><button class="modal-row" data-credit="${safe(t.id)}">Copiar créditos da faixa</button>`:''}${t.licenseUrl?`<a class="modal-link" href="${safe(t.licenseUrl)}" target="_blank" rel="noopener noreferrer">Condições da licença ↗</a>`:''}`)}
function createPlaylist(addId){const val=typeof addId==='string'?addId:'';modal('Nova playlist',`<p class="modal-copy">Dê um nome para a sua coleção de músicas.</p><form id="newPlaylistForm"><input id="playlistNameInput" class="modal-input" placeholder="Ex.: Músicas para viajar" maxlength="60" required autocomplete="off"><input type="hidden" value="${safe(val)}" id="addSongAfterCreate"><button class="modal-btn" type="submit">Criar playlist</button></form>`);$('#newPlaylistForm').addEventListener('submit',e=>{e.preventDefault();const name=$('#playlistNameInput').value.trim();if(!name)return;const id='pl:'+Date.now();state.playlists[id]={name,ids:val?[val]:[],tracks:val?[lookup(val)].filter(Boolean).map(t=>{const {blob,...m}=t;return m}):[]};writeStore('acl_music_playlists',state.playlists);closeModal();toast('Playlist criada');state.view='playlists';renderList()});$('#playlistNameInput').focus()}
function addToPlaylist(pid,songId){if(!state.playlists[pid])return;const p=state.playlists[pid];if(!p.ids.includes(songId))p.ids.push(songId);const t=lookup(songId);if(t){p.tracks=p.tracks||[];if(!p.tracks.find(v=>v.id===songId)){const {blob,...m}=t;p.tracks.push(m)}}writeStore('acl_music_playlists',state.playlists);toast('Adicionada à playlist '+p.name);closeModal();renderList()}
async function removeOffline(id){if(!isSaved(id))return;modal('Excluir música offline?',`<p class="modal-copy">A cópia salva de <b>${safe(lookup(id)?.title||'esta música')}</b> será removida deste dispositivo. A faixa original e suas playlists não serão alteradas.</p><button class="modal-btn" data-confirm-remove="${safe(id)}">Excluir cópia offline</button>`)}
function showQueue(){const q=state.queue;if(!q.length){modal('Fila de reprodução','<p class="modal-copy">Escolha músicas para começar sua fila.</p>');return}modal('Próximas músicas',q.map((t,i)=>`<button class="modal-row" data-queueplay="${safe(t.id)}"><span>${i+1}. ${safe(t.title)}<br><small>${safe(t.artist)}</small></span>${i===state.idx?'♫':''}</button>`).join(''))}
function showMobilePlayerOptions(){
 if(!state.current){toast('Escolha uma música para ver as opções');return}
 modal('Opções de reprodução',`<button class="modal-row" data-toggle-shuffle="1">⇄ Reprodução aleatória: <b>${state.shuffle?'Ligada':'Desligada'}</b></button><button class="modal-row" data-toggle-repeat="1">↻ Repetir faixa: <b>${state.repeat?'Ligado':'Desligado'}</b></button><button class="modal-row" data-show-queue="1">☷ Ver fila de reprodução</button><button class="modal-row" data-menu-current="1">⋮ Opções desta música</button>`);
}

function showAbout(){modal('ACLFUTURE Music',`<img class="modal-logo" src="assets/aclfuture-oficial.jpg" alt="Logotipo oficial ACLFUTURE"><p class="modal-copy"><b>Versão 1.5 Beta — reprodução integrada no Android.</b> Pesquise gravações comercialmente lançadas por artista ou música. A reprodução acontece dentro do ACLFUTURE Music e depende das fontes disponíveis. Audius, Openverse e Free To Use permanecem disponíveis para músicas independentes. O aplicativo não tem servidor de contas nem vende seus dados; playlists, favoritos e áudios baixados ficam armazenados neste dispositivo.</p><p class="modal-copy">Algumas faixas exigem créditos e podem ter condições específicas de uso. O app não oferece o catálogo licenciado do Spotify e não baixa áudios de YouTube sem autorização.</p><p class="modal-copy">Ouvindo offline: baixe faixas disponíveis ou importe seus arquivos MP3. A reprodução offline é feita com o armazenamento local do navegador.</p><a class="modal-link" target="_blank" rel="noopener noreferrer" href="https://openverse.org">Openverse ↗</a><a class="modal-link" target="_blank" rel="noopener noreferrer" href="https://audius.co">Audius ↗</a><a class="modal-link" target="_blank" rel="noopener noreferrer" href="https://freetouse.com/license">Licenças Free To Use ↗</a>`)}
function install(){if(window.__ACLFUTURE_ANDROID__){toast('ACLFUTURE Music já está instalado neste Android.');return}if(installPrompt){installPrompt.prompt();installPrompt.userChoice.finally(()=>{installPrompt=null});return}modal('Instalar no Android',`<p class="modal-copy"><b>Para instalar como aplicativo:</b> publique esta pasta em hospedagem HTTPS (por exemplo, GitHub Pages), abra o endereço no <b>Chrome para Android</b> e toque em <b>⋮ → Adicionar à tela inicial → Instalar</b>.</p><p class="modal-copy">Abrir o arquivo HTML diretamente não instala a PWA: a instalação exige HTTPS. No Android, as músicas importadas funcionam no navegador mesmo sem rede enquanto o armazenamento for mantido.</p>`)}

// Interações delegadas (evita handlers presos a resultados dinâmicos).
document.addEventListener('click',async e=>{
 const nav=e.target.closest('[data-view]');if(nav){e.preventDefault();navigate(nav.dataset.view);return}
 const gen=e.target.closest('[data-genre]');if(gen){state.source='catalog';$('#sourceSelect').value=state.source;state.searchKind='artist';$('#searchKind').value='artist';runSearch(gen.dataset.genre);return}
 const target=e.target.closest('[data-inline],[data-like],[data-download],[data-menu],[data-delete],[data-addto],[data-create-add],[data-playlist],[data-import],[data-retry],[data-confirm-remove],[data-queueplay],[data-credit],[data-toggle-shuffle],[data-toggle-repeat],[data-show-queue],[data-menu-current]');
 if(target){e.stopPropagation();const d=target.dataset;
   if(d.inline){const t=lookup(d.inline);closeModal();if(t)playTrack(t.id);return}
   if(d.toggleShuffle){state.shuffle=!state.shuffle;updatePlayer();closeModal();toast(state.shuffle?'Aleatório ativado':'Aleatório desativado');return}
   if(d.toggleRepeat){state.repeat=!state.repeat;updatePlayer();closeModal();toast(state.repeat?'Repetição ativada':'Repetição desativada');return}
   if(d.showQueue){showQueue();return}
   if(d.menuCurrent){trackMenu(state.current?.id);return}
   if(d.credit){const track=lookup(d.credit);if(track?.attribution){navigator.clipboard?.writeText(track.attribution).then(()=>toast('Créditos copiados')).catch(()=>toast('Copie os créditos na ficha da faixa'));}return}
   if(d.like){favorite(d.like);if(!$('#modal').hidden){closeModal()}return}
   if(d.download){closeModal();await downloadTrack(d.download);return}
   if(d.menu){trackMenu(d.menu);return}
   if(d.delete){await removeOffline(d.delete);return}
   if(d.confirmRemove){try{await tx('delete',d.confirmRemove);await refreshOffline();if(state.current?.id===d.confirmRemove){playRequest++;resetPlayers();audio.pause();audio.removeAttribute('src');audio.load();if(currentObjectURL){URL.revokeObjectURL(currentObjectURL);currentObjectURL=''}state.current=null;state.queue=[]}closeModal();toast('Cópia offline excluída');renderList();updatePlayer()}catch(e){console.error(e);toast('Não foi possível excluir a cópia offline')}return}
   if(d.addto){addToPlaylist(d.addto,d.song);return}
   if(d.createAdd){createPlaylist(d.createAdd);return}
   if(d.playlist){state.playlistId=d.playlist;state.view='playlist-detail';renderList();return}
   if(d.import!==undefined){$('#fileInput').click();return}
   if(d.retry!==undefined){discover();return}
   if(d.queueplay){closeModal();playTrack(d.queueplay,state.queue);return}
 }
 const rowEl=e.target.closest('.track-row[data-play]');if(rowEl){playTrack(rowEl.dataset.play);return}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();$('#sidebar').classList.remove('open');$('#overlay').hidden=true};if((e.key==='Enter'||e.key===' ')&&e.target.matches('.track-row[data-play]')){e.preventDefault();playTrack(e.target.dataset.play)}if(e.code==='Space'&&!['INPUT','TEXTAREA','BUTTON','SELECT'].includes(document.activeElement?.tagName)){e.preventDefault();togglePlay()}});
$('#searchForm').addEventListener('submit',e=>{e.preventDefault();clearTimeout(searchTimer);runSearch($('#searchInput').value)});
$('#searchInput').addEventListener('input',e=>{clearTimeout(searchTimer);const value=e.target.value.trim();if(value.length>=3)searchTimer=setTimeout(()=>runSearch(value),720);if(!value&&state.query)searchTimer=setTimeout(()=>runSearch(''),720)});
$('#sourceSelect').addEventListener('change',e=>{state.source=e.target.value;$('#catalogNotice').textContent=state.source==='youtube'?'Busca do YouTube Music pelo player interno. Se o áudio não carregar, tente outra gravação.':'Busque gravações originais de artistas e álbuns. A reprodução acontece dentro do ACLFUTURE Music.';if(state.source==='local'){state.view='offline';renderList();return}state.view='buscar';state.tracks=[];renderList();discover()});
$('#searchKind').addEventListener('change',e=>{state.searchKind=e.target.value;state.view='buscar';state.tracks=[];renderList();discover()});
$('#heroExplore').addEventListener('click',()=>navigate('buscar'));
$('#heroOffline').addEventListener('click',()=>navigate('offline'));
$('#loadMore').addEventListener('click',()=>discover({append:true}));
$('#youtubeSearch').addEventListener('click',()=>{state.source='youtube';$('#sourceSelect').value='youtube';runSearch(state.query||$('#searchInput').value.trim());});
$('#shuffleAll').addEventListener('click',()=>{const t=contentForView();if(t.length)playTrack(t[Math.floor(Math.random()*t.length)].id,t);else toast('Encontre músicas primeiro')});
$('#newPlaylistSide').addEventListener('click',()=>createPlaylist());$('#importSide').addEventListener('click',()=>$('#fileInput').click());$('#fileInput').addEventListener('change',e=>importFiles(e.target.files));
$('#playPauseBtn').addEventListener('click',togglePlay);$('#previousBtn').addEventListener('click',previous);$('#nextBtn').addEventListener('click',next);
$('#shuffleBtn').addEventListener('click',()=>{state.shuffle=!state.shuffle;updatePlayer();toast(state.shuffle?'Modo aleatório ativado':'Modo aleatório desativado')});
$('#repeatBtn').addEventListener('click',()=>{state.repeat=!state.repeat;updatePlayer();toast(state.repeat?'Repetir faixa ativado':'Repetir faixa desativado')});
$('#playerLike').addEventListener('click',()=>state.current?favorite(state.current.id):toast('Escolha uma faixa'));
$('#queueBtn').addEventListener('click',showQueue);$('#playerMobileMore').addEventListener('click',showMobilePlayerOptions);$('#downloadCurrent').addEventListener('click',()=>state.current&&downloadTrack(state.current.id));
$('#volume').addEventListener('input',e=>{audio.volume=Number(e.target.value)/100;window.ACLPlayer?.setVolume?.(Number(e.target.value)/100);});
$('#progress').addEventListener('input',e=>{if(nativePlayback.mode==='native'&&nativePlayback.duration>0){window.ACLPlayer?.seekTo?.(Math.round(Number(e.target.value)*nativePlayback.duration/1000));return}if(Number.isFinite(audio.duration))audio.currentTime=Number(e.target.value)/1000*audio.duration});
if(window.__ACLFUTURE_ANDROID__){$('#installBtn').hidden=true;$('#installSide').textContent='Aplicativo instalado';document.addEventListener('click',e=>{const link=e.target.closest('a[target="_blank"]');if(link&&/^https?:/.test(link.href)){e.preventDefault();toast('Esta versão mantém a navegação dentro do ACLFUTURE Music.')}},true)}
$('#installBtn').addEventListener('click',install);$('#installSide').addEventListener('click',install);$('#helpBtn').addEventListener('click',showAbout);
$('#embeddedClose')?.addEventListener('click',()=>{$('#embeddedFrame').src='about:blank';$('#embeddedPanel').hidden=true;nativePlayback.mode='none';nativePlayback.active=false;updatePlayer()});
$('#modalClose').addEventListener('click',closeModal);$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
$('#menuBtn').addEventListener('click',()=>{$('#sidebar').classList.add('open');$('#overlay').hidden=false});$('#overlay').addEventListener('click',()=>{$('#sidebar').classList.remove('open');$('#overlay').hidden=true});
window.addEventListener('online',setNet);window.addEventListener('offline',setNet);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e});
audio.addEventListener('play',updatePlayer);audio.addEventListener('pause',updatePlayer);audio.addEventListener('loadedmetadata',()=>{$('#timeTotal').textContent=fmt(audio.duration)});
audio.addEventListener('timeupdate',()=>{$('#timeNow').textContent=fmt(audio.currentTime);$('#timeTotal').textContent=fmt(audio.duration);$('#progress').value=Number.isFinite(audio.duration)&&audio.duration>0?Math.round(1000*audio.currentTime/audio.duration):0});
audio.addEventListener('ended',()=>{if(state.repeat){audio.currentTime=0;audio.play().catch(()=>{})}else next()});
audio.addEventListener('error',()=>{if(audio.src&&state.current&&nativePlayback.mode==='none')toast('Áudio indisponível nesta fonte. Tente outra faixa.');updatePlayer()});
async function init(){setNet();audio.volume=.8;$('#sourceSelect').value=state.source;$('#searchKind').value=state.searchKind;$('#catalogNotice').textContent=state.source==='youtube'?'Áudio reproduzido dentro do ACLFUTURE Music, quando a fonte é compatível.':$('#catalogNotice').textContent;await refreshOffline();renderList();if(navigator.onLine && (state.query||!['catalog','youtube'].includes(state.source)))await discover();if(!window.__ACLFUTURE_ANDROID__&&'serviceWorker'in navigator&&['https:','http:'].includes(location.protocol)){navigator.serviceWorker.register('sw.js').catch(e=>console.warn('PWA offline indisponível:',e))}if(navigator.storage?.persisted){navigator.storage.persisted().then(isPersistent=>{const el=$('#storagePersistence');if(el)el.textContent=isPersistent?'Armazenamento protegido':'Faça backup dos seus MP3: o navegador pode limpar os dados';}).catch(()=>{})}}
init();
