// docs.md, the whole reference as one file, cut back into the sections it was
// made of, for `vatio docs search`. site/src/docs/contract.mjs writes it:
//
//   ## Tab                    (Documentation, CLI, SDK, API Reference)
//   ### Page title
//   `https://vatio.ai/docs/page`
//   #### A heading of the page (its ##, demoted by two), and so on down
//
// A section runs from one heading to the next, and knows its heading path and
// the URL of the page it is on, with the heading's anchor.

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{2,6})\s+(.*?)\s*$/;
const PAGE_URL = /^`(https?:\/\/[^`\s]+)`$/;
const CUSTOM_ID = /\s*\{#([\w-]+)\}\s*$/;

export function sectionsOf(markdown) {
  const lines = markdown.split("\n");
  const sections = [];
  let tab = null;
  let page = null;
  let trail = [];
  let section = null;
  let fenced = false;

  const open = (headings, anchor) => {
    section = {
      path: [tab, page?.title, ...headings].filter(Boolean),
      url: page ? (anchor ? `${page.url}#${anchor}` : page.url) : null,
      lines: []
    };
    sections.push(section);
  };

  lines.forEach((text, index) => {
    const number = index + 1;
    if (FENCE.test(text)) fenced = !fenced;
    const heading = fenced ? null : HEADING.exec(text);

    if (heading) {
      const level = heading[1].length;
      const title = heading[2].replace(CUSTOM_ID, "");
      if (level === 2) {
        tab = title;
        page = null;
        trail = [];
        open([], null);
      } else if (level === 3) {
        page = { title, url: null, used: new Set([slugify(plain(title))]) };
        trail = [];
        open([], null);
      } else {
        // A page's own ## is #### here.
        const depth = level - 4;
        trail = [...trail.slice(0, depth), plain(title)];
        open(trail, page ? anchorFor(heading[2], page.used) : null);
      }
      section.lines.push({ number, text });
      return;
    }

    if (page && page.url === null && PAGE_URL.test(text.trim())) {
      page.url = PAGE_URL.exec(text.trim())[1];
      section.url = page.url;
      return;
    }
    section?.lines.push({ number, text });
  });

  return sections.filter((row) => row.url !== null);
}

// What `vatio docs PAGE` takes for a page URL: "tools", "cli/chat", "cli" for
// cli/, "index" for the introduction.
export function pageArgument(url) {
  const path = String(url).replace(/#.*$/, "").replace(/^.*?\/docs\//, "");
  if (path === "") return "index";
  return path.replace(/\/$/, "");
}

// The heading ids the site gives (site/src/plugins/rehype-docs.mjs): an
// explicit {#id}, or the text lowercased with accents folded and every run of
// anything else as one hyphen, -1, -2 on a repeat.
function anchorFor(raw, used) {
  const custom = CUSTOM_ID.exec(raw);
  if (custom) {
    used.add(custom[1]);
    return custom[1];
  }
  const slug = slugify(plain(raw));
  let id = slug;
  for (let i = 1; used.has(id); i++) id = `${slug}-${i}`;
  used.add(id);
  return id;
}

// A heading's text as the page shows it: no backticks, emphasis or link
// targets.
function plain(heading) {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .trim();
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
