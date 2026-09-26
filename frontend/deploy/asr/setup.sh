#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="${MIRAI_ASR_HOME:-$HOME/mirai-asr}"
models="$root/models"
venv="$root/venv"
release=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models
sherpa=1.13.8

command -v uv >/dev/null || { echo "uv is not installed" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is not installed" >&2; exit 1; }
ytdlp="$(command -v yt-dlp)" || { echo "yt-dlp is not installed" >&2; exit 1; }
[ -x "$HOME/.local/bin/yt-dlp" ] && ytdlp="$HOME/.local/bin/yt-dlp"

if nvidia-smi >/dev/null 2>&1; then provider=cuda; precision=fp16; else provider=cpu; precision=int8; fi

mkdir -p "$models"
fetch() {
  [ -e "$models/$1" ] && return
  echo "downloading $1"
  curl -fsSL "$release/$2" -o "$models/.part"
  case "$2" in
    *.tar.bz2) tar xjf "$models/.part" -C "$models" && rm "$models/.part" ;;
    *) mv "$models/.part" "$models/$1" ;;
  esac
}
fetch "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-$precision" "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-$precision.tar.bz2"

[ -x "$venv/bin/python" ] || uv venv -q -p 3.12 "$venv"
libs=""
if [ "$provider" = cuda ]; then
  uv pip install -q -p "$venv" "sherpa-onnx==$sherpa+cuda13.cudnn9.onnxruntime1.28.2" numpy nvidia-cuda-runtime nvidia-cublas nvidia-cudnn-cu13 nvidia-cufft nvidia-curand -f https://k2-fsa.github.io/sherpa/onnx/cuda.html
  site="$("$venv/bin/python" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
  libs="$site/nvidia/cu13/lib:$site/nvidia/cudnn/lib"
else
  uv pip install -q -p "$venv" "sherpa-onnx==$sherpa" numpy
fi

cat > "$root/transcribe" <<WRAPPER
#!/usr/bin/env bash
export LD_LIBRARY_PATH="$libs" MIRAI_ASR_PROVIDER=$provider MIRAI_ASR_MODELS="$models" MIRAI_ASR_YTDLP="$ytdlp"
exec systemd-run --user --scope --quiet --collect --unit="mirai-asr-\$\$" -p MemoryMax=\${MIRAI_ASR_MEMORY_MAX:-3G} -p MemorySwapMax=0 -- "$venv/bin/python" "$here/transcribe.py" "\$@"
WRAPPER
chmod +x "$root/transcribe"

envfile="$HOME/.config/mirai/hub.env"
if [ -f "$envfile" ] && ! grep -q '^MIRAI_ASR_BIN=' "$envfile"; then echo "MIRAI_ASR_BIN=$root/transcribe" >> "$envfile"; fi
echo "asr ready on $provider: echo <video id> | $root/transcribe"
