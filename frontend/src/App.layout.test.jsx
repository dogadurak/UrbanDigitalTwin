import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The dashboard has to be readable on a phone.
 *
 * It was not. The side panel is 500px and `shrink-0`, the map beside it is
 * `flex-1 min-w-0`, and the root is `overflow-hidden`. On a 375px screen that
 * arithmetic gives the map zero pixels and clips the panel at 369 with no way
 * to scroll to the rest: the page showed neither pane. Nothing failed, because
 * nothing was measuring.
 *
 * These render the real component at real viewport widths and check the layout
 * it actually produces, so the same silence cannot happen twice.
 */

vi.mock('./components/GlobeMap', () => ({
  // Cesium does not load under jsdom and is not what these tests are about.
  default: () => <div data-testid="globe" />,
}));

const EMPTY = { tasks: [], buildings: [], blocks: [], matrix: [], uses: [] };

vi.mock('./api', async () => {
  const actual = await vi.importActual('./api');
  const nothing = () => Promise.resolve(EMPTY);
  return {
    ...actual,
    isStatic: false,
    staticInfo: () => Promise.resolve(null),
    api: {
      health: nothing, tasks: nothing, summary: nothing, byCity: nothing,
      contrasts: nothing, buildings: nothing, euiByUse: nothing,
      screening: nothing, profile: nothing, diagnose: nothing, anomaly: nothing,
      siteSummary: nothing, predict: nothing, whatIf: nothing,
    },
  };
});

const { default: App } = await import('./App');

function setViewport(width) {
  // The resize listener sets React state from a raw DOM event; without act()
  // the re-render is not flushed and the assertion reads the old markup.
  act(() => {
    window.innerWidth = width;
    window.dispatchEvent(new Event('resize'));
  });
}

const original = window.innerWidth;

// jsdom under Node 22 does not always expose localStorage -- which is the same
// hostile-but-legal condition a browser blocking site data presents, and the
// app has to survive both. So these helpers tolerate its absence rather than
// requiring it, and one test below asserts the app does too.
function remember(width) {
  try { window.localStorage.setItem('bei.panelWidth', String(width)); return true; }
  catch { return false; }
}
function forget() {
  try { window.localStorage.clear(); } catch { /* nothing to clear */ }
}

beforeEach(forget);
afterEach(() => { window.innerWidth = original; });

/** The element holding the two panes, found without depending on class order. */
function panes(container) {
  const aside = container.querySelector('aside');
  return { aside, row: aside.parentElement };
}

describe('layout on a phone', () => {
  it('stacks the panes instead of squeezing the map to nothing', () => {
    window.innerWidth = 375;
    const { container } = render(<App />);
    const { aside, row } = panes(container);

    expect(row.className).toContain('flex-col');
    // No inline width: a fixed 500px is what broke it.
    expect(aside.getAttribute('style')).toBeFalsy();
    expect(aside.className).toContain('w-full');
    expect(aside.className).not.toContain('shrink-0');
  });

  it('drops the drag handle, which cannot do anything when stacked', () => {
    window.innerWidth = 375;
    const { container } = render(<App />);
    expect(container.querySelector('.cursor-col-resize')).toBeNull();
  });

  it('never lets the panel exceed the screen', () => {
    // A width remembered from a desktop session must not come back to a phone.
    remember(900);
    window.innerWidth = 375;
    const { container } = render(<App />);
    const { aside } = panes(container);
    const width = Number((aside.getAttribute('style') || '').replace(/\D/g, '')) || 0;
    expect(width).toBeLessThanOrEqual(375);
  });
});

describe('layout on a desktop', () => {
  it('keeps the map and the panel side by side', () => {
    window.innerWidth = 1440;
    const { container } = render(<App />);
    const { aside, row } = panes(container);

    expect(row.className).not.toContain('flex-col');
    expect(aside.className).toContain('shrink-0');
    expect(aside.getAttribute('style')).toContain('width');
  });

  it('keeps the drag handle', () => {
    window.innerWidth = 1440;
    const { container } = render(<App />);
    expect(container.querySelector('.cursor-col-resize')).not.toBeNull();
  });

  it('restores a remembered width, clamped to the window', () => {
    if (!remember(640)) return;  // nothing to restore where storage is absent
    window.innerWidth = 1440;
    const { container } = render(<App />);
    const { aside } = panes(container);
    expect(aside.getAttribute('style')).toContain('640');
  });

  it('renders at all when the browser refuses localStorage', () => {
    // Blocking site data raises SecurityError on the property, not on the
    // call. An unguarded read in a component initialiser is a blank page.
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('denied', 'SecurityError'); },
    });
    try {
      window.innerWidth = 1440;
      const { container } = render(<App />);
      expect(panes(container).aside.getAttribute('style')).toContain('width');
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
      else delete window.localStorage;
    }
  });
});

describe('crossing the breakpoint', () => {
  it('restacks when the window shrinks under it', () => {
    window.innerWidth = 1440;
    const { container } = render(<App />);
    expect(panes(container).row.className).not.toContain('flex-col');

    setViewport(400);
    expect(panes(container).row.className).toContain('flex-col');
  });

  it('and unstacks when it grows again', () => {
    window.innerWidth = 400;
    const { container } = render(<App />);
    expect(panes(container).row.className).toContain('flex-col');

    setViewport(1280);
    expect(panes(container).row.className).not.toContain('flex-col');
  });
});

describe('the header', () => {
  it('wraps rather than pushing content off a narrow screen', () => {
    window.innerWidth = 375;
    const { container } = render(<App />);
    expect(container.querySelector('header').className).toContain('flex-wrap');
  });

  it('still renders the title', () => {
    window.innerWidth = 375;
    render(<App />);
    expect(screen.getByText('Building Energy Intelligence')).toBeTruthy();
  });
});
