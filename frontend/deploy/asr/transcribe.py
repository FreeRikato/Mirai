import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import IO, Iterator, Literal

import numpy as np
import sherpa_onnx as so

SAMPLE_RATE = 16_000
GPU_BATCH = 16
PROGRESS_EVERY_S = 0.5
FRAME = SAMPLE_RATE // 50
MIN_CHUNK = 4 * SAMPLE_RATE
MAX_CHUNK = 8 * SAMPLE_RATE
QUIET = 10 ** (-50 / 20)
READ_BYTES = 4 * MAX_CHUNK * 4

Stage = Literal["downloading", "transcribing"]


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class Chunk:
    start: float
    samples: np.ndarray


class VideoFailed(Exception):
    pass


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"{name} is not set")
    return value


def emit(event: dict[str, object]) -> None:
    print(json.dumps(event), flush=True)


class Progress:
    def __init__(self, video_id: str) -> None:
        self.video_id = video_id
        self.last = 0.0

    def report(self, stage: Stage, done: float, total: float, final: bool = False) -> None:
        now = time.monotonic()
        if total <= 0 or (not final and now - self.last < PROGRESS_EVERY_S):
            return
        self.last = now
        emit({"type": "progress", "id": self.video_id, "stage": stage, "done": round(min(done, total), 2), "total": round(total, 2)})


def last_line(err: IO[str], fallback: str) -> str:
    err.seek(0)
    lines = [line for line in err.read().splitlines() if line.strip()]
    return lines[-1] if lines else fallback


def number(text: str) -> float | None:
    try:
        return float(text)
    except ValueError:
        return None


def download(video_id: str, workdir: Path, progress: Progress) -> Path:
    audio = workdir / "audio"

    def downloaded(line: str) -> None:
        got, total, estimate = (number(part) for part in (line.split() + ["NA", "NA", "NA"])[:3])
        size = total or estimate
        if got is not None and size:
            progress.report("downloading", got, size)

    template = "%(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s"
    cmd = [env("MIRAI_ASR_YTDLP"), "--quiet", "--no-warnings", "--newline", "--progress", "--progress-template", f"download:{template}", "-f", "bestaudio", "-o", str(audio), f"https://www.youtube.com/watch?v={video_id}"]
    with tempfile.TemporaryFile(mode="w+", dir=workdir) as err:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err, text=True)
        assert proc.stdout is not None
        for line in proc.stdout:
            downloaded(line.strip())
        if proc.wait() != 0:
            raise VideoFailed(last_line(err, f"yt-dlp exited with {proc.returncode}"))
    return audio


def duration(audio: Path) -> float:
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(audio)], capture_output=True, text=True)
    return number(probe.stdout.strip()) or 0.0


