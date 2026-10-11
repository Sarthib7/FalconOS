import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const deckPath = new URL('../docs/pitches/falcon-investor-deck.html', import.meta.url);
const publishedDeckPath = new URL('../web/goal/public/index.html', import.meta.url);
const publishedAssetsPath = new URL('../web/goal/public/assets/', import.meta.url);

test('goal site publishes the source deck and every local asset', async () => {
  const [source, published] = await Promise.all([
    readFile(deckPath, 'utf8'),
    readFile(publishedDeckPath, 'utf8'),
  ]);
  assert.equal(published, source, 'published page matches the investor deck source');

  const refs = new Set();
  for (const match of source.matchAll(/(?:src|href)="assets\/([^"]+)"|url\("assets\/([^"]+)"\)/g)) {
    refs.add(match[1] ?? match[2]);
  }
  assert.ok(refs.size > 0, 'deck references local assets');
  await Promise.all([...refs].map(name => access(new URL(name, publishedAssetsPath))));
});

test('investor deck sliders and reserve stress cases calculate cash limits', async () => {
  const html = await readFile(deckPath, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'deck script exists');

  const elements = new Map<string, any>();
  const makeElement = (value = '') => ({
    value,
    textContent: '',
    style: {},
    listeners: new Map<string, (event: any) => void>(),
    classList: { toggle() {} },
    matches: () => false,
    addEventListener(name: string, listener: (event: any) => void) {
      this.listeners.set(name, listener);
    },
  });
  for (const [id, value] of Object.entries({
    counter: '', progress: '', prev: '', next: '', notesToggle: '',
    cashSlider: '2400000', obligationsSlider: '650000', reserveSlider: '750000',
    cashValue: '', obligationsValue: '', reserveValue: '', availableValue: '', decisionState: '',
    baseAvailable: '', baseStatus: '', invoiceAvailable: '', invoiceStatus: '',
    cashDropAvailable: '', cashDropStatus: '', reserveRiseAvailable: '', reserveRiseStatus: '', stressSummary: '',
  })) elements.set(id, makeElement(value));

  const slides = Array.from({ length: 12 }, () => ({ classList: { toggle() {} } }));
  let keydown: ((event: any) => void) | undefined;
  const document = {
    title: '',
    querySelectorAll: () => slides,
    getElementById: (id: string) => elements.get(id)!,
    addEventListener: (_name: string, listener: (event: any) => void) => { keydown = listener; },
  };
  const history = { replaceState() {} };
  const location = { hash: '#6' };
  runInNewContext(script, { document, history, location });

  const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
  assert.equal(elements.get('availableValue')!.textContent, formatted.format(1_000_000));
  assert.equal(elements.get('decisionState')!.textContent, 'READY TO ALLOCATE');
  assert.equal(elements.get('baseAvailable')!.textContent, `${formatted.format(1_000_000)} available`);
  assert.equal(elements.get('baseStatus')!.textContent, 'ALLOW $1M');
  assert.equal(elements.get('invoiceAvailable')!.textContent, `${formatted.format(600_000)} available`);
  assert.equal(elements.get('invoiceStatus')!.textContent, 'BLOCK $400K short');
  assert.equal(elements.get('cashDropAvailable')!.textContent, `${formatted.format(500_000)} available`);
  assert.equal(elements.get('cashDropStatus')!.textContent, 'BLOCK $500K short');
  assert.equal(elements.get('reserveRiseAvailable')!.textContent, `${formatted.format(750_000)} available`);
  assert.equal(elements.get('reserveRiseStatus')!.textContent, 'BLOCK $250K short');
  assert.equal(elements.get('stressSummary')!.textContent, '1 of 4 cases allow the $1M allocation. 3 stress cases block it.');

  elements.get('cashSlider')!.value = '500000';
  elements.get('obligationsSlider')!.value = '1800000';
  elements.get('reserveSlider')!.value = '1500000';
  elements.get('cashSlider')!.listeners.get('input')!({});
  assert.equal(elements.get('availableValue')!.textContent, formatted.format(0));
  assert.equal(elements.get('decisionState')!.textContent, 'HOLD CASH');

  let prevented = false;
  elements.get('cashSlider')!.matches = (selector: string) => selector === 'input[type="range"]';
  keydown!({ target: elements.get('cashSlider'), key: 'ArrowRight', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false, 'arrow keys remain available to the range control');
});
