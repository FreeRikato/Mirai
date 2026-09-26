import { expect, test } from "bun:test";
import { youtubePlaylistId } from "./later";

test("only youtube playlist pages count as playlists, not a video that happens to sit in one", () => {
  expect(youtubePlaylistId("https://www.youtube.com/playlist?list=PLoROMvodv4rOSH4v6133s9LFPRHjEmbmJ")).toBe("PLoROMvodv4rOSH4v6133s9LFPRHjEmbmJ");
  expect(youtubePlaylistId("https://m.youtube.com/playlist?list=PL_a-1&si=xyz")).toBe("PL_a-1");
  expect(youtubePlaylistId("https://www.youtube.com/watch?v=iXjtJmUQBZk&list=PLx")).toBeNull();
  expect(youtubePlaylistId("https://www.youtube.com/playlist")).toBeNull();
  expect(youtubePlaylistId("https://example.com/playlist?list=PLx")).toBeNull();
  expect(youtubePlaylistId("not a url")).toBeNull();
});
