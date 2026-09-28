import { cn } from "cn";
import { ArrowUp, ExternalLink, Link2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LaterItem } from "@/shared/later";
import { isBareXArticle, mediaSrc, type Media, type RedditComment, type RedditThread, type Tweet, type XArticle } from "@/shared/social";
import { ago } from "../format";
import { createSanitizer } from "../safeHtml";
import { useSocial } from "./api";
import { OpenWith, Tldr } from "./OpenWith";
import { useSurface } from "./ReadingTools";
import { READER_MAX_WIDTH, useLaterUi } from "./store";

type Video = Extract<Media, { type: "video" }>;
type HlsInstance = { loadSource: (url: string) => void; attachMedia: (el: HTMLVideoElement) => void; destroy: () => void };
type HlsCtor = { new (): HlsInstance; isSupported: () => boolean };

const sanitizeReddit = createSanitizer("https://www.reddit.com");
const sanitizeX = createSanitizer("https://x.com");
const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

const isHlsCtor = (v: unknown): v is HlsCtor => typeof v === "function" && "isSupported" in v && typeof v.isSupported === "function";

let hlsLoad: Promise<HlsCtor> | undefined;

function loadHls(): Promise<HlsCtor> {
  const url = new URL("/vendor/hls.js/hls.light.min.mjs", window.location.origin).href;
  hlsLoad ??= import(url).then((mod: { default?: unknown }) => {
    if (!isHlsCtor(mod.default)) throw new Error("hls.js did not load");
    return mod.default;
  });
  return hlsLoad;
}

export function SocialView({ item }: { item: LaterItem }) {
  const { data } = useSocial(item.id);
  const fontSize = useLaterUi(s => s.fontSize);
  const width = useLaterUi(s => s.width);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useSurface(data && data.kind !== "unavailable" ? root : null, null);
  if (!data) return <p className="m-0 p-5 text-dim">loading from {item.site}</p>;
  if (data.kind === "unavailable") return <OpenWith item={item} reason={data.reason} />;
  return (
    <article ref={setRoot} style={{ fontSize, maxWidth: READER_MAX_WIDTH[width] }} className="mx-auto flex flex-col gap-[1.3em] px-7 pt-8 pb-[30vh] font-serif leading-normal">
      {data.kind === "tweet" ? <TweetCard tweet={data.tweet} /> : <Thread thread={data.thread} />}
      {item.tldr.length > 0 && data.kind === "reddit" && <Tldr item={item} />}
      {data.kind === "reddit" && <Comments thread={data.thread} />}
    </article>
  );
}

function Linked({ text }: { text: string }) {
  return text.split(URL_PATTERN).map((part, i) =>
    i % 2 === 1 ? (
      <a key={`${i}:${part}`} href={part} target="_blank" rel="noreferrer" className="break-all text-link no-underline hover:underline">
        {part.replace(/^https?:\/\/(www\.)?/, "")}
      </a>
    ) : (
      part
    ),
  );
}

function TweetCard({ tweet, quoted }: { tweet: Tweet; quoted?: boolean }) {
  return (
    <section aria-label={`tweet by @${tweet.author.handle}`} className={cn("flex flex-col", quoted ? "gap-[0.7em] border border-faint px-[1.1em] py-[1em]" : "gap-[1em]")}>
      <header className="flex items-center gap-3 font-mono">
        {tweet.author.avatar && <img data-no-lightbox src={tweet.author.avatar} alt="" className={cn("shrink-0 rounded-full", quoted ? "size-6" : "size-10")} />}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className={cn("truncate font-key font-semibold text-fg", quoted ? "text-[13px]" : "text-[15px]")}>{tweet.author.name}</span>
          <span className="truncate text-[10px] text-dim">
            @{tweet.author.handle} · {ago(tweet.createdAt)}
          </span>
        </span>
        {!quoted && (
          <a href={tweet.url} target="_blank" rel="noreferrer" className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] text-dim no-underline hover:text-fg">
            <ExternalLink aria-hidden className="size-3" />
            open on x
          </a>
        )}
      </header>
      {tweet.text && !(tweet.article && isBareXArticle(tweet.text.trim())) && (
        <p className={cn("m-0 break-words whitespace-pre-wrap text-fg", quoted ? "text-[1em] leading-[1.55]" : "text-[1.24em] leading-[1.5]")}>
          <Linked text={tweet.text} />
        </p>
      )}
      <MediaGrid media={tweet.media} />
      {tweet.article && <ArticleBody article={tweet.article} full={!quoted} />}
      {tweet.quoted && <TweetCard tweet={tweet.quoted} quoted />}
    </section>
  );
}

function ArticleBody({ article, full }: { article: XArticle; full: boolean }) {
  const clean = useMemo(() => (full && article.html ? sanitizeX(article.html) : null), [full, article.html]);
  return (
    <section aria-label={`article: ${article.title}`} className="flex flex-col gap-[0.9em]">
      <h1 className="m-0 font-key text-[1.5em] leading-[1.3] font-semibold text-fg">{article.title}</h1>
      {clean ? (
        <div className="social-prose leading-[1.6] text-fg" dangerouslySetInnerHTML={{ __html: clean }} />
      ) : (
        <>
          {article.cover && <img src={article.cover} alt="" loading="lazy" referrerPolicy="no-referrer" className="block h-auto w-full border border-rule" />}
          {article.preview && <p className="m-0 leading-[1.6] text-dim">{article.preview}</p>}
        </>
      )}
    </section>
  );
}

