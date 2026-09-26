import { cn } from "cn";
import { ExternalLink, Minus, Plus, RotateCcw, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

type Shown = { src: string; alt: string };

const MIN_WIDTH = 40;
const MAX_SCALE = 8;

const IMAGE_URL = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;

const linksElsewhere = (img: HTMLImageElement) => {
  const href = img.closest("a")?.href;
  return href !== undefined && href !== "" && href !== img.src && href !== img.currentSrc && !IMAGE_URL.test(new URL(href).pathname);
};

const previewable = (img: HTMLImageElement) => !img.closest("[data-no-lightbox]") && !linksElsewhere(img) && img.getBoundingClientRect().width >= MIN_WIDTH;

export function ImageLightbox() {
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const img = e.target instanceof Element ? e.target.closest("img") : null;
      if (!img || !previewable(img)) return;
      e.preventDefault();
      e.stopPropagation();
      setShown({ src: img.currentSrc || img.src, alt: img.alt });
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  const close = () => setShown(null);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setShown(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [shown]);

  return (
    <Dialog.Root open={shown !== null} onOpenChange={open => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/90" />
        <Dialog.Content aria-describedby={undefined} data-no-lightbox onClick={e => e.target === e.currentTarget && close()} className="fixed inset-0 z-50 flex flex-col items-center gap-3 p-6 font-mono outline-none">
          <Dialog.Title className="sr-only">{shown?.alt || "image preview"}</Dialog.Title>
          {shown && <Viewer key={shown.src} shown={shown} onClose={close} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Viewer({ shown, onClose }: { shown: Shown; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const dragged = useRef(false);
  const zoomed = scale > 1.01;

  return (
    <TransformWrapper
      minScale={1}
      maxScale={MAX_SCALE}
      centerOnInit
      limitToBounds
      wheel={{ step: 0.005 }}
      doubleClick={{ mode: "toggle", step: 1 }}
      keyboard={{ disabled: false }}
      onPanningStart={() => {
        dragged.current = false;
      }}
      onPanning={() => {
        dragged.current = true;
      }}
      onTransform={(_, state) => setScale(state.scale)}
    >
      {({ zoomIn, zoomOut, resetTransform }) => (
        <>
          <TransformComponent
            wrapperClass="!h-auto !w-full min-h-0 flex-1"
            contentClass="!h-full !w-full items-center justify-center"
            wrapperProps={{
              onClick: e => {
                if (!(e.target instanceof HTMLImageElement) && !dragged.current) onClose();
              },
            }}
          >
            <img
              src={shown.src}
              alt={shown.alt}
              draggable={false}
              className={cn("max-h-full max-w-full border border-rule object-contain", zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
            />
          </TransformComponent>
          <div className="flex max-w-full shrink-0 items-center gap-4 text-[10px] text-dim">
            <span className="flex shrink-0 items-center border border-rule">
              <ToolButton label="zoom out" disabled={!zoomed} onClick={() => zoomOut(0.5)}>
                <Minus aria-hidden className="size-3" />
              </ToolButton>
              <span aria-live="polite" className="w-12 text-center text-fg">
                {Math.round(scale * 100)}%
              </span>
              <ToolButton label="zoom in" disabled={scale >= MAX_SCALE} onClick={() => zoomIn(0.5)}>
                <Plus aria-hidden className="size-3" />
              </ToolButton>
              <ToolButton label="reset zoom" disabled={!zoomed} onClick={() => resetTransform()}>
                <RotateCcw aria-hidden className="size-3" />
              </ToolButton>
            </span>
            {shown.alt && <span className="truncate">{shown.alt}</span>}
            <a href={shown.src} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1.5 text-dim no-underline hover:text-fg">
              <ExternalLink aria-hidden className="size-3" />
              open original
            </a>
            <Dialog.Close className="flex shrink-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 font-mono text-[10px] text-dim hover:text-fg">
              <X aria-hidden className="size-3" />
              close
            </Dialog.Close>
          </div>
        </>
      )}
    </TransformWrapper>
  );
}

function ToolButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 cursor-pointer items-center justify-center border-0 bg-transparent text-dim hover:text-fg disabled:cursor-default disabled:opacity-35"
    >
      {children}
    </button>
  );
}
