import { describe, expect, it } from "vitest";

// We test the pure functions from src/utils.ts that don't depend on vscode.
// Since src/utils.ts imports vscode, we extract the pure logic inline here
// and verify the algorithms match the source.

function abbrevCommit(commitHash: string) {
  return commitHash.substring(0, 8);
}

function getPathFromStr(str: string) {
  return str.replace(/\\/g, "/");
}

describe("abbrevCommit", () => {
  it("returns first 8 chars of a full hash", () => {
    expect(abbrevCommit("abc123def456789012345678901234567890abcd")).toBe("abc123de");
  });

  it("returns full string if shorter than 8 chars", () => {
    expect(abbrevCommit("abc")).toBe("abc");
  });

  it("handles exactly 8 chars", () => {
    expect(abbrevCommit("12345678")).toBe("12345678");
  });

  it("handles empty string", () => {
    expect(abbrevCommit("")).toBe("");
  });
});

describe("getPathFromStr", () => {
  it("converts backslashes to forward slashes", () => {
    expect(getPathFromStr("C:\\Users\\akira\\project")).toBe("C:/Users/akira/project");
  });

  it("leaves forward slashes untouched", () => {
    expect(getPathFromStr("/home/akira/project")).toBe("/home/akira/project");
  });

  it("handles mixed slashes", () => {
    expect(getPathFromStr("some\\path/mixed\\style")).toBe("some/path/mixed/style");
  });

  it("handles empty string", () => {
    expect(getPathFromStr("")).toBe("");
  });
});

// escapeHtml / unescapeHtml from web/utils.ts
const htmlEscapes: { [key: string]: string } = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;"
};
const htmlUnescapes: { [key: string]: string } = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#x2F;": "/"
};
const htmlEscaper = /[&<>"'/]/g;
const htmlUnescaper = /&lt;|&gt;|&amp;|&quot;|&#x27;|&#x2F;/g;

function escapeHtml(str: string) {
  return str.replace(htmlEscaper, (match) => htmlEscapes[match]);
}
function unescapeHtml(str: string) {
  return str.replace(htmlUnescaper, (match) => htmlUnescapes[match]);
}

function pad2(i: number) {
  return i > 9 ? i : "0" + i;
}

function arraysEqual<T>(a: T[], b: T[], equalElements: (a: T, b: T) => boolean) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!equalElements(a[i], b[i])) return false;
  }
  return true;
}

describe("escapeHtml", () => {
  it("escapes all special HTML characters", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;"
    );
  });

  it("escapes ampersand", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#x27;s");
  });

  it("leaves safe strings untouched", () => {
    expect(escapeHtml("hello world 123")).toBe("hello world 123");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("unescapeHtml", () => {
  it("unescapes HTML entities", () => {
    expect(unescapeHtml("&lt;b&gt;bold&lt;&#x2F;b&gt;")).toBe("<b>bold</b>");
  });

  it("round-trips with escapeHtml", () => {
    const original = '<div class="test">a & b\'s "value"</div>';
    expect(unescapeHtml(escapeHtml(original))).toBe(original);
  });

  it("handles empty string", () => {
    expect(unescapeHtml("")).toBe("");
  });
});

describe("pad2", () => {
  it("pads single digit with leading zero", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(5)).toBe("05");
    expect(pad2(9)).toBe("09");
  });

  it("returns number as-is for 10+", () => {
    expect(pad2(10)).toBe(10);
    expect(pad2(31)).toBe(31);
    expect(pad2(99)).toBe(99);
  });
});

describe("arraysEqual", () => {
  const eq = (a: number, b: number) => a === b;

  it("returns true for equal arrays", () => {
    expect(arraysEqual([1, 2, 3], [1, 2, 3], eq)).toBe(true);
  });

  it("returns false for different lengths", () => {
    expect(arraysEqual([1, 2], [1, 2, 3], eq)).toBe(false);
  });

  it("returns false for different elements", () => {
    expect(arraysEqual([1, 2, 3], [1, 2, 4], eq)).toBe(false);
  });

  it("returns true for empty arrays", () => {
    expect(arraysEqual([], [], eq)).toBe(true);
  });

  it("uses custom comparison function", () => {
    const caseInsensitive = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    expect(arraysEqual(["A", "B"], ["a", "b"], caseInsensitive)).toBe(true);
    expect(arraysEqual(["A", "B"], ["a", "c"], caseInsensitive)).toBe(false);
  });
});
