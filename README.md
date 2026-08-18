# AudioGram

Webapp che genera un **audiogram in stile Spotify** (onde dinamiche) su **sfondo verde** (`#00FF00`), pronto per il **chroma key** nei tuoi video.

## Funzionalità

- Accetta qualsiasi formato audio (mp3, wav, m4a/aac, ogg, flac, opus, aiff, wma…) tramite `decodeAudioData` nativo + fallback WASM (`audio-decode`).
- Onde **animate** (barre a pillola che pulsano con l'ampiezza), dissolvenza e profilo a campana ai lati.
- Colore delle onde personalizzabile (con avviso se troppo vicino al verde).
- Nome/titolo opzionale sovrapposto.
- Esportazione **video 1080×1080**:
  - **MP4 H.264 + AAC** tramite WebCodecs (più veloce del tempo reale) sui browser che lo supportano.
  - Fallback WebM/MP4 tramite `MediaRecorder` (tempo reale) sugli altri.
- Interfaccia semplice e mobile-friendly.

## Sviluppo

```bash
npm install
npm run dev      # server di sviluppo
npm run build    # build di produzione (output in dist/)
npm run preview  # anteprima della build
```

## Deploy

Deploy automatico su **GitHub Pages** tramite `.github/workflows/deploy.yml` (build + publish).

> Nota: GitHub Pages non è disponibile per repo **private** sul piano Free; il deploy funzionerà quando la repo sarà pubblica (o con un piano a pagamento).

## Note tecniche

- Il rendering WebCodecs genera il video più velocemente del tempo reale (bitrate video 12 Mbps, audio 192 kbps).
- Il fallback `MediaRecorder` rende in tempo reale (un audio di 3 min ≈ 3 min di rendering).
