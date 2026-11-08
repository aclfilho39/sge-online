# ACLFUTURE Music 1.5 Beta — Android com player integrado

Versão de teste separada da 1.4. A busca inicial usa catálogo mundial de gravações originais, de artistas e bandas de qualquer país. Depois de selecionar uma faixa, tenta localizar sua gravação no YouTube Music por NewPipeExtractor e reproduzir a URL de áudio **dentro do aplicativo** com AndroidX Media3 / ExoPlayer.

Se a extração de áudio falhar, mas houver um vídeo identificável, oferece um reprodutor de vídeo YouTube incorporado em uma caixa dentro do ACLFUTURE Music, sem abrir Brave ou outro aplicativo. O reprodutor incorporado pode mostrar publicidade ou indisponibilidade conforme a plataforma. Se não houver vídeo compatível, pode usar a prévia de 30s do catálogo, identificada como prévia; não promete faixa integral.

**Licença:** código aberto GPL-3.0 (devido à integração com NewPipeExtractor). A logo oficial ACLFUTURE permanece do arquivo de origem. O APK não foi publicado na Play Store; é um APK de teste com assinatura debug.

**Limitações:** compilação aprovada não significa que todas as faixas comerciais tocam. O YouTube pode alterar mecanismos e recusar a extração. Algumas gravações podem não permitir incorporação. Downloads comerciais do YouTube não estão habilitados; offline preservado para arquivos do usuário e fontes com download permitido. Reprodução em segundo plano não foi implementada como serviço Android neste estágio.

**Teste:** verifique busca por Engenheiros do Hawaii, Iron Maiden, Taylor Swift; toque em ▶; confirme que não houve abertura de aplicativo externo. Em falha de carregamento, abra o painel interno ou informe mensagem exibida. Android 8.0+.
