import type { Page } from "@playwright/test";

// A theme audit finding: one visible surface or text run that breaks the theme rules.
export interface Finding {
  kind: "white-fill" | "ink-fill" | "contrast";
  screen: string;
  theme: "light" | "dark";
  selector: string;
  text: string;
  detail: string;
}

// Sample the rendered page: no white fills in dark, no ink fills in light, and readable text everywhere.
// The rules come from the design brief (section 1); the audit reports offenders by selector.
export async function auditTheme(
  page: Page,
  theme: "light" | "dark",
  screen: string,
): Promise<Finding[]> {
  return page.evaluate(
    ({ theme, screen }) => {
      const findings: Finding[] = [];
      const seen = new Set<string>();

      // Resolve a CSS custom property the way a component would, through a probe element.
      const probe = document.createElement("span");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      document.body.append(probe);
      const token = (name: string) => {
        probe.style.color = `var(${name})`;
        return getComputedStyle(probe).color;
      };
      const ink = token("--gd-ink");
      probe.remove();

      type Rgba = { r: number; g: number; b: number; a: number };
      const parse = (value: string): Rgba | null => {
        const m = value.match(
          /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/,
        );
        if (!m) return null;
        return {
          r: +m[1],
          g: +m[2],
          b: +m[3],
          a: m[4] === undefined ? 1 : +m[4],
        };
      };
      const same = (a: string, b: string) => {
        const x = parse(a),
          y = parse(b);
        return (
          !!x &&
          !!y &&
          Math.abs(x.r - y.r) < 1 &&
          Math.abs(x.g - y.g) < 1 &&
          Math.abs(x.b - y.b) < 1
        );
      };
      // WCAG relative luminance and contrast ratio.
      const lum = ({ r, g, b }: Rgba) => {
        const ch = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
      };
      const ratio = (a: Rgba, b: Rgba) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const mix = (front: Rgba, back: Rgba): Rgba => ({
        r: front.r * front.a + back.r * (1 - front.a),
        g: front.g * front.a + back.g * (1 - front.a),
        b: front.b * front.a + back.b * (1 - front.a),
        a: 1,
      });

      const selector = (el: Element) => {
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && node !== document.body && parts.length < 5) {
          const name = node.tagName.toLowerCase();
          if (name === "html" || name === "body") break;
          const classes = [...node.classList].slice(0, 2).join(".");
          parts.unshift(
            `${name}${node.id ? `#${node.id}` : ""}${classes ? `.${classes}` : ""}`,
          );
          node = node.parentElement;
        }
        return `body>${parts.join(">")}`;
      };

      const visible = (el: Element) => {
        const check = (
          el as Element & {
            checkVisibility?: (o?: {
              checkOpacity?: boolean;
              checkVisibilityCSS?: boolean;
            }) => boolean;
          }
        ).checkVisibility;
        if (check && !check.call(el, { checkOpacity: true, checkVisibilityCSS: true }))
          return false;
        const style = getComputedStyle(el);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0.05
        );
      };

      // The nearest background actually painted behind the element, walking up the tree.
      // Gradients and images are reported as unknown so a picture is never read as a colour.
      const background = (el: Element): Rgba | "unknown" => {
        let node: Element | null = el;
        const stack: Rgba[] = [];
        while (node) {
          const style = getComputedStyle(node);
          if (style.backgroundImage && style.backgroundImage !== "none")
            return "unknown";
          const bg = parse(style.backgroundColor);
          if (bg && bg.a > 0) {
            stack.push(bg);
            if (bg.a >= 1) {
              return stack
                .slice(0, -1)
                .reduceRight((back, front) => mix(front, back), bg);
            }
          }
          node = node.parentElement;
        }
        // An element with no opaque ancestor sits on the page canvas, which is white.
        return stack.reduceRight(
          (back, front) => mix(front, back),
          { r: 255, g: 255, b: 255, a: 1 },
        );
      };

      const add = (finding: Finding) => {
        const key = `${finding.kind}|${finding.selector}|${finding.text}`;
        if (seen.has(key)) return;
        seen.add(key);
        findings.push(finding);
      };

      for (const el of document.body.querySelectorAll("*")) {
        if (!visible(el)) continue;
        // SVG text uses fill, not colour, so it is audited by its own component rules.
        if (el.closest("svg")) continue;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const bg = parse(style.backgroundColor);
        const label = (el.textContent ?? "").trim().replace(/\s+/g, " ");

        // Rule 1: large surfaces never use the forbidden fill for the theme.
        if (
          rect.width >= 60 &&
          rect.height >= 24 &&
          bg &&
          bg.a >= 1 &&
          ((theme === "dark" && same(style.backgroundColor, "rgb(255, 255, 255)")) ||
            (theme === "light" && same(style.backgroundColor, ink)))
        ) {
          add({
            kind: theme === "dark" ? "white-fill" : "ink-fill",
            screen,
            theme,
            selector: selector(el),
            text: label.slice(0, 60),
            detail: `background ${style.backgroundColor}`,
          });
        }

        // Rule 2: every visible text run is readable against its nearest opaque background.
        const direct = [...el.childNodes].some(
          (n) =>
            n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
        );
        if (!direct) continue;
        if (el.closest("[aria-hidden=true], .visually-hidden, .gd-visually-hidden"))
          continue;
        const color = parse(style.color);
        if (!color || color.a <= 0) continue;
        const back = background(el);
        if (back === "unknown") continue;
        const text = [...el.childNodes]
          .filter(
            (n) =>
              n.nodeType === Node.TEXT_NODE &&
              (n.textContent ?? "").trim() !== "",
          )
          .map((n) => (n.textContent ?? "").trim())
          .join(" ")
          .slice(0, 60);
        const front = color.a < 1 ? mix(color, back) : color;
        const size = parseFloat(style.fontSize);
        const need = size >= 24 ? 3 : 4.5;
        const got = ratio(front, back);
        if (got + 0.01 < need)
          add({
            kind: "contrast",
            screen,
            theme,
            selector: selector(el),
            text,
            detail: `${got.toFixed(2)}:1 (needs ${need}:1) ${style.color} on rgb(${Math.round(back.r)}, ${Math.round(back.g)}, ${Math.round(back.b)}), ${style.fontSize}`,
          });
      }
      return findings;
    },
    { theme, screen },
  );
}
