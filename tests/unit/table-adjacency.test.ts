import { describe, expect, it } from 'vitest';
import { areNeighbours, isConnectedSelection } from '../../src/config/floor-plan';

describe('which tables can be pushed together', () => {
  it('treats tables side by side as neighbours', () => {
    expect(areNeighbours('18', '17')).toBe(true);
    expect(areNeighbours('17', '16')).toBe(true);
    expect(areNeighbours('14', '13')).toBe(true);
    expect(areNeighbours('53', '52')).toBe(true);
    expect(areNeighbours('21', '22')).toBe(true);
  });

  it('treats one table behind another as neighbours', () => {
    expect(areNeighbours('20', '19')).toBe(true);
    expect(areNeighbours('12', '9')).toBe(true);
    expect(areNeighbours('21', '18')).toBe(true);
  });

  it('refuses to merge across a physical divider', () => {
    // A screen stands between 15 and 12, and between the 13/14 and 11/10 rows.
    expect(areNeighbours('15', '12')).toBe(false);
    expect(areNeighbours('14', '11')).toBe(false);
    expect(areNeighbours('13', '10')).toBe(false);
  });

  it('allows a gap that is not a divider', () => {
    // 9 and 4 have empty space between them, not a screen.
    expect(areNeighbours('9', '4')).toBe(true);
  });

  it('does not count diagonals', () => {
    expect(areNeighbours('18', '16')).toBe(false); // two apart in a row
    expect(areNeighbours('20', '14')).toBe(false); // corner to corner
  });

  it('refuses tables at opposite ends of the room', () => {
    expect(areNeighbours('21', '50')).toBe(false);
    expect(areNeighbours('4', '53')).toBe(false);
  });

  it('is symmetric, and a table is never its own neighbour', () => {
    expect(areNeighbours('18', '17')).toBe(areNeighbours('17', '18'));
    expect(areNeighbours('18', '18')).toBe(false);
  });

  it('knows nothing of outside tables, which are not on the plan', () => {
    expect(areNeighbours('30', '31')).toBe(false);
  });
});

describe('a mergeable selection is one connected run', () => {
  it('accepts a row pushed together', () => {
    expect(isConnectedSelection(['53', '52', '51'])).toBe(true);
    expect(isConnectedSelection(['18', '17', '16', '15'])).toBe(true);
  });

  it('accepts an L shape, as long as every table touches the run', () => {
    expect(isConnectedSelection(['21', '22', '18'])).toBe(true);
  });

  it('accepts a selection given in any order', () => {
    expect(isConnectedSelection(['51', '53', '52'])).toBe(true);
  });

  it('rejects two separate pairs dressed up as one table', () => {
    expect(isConnectedSelection(['53', '52', '21', '22'])).toBe(false);
  });

  it('rejects a table that touches nothing in the set', () => {
    expect(isConnectedSelection(['53', '52', '4'])).toBe(false);
  });

  it('rejects a selection that would jump a divider', () => {
    expect(isConnectedSelection(['14', '11'])).toBe(false);
  });

  it('needs at least two tables', () => {
    expect(isConnectedSelection(['53'])).toBe(false);
    expect(isConnectedSelection([])).toBe(false);
  });
});
