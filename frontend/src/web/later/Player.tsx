import { cn } from "cn";
import { Captions, Maximize2, Minimize2, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { SKIP_LABEL, type Chapter, type LaterItem, type Skip } from "@/shared/later";
import { useSettings } from "../settings";
import { useSkips, useTranscript } from "./api";
import { captionAt, toCaptions } from "./captions";
import { clockTime, fitRate, skipAt } from "./derive";
import { useJump } from "./jump";
import { SPEEDS, useLaterUi, type Speed } from "./store";
import { WatchTabs } from "./WatchTabs";
import { hideYouTubeCaptions, loadYouTube, YT_ENDED, YT_PLAYING, type YTPlayer } from "./youtube";

export type Playback = {
  toggle: () => void;
  seekTo: (sec: number) => void;
  setRate: (rate: number) => void;
  time: () => number;
  duration: () => number;
  playing: () => boolean;
  muted: () => boolean;
  setMuted: (muted: boolean) => void;
  rates: readonly number[];
  video: HTMLVideoElement | null;
};

const SKIP_SEC = 10;
const IDLE_MS = 2500;
const SKIPPED_SHOWN_MS = 4000;

export function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function youtubePlayback(p: YTPlayer): Playback {
  return {
    toggle: () => (p.getPlayerState() === YT_PLAYING ? p.pauseVideo() : p.playVideo()),
    seekTo: sec => p.seekTo(sec, true),
    setRate: rate => p.setPlaybackRate(rate),
    time: () => p.getCurrentTime(),
    duration: () => p.getDuration(),
    playing: () => p.getPlayerState() === YT_PLAYING,
    muted: () => p.isMuted(),
    setMuted: muted => (muted ? p.mute() : p.unMute()),
    rates: p.getAvailablePlaybackRates().filter(r => r >= SPEEDS[0]),
    video: null,
  };
}

function videoPlayback(v: HTMLVideoElement): Playback {
  return {
    toggle: () => void (v.paused ? v.play() : v.pause()),
    seekTo: sec => {
      v.currentTime = sec;
    },
    setRate: rate => {
      v.playbackRate = rate;
    },
    time: () => v.currentTime,
    duration: () => (Number.isFinite(v.duration) ? v.duration : 0),
    playing: () => !v.paused && !v.ended,
    muted: () => v.muted,
    setMuted: muted => {
      v.muted = muted;
    },
    rates: SPEEDS,
    video: v,
  };
}

function YouTubeSurface({ videoId, start, autoplay, poster, started, onReady, onEnded }: { videoId: string; start: number; autoplay: boolean; poster: string | null; started: boolean; onReady: (p: Playback) => void; onEnded: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const handlers = useRef({ onReady, onEnded });
  handlers.current = { onReady, onEnded };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let player: YTPlayer | null = null;
    let cancelled = false;
    const mount = document.createElement("div");
    el.replaceChildren(mount);
    loadYouTube().then(
      YT => {
        if (cancelled) return;
        player = new YT.Player(mount, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: { start: Math.floor(start), autoplay: autoplay ? 1 : 0, cc_load_policy: 0, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1, modestbranding: 1 },
          events: {
            onReady: e => {
              hideYouTubeCaptions(e.target);
              handlers.current.onReady(youtubePlayback(e.target));
            },
            onApiChange: e => hideYouTubeCaptions(e.target),
            onStateChange: e => {
              if (e.data === YT_PLAYING) hideYouTubeCaptions(e.target);
              if (e.data === YT_ENDED) handlers.current.onEnded();
            },
          },
        });
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
      player?.destroy();
    };
  }, [videoId]);

  if (error) return <p className="m-0 grid h-full place-items-center text-dim">{error}</p>;
  return (
    <>
      <div ref={host} className="relative h-full w-full overflow-hidden [&_iframe]:absolute [&_iframe]:-top-20 [&_iframe]:left-0 [&_iframe]:h-[calc(100%+10rem)] [&_iframe]:w-full" />
      {!started && (poster ? <img src={poster} alt="" className="absolute inset-0 h-full w-full bg-sunk object-cover" /> : <div className="absolute inset-0 bg-sunk" />)}
    </>
  );
}

