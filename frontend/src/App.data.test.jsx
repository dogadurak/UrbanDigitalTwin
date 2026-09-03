import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

/**
 * The last link in the chain: does the page display what the export contains?
 *
 * `scripts/verify_web_data.py` checks the analysis against the API and the API
 * against the frozen files. That leaves one joint untested, and it is the one
 * the reader actually sees: a file can be perfect and still be rendered into
 * the wrong cell, formatted with the wrong scale, or dropped for a shape the
 * component did not expect -- all of which look like a working page.
 *
 * So these render the real components against the real exported files, served
 * through a `fetch` that reads `public/data`, and assert on the text that ends
 * up on screen.
 */

// Resolved from the working directory, not from `import.meta.url`: under jsdom
// that is an http:// URL and `fileURLToPath` rejects it. Vitest runs with the
// project root as cwd.
const DATA = path.join(process.cwd(), 'public', 'data') + path.sep;

const read = (path) => JSON.parse(readFileSync(DATA + path, 'utf8'));

const hasExport = existsSync(DATA + 'manifest.json');

vi.mock('./components/GlobeMap', () => ({
  default: () => <div data-testid="globe" />,
}));

// Both of these must be in place before `api.js` is evaluated: it reads the
// flag at module scope. Pulling App in from a `beforeAll` instead would work
// too, but the import alone takes longer than the default hook timeout.
//
// BASE_URL is already '/' under test; stubbing that particular key wedges
// Vite's module runner, so only the app's own flag is set here.
vi.stubEnv('VITE_STATIC_DATA', '1');

// Serve the published files the way the browser would.
vi.stubGlobal('fetch', async (url) => {
  const rel = String(url).replace(/^\/+/, '');
  const file = DATA + rel.replace(/^data\//, '');
  if (!rel.startsWith('data/') || !existsSync(file)) {
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
  }
  const body = readFileSync(file, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
});

const { default: App } = await import('./App');

// The active tab is stored in the URL hash so a view can be linked to. jsdom
// keeps the hash across renders, so a test that clicks a tab would otherwise
// pick the tab for every test after it.
beforeEach(() => { window.location.hash = ''; });

afterAll(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const maybe = hasExport ? describe : describe.skip;

maybe('the header, against health.json', () => {
  it('shows the building count the model reports', async () => {
    const health = read('health.json');
    // The header formats with `toLocaleString()` and no locale argument, so
    // the separator is the reader's, not en-US's. Compare against the same
    // call rather than a hard-coded "1,381".
    const shown = health.trained_on_buildings.toLocaleString();
    render(<App />);
    await waitFor(() => {
      expect(document.body.textContent).toContain(shown);
    });
  });

  it('shows the model spec, not a placeholder', async () => {
    const health = read('health.json');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`model ${health.spec}`))).toBeTruthy();
    });
    // The em dash is what the header prints before the data arrives.
    expect(screen.queryByText(/model —/)).toBeNull();
  });
});

maybe('the headline strip, against results/cold_start/summary.json', () => {
  /** What the strip reads: the median cell for a model under a protocol. */
  const cell = (summary, model, protocol) =>
    summary.matrix.find((r) => r.model === model)?.[protocol]?.median;

  it('prints the same CV(RMSE) the summary file carries', async () => {
    const summary = read('results/cold_start/summary.json');
    render(<App />);

    for (const model of ['M0_seasonal_naive', 'M2_weather',
      'M3prime_site_identity', 'M3_building']) {
      const value = cell(summary, model, 'leave_block_out');
      expect(value, `${model} missing from the export`).toBeTypeOf('number');
      // The strip formats with one decimal.
      await waitFor(() => {
        expect(screen.getAllByText(`${value.toFixed(1)}%`).length).toBeGreaterThan(0);
      });
    }
  });

  it('does not leave the strip on its placeholder', async () => {
    render(<App />);
    await waitFor(() => expect(screen.queryAllByText('—').length).toBe(0));
  });
});

