import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineMarkdown, Markdown } from "./Markdown";

test("wiki-links render as in-app note links with their label, everywhere markdown is shown", () => {
  const html = renderToStaticMarkup(<Markdown>{"See [[aws/aws-iam|IAM]] and [[Postgres internals#Rewriter]]."}</Markdown>);
  expect(html).toContain('href="/notes/aws%2Faws-iam"');
  expect(html).toContain(">IAM</a>");
  expect(html).toContain('href="/notes/Postgres%20internals"');
  expect(html).toContain(">Postgres internals &gt; Rewriter</a>");
  expect(renderToStaticMarkup(<InlineMarkdown>{"fix [[rls]] today"}</InlineMarkdown>)).toContain('href="/notes/rls"');
});

test("wiki-links inside code stay as written, and image embeds show the image from the vault", () => {
  const html = renderToStaticMarkup(<Markdown>{"`[[not-a-link]]` and ![[Pasted image 1.png]]"}</Markdown>);
  expect(html).not.toContain('href="/notes/');
  expect(html).toContain("[[not-a-link]]");
  expect(html).toContain('src="/api/notes/asset?name=Pasted%20image%201.png"');
});
