import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SimulationPanel from './SimulationPanel';
import useTwinStore from '../../store/useTwinStore';

vi.mock('../../store/useTwinStore');

describe('SimulationPanel', () => {
  it('renders simulation panel and sliders with AI result', () => {
    const mockSimulateWhatIf = vi.fn();
    useTwinStore.mockImplementation((selector) => {
      const state = {
        simulateWhatIf: mockSimulateWhatIf,
        whatIfResult: { projectedPower: 150.5, delta: 5.2 }
      };
      return selector(state);
    });

    render(<SimulationPanel />);

    expect(screen.getByText(/WHAT-IF SIMULATION \(AI\)/i)).toBeDefined();
    expect(screen.getByText(/Outdoor Temperature/i)).toBeDefined();
    
    // Check if result is displayed based on mocked state
    expect(screen.getByText(/Expected Power Load/i)).toBeDefined();
    expect(screen.getByText(/150.5 kW/i)).toBeDefined();
  });
});