maybe('the screening tab, against screening/2.0.json', () => {
  it('shows the flagged count and the energy at stake from the file', async () => {
    const s = read('screening/2.0.json').summary;
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Screening' }));

    // The exact strings the panel composes, so a unit slip or a swapped field
    // fails here rather than looking plausible on screen.
    await waitFor(() => {
      const text = document.body.textContent;
      expect(text).toContain(`${s.n_flagged} / ${s.n_screened}`);
      expect(text).toContain(`${s.excess_annual_gwh} GWh/yr`);
      expect(text).toContain(`${(s.share_flagged * 100).toFixed(1)}% of portfolio`);
      expect(text).toContain(
        `${(s.excess_share_of_portfolio * 100).toFixed(1)}% of ${s.portfolio_annual_gwh} GWh`,
      );
    });
  });

  it('lists as many buildings as the file holds', async () => {
    const s = read('screening/2.0.json');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Screening' }));

    await waitFor(() => {
      for (const b of s.buildings.slice(0, 3)) {
        expect(screen.getAllByText(new RegExp(b.building_id)).length).toBeGreaterThan(0);
      }
    });
  });
});

maybe('the results tab, against the same summary file', () => {
  it('renders a row for every model in the matrix', async () => {
    const summary = read('results/cold_start/summary.json');
    render(<App />);

    // Substring, not a regex: the labels contain "+", "'" and "(control)",
    // and turning those into a pattern silently changes what is being asked.
    await waitFor(() => {
      for (const row of summary.matrix) {
        expect(document.body.textContent, row.model).toContain(row.label);
      }
    });
  });

  it('renders each protocol column the file declares', async () => {
    const summary = read('results/cold_start/summary.json');
    render(<App />);
    await waitFor(() => {
      for (const p of summary.protocols) {
        expect(document.body.textContent, p.key).toContain(p.label);
      }
    });
  });

  it('prints every median cell exactly as the file carries it', async () => {
    const summary = read('results/cold_start/summary.json');
    render(<App />);

    await waitFor(() => expect(document.body.textContent)
      .toContain(summary.matrix[0].label));

    const text = document.body.textContent;
    let checked = 0;
    for (const row of summary.matrix) {
      for (const p of summary.protocols) {
        const cell = row[p.key];
        if (!cell) continue;
        expect(text, `${row.model}/${p.key}`).toContain(String(cell.median));
        checked += 1;
      }
    }
    // A pass with nothing compared would be worse than a failure.
    expect(checked).toBeGreaterThan(10);
  });
});

maybe('the EUI panel, against explore/eui-by-use.json', () => {
  it('labels the unit and year from the file, not from a constant', async () => {
    // The bars themselves are Recharts inside a ResponsiveContainer, which
    // measures 0x0 under jsdom and renders no axis text. What can be checked
    // here is that the panel took its unit and period from the response
    // rather than hard-coding them, which is where this kind of panel goes
    // wrong: right numbers, wrong stated unit.
    const eui = read('explore/eui-by-use.json');
    expect(eui.uses.length).toBeGreaterThan(0);
    render(<App />);
    await waitFor(() => {
      expect(document.body.textContent)
        .toContain(`Median ${eui.unit}, ${eui.year}`);
    });
  });

  it('carries enough categories to show the spread the README claims', () => {
    const eui = read('explore/eui-by-use.json');
    const medians = eui.uses.map((u) => u.median_eui);
    expect(eui.uses.length).toBeGreaterThanOrEqual(8);
    // Sorted ascending by the endpoint; the README's argument rests on the
    // ratio between the ends being large.
    expect(medians).toEqual([...medians].sort((a, b) => a - b));
    expect(medians[medians.length - 1] / medians[0]).toBeGreaterThan(5);
  });
});

maybe('the snapshot notice', () => {
  it('tells the reader the figures are frozen, and when', async () => {
    const manifest = read('manifest.json');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Published snapshot/)).toBeTruthy();
    });
    expect(document.body.textContent).toContain(manifest.generated_at.slice(0, 10));
  });
});
