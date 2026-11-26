import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../../src/markdown.ts";

test("about pages: blocks and inline markup", () => {
  const out = renderMarkdown("# Title\n\nSome **bold**, *em* and `x < y`.\n\n- one\n- two\n  wrapped\n\n1. first\n\n> quoted\n\n```\na <b>\n```");
  assert.equal(
    out,
    [
      "<h2>Title</h2>",
      "<p>Some <strong>bold</strong>, <em>em</em> and <code>x &#60; y</code>.</p>",
      "<ul><li>one</li><li>two wrapped</li></ul>",
      "<ol><li>first</li></ol>",
      "<blockquote><p>quoted</p></blockquote>",
      "<pre><code>a &#60;b&#62;</code></pre>",
    ].join("\n"),
  );
});

test("about pages: no HTML and only http(s) links", () => {
  assert.equal(renderMarkdown('<script>alert(1)</script> <img src=x onerror="y">'), "<p>&#60;script&#62;alert(1)&#60;/script&#62; &#60;img src=x onerror=&#34;y&#34;&#62;</p>");
  assert.equal(renderMarkdown("[a](https://x.test/?a=1&b=2)"), '<p><a href="https://x.test/?a=1&#38;b=2" rel="nofollow noopener">a</a></p>');
  assert.equal(renderMarkdown("[a](javascript:alert(1))"), "<p>[a](javascript:alert(1))</p>");
  assert.equal(renderMarkdown('[a](https://x.test/"onmouseover="y)'), '<p><a href="https://x.test/&#34;onmouseover=&#34;y" rel="nofollow noopener">a</a></p>');
  assert.equal(renderMarkdown("snake_case_name"), "<p>snake_case_name</p>");
});

test("about pages: adversarial input renders in linear time", () => {
  const n = 64 * 1024;
  for (const src of ["[".repeat(n), "[a](https://".repeat(n / 12), "*".repeat(n), "**a".repeat(n / 3), "_a".repeat(n / 2), "`".repeat(n - 1)]) {
    const start = performance.now();
    renderMarkdown(src);
    const ms = performance.now() - start;
    assert.ok(ms < 250, `${JSON.stringify(src.slice(0, 12))}… took ${ms.toFixed(0)} ms`);
  }
  // Links still work, and one with text over the bound is left as text.
  assert.equal(renderMarkdown("[a](https://x.test)"), '<p><a href="https://x.test" rel="nofollow noopener">a</a></p>');
  assert.equal(renderMarkdown(`[${"a".repeat(201)}](https://x.test)`), `<p>[${"a".repeat(201)}](https://x.test)</p>`);
});