def cut_point(pending: np.ndarray) -> int:
    window = pending[MIN_CHUNK:MAX_CHUNK]
    frames = window[: len(window) // FRAME * FRAME].reshape(-1, FRAME)
    loudness = np.sqrt((frames**2).mean(axis=1))
    return MIN_CHUNK + int(loudness.argmin()) * FRAME + FRAME // 2


def chunks(audio: Path, workdir: Path) -> Iterator[Chunk]:
    cmd = ["ffmpeg", "-loglevel", "error", "-nostdin", "-i", str(audio), "-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "1", "pipe:1"]
    with tempfile.TemporaryFile(mode="w+", dir=workdir) as err:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err)
        assert proc.stdout is not None
        pending = np.zeros(0, dtype=np.float32)
        offset = 0
        try:
            while True:
                data = proc.stdout.read(READ_BYTES)
                if data:
                    pending = np.concatenate([pending, np.frombuffer(data[: len(data) // 4 * 4], dtype=np.float32)])
                while len(pending) > MAX_CHUNK or (not data and len(pending) > 0):
                    cut = cut_point(pending) if len(pending) > MAX_CHUNK else len(pending)
                    piece = pending[:cut]
                    if np.abs(piece).max() > QUIET:
                        yield Chunk(offset / SAMPLE_RATE, piece)
                    offset += cut
                    pending = pending[cut:]
                if not data:
                    break
        finally:
            proc.stdout.close()
            code = proc.wait()
        if code != 0:
            raise VideoFailed(last_line(err, f"ffmpeg exited with {code}"))


def recognizer(models: Path, provider: str) -> tuple[so.OfflineRecognizer, str]:
    precision = "fp16" if provider == "cuda" else "int8"
    name = f"parakeet-tdt-0.6b-v2-{precision}"
    d = models / f"sherpa-onnx-nemo-{name}"
    rec = so.OfflineRecognizer.from_transducer(
        encoder=str(d / f"encoder.{precision}.onnx"),
        decoder=str(d / f"decoder.{precision}.onnx"),
        joiner=str(d / f"joiner.{precision}.onnx"),
        tokens=str(d / "tokens.txt"),
        model_type="nemo_transducer",
        num_threads=max(1, (os.cpu_count() or 2) - 2),
        provider=provider,
    )
    return rec, f"{name} {provider}"


def batches(pieces: Iterator[Chunk], size: int) -> Iterator[list[Chunk]]:
    group: list[Chunk] = []
    for piece in pieces:
        group.append(piece)
        if len(group) == size:
            yield group
            group = []
    if group:
        yield group


class Worker:
    def __init__(self, models: Path, provider: str, cache: Path) -> None:
        self.models = models
        self.provider = provider
        self.cache = cache
        self.loaded: tuple[so.OfflineRecognizer, str] | None = None

    def model(self) -> tuple[so.OfflineRecognizer, str]:
        if self.loaded is None:
            self.loaded = recognizer(self.models, self.provider)
        return self.loaded

    def transcribe(self, video_id: str) -> None:
        progress = Progress(video_id)
        with tempfile.TemporaryDirectory(prefix=f"job-{os.getpid()}-", dir=self.cache) as tmp:
            workdir = Path(tmp)
            audio = download(video_id, workdir, progress)
            length = duration(audio)
            rec, model = self.model()
            for group in batches(chunks(audio, workdir), GPU_BATCH if self.provider == "cuda" else 1):
                streams = []
                for piece in group:
                    stream = rec.create_stream()
                    stream.accept_waveform(SAMPLE_RATE, piece.samples)
                    streams.append(stream)
                rec.decode_streams(streams)
                heard = [Segment(round(p.start, 2), round(p.start + len(p.samples) / SAMPLE_RATE, 2), s.result.text.strip()) for p, s in zip(group, streams)]
                heard = [h for h in heard if h.text]
                if heard:
                    emit({"type": "segments", "id": video_id, "segments": [asdict(h) for h in heard]})
                progress.report("transcribing", group[-1].start + len(group[-1].samples) / SAMPLE_RATE, length)
            progress.report("transcribing", length, length, final=True)
        emit({"type": "done", "id": video_id, "model": model})


def owner_alive(job: Path) -> bool:
    pid = job.name.split("-")[1] if job.name.count("-") >= 2 else ""
    if not pid.isdigit():
        return False
    try:
        os.kill(int(pid), 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def clear_leftovers(cache: Path) -> None:
    for old in cache.glob("job-*"):
        if not owner_alive(old):
            shutil.rmtree(old, ignore_errors=True)


def main() -> None:
    if len(sys.argv) != 1:
        sys.exit("usage: transcribe, then write one youtube video id per line to stdin")
    cache = Path(os.environ.get("MIRAI_ASR_CACHE") or Path.home() / ".cache" / "mirai-asr")
    cache.mkdir(parents=True, exist_ok=True)
    clear_leftovers(cache)
    worker = Worker(Path(env("MIRAI_ASR_MODELS")), os.environ.get("MIRAI_ASR_PROVIDER", "cpu"), cache)
    for line in sys.stdin:
        video_id = line.strip()
        if not video_id:
            continue
        try:
            worker.transcribe(video_id)
        except VideoFailed as err:
            emit({"type": "failed", "id": video_id, "error": str(err)})


if __name__ == "__main__":
    main()
