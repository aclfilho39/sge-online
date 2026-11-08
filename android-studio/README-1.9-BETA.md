# ACLFUTURE Music 1.9 — Biblioteca e playlists (APK beta)

## Melhorias
- Aba Biblioteca para criar, renomear e excluir playlists, com favoritos e áudios offline.
- Adicionar músicas do catálogo em playlists pelo botão +, sem modificar as faixas originais.
- Reprodução da playlist inteira e organização da ordem em fila.
- Baixar playlist: fila sequencial com progresso, status por faixa e opção de repetir falhas; não interrompe a playlist inteira porque uma faixa falhou.
- Bridge Android OfflineBridge: usa o mesmo extrator NewPipeExtractor já presente para obter o fluxo de áudio, grava no armazenamento privado do app, valida cabeçalho e duração, salva metadados, permite ouvir no player Media3/ExoPlayer sem rede.
- Uso de conceitos de fila, recomeço, validação e tratamento individual por faixa do projeto ACLFUTURE DownloadMP3 Windows, localizado no Google Drive do usuário, que usa yt-dlp/FFmpeg. O motor Python/Windows **não** foi copiado ou convertido para Android.
- Plaquinha original prateada "By Tunico" preservada como arte PNG sem fundo na aba Biblioteca e barra lateral.
- Tema ACLFUTURE 1.8 dourado, grafite e azul preservado.

## Limites técnicos
- A extração de alguns vídeos pode falhar por login, bloqueios de plataforma, localização, alterações de protocolo, indisponibilidade de mídia ou falta de espaço. Não é possível garantir que todas as faixas comerciais possam ser baixadas.
- Download individual de até 160 MB, com tempo máximo de 5 minutos por faixa e proteção contra conteúdo não-áudio. Fila de até 500 faixas na sessão.
- A fila roda enquanto o aplicativo está ativo; ao fechar ou suspender o app ela pode parar. Nova execução tenta novamente faixas ainda não salvas.
- A versão APK 1.9 possui ID separado das versões anteriores e não migra automaticamente suas playlists ou downloads.
- APK debug assinado para testes. Recomendado testar em celular físico.

## Testes
- 27 de 27 testes da UI e lógica de biblioteca aprovados com ponte Android e armazenamento simulados.
- Compilação, Android Lint, assinatura e verificações de estrutura: a conferir no pipeline GitHub Actions.
- Teste real de downloads comerciais depende da disponibilidade do YouTube e deve ser confirmado no Android.

## Código e dependências
- NewPipeExtractor (GPLv3), AndroidX Media3, Android SDK. Código-fonte disponível na branch do projeto.
- O aplicativo foi construído para experimentação pessoal e não transfere playlists/arquivos para servidores próprios.
