// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import indexSrc from '../../../plugins-available/barcode-desk/index.mjs?raw';
import manifestSrc from '../../../plugins-available/barcode-desk/plugin.json?raw';
import { PluginHost, memoryCapabilities, type Bundle, type Loader, type Store } from './pluginHost';

const read = (f: string) => (f === 'plugin.json' ? manifestSrc : indexSrc);
const loader: Loader = code => import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const memory = (): Store => { let all: Record<string, Bundle> = {}; return { read: () => all, write: a => { all = a; } }; };
// The sha is not checked by install() — parseBundle does that — so a plain object is enough here.
const bundle = (): Bundle => ({ format: 'plugin-bundle/1', manifest: JSON.parse(read('plugin.json')), files: { 'plugin.json': read('plugin.json'), 'index.mjs': read('index.mjs') }, sha256: '' });

async function open(extra: Partial<ReturnType<typeof memoryCapabilities>> & Record<string, unknown> = {}) {
  const caps = { ...memoryCapabilities(), ...extra };
  const host = new PluginHost(memory(), loader, caps);
  await host.install(bundle());
  const el = document.createElement('div');
  document.body.append(el);
  const close = host.mountScreen('barcode-desk', 'desk', el);
  const q = <T extends Element>(sel: string) => el.querySelector(sel) as T;
  const click = (sel: string) => q<HTMLElement>(sel).click();
  const pickCur = (c: string) => { const sel = q<HTMLSelectElement>('[data-f=cur]'); sel.value = c; sel.dispatchEvent(new Event('change')); };
  const type = (sel: string, v: string) => { const i = q<HTMLInputElement>(sel); i.value = v; i.dispatchEvent(new Event('input')); };
  return { host, el, close, q, click, type, pickCur, caps };
}

