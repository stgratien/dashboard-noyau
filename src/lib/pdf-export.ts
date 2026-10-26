/** Browser-only exports. Capture isolated light-theme clones, never change the live page. */
import { client } from './client';

export function pdfFileName(tab: string, periodName: string) {
  const clean = (v: string) => v.normalize('NFC').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-');
  return `${client.brand.exportFileBase}_${clean(tab)}_${clean(periodName)}.pdf`;
}

const WHITE = '#ffffff';
const exportFilter = (node: Node) => !(node instanceof HTMLElement && node.hasAttribute('data-export-hide'));
const twoFrames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export function exportContainer(width: number, height?: number) {
  const frame = document.createElement('div');
  frame.className = 'export-light';
  frame.setAttribute('data-export-clone', '');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;${height ? `height:${height}px;` : ''}opacity:1;visibility:visible;background:${WHITE};color:var(--foreground);font-family:Roboto,sans-serif;box-sizing:border-box;pointer-events:none;`;
  document.body.append(frame);
  return frame;
}

/** SVG charts are already rendered: freeze their geometry instead of asking React to measure an off-screen clone. */
function cloneForExport(source: HTMLElement) {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  clone.querySelectorAll('[data-export-hide]').forEach(node => node.remove());
  clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  const originals = [...source.querySelectorAll<HTMLElement>('.recharts-responsive-container')];
  clone.querySelectorAll<HTMLElement>('.recharts-responsive-container').forEach((container, i) => {
    const original = originals[i];
    if (!original) return;
    const { width, height } = original.getBoundingClientRect();
    container.style.width = '100%';
    container.style.height = `${height}px`;
    container.style.minWidth = '0';
    const wrapper = container.querySelector<HTMLElement>('.recharts-wrapper');
    if (wrapper) { wrapper.style.width = '100%'; wrapper.style.height = `${height}px`; }
    const svg = container.querySelector<SVGSVGElement>('svg.recharts-surface');
    if (svg) {
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', String(height));
    }
  });
  return clone;
}

async function ready(frame: HTMLElement) {
  await document.fonts.ready;
  await Promise.all([...frame.querySelectorAll('img')].map(image => image.decode().catch(() => undefined)));
  await twoFrames();
}

const captureOptions = (width: number, height: number) => ({
  width, height, pixelRatio: 2, backgroundColor: WHITE, cacheBust: true, filter: exportFilter,
  // html-to-image must not carry the off-screen position into its SVG foreignObject.
  style: { position: 'relative', left: '0', top: '0', margin: '0', opacity: '1', visibility: 'visible', transform: 'none' },
});

/**
 * CSS des polices web (Roboto : la seule police chargée) à passer en `fontEmbedCSS` des captures du rapport, calculé UNE fois pour tout l'hôte.
 * Sans lui, html-to-image refait ce travail à chaque capture : la feuille Google Fonts, sans attribut crossorigin, est illisible pour lui, il retélécharge
 * donc chaque fichier de police et insère de nouveau les règles @font-face dans la page, que la capture suivante relit : la n-ième capture embarque n jeux de polices.
 * Les copies déjà insérées (par une génération ou un export précédent) sont dédoublonnées. Rend `undefined` (rien n'est gardé) si le calcul échoue, dépasse 20 s
 * ou ne donne aucune police : chaque capture fait alors ce qu'elle faisait avant. Jamais une chaîne vide : html-to-image la prendrait pour « aucune police ».
 */
let reportFontCache: string | undefined;
export async function reportFontCss(host: HTMLElement): Promise<string | undefined> {
  if (reportFontCache) return reportFontCache;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { getFontEmbedCSS } = await import('html-to-image');
    const css = await Promise.race([getFontEmbedCSS(host, {}), new Promise<string>((resolve) => { timer = setTimeout(() => resolve(''), 20_000); })]);
    const unique = [...new Set(css.split(/(?=@font-face)/).map((rule) => rule.trim()).filter(Boolean))].join('\n');
    if (!unique.includes('@font-face')) return undefined;
    reportFontCache = unique;
    return unique;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Capture directe d'un bloc déjà rendu dans un hôte isolé (rapport Google Slides) : pas de clone, la géométrie des graphiques est celle du bloc. `fontEmbedCSS` : voir reportFontCss. */
export async function captureRenderedBlock(el: HTMLElement, fontEmbedCSS?: string) {
  const { toBlob } = await import('html-to-image');
  const { width, height } = el.getBoundingClientRect();
  const blob = await toBlob(el, { ...captureOptions(Math.ceil(width), Math.ceil(height)), ...(fontEmbedCSS ? { fontEmbedCSS } : {}) });
  if (!blob) throw new Error('Image indisponible');
  return blob;
}

export async function exportDashboardPdf({ tab, periodName, periodLine, logoUrl }: { tab: string; periodName: string; periodLine: string; logoUrl: string }) {
  const [{ jsPDF }, { toPng }] = await Promise.all([import('jspdf'), import('html-to-image')]);
  const container = document.getElementById('dashboard-export');
  if (!container) throw new Error('Contenu introuvable');
  const width = Math.max(960, container.clientWidth - 48);
  const frame = exportContainer(width);
  try {
    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 0;display:flex;align-items:center;gap:12px';
    const logo = document.createElement('img');
    logo.crossOrigin = 'anonymous'; logo.src = logoUrl; logo.style.height = '36px';
    const text = document.createElement('div');
    text.innerHTML = '<div style="font-size:18px;font-weight:500"></div><div style="font-size:12px;color:var(--muted-foreground)"></div>';
    (text.children[0] as HTMLElement).textContent = `${client.brand.exportTitle} — ${tab}`;
    (text.children[1] as HTMLElement).textContent = periodLine;
    header.append(logo, text);
    const blocks = [...container.querySelectorAll<HTMLElement>('[data-export-block]')].filter(el => !el.parentElement?.closest('[data-export-block]') && !el.hasAttribute('data-export-hide'));
    const shots: { url: string; w: number; h: number }[] = [];
    for (const source of [header, ...blocks]) {
      frame.replaceChildren(source === header ? header : cloneForExport(source));
      await ready(frame);
      const height = Math.ceil(frame.getBoundingClientRect().height);
      shots.push({ url: await toPng(frame, captureOptions(width, height)), w: width, h: height });
    }
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = 297, pageH = 210, margin = 10, gap = 4, usable = pageW - margin * 2;
    let y = margin;
    shots.forEach((shot, i) => {
      let w = usable, h = shot.h * usable / shot.w;
      const maxH = pageH - margin * 2;
      if (h > maxH) { w = w * maxH / h; h = maxH; }
      if (i > 0 && y + h > pageH - margin) { pdf.addPage(); y = margin; }
      pdf.addImage(shot.url, 'PNG', margin, y, w, h);
      y += h + gap;
    });
    pdf.save(pdfFileName(tab, periodName));
  } finally { frame.remove(); }
}
