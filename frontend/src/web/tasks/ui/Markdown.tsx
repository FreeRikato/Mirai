import { cn } from "cn";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { classifyUrl } from "@/shared/links";
import { navigate } from "../../router";
import { LINK_ICON, linkLabel } from "./Links";
import { remarkWikiLinks } from "./remarkWikiLinks";

const components: Components = {
  h1: ({ children }) => <h3 className="m-0 mt-2 text-[12px] font-bold">{children}</h3>,
  h2: ({ children }) => <h3 className="m-0 mt-2 text-[12px] font-bold">{children}</h3>,
  h3: ({ children }) => <h4 className="m-0 mt-1 text-[11px] font-bold">{children}</h4>,
  p: ({ children }) => <p className="m-0 leading-[1.6] text-soft">{children}</p>,
  a: ({ href, children }) => <MdLink href={href}>{children}</MdLink>,
  ul: ({ children }) => <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-soft">{children}</ul>,
  ol: ({ children }) => <ol className="m-0 flex list-decimal flex-col gap-1 pl-4 text-soft">{children}</ol>,
  code: ({ children, className }) => <code className={cn("text-warn", className)}>{children}</code>,
  pre: ({ children }) => <pre className="m-0 overflow-x-auto border border-rule bg-raise p-3 text-[10px] leading-[1.5] [&_code]:text-fg">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="m-0 border-l-2 border-rule pl-3 text-dim">{children}</blockquote>,
  img: ({ src, alt }) => <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} loading="lazy" className="block h-auto max-h-[420px] max-w-full border border-rule object-contain" />,
  table: ({ children }) => <table className="w-full border-collapse text-[10px]">{children}</table>,
  th: ({ children }) => <th className="border-b border-rule py-1 text-left font-normal text-dim">{children}</th>,
  td: ({ children }) => <td className="border-b border-rule py-1">{children}</td>,
};

function MdLink({ href, children }: { href: string | undefined; children: React.ReactNode }) {
  if (href?.startsWith("/notes/")) {
    return (
      <a
        href={href}
        onClick={e => {
          e.preventDefault();
          navigate(href);
        }}
        className="text-fg underline decoration-dim underline-offset-2 hover:decoration-fg"
      >
        {children}
      </a>
    );
  }
  const bare = href !== undefined && children === href ? classifyUrl(href) : null;
  const Icon = bare ? LINK_ICON[bare.kind] : null;
  return (
    <a href={href} target="_blank" rel="noreferrer" title={href} className="inline-flex items-baseline gap-1 text-link no-underline hover:underline">
      {Icon && <Icon aria-hidden className="size-3 self-center" />}
      {bare ? linkLabel(bare) : children}
    </a>
  );
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2.5 text-[11px] break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkWikiLinks]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function InlineMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkWikiLinks]} components={{ ...components, p: ({ children: c }) => <>{c}</> }} allowedElements={["p", "strong", "em", "code", "a", "del"]} unwrapDisallowed>
      {children}
    </ReactMarkdown>
  );
}