describe('Barcode Desk screen', () => {
  it('is offered as a screen', async () => {
    const { host } = await open();
    expect(host.screens()).toEqual([{ pluginId: 'barcode-desk', id: 'desk', title: 'Barcode Desk', icon: '🏷️' }]);
  });

  it('adds a product with a price and a valid EAN-13 code, then deletes it in two taps', async () => {
    const { el, q, click, type, pickCur } = await open();
    type('[data-f=name]', 'Bread'); type('[data-f=price]', '٢٫٥٠'); pickCur('SAR');   // Arabic digits are fine
    click('[data-act=add]');
    const item = q<HTMLElement>('[data-code]');
    expect(item.textContent).toContain('Bread');
    expect(item.textContent).toContain('2.50 SAR');
    expect(item.querySelector('.barbox svg')).not.toBeNull();   // big barcode on its own line
    expect(item.querySelector('.acts [data-act=edit]')).not.toBeNull();   // edit + delete under it
    const code = item.dataset.code!;
    expect(code).toMatch(/^2\d{12}$/);
    expect(item.querySelector('svg')).not.toBeNull();
    click('[data-act=del]');                 // first tap asks «Sure?»
    expect(el.querySelector('[data-code]')).not.toBeNull();
    click('[data-act=del]');                 // second tap deletes
    expect(el.querySelector('[data-code]')).toBeNull();
  });

  it('refuses an empty name or a bad price', async () => {
    const { el, click, type } = await open();
    click('[data-act=add]');
    expect(el.querySelector('.toast')!.textContent).toBe('Enter a name.');
    type('[data-f=name]', 'Milk'); type('[data-f=price]', 'abc'); click('[data-act=add]');
    expect(el.querySelector('.toast')!.textContent).toBe('Enter a valid price.');
    expect(el.querySelector('[data-code]')).toBeNull();
  });

  it('counts scans per product and marks unknown codes «not known»', async () => {
    const { el, q, click, type, pickCur } = await open();
    type('[data-f=name]', 'Bread'); type('[data-f=price]', '2'); pickCur('SAR'); click('[data-act=add]');
    const code = q<HTMLElement>('[data-code]').dataset.code!;
    click('[data-tab=scan]');
    for (let i = 0; i < 3; i++) { type('[data-f=typed]', code); click('[data-act=go]'); }
    expect(q('[data-last]').getAttribute('data-last')).toBe('ok');
    expect(q('[data-row] td').textContent).toBe('Bread');
    expect(q('[data-row] td.n').textContent).toBe('× 3');
    type('[data-f=typed]', '4006381333931'); click('[data-act=go]');
    expect(q('[data-last]').getAttribute('data-last')).toBe('bad');
    expect(q('[data-unknown]').textContent).toContain('not known');
    expect(q('[data-stat=scanned]').textContent).toBe('3');
    expect(q('[data-stat=unknown]').textContent).toBe('1');
    expect(el.textContent).toContain('6.00 SAR');       // 3 × 2.00
  });

  it('prints the selected labels through the host, in the chosen font and language', async () => {
    const print = vi.fn(async () => {});
    const { q, click, type } = await open({ print, fontCss: async () => '/*font*/' });
    type('[data-f=name]', 'خبز'); type('[data-f=price]', '1'); click('[data-act=add]');
    click('[data-act=print]');
    await vi.waitFor(() => expect(print).toHaveBeenCalled());
    const [html] = print.mock.calls[0] as unknown as [string];
    expect(html).toContain('خبز');
    expect(html).toContain('/*font*/');
    expect(html).toContain('<svg');
    expect(html).toContain('repeat(3,1fr)');
    expect(q('[data-tab=scan]')).not.toBeNull();
  });

  it('runs a scan loop from the host scanner until the person backs out', async () => {
    const codes: (string | null)[] = [];
    const scan = vi.fn(async () => (codes.length ? codes.shift()! : null));
    const { q, click, type } = await open({ scan });
    type('[data-f=name]', 'Tea'); type('[data-f=price]', '3'); click('[data-act=add]');
    const code = q<HTMLElement>('[data-code]').dataset.code!;
    codes.push(code, '123');
    click('[data-tab=scan]'); click('[data-act=scan]');
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(3), { timeout: 4000 });   // 2 codes + the back-out
    await vi.waitFor(() => expect(q('[data-unknown]')).not.toBeNull());
    expect(q('[data-row] td.n').textContent).toBe('× 1');
  });

  it('has no scan button without a scanner, but still accepts typed codes', async () => {
    const { el, click } = await open();
    click('[data-tab=scan]');
    expect(el.querySelector('[data-act=scan]')).toBeNull();
    expect(el.textContent).toContain('No camera scanner here');
  });

  it('customises: language, default currency and accent from the Settings tab', async () => {
    const { el, q, click, type } = await open();
    click('[data-tab=settings]');
    const lang = q<HTMLSelectElement>('[data-s=lang]'); lang.value = 'no'; lang.dispatchEvent(new Event('change'));
    expect(el.querySelector('[data-tab=products]')!.getAttribute('aria-label')).toBe('Varer');
    const cur = q<HTMLSelectElement>('[data-s=currency]'); cur.value = 'USD'; cur.dispatchEvent(new Event('change'));
    expect(q<HTMLElement>('.bd').style.getPropertyValue('--bd-accent')).toBe('#1b5e20');
    click('[data-tab=products]');
    type('[data-f=name]', 'Brød'); type('[data-f=price]', '150'); click('[data-act=add]');
    expect(q<HTMLElement>('[data-code]').textContent).toContain('150.00 USD');
    const ar = (click('[data-tab=settings]'), q<HTMLSelectElement>('[data-s=lang]')); ar.value = 'ar'; ar.dispatchEvent(new Event('change'));
    expect(q<HTMLElement>('.bd').dir).toBe('rtl');
  });

  it('lets each product choose SAR, YER or USD, and totals each currency separately', async () => {
    const { el, q, click, type } = await open();
    const add = (name: string, price: string, cur: string) => { type('[data-f=name]', name); type('[data-f=price]', price); const sel = q<HTMLSelectElement>('[data-f=cur]'); sel.value = cur; sel.dispatchEvent(new Event('change')); click('[data-act=add]'); };
    add('Tea', '5', 'USD'); add('Rice', '1000', 'YER');
    const codes = [...el.querySelectorAll<HTMLElement>('[data-code]')].map(e => e.dataset.code!);   // newest first: Rice, Tea
    expect(el.textContent).toContain('5.00 USD'); expect(el.textContent).toContain('1,000 YER');
    click('[data-tab=scan]');
    for (const c of [codes[0], codes[0], codes[1]]) { type('[data-f=typed]', c); click('[data-act=go]'); }
    expect(q('[data-stat=value]').textContent).toBe('2,000 YER\n5.00 USD');
  });

  it('keeps products and counts across closing and reopening (storage)', async () => {
    const caps = memoryCapabilities();
    const host = new PluginHost(memory(), loader, caps);
    await host.install(bundle());
    const el = document.createElement('div');
    const close = host.mountScreen('barcode-desk', 'desk', el);
    (el.querySelector('[data-f=name]') as HTMLInputElement).value = 'Rice';
    el.querySelector('[data-f=name]')!.dispatchEvent(new Event('input'));
    (el.querySelector('[data-f=price]') as HTMLInputElement).value = '9';
    el.querySelector('[data-f=price]')!.dispatchEvent(new Event('input'));
    (el.querySelector('[data-act=add]') as HTMLElement).click();
    close();
    const el2 = document.createElement('div');
    host.mountScreen('barcode-desk', 'desk', el2);
    expect(el2.textContent).toContain('Rice');
  });
});

