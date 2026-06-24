# Groovr

Download audio from YouTube — MP3 320 kbps ou WAV lossless — com metadados e capa embutidos.

---

## Download via CLI (local)

**Pré-requisitos:** Python 3, ffmpeg instalado (`brew install ffmpeg`)

### Primeira vez (setup único)

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Uso

```bash
# Interativo — pede URL e formato
./groovr

# Vídeo direto em MP3
./groovr "https://youtu.be/XXXXX" --mp3

# Vídeo direto em WAV
./groovr "https://youtu.be/XXXXX" --wav

# Playlist inteira em MP3 sem confirmação
./groovr "https://www.youtube.com/playlist?list=XXXXX" --mp3 --yes
```

Os arquivos ficam em `downloads/`. Playlists são organizadas em pastas com o nome da playlist.

---

## Download via Web (groovr.xyz)

Acesse **groovr.xyz**, cole o link e clique em Download.

---

## Deploy (Vercel)

O projeto está conectado ao GitHub. Qualquer push na branch `main` faz deploy automático.

Para downloads funcionarem em produção, adicione nas variáveis de ambiente do Vercel:

| Variável | Valor |
|---|---|
| `YOUTUBE_COOKIES_B64` | Cookies do YouTube exportados em base64 (ver abaixo) |

**Como exportar os cookies:**
1. Instale a extensão **"Get cookies.txt LOCALLY"** no Chrome
2. Entre em youtube.com logado na sua conta
3. Clique na extensão e exporte `cookies.txt`
4. No terminal: `base64 -i cookies.txt | tr -d '\n' | pbcopy`
5. Cole o valor na variável `YOUTUBE_COOKIES_B64` no Vercel
6. Faça um novo deploy

---

## Dev local (web app)

```bash
npm install
npm run dev
# → http://localhost:3000
```

## Docker

```bash
docker build -t groovr .
docker run --rm -p 3000:3000 groovr
```

---

> YouTube só serve áudio comprimido (Opus ~128–256 kbps). WAV não cria qualidade do nada — garante zero perda adicional. Use WAV para edição, MP3 para escuta.
