# ACLFUTURE Music 1.6 Beta — Android

**Alterações:** interface grafite/dourado metálico/azul-ciano baseada na logo ACLFUTURE, pesquisa com sugestões durante digitação, correções prováveis de grafia, histórico de artistas, suporte a acentuação, Enter/setas e busca de músicas. A busca global consulta o catálogo Apple/iTunes; as sugestões também aparecem pelo catálogo em tempo real. Uma lista local reduzida apenas acelera sugestões conhecidas enquanto a consulta mundial responde; não limita o catálogo.

**Reprodução:** o mecanismo interno AndroidX Media3/ExoPlayer e o fallback de vídeo incorporado foram mantidos da 1.5. O app não abre automaticamente navegadores externos. Fontes comerciais podem não entregar o fluxo completo ou bloquear a extração. O download offline de músicas comerciais não está habilitado; apenas músicas com download autorizado e arquivos do usuário.

**Testes:** 42 verificações simuladas de autocomplete, seleção, layout e reprodução interna no Chromium em oito larguras de tela. GitHub Actions compila APK, executa Android Lint, verifica assinatura v2 e consulta catálogo Apple com dados reais. Não substitui teste com áudio real no Android.

**Identidade:** assets oficiais de ACLFUTURE inalterados; nenhum logo novo foi gerado.

**Instalação:** aplicativo beta em pacote separado `com.aclfuture.music.preview16`, Android 8+. Não substitui o app 1.5 e não migra biblioteca local automaticamente.

**Licença:** GPL-3.0 por conta da dependência NewPipeExtractor (código aberto).
