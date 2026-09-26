import { expect, test } from "bun:test";
import type { Social, Tweet } from "@/shared/social";
import { findXArticle } from "./social";

const post = (id: string, articleId: string | null): Tweet => ({
  id,
  url: `https://x.com/a/status/${id}`,
  author: { name: "A", handle: "a", avatar: null },
  text: "",
  createdAt: "2026-02-17T05:29:02.000Z",
  media: [],
  quoted: null,
  article: articleId ? { id: articleId, title: "T", cover: null, preview: "", html: "<p>body</p>" } : null,
});

test("a bare X article is found through a saved post that carries it, asking only saved posts", async () => {
  const asked: string[] = [];
  const social = async (url: string): Promise<Social> => {
    asked.push(url);
    const id = url.split("/").at(-1) ?? "";
    return { kind: "tweet", tweet: post(id, id === "2" ? "99" : null) };
  };
  const saved = ["https://x.com/a/status/1", "https://example.com/post", "http://x.com/i/article/99", "https://x.com/a/status/2", "https://x.com/a/status/3"];
  expect((await findXArticle("99", saved, social))?.id).toBe("2");
  expect(asked).toEqual(["https://x.com/a/status/1", "https://x.com/a/status/2"]);
  expect(await findXArticle("77", saved, social)).toBeNull();
});