function VideoSurface({ src, start, autoplay, onReady, onEnded }: { src: string; start: number; autoplay: boolean; onReady: (p: Playback) => void; onEnded: () => void }) {
  return (
    <video
      src={src}
      playsInline
      autoPlay={autoplay}
      onLoadedMetadata={e => {
        const v = e.currentTarget;
        if (start > 0 && start < v.duration) v.currentTime = start;
        onReady(videoPlayback(v));
      }}
      onEnded={onEnded}
      className="h-full w-full bg-black"
    />
  );
}

function ChapterBar({ chapters, skips, time, duration, onSeek }: { chapters: readonly Chapter[]; skips: readonly Skip[]; time: number; duration: number; onSeek: (sec: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const parts = chapters.length > 0 ? chapters.map((c, i) => ({ at: c.at, end: chapters[i + 1]?.at ?? duration, title: c.title })) : [{ at: 0, end: duration, title: "" }];
  const at = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const hoverSec = hover === null ? null : hover * duration;
  return (
    <div
      role="slider"
      aria-label="seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      tabIndex={-1}
      onClick={e => duration > 0 && onSeek(at(e) * duration)}
      onMouseMove={e => setHover(at(e))}
      onMouseLeave={() => setHover(null)}
      className="group/bar relative flex h-4 cursor-pointer items-center gap-0.5"
    >
      {hover !== null && hoverSec !== null && duration > 0 && (
        <span className="pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 border border-rule bg-bg px-2 py-1 text-[10px] whitespace-nowrap" style={{ left: `${hover * 100}%` }}>
          {clockTime(hoverSec)}
          {chapters.length > 0 && <span className="text-dim"> {currentChapter(chapters, hoverSec)?.title}</span>}
        </span>
      )}
      {parts.map(p => {
        const len = Math.max(0, p.end - p.at);
        const filled = len > 0 ? Math.min(1, Math.max(0, (time - p.at) / len)) : 0;
        return (
          <span key={p.at} className="relative h-1 min-w-0 bg-[#ffffff40] group-hover/bar:h-1.5" style={{ flexGrow: Math.max(len, 1) }}>
            <span className="absolute inset-y-0 left-0 bg-bad" style={{ width: `${filled * 100}%` }} />
          </span>
        );
      })}
      {duration > 0 &&
        skips.map(s => (
          <span
            key={s.start}
            data-testid="skip-mark"
            title={SKIP_LABEL[s.category]}
            className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 bg-warn group-hover/bar:h-1.5"
            style={{ left: `${(s.start / duration) * 100}%`, width: `${((Math.min(s.end, duration) - s.start) / duration) * 100}%` }}
          />
        ))}
    </div>
  );
}

export function currentChapter(chapters: readonly Chapter[], time: number): Chapter | null {
  return chapters.filter(c => c.at <= time).pop() ?? null;
}

function useFullscreen(el: RefObject<HTMLElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(document.fullscreenElement !== null && document.fullscreenElement === el.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [el]);
  const toggle = () => void (document.fullscreenElement ? document.exitFullscreen() : el.current?.requestFullscreen());
  return [on, toggle] as const;
}

type Now = { time: number; duration: number; playing: boolean; muted: boolean };

function readNow(p: Playback, fallbackDuration: number): Now {
  return { time: p.time(), duration: p.duration() || fallbackDuration, playing: p.playing(), muted: p.muted() };
}

function SpeedMenu({ rate, rates, onPick }: { rate: number; rates: readonly number[]; onPick: (s: Speed) => void }) {
  const max = Math.max(...rates);
  return (
    <div role="menu" aria-label="speeds" className="absolute right-0 bottom-full mb-2 flex min-w-24 flex-col border border-rule bg-bg py-1">
      {SPEEDS.map(s => (
        <button
          key={s}
          type="button"
          role="menuitemradio"
          aria-checked={s === rate}
          disabled={!rates.includes(s)}
          onPointerDown={e => e.preventDefault()}
          onClick={() => onPick(s)}
          className={cn("cursor-pointer border-0 px-4 py-1 text-right font-mono text-[11px] disabled:cursor-default disabled:bg-transparent disabled:text-faint", s === rate ? "bg-fg text-bg" : "bg-transparent text-fg hover:bg-lift")}
        >
          {s}x
        </button>
      ))}
      {max < Math.max(...SPEEDS) && <span className="px-4 pt-1 text-right text-[9px] text-dim">max {max}x here</span>}
    </div>
  );
}

function Overlay({ pb, now, chapters, skips, rate, subtitles, fullscreen, onSpeed, onSubtitles, onFullscreen, onSync }: { pb: Playback | null; now: Now; chapters: readonly Chapter[]; skips: readonly Skip[]; rate: number; subtitles: boolean | null; fullscreen: boolean; onSpeed: (s: Speed) => void; onSubtitles: () => void; onFullscreen: () => void; onSync: () => void }) {
  const [awake, setAwake] = useState(true);
  const [menu, setMenu] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const wake = () => {
    setAwake(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAwake(false), IDLE_MS);
  };
  const act = (run: (p: Playback) => void) => () => {
    if (!pb) return;
    run(pb);
    onSync();
  };
  const toggle = act(p => p.toggle());
  const skip = (by: number) => act(p => p.seekTo(Math.max(0, p.time() + by)));
  const shown = !pb || !now.playing || awake || menu;
  const chapter = currentChapter(chapters, now.time);

  return (
    <div
      data-testid="player-overlay"
      onMouseMove={wake}
      onMouseLeave={() => setAwake(false)}
      onClick={e => {
        if (e.target !== e.currentTarget) return;
        if (menu) setMenu(false);
        else toggle();
      }}
      onDoubleClick={e => e.target === e.currentTarget && onFullscreen()}
      className={cn("absolute inset-0 flex flex-col justify-end", !shown && "cursor-none")}
    >
      {pb && !now.playing && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="pointer-events-auto flex items-center gap-10">
            <SkipBtn label={`back ${SKIP_SEC} seconds`} onClick={skip(-SKIP_SEC)}>
              <RotateCcw className="size-5" />
            </SkipBtn>
            <button type="button" aria-label="play" title="play (space)" onPointerDown={e => e.preventDefault()} onClick={toggle} className="grid size-16 cursor-pointer place-items-center rounded-full border border-[#ffffff40] bg-[#000000a6] text-fg hover:border-fg">
              <Play className="size-6" />
            </button>
            <SkipBtn label={`forward ${SKIP_SEC} seconds`} onClick={skip(SKIP_SEC)}>
              <RotateCw className="size-5" />
            </SkipBtn>
          </div>
        </div>
      )}
      <div className={cn("relative flex flex-col gap-1.5 bg-linear-to-t from-[#000000e6] to-transparent px-4 pt-10 pb-2.5 transition-opacity duration-200 focus-within:pointer-events-auto focus-within:opacity-100", shown ? "opacity-100" : "pointer-events-none opacity-0")}>
        <ChapterBar chapters={chapters} skips={skips} time={now.time} duration={now.duration} onSeek={s => pb?.seekTo(s)} />
        <div className="flex items-center gap-3 text-[11px]">
          <IconBtn label={now.playing ? "pause" : "play"} onClick={toggle} disabled={!pb}>
            {now.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </IconBtn>
          <IconBtn label={now.muted ? "unmute" : "mute"} onClick={act(p => p.setMuted(!p.muted()))} disabled={!pb}>
            {now.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </IconBtn>
          <span className="shrink-0 whitespace-nowrap">
            {clockTime(now.time)} <span className="text-soft">/ {clockTime(now.duration)}</span>
          </span>
          {chapter && <span className="min-w-0 truncate text-[10px] text-soft">{chapter.title}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-3">
            <IconBtn label={subtitles ? "subtitles off (c)" : "subtitles on (c)"} pressed={subtitles === true} onClick={onSubtitles} disabled={subtitles === null}>
              <Captions className="size-4" />
            </IconBtn>
            <span className="relative">
              <button type="button" aria-label="speed" aria-expanded={menu} title="speed (, .)" onPointerDown={e => e.preventDefault()} onClick={() => setMenu(!menu)} className="cursor-pointer border-0 bg-transparent p-1 font-mono text-[11px] text-fg hover:text-soft">
                {rate}x
              </button>
              {menu && (
                <SpeedMenu
                  rate={rate}
                  rates={pb?.rates ?? SPEEDS}
                  onPick={s => {
                    onSpeed(s);
                    setMenu(false);
                  }}
                />
              )}
            </span>
            {pb?.video && document.pictureInPictureEnabled && (
              <IconBtn label="picture in picture" onClick={() => void pb.video?.requestPictureInPicture()}>
                <PictureInPicture2 className="size-4" />
              </IconBtn>
            )}
            <IconBtn label={fullscreen ? "exit fullscreen" : "fullscreen"} onClick={onFullscreen}>
              {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </IconBtn>
          </span>
        </div>
      </div>
    </div>
  );
}

export function Player({ item, autoplay, onProgress, onEnded, onPlayback }: { item: LaterItem; autoplay: boolean; onProgress: (progress: number, position: number) => void; onEnded: () => void; onPlayback: (p: Playback | null) => void }) {
  const { saveEveryMs } = useSettings().later;
  const speed = useLaterUi(s => s.speed);
  const setSpeed = useLaterUi(s => s.setSpeed);
  const captions = useLaterUi(s => s.captions);
  const setCaptions = useLaterUi(s => s.setCaptions);
  const transcript = useTranscript(item.id, item.embed.type === "youtube");
  const skips = useSkips(item.id, item.embed.type === "youtube").data ?? [];
  const frame = useRef<HTMLDivElement>(null);
  const [fullscreen, toggleFullscreen] = useFullscreen(frame);
  const [pb, setPb] = useState<Playback | null>(null);
  const [now, setNow] = useState<Now>({ time: item.position, duration: item.lengthSec ?? 0, playing: false, muted: false });
  const report = useRef(onProgress);
  report.current = onProgress;

  const [started, setStarted] = useState(false);
  const [skipped, setSkipped] = useState<Skip | null>(null);
  const lastTime = useRef(now.time);
  const kept = useRef(new Set<number>());
  const citedAt = useRef<number | null>(null);

  useEffect(() => {
    setPb(null);
    setStarted(false);
    setSkipped(null);
    kept.current = new Set();
    citedAt.current = null;
    lastTime.current = Infinity;
    onPlayback(null);
  }, [item.id, onPlayback]);

  useEffect(() => {
    const prev = lastTime.current;
    lastTime.current = now.time;
    const hit = skipAt(skips, prev, now.time);
    const cited = citedAt.current;
    if (hit && cited !== null && cited >= hit.start - 1 && cited < hit.end) kept.current.add(hit.start);
    if (!pb || !hit || kept.current.has(hit.start)) return;
    pb.seekTo(hit.end);
    lastTime.current = hit.end;
    setSkipped(hit);
  }, [now.time, skips, pb]);

  useEffect(() => {
    if (!skipped) return;
    const id = setTimeout(() => setSkipped(null), SKIPPED_SHOWN_MS);
    return () => clearTimeout(id);
  }, [skipped]);

  const undoSkip = (s: Skip) => {
    kept.current.add(s.start);
    pb?.seekTo(s.start);
    setSkipped(null);
  };

  useEffect(() => {
    if (now.playing) setStarted(true);
  }, [now.playing]);

  const jump = useJump(s => s.jump);
  useEffect(() => {
    if (!pb || !jump || jump.id !== item.id || !("at" in jump)) return;
    citedAt.current = jump.at;
    pb.seekTo(jump.at);
    lastTime.current = jump.at;
    if (!pb.playing()) pb.toggle();
    useJump.getState().setJump(null);
  }, [pb, jump, item.id]);

  const ready = (p: Playback) => {
    p.setRate(fitRate(speed, p.rates));
    setPb(p);
    onPlayback(p);
  };

  const sync = () => pb && setNow(readNow(pb, item.lengthSec ?? 0));

  useEffect(() => {
    if (!pb) return;
    const id = setInterval(() => setNow(readNow(pb, item.lengthSec ?? 0)), 500);
    return () => clearInterval(id);
  }, [pb, item.lengthSec]);

  useEffect(() => {
    if (!pb) return;
    const save = () => {
      const d = pb.duration();
      if (d > 0 && pb.time() > 0) report.current(pb.time() / d, pb.time());
    };
    const id = setInterval(() => pb.playing() && save(), saveEveryMs);
    return () => {
      clearInterval(id);
      save();
    };
  }, [pb, saveEveryMs]);

  const ended = () => {
    report.current(1, pb?.duration() ?? item.lengthSec ?? 0);
    onEnded();
  };

  const surface =
    item.embed.type === "youtube" ? (
      <YouTubeSurface key={item.id} videoId={item.embed.videoId} start={item.progress >= 1 ? 0 : item.position} autoplay={autoplay} poster={item.image} started={started} onReady={ready} onEnded={ended} />
    ) : item.embed.type === "vimeo" ? (
      <iframe key={item.id} title={item.title} src={`https://player.vimeo.com/video/${item.embed.videoId}#t=${Math.floor(item.position)}s`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen className="h-full w-full border-0" />
    ) : (
      <VideoSurface key={item.id} src={item.url} start={item.position} autoplay={autoplay} onReady={ready} onEnded={ended} />
    );

  const chapter = currentChapter(item.chapters, now.time);
  const heard = transcript.data?.status === "ready" || transcript.data?.status === "running" ? transcript.data.segments : null;
  const captionLines = useMemo(() => (heard ? toCaptions(heard) : null), [heard]);
  const subtitle = captions && captionLines ? captionAt(captionLines, now.time) : null;
  const controlled = item.embed.type !== "vimeo";
  const rate = pb ? fitRate(speed, pb.rates) : speed;
  const left = now.duration > now.time && now.time > 0 ? `${clockTime((now.duration - now.time) / rate)} left${rate === 1 ? "" : ` at ${rate}x`}` : null;

  return (
    <div className="flex flex-col gap-4">
      <div ref={frame} className="relative aspect-video w-full overflow-hidden bg-sunk">
        {surface}
        {controlled && (
          <Overlay
            pb={pb}
            now={now}
            chapters={item.chapters}
            skips={skips}
            rate={rate}
            subtitles={captionLines ? captions : null}
            fullscreen={fullscreen}
            onSpeed={s => {
              setSpeed(s);
              pb?.setRate(s);
            }}
            onSubtitles={() => setCaptions(!captions)}
            onFullscreen={toggleFullscreen}
            onSync={sync}
          />
        )}
        {skipped && (
          <div role="status" className="absolute top-4 left-4 flex items-center gap-3 border border-rule bg-bg px-3 py-1.5 text-[10px]">
            <span>
              skipped {SKIP_LABEL[skipped.category]} <span className="text-dim">{clockTime(skipped.end - skipped.start)}</span>
            </span>
            <button type="button" onClick={() => undoSkip(skipped)} className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[10px] text-fg underline">
              undo
            </button>
          </div>
        )}
        {subtitle && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[12%] flex justify-center px-6">
            <span data-testid="subtitle" className="max-w-[78%] bg-[#000000b8] px-3 py-1.5 text-center font-serif text-[clamp(14px,2.2vw,22px)] leading-snug text-fg">
              {subtitle}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="m-0 font-serif text-[20px] leading-tight font-semibold">{item.title}</h2>
        <span className="text-[10px] text-dim">{[item.author, item.site, controlled ? left : null].filter(Boolean).join(" · ")}</span>
        {!controlled && <span className="text-[10px] text-dim">vimeo keeps its own controls inside the player; progress isn't tracked</span>}
      </div>
      <WatchTabs item={item} chapter={chapter} transcript={transcript.data} time={now.time} playing={now.playing} stamp={() => pb?.time() ?? now.time} onSeek={s => pb?.seekTo(s)} />
    </div>
  );
}

function SkipBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onPointerDown={e => e.preventDefault()} onClick={onClick} className="flex cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-1 font-mono text-[10px] text-soft hover:text-fg">
      {children}
      {SKIP_SEC}
    </button>
  );
}

function IconBtn({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} onPointerDown={e => e.preventDefault()} onClick={onClick} disabled={disabled} className="grid cursor-pointer place-items-center border-0 bg-transparent p-1 text-fg hover:text-soft disabled:cursor-default disabled:text-faint aria-pressed:bg-[#ffffff33]">
      {children}
    </button>
  );
}
