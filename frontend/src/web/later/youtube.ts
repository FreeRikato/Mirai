export type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setPlaybackRate: (rate: number) => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  getAvailablePlaybackRates: () => number[];
  unloadModule: (name: string) => void;
  destroy: () => void;
};

type YTEvent = { data: number; target: YTPlayer };

type YTOptions = {
  videoId: string;
  width?: string;
  height?: string;
  playerVars?: Record<string, string | number>;
  events?: { onReady?: (e: YTEvent) => void; onStateChange?: (e: YTEvent) => void; onApiChange?: (e: YTEvent) => void };
};

type YTApi = { Player: new (el: HTMLElement, opts: YTOptions) => YTPlayer };

declare global {
  interface Window {
    YT?: YTApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const YT_PLAYING = 1;
export const YT_ENDED = 0;

export function hideYouTubeCaptions(p: YTPlayer): void {
  p.unloadModule("captions");
  p.unloadModule("cc");
}

let loading: Promise<YTApi> | null = null;

export function loadYouTube(): Promise<YTApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  loading ??= new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      loading = null;
      reject(new Error("could not load the YouTube player"));
    };
    document.head.append(script);
  });
  return loading;
}
