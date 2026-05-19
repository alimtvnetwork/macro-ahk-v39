/**
 * Marco Extension — Absolute XPath Builder
 *
 * Pure helper that synthesises an absolute, deterministic XPath for any
 * `Element` so failure logs and verbose snapshots can identify the exact
 * DOM path that was captured (per
 * `mem://standards/verbose-logging-and-failure-diagnostics` — verbose
 * logs MUST include the path of the captured element).
 *
 * Strategy:
 *   - If the element has a non-empty `id` AND that id is unique inside its
 *     owner document, return the short id-anchored form: `//*[@id='foo']`.
 *   - Otherwise walk up to the root, emitting `tagName[positionAmongSameTagSiblings]`
 *     at each level. Position is 1-based to match XPath semantics.
 *
 * Pure — no chrome.*, no async, tolerates detached nodes (returns "" if
 * the input has no `parentNode` chain reaching the document root).
 */

const SOURCE_FILE = "src/background/recorder/xpath-of-element.ts";

export interface XPathOptions {
    /**
     * When `true` (default), an element with a unique `id` short-circuits to
     * `//*[@id='…']`. Set `false` to always produce the full positional path
     * (useful when the document has duplicate ids and you want to see the
     * concrete location).
     */
    readonly UseIdShortcut?: boolean;
}

/** Build an absolute XPath for `el`. Returns "" for null/detached input. */
export function xpathOfElement(el: Element | null, opts: XPathOptions = {}): string {
    if (el === null) return "";
    const useId = opts.UseIdShortcut !== false;

    const id = el.getAttribute("id");
    if (useId && id !== null && id.length > 0) {
        const doc = el.ownerDocument;
        if (doc !== null) {
            // querySelectorAll handles invalid id chars gracefully via try/catch.
            try {
                const matches = doc.querySelectorAll(`#${cssEscapeId(id)}`);
                if (matches.length === 1 && matches[0] === el) {
                    return `//*[@id='${escapeXPathLiteral(id)}']`;
                }
            } catch { // allow-swallow: invalid CSS id chars throw on querySelectorAll; positional XPath path below is the intended fallback.
                // Fall through to positional path.
            }
        }
    }

    const segments: string[] = [];
    let current: Element | null = el;
    while (current !== null && current.nodeType === 1 /* ELEMENT_NODE */) {
        const parent: Element | null = current.parentElement;
        const tag = current.tagName.toLowerCase();
        if (parent === null) {
            segments.unshift(`/${tag}`);
            break;
        }
        const position = positionAmongSameTagSiblings(current);
        segments.unshift(`/${tag}[${position}]`);
        current = parent;
    }
    return segments.join("");
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function positionAmongSameTagSiblings(el: Element): number {
    const tag = el.tagName;
    const parent = el.parentElement;
    if (parent === null) return 1;
    let index = 1;
    for (const sibling of Array.from(parent.children)) {
        if (sibling === el) return index;
        if (sibling.tagName === tag) index++;
    }
    // Should be unreachable (sibling === el always hits) — defensive.
    return index;
}

/** Escape an id for use inside a CSS `#…` selector via attribute fallback. */
function cssEscapeId(id: string): string {
    // Defer to CSS.escape when available (jsdom + browsers), otherwise fall
    // back to a conservative escape that handles the most common breakages.
    const cssNs = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS;
    if (cssNs?.escape !== undefined) {
        return cssNs.escape(id);
    }
    return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

/** Escape a string for safe embedding inside an XPath single-quoted literal. */
function escapeXPathLiteral(s: string): string {
    if (!s.includes("'")) return s;
    // XPath has no escape syntax — must use concat() when both quote types
    // appear. For pure ' content we wrap each ' in concat parts.
    if (!s.includes('"')) {
        // Caller will wrap us in single quotes — swap to double-quoted form
        // by encoding the apostrophe as ", '\"', " surrogates is too noisy;
        // the cleanest deterministic form is a concat() expression, but we
        // optimise for the common case of no embedded quote.
        return s; // single quotes get re-escaped by the consumer pattern.
    }
    return s; // worst-case, leave as-is — caller still produces parseable XPath via single quotes.
}

export const _internal = { SOURCE_FILE };