function MediaGrid({ media }: { media: readonly Media[] }) {
  if (media.length === 0) return null;
  return (
    <div className={cn("grid gap-1.5", media.length > 1 && "grid-cols-2")}>
      {media.map(m =>
        m.type === "image" ? (
          <img
            key={m.url}
            src={m.url}
            alt={m.alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            width={m.width ?? undefined}
            height={m.height ?? undefined}
            className={cn("block h-auto w-full border border-rule bg-raise object-cover", media.length > 1 ? "aspect-square" : "max-h-[560px] object-contain")}
          />
        ) : (
          <VideoPlayer key={m.url} video={m} />
        ),
      )}
    </div>
  );
}

function VideoPlayer({ video }: { video: Video }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    const hls = video.hls;
    if (!el || !hls) return;
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = hls;
      return;
    }
    let player: HlsInstance | null = null;
    let stale = false;
    loadHls().then(
      Hls => {
        if (stale) return;
        if (!Hls.isSupported()) {
          el.src = mediaSrc(video.url);
          return;
        }
        player = new Hls();
        player.loadSource(hls);
        player.attachMedia(el);
      },
      () => {
        if (!stale) el.src = mediaSrc(video.url);
      },
    );
    return () => {
      stale = true;
      player?.destroy();
    };
  }, [video.hls, video.url]);

  return (
    <video
      ref={ref}
      controls
      playsInline
      preload="metadata"
      poster={video.poster ?? undefined}
      src={video.hls ? undefined : mediaSrc(video.url)}
      width={video.width ?? undefined}
      height={video.height ?? undefined}
      className="block h-auto max-h-[560px] w-full border border-rule bg-black"
    />
  );
}

function RedditHtml({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => sanitizeReddit(html), [html]);
  return <div className={cn("social-prose", className)} dangerouslySetInnerHTML={{ __html: clean }} />;
}

function Meta({ children }: { children: ReactNode }) {
  return <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[10px] text-dim">{children}</span>;
}

function Thread({ thread }: { thread: RedditThread }) {
  return (
    <section aria-label="reddit post" className="flex flex-col gap-[0.9em]">
      <Meta>
        <span className="text-fg">r/{thread.subreddit}</span>
        <span>u/{thread.author}</span>
        <span>{ago(thread.createdAt)}</span>
        <span className="flex items-center gap-0.5">
          <ArrowUp aria-hidden className="size-3" />
          {thread.score}
        </span>
        <a href={thread.url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1.5 text-dim no-underline hover:text-fg">
          <ExternalLink aria-hidden className="size-3" />
          open on reddit
        </a>
      </Meta>
      <h1 className="m-0 text-[1.65em] leading-tight font-semibold text-fg">{thread.title}</h1>
      {thread.link && (
        <a href={thread.link} target="_blank" rel="noreferrer" className="flex items-center gap-2 border border-rule px-3 py-2 font-mono text-[11px] text-link no-underline hover:border-dim">
          <Link2 aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{thread.link.replace(/^https?:\/\/(www\.)?/, "")}</span>
        </a>
      )}
      <MediaGrid media={thread.media} />
      {thread.html && <RedditHtml html={thread.html} className="text-[1.06em] leading-[1.7] text-soft" />}
    </section>
  );
}

function Comments({ thread }: { thread: RedditThread }) {
  return (
    <section aria-label="comments" className="flex flex-col gap-[1.35em] border-t border-rule pt-[1.6em]">
      <span className="font-mono text-[11px] font-semibold text-fg">{thread.comments} comments</span>
      {thread.replies.length === 0 && <span className="font-mono text-[10px] text-dim">no comments yet</span>}
      {thread.replies.map(c => (
        <CommentNode key={c.id} comment={c} threadUrl={thread.url} op={thread.author} />
      ))}
      <MoreOnReddit count={thread.more} url={thread.url} />
    </section>
  );
}

function MoreOnReddit({ count, url }: { count: number; url: string }) {
  if (count === 0) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="w-fit font-mono text-[10px] text-dim no-underline hover:text-fg">
      {count} more {count === 1 ? "reply" : "replies"} on reddit
    </a>
  );
}

function CommentNode({ comment, threadUrl, op }: { comment: RedditComment; threadUrl: string; op: string }) {
  const [open, setOpen] = useState(true);
  const hidden = countAll(comment);
  return (
    <div className="flex flex-col gap-[0.4em]">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-fit cursor-pointer flex-wrap items-baseline gap-x-2.5 border-0 bg-transparent p-0 text-left font-mono text-[11px] text-dim hover:text-soft">
        <span className={cn("font-semibold", comment.author === "[deleted]" ? "text-faint" : "text-fg")}>{comment.author}</span>
        {comment.author === op && <span className="text-[10px] text-warn">OP</span>}
        <span>
          {comment.score} {Math.abs(comment.score) === 1 ? "point" : "points"} · {ago(comment.createdAt)}
        </span>
        {!open && <span className="text-soft">{hidden > 1 ? `[+${hidden}]` : "[+]"}</span>}
      </button>
      {open && (
        <>
          <RedditHtml html={comment.html} className="text-[0.97em] leading-[1.62] text-soft" />
          {(comment.replies.length > 0 || comment.more > 0) && (
            <div className="mt-[0.6em] flex flex-col gap-[1.35em] border-l border-rule pl-[1.1em]">
              {comment.replies.map(r => (
                <CommentNode key={r.id} comment={r} threadUrl={threadUrl} op={op} />
              ))}
              <MoreOnReddit count={comment.more} url={`${threadUrl}${comment.id}/`} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

const countAll = (c: RedditComment): number => 1 + c.replies.reduce((n, r) => n + countAll(r), 0);
