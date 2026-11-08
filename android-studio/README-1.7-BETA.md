# ACLFUTURE Music 1.7 — Busca por artistas e músicas

Alteração de escopo restrito em relação à v1.6:

- A busca padrão pesquisa **artistas e títulos de músicas simultaneamente**.
- As sugestões exibem grupos ARTISTAS e MÚSICAS; cada música mostra o artista creditado logo abaixo.
- A mesma música interpretada por artistas diferentes aparece separada, com créditos visíveis.
- Ao selecionar uma música, a busca da faixa é acionada e a gravação escolhida é priorizada nos resultados do catálogo.
- Os modos Só artistas e Só músicas continuam disponíveis para refinar resultados; nova digitação volta à busca combinada quando o modo não foi fixado manualmente.
- As consultas nativas de sugestões para artista e música possuem cancelamento independente e controle de respostas antigas.
- Mantidos o tema grafite/dourado/ciano da v1.6, arquivos oficiais da marca, player Media3/ExoPlayer, playlists e biblioteca offline.

**Limitações:** o catálogo identifica faixas, mas a reprodução integral depende de fontes acessíveis. YouTube/NewPipeExtractor podem exigir autenticação antirrobô ou indisponibilizar a extração. O teste real de reprodução em celular físico ainda não foi realizado. O APK beta é identificado como `com.aclfuture.music.preview17` e instala-se separadamente da versão anterior.

**Testes locais:** 27 verificações da interface com Chromium e respostas simuladas, 3 verificações de integração com ponte nativa simulada, `node --check app.js`. **Testes remotos:** compilação Gradle, Android Lint, assinatura do APK e consultas reais de catálogo (conforme registro da execução do GitHub Actions).

**Licenças:** integrar o NewPipeExtractor (GPLv3) implica observância da licença distribuída neste repositório. A versão mantém os créditos do projeto.
