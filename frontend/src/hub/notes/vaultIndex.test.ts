import { describe, expect, test } from "bun:test";
import { buildIndex, searchNotes, type VaultFile } from "./vaultIndex";

const file = (id: string, text: string): VaultFile => ({ id, text, mtime: 1 });

const vault = [
  file("aws/aws-iam", "---\ntags: aws\n---\n# IAM\n\nIdentity for [[aws-s3|S3]] and [[aws-ec2]].\nAlso [[missing]] and ![[chart.png]]."),
  file("aws/aws-s3", "Buckets. Access is granted by [[aws-iam]] policies."),
  file("aws-ec2", "Instances"),
  file("Excalidraw/AWS", "---\nexcalidraw-plugin: parsed\n---\n## Text Elements\n[[aws-iam]] ^abc\n## Drawing\n```json\n{\"rls\":1}\n```"),
];

describe("buildIndex", () => {
  const notes = buildIndex(vault);
  const byId = new Map(notes.map(n => [n.id, n]));

  test("resolves note links once each, dropping attachments and missing notes", () => {
    expect(byId.get("aws/aws-iam")?.links.map(l => l.to)).toEqual(["aws/aws-s3", "aws-ec2"]);
  });

  test("keeps the line around each link as backlink context", () => {
    expect(byId.get("aws/aws-s3")?.links).toEqual([{ to: "aws/aws-iam", context: "Buckets. Access is granted by [[aws-iam]] policies." }]);
  });

  test("derives title, top folder, excerpt and words without frontmatter or headings", () => {
    const iam = byId.get("aws/aws-iam");
    expect([iam?.title, iam?.folder, iam?.excerpt]).toEqual(["aws-iam", "aws", "Identity for S3 and aws-ec2. Also missing and chart.png."]);
    expect(iam?.words).toBe(10);
    expect(byId.get("aws-ec2")?.folder).toBe("");
  });

  test("keeps links from Excalidraw drawings but gives them no excerpt or words", () => {
    const d = byId.get("Excalidraw/AWS");
    expect([d?.excerpt, d?.words, d?.links.map(l => l.to)]).toEqual(["", 0, ["aws/aws-iam"]]);
  });
});

describe("searchNotes", () => {
  test("ranks title hits before body hits and snips the body around the match", () => {
    const hits = searchNotes(vault, "iam", 10);
    expect(hits.map(h => [h.id, h.inTitle])).toEqual([
      ["aws/aws-iam", true],
      ["aws/aws-s3", false],
    ]);
    expect(hits[1]?.snippet).toBe("Buckets. Access is granted by aws-iam policies.");
  });

  test("never matches inside drawing data and ignores blank queries", () => {
    expect(searchNotes(vault, "rls", 10)).toEqual([]);
    expect(searchNotes(vault, "  ", 10)).toEqual([]);
  });
});