describe('Barcode Desk — currency drop-down', () => {
  it('offers YER, SAR and USD in one drop-down, YER first and selected', async () => {
    const { q, click, type } = await open();
    const sel = q<HTMLSelectElement>('[data-f=cur]');
    expect([...sel.options].map(o => o.value)).toEqual(['YER', 'SAR', 'USD']);
    expect(sel.value).toBe('YER');
    type('[data-f=name]', 'Bread'); type('[data-f=price]', '300'); click('[data-act=add]');
    expect(q<HTMLElement>('[data-code]').textContent).toContain('300 YER');
  });
});

describe('Barcode Desk — share as PDF', () => {
  it('buildPdf makes a valid multi-page PDF (header, page count, correct xref offsets)', async () => {
    const mod = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(indexSrc).toString('base64')}`);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const pdf: Uint8Array = mod.buildPdf([{ jpeg, w: 10, h: 10 }, { jpeg, w: 10, h: 10 }]);
    const text = Buffer.from(pdf).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // every xref entry must point exactly at its "N 0 obj"
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    const entries = text.slice(xrefAt).split('\n').filter(l => /^\d{10} 00000 n/.test(l));
    expect(entries.length).toBe(8);
    entries.forEach((l, i) => expect(text.slice(Number(l.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it('shares the selected labels as a PDF through the host', async () => {
    const proxy = new Proxy({}, { get: () => () => ({ width: 10 }), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(proxy as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,/9j/2Q==');
    const share = vi.fn(async () => {});
    const { click, type } = await open({ share });
    type('[data-f=name]', 'Bread'); type('[data-f=price]', '2'); click('[data-act=add]');
    click('[data-act=share]');
    await vi.waitFor(() => expect(share).toHaveBeenCalled());
    const [filename, b64, mime] = share.mock.calls[0] as unknown as [string, string, string];
    expect(filename).toMatch(/^labels-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(mime).toBe('application/pdf');
    expect(atob(b64).startsWith('%PDF-1.4')).toBe(true);
    vi.restoreAllMocks();
  });

  it('says so when the host cannot share', async () => {
    const { el, click, type } = await open();
    type('[data-f=name]', 'Bread'); type('[data-f=price]', '2'); click('[data-act=add]');
    click('[data-act=share]');
    expect(el.querySelector('.toast')!.textContent).toBe('Sharing is not available here.');
  });
});
