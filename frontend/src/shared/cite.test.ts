import { expect, test } from "bun:test";
import { citeKey, decodeEntities, findQuote, htmlText, parseCiteHref } from "./cite";

test("citation links carry an item id and one target: a moment, a passage, the item itself, or a malformed one", () => {
  expect(parseCiteHref("/content/item/19d31f46?t=1671")).toEqual({ id: "19d31f46", target: { kind: "moment", at: 1671 } });
  expect(parseCiteHref("/content/item/rls?q=inlined%20into%20the%20plan")).toEqual({ id: "rls", target: { kind: "passage", quote: "inlined into the plan" } });
  expect(parseCiteHref("/content/item/rls")).toEqual({ id: "rls", target: { kind: "item" } });
  for (const bad of ["abc", "1e3", "-5", ""]) expect(parseCiteHref(`/content/item/v?t=${bad}`)?.target).toEqual({ kind: "malformed", reason: "malformed timestamp" });
  expect(parseCiteHref("/content/item/v?q=%20")?.target).toEqual({ kind: "malformed", reason: "empty quote" });
  expect(parseCiteHref("/machines/omarikato")).toBeNull();
  expect(parseCiteHref("https://example.com/content/item/x")).toBeNull();
});

test("a raw and a percent-encoded href of the same citation share one key", () => {
  const raw = parseCiteHref("/content/item/a?q=it\u2019s a café (really)");
  const encoded = parseCiteHref("/content/item/a?q=it%E2%80%99s%20a%20caf%C3%A9%20(really)");
  expect(raw && encoded && citeKey(raw) === citeKey(encoded)).toBe(true);
});

test("a quote is found across tags, spacing, smart quotes, entities and invisible characters, and maps back to the original text", () => {
  const text = "Each table gets its USING\u00a0clause   attached\nas a \u201csecurity barrier\u201d quali\u00adfier.";
  const span = findQuote(text, 'using clause attached as a "security barrier" qualifier');
  expect(span && text.slice(span.start, span.end)).toBe("USING\u00a0clause   attached\nas a \u201csecurity barrier\u201d quali\u00adfier");
  expect(findQuote(htmlText("<p>it is <em>really</em>, fast &amp; cheap</p>"), "really, fast &amp; cheap")).not.toBeNull();
  expect(findQuote(text, "a paraphrase of the clause")).toBeNull();
  expect(findQuote(text, "  ")).toBeNull();
});

test("characters that change length when lowercased keep later matches on the right words", () => {
  const text = "İİİ abc def";
  const span = findQuote(text, "def");
  expect(span && text.slice(span.start, span.end)).toBe("def");
});

test("a quote cannot be stitched together from separate paragraphs, list items or table cells", () => {
  const text = htmlText("<table><tr><td>not</td><td>recommended for production use today</td></tr></table><ul><li>Revenue grew</li><li>fast in every market</li></ul><p>one two three</p><p>four five</p>");
  expect(findQuote(text, "not recommended for production use today")).toBeNull();
  expect(findQuote(text, "Revenue grew fast in every market")).toBeNull();
  expect(findQuote(text, "recommended for production use today")).not.toBeNull();
});

test("entity decoding leaves out-of-range and unknown entities alone instead of throwing", () => {
  expect(decodeEntities("Tom &amp; Jerry&#39;s &#x2014; &#99999999; &#face; &#1e400; &bogus;")).toBe("Tom & Jerry's \u2014 &#99999999; &#face; &#1e400; &bogus;");
});
