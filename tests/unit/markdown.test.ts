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
