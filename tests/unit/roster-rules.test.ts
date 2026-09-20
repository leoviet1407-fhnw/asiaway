import { describe, expect, it } from 'vitest';
import {
  blocksPublish,
  validateRoster,
  type PersonContext,
  type PlannedShift,
  type RosterInput,
  type RuleCode,
  type RuleSettings,
} from '../../src/domain/roster/rules';

const POLICY = { weeklyHoursMinAt100: 40, weeklyHoursMaxAt100: 42.5 };

/** Mirrors the seeded roster_rules rows, so the tests exercise real defaults. */
const RULES: RuleSettings = {
  R2_MIN_REST: { severity: 'BLOCK', isEnabled: true, config: { minutes: 660 } },
  R3_MAX_DAILY_SPAN: { severity: 'BLOCK', isEnabled: true, config: { minutes: 840 } },
  R4_MAX_CONSECUTIVE: { severity: 'BLOCK', isEnabled: true, config: { days: 6 } },
  R5_BREAKS: {
    severity: 'BLOCK',
    isEnabled: true,
    config: {
      tiers: [
        { afterMinutes: 330, breakMinutes: 15 },
        { afterMinutes: 420, breakMinutes: 30 },
        { afterMinutes: 540, breakMinutes: 60 },
      ],
    },
  },
  R6_NO_OVERLAP: { severity: 'BLOCK', isEnabled: true, config: {} },
  R7_UNDERSTAFFED: { severity: 'WARN', isEnabled: true, config: {} },
  R8A_ON_CALL_OUTSIDE: { severity: 'BLOCK', isEnabled: true, config: {} },
  R8B_AGAINST_PREF: { severity: 'WARN', isEnabled: true, config: {} },
  R8C_ON_ABSENCE: { severity: 'BLOCK', isEnabled: true, config: {} },
  R9_CORRIDOR: { severity: 'WARN', isEnabled: true, config: {} },
  R10_SPLIT_FAIRNESS: { severity: 'WARN', isEnabled: true, config: { maxPerWeek: 3 } },
  R11_UNACKNOWLEDGED: { severity: 'INFO', isEnabled: true, config: {} },
};

let counter = 0;

function shift(
  onDate: string,
  from: string,
  to: string,
  userId: string | null,
  extra: Partial<PlannedShift> = {},
): PlannedShift {
  counter += 1;
  return {
    id: `s${counter}`,
    onDate,
    stationCode: 'EG_ALACARTE',
    stationPolicy: 'STAFFED',
    userId,
    startsAt: new Date(`${onDate}T${from}:00Z`),
    endsAt: new Date(`${onDate}T${to}:00Z`),
    plannedBreakMinutes: 0,
    isPublished: false,
    acknowledged: false,
    ...extra,
  };
}

function person(overrides: Partial<PersonContext> & { userId: string }): PersonContext {
  return {
    displayName: overrides.userId,
    employmentType: 'PART_TIME',
    pensumPercent: 80,
    availability: [],
    absences: [],
    ...overrides,
  };
}

function run(input: Partial<RosterInput> & Pick<RosterInput, 'shifts' | 'people'>): RosterInput {
  // Fixtures are written as ...Z, so UTC keeps the wall clock and the instant
  // identical and the expectations readable. The zone itself is covered in
  // tests/unit/roster-time.test.ts.
  return { periodDays: 7, timeZone: 'UTC', policy: POLICY, rules: RULES, ...input };
}

const codes = (input: RosterInput): RuleCode[] => validateRoster(input).map((v) => v.code);

describe('R7 — a station nobody is standing in', () => {
  it('flags an unassigned shift at a staffed station', () => {
    const v = validateRoster(run({ shifts: [shift('2026-09-07', '11:30', '16:00', null)], people: [] }));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ code: 'R7_UNDERSTAFFED', severity: 'WARN' });
    expect(v[0]!.message).toContain('nobody assigned');
  });

  it('accepts "Kellner selbst" as an answer rather than a gap', () => {
    // The September plan wrote this into all 14 bar slots and left the 1. OG
    // lunch rows blank; nothing could tell the two apart.
    const bar = shift('2026-09-07', '11:00', '14:30', null, {
      stationCode: 'BAR',
      stationPolicy: 'SELF_SERVE',
    });
    expect(validateRoster(run({ shifts: [bar], people: [] }))).toHaveLength(0);
  });
});

describe('R4 — consecutive working days', () => {
  const sixDays = ['07', '08', '09', '10', '11', '12'].map((d) =>
    shift(`2026-09-${d}`, '17:00', '22:00', 'YEN'),
  );

  it("passes YEN's six-day week — at the limit, with no slack", () => {
    expect(codes(run({ shifts: sixDays, people: [person({ userId: 'YEN' })] }))).not.toContain(
      'R4_MAX_CONSECUTIVE',
    );
  });

  it('blocks the seventh day', () => {
    const seven = [...sixDays, shift('2026-09-13', '17:00', '22:00', 'YEN')];
    const v = validateRoster(run({ shifts: seven, people: [person({ userId: 'YEN' })] }));
    const hit = v.find((x) => x.code === 'R4_MAX_CONSECUTIVE');
    expect(hit?.severity).toBe('BLOCK');
    expect(hit?.message).toContain('7 days in a row');
  });

  it('resets the run across a rest day', () => {
    const split = [
      shift('2026-09-07', '17:00', '22:00', 'YEN'),
      shift('2026-09-09', '17:00', '22:00', 'YEN'),
    ];
    expect(codes(run({ shifts: split, people: [person({ userId: 'YEN' })] }))).not.toContain(
      'R4_MAX_CONSECUTIVE',
    );
  });
});

describe('R3 — the daily span of a split shift', () => {
  const splitDay = [
    shift('2026-09-11', '10:30', '14:30', 'TAMIE'),
    shift('2026-09-11', '17:30', '22:00', 'TAMIE'),
  ];

  it("accepts September's real 11 h 30 span under a 14 h limit", () => {
    expect(codes(run({ shifts: splitDay, people: [person({ userId: 'TAMIE' })] }))).not.toContain(
      'R3_MAX_DAILY_SPAN',
    );
  });

  it('flags it once the limit is tightened — the threshold is configuration', () => {
    const v = validateRoster(
      run({
        shifts: splitDay,
        people: [person({ userId: 'TAMIE' })],
        rules: { ...RULES, R3_MAX_DAILY_SPAN: { severity: 'BLOCK', isEnabled: true, config: { minutes: 660 } } },
      }),
    );
    expect(v.find((x) => x.code === 'R3_MAX_DAILY_SPAN')?.message).toContain('11.5 h');
  });
});

describe('R2 — rest between working days', () => {
  it('accepts closing at 22:00 and opening at 10:30', () => {
    const shifts = [
      shift('2026-09-07', '17:30', '22:00', 'EDMOND'),
      shift('2026-09-08', '10:30', '14:30', 'EDMOND'),
    ];
    expect(codes(run({ shifts, people: [person({ userId: 'EDMOND' })] }))).not.toContain('R2_MIN_REST');
  });

  it('blocks a close followed by an early start', () => {
    const shifts = [
      shift('2026-09-07', '17:30', '23:30', 'EDMOND'),
      shift('2026-09-08', '08:00', '14:30', 'EDMOND'),
    ];
    const hit = validateRoster(run({ shifts, people: [person({ userId: 'EDMOND' })] })).find(
      (x) => x.code === 'R2_MIN_REST',
    );
    expect(hit?.severity).toBe('BLOCK');
    expect(hit?.message).toContain('8.5 h rest');
  });

  it('does not treat the gap inside a split shift as short rest', () => {
    const shifts = [
      shift('2026-09-11', '10:30', '14:30', 'PHUOC'),
      shift('2026-09-11', '17:30', '22:00', 'PHUOC'),
    ];
    expect(codes(run({ shifts, people: [person({ userId: 'PHUOC' })] }))).not.toContain('R2_MIN_REST');
  });
});

describe('R6 — two stations at once', () => {
  it('blocks overlapping assignments', () => {
    const shifts = [
      shift('2026-09-07', '10:30', '14:30', 'MERSI', { stationCode: 'BUFFET' }),
      shift('2026-09-07', '14:00', '18:00', 'MERSI', { stationCode: 'EG_BUBBLE_TEA' }),
    ];
    const hit = validateRoster(run({ shifts, people: [person({ userId: 'MERSI' })] })).find(
      (x) => x.code === 'R6_NO_OVERLAP',
    );
    expect(hit?.severity).toBe('BLOCK');
    expect(hit?.message).toContain('at the same time');
  });

  it('allows one station handing straight over to the next', () => {
    const shifts = [
      shift('2026-09-07', '10:30', '14:30', 'MERSI', { stationCode: 'BUFFET' }),
      shift('2026-09-07', '14:30', '18:00', 'MERSI', { stationCode: 'EG_BUBBLE_TEA' }),
    ];
    expect(codes(run({ shifts, people: [person({ userId: 'MERSI' })] }))).not.toContain('R6_NO_OVERLAP');
  });
});

describe('R8 — what an availability row is worth', () => {
  const day = '2026-10-05';

  it('blocks an Aushilfe rostered on a day they offered nothing', () => {
    const dennis = person({ userId: 'DENNIS', employmentType: 'ON_CALL', pensumPercent: null });
    const hit = validateRoster(
      run({ shifts: [shift(day, '18:00', '22:00', 'DENNIS')], people: [dennis] }),
    ).find((x) => x.code === 'R8A_ON_CALL_OUTSIDE');
    expect(hit?.severity).toBe('BLOCK');
    expect(hit?.message).toContain('offered no hours');
  });

  it('blocks an Aushilfe rostered beyond the window they offered', () => {
    const dennis = person({
      userId: 'DENNIS',
      employmentType: 'ON_CALL',
      pensumPercent: null,
      availability: [{ onDate: day, fromMinutes: 18 * 60, toMinutes: 22 * 60, kind: 'AVAILABLE' }],
    });
    expect(
      codes(run({ shifts: [shift(day, '14:00', '22:00', 'DENNIS')], people: [dennis] })),
    ).toContain('R8A_ON_CALL_OUTSIDE');
  });

  it('accepts an Aushilfe inside their offer', () => {
    const dennis = person({
      userId: 'DENNIS',
      employmentType: 'ON_CALL',
      pensumPercent: null,
      availability: [{ onDate: day, fromMinutes: 14 * 60, toMinutes: 22 * 60, kind: 'AVAILABLE' }],
    });
    expect(
      codes(run({ shifts: [shift(day, '18:00', '22:00', 'DENNIS')], people: [dennis] })),
    ).not.toContain('R8A_ON_CALL_OUTSIDE');
  });

  it('only warns for a contracted employee, whose hours are already owed', () => {
    const tamie = person({
      userId: 'TAMIE',
      availability: [{ onDate: day, fromMinutes: 0, toMinutes: 1439, kind: 'UNAVAILABLE' }],
    });
    const hit = validateRoster(
      run({ shifts: [shift(day, '17:30', '22:00', 'TAMIE')], people: [tamie] }),
    ).find((x) => x.code === 'R8B_AGAINST_PREF');
    expect(hit?.severity).toBe('WARN');
  });
});

describe('R8c — approved leave', () => {
  it("blocks a shift during PATRICIA's holiday", () => {
    const patricia = person({
      userId: 'PATRICIA',
      employmentType: 'ON_CALL',
      pensumPercent: null,
      absences: [{ startsOn: '2026-09-07', endsOn: '2026-09-13' }],
      availability: [{ onDate: '2026-09-09', fromMinutes: 0, toMinutes: 1439, kind: 'AVAILABLE' }],
    });
    const hit = validateRoster(
      run({ shifts: [shift('2026-09-09', '17:30', '22:00', 'PATRICIA')], people: [patricia] }),
    ).find((x) => x.code === 'R8C_ON_ABSENCE');
    expect(hit?.severity).toBe('BLOCK');
    expect(hit?.message).toContain('approved leave');
  });
});

describe('R9 — the pensum corridor', () => {
  function week(userId: string, pensum: number, hoursPerDay: number, days: number): RosterInput {
    const shifts = Array.from({ length: days }, (_, i) =>
      shift(
        `2026-10-0${i + 1}`,
        '10:00',
        `${String(10 + hoursPerDay).padStart(2, '0')}:00`,
        userId,
      ),
    );
    return run({ shifts, people: [person({ userId, pensumPercent: pensum })], periodDays: 7 });
  }

  it('is silent inside the corridor', () => {
    // 80% of 40-42.5 h is 32-34 h; four eight-hour days is exactly 32.
    expect(codes(week('TAMIE', 80, 8, 4))).not.toContain('R9_CORRIDOR'); // 32 h
  });

  it('warns above it', () => {
    const hit = validateRoster(week('TAMIE', 80, 9, 5)).find((x) => x.code === 'R9_CORRIDOR');
    expect(hit?.severity).toBe('WARN');
    expect(hit?.message).toContain('over');
  });

  it('warns below it', () => {
    expect(validateRoster(week('TAMIE', 80, 4, 4)).find((x) => x.code === 'R9_CORRIDOR')?.message).toContain(
      'under',
    );
  });

  it('never applies to an Aushilfe, who is owed no hours', () => {
    const dennis = person({
      userId: 'DENNIS',
      employmentType: 'ON_CALL',
      pensumPercent: null,
      availability: Array.from({ length: 5 }, (_, i) => ({
        onDate: `2026-10-0${i + 1}`,
        fromMinutes: 0,
        toMinutes: 1439,
        kind: 'AVAILABLE' as const,
      })),
    });
    const shifts = Array.from({ length: 5 }, (_, i) =>
      shift(`2026-10-0${i + 1}`, '10:00', '20:00', 'DENNIS'),
    );
    expect(codes(run({ shifts, people: [dennis] }))).not.toContain('R9_CORRIDOR');
  });
});

describe('R5 — the break a long day earns', () => {
  it('flags nine hours straight through with no break', () => {
    const hit = validateRoster(
      run({ shifts: [shift('2026-09-07', '11:00', '20:30', 'APRIL')], people: [person({ userId: 'APRIL' })] }),
    ).find((x) => x.code === 'R5_BREAKS');
    expect(hit?.severity).toBe('BLOCK');
    expect(hit?.message).toContain('60 min is owed');
  });

  it('counts a split shift’s own gap as the break', () => {
    const shifts = [
      shift('2026-09-07', '10:30', '14:30', 'APRIL'),
      shift('2026-09-07', '17:30', '22:00', 'APRIL'),
    ];
    expect(codes(run({ shifts, people: [person({ userId: 'APRIL' })] }))).not.toContain('R5_BREAKS');
  });

  it('accepts a planned break that meets the tier', () => {
    const long = shift('2026-09-07', '11:00', '20:30', 'APRIL', { plannedBreakMinutes: 60 });
    expect(codes(run({ shifts: [long], people: [person({ userId: 'APRIL' })] }))).not.toContain('R5_BREAKS');
  });
});

describe('R10 — split shifts spread fairly', () => {
  it('flags four split shifts in one week, as EDMOND had in September', () => {
    const shifts = ['07', '09', '11', '12'].flatMap((d) => [
      shift(`2026-09-${d}`, '10:30', '14:30', 'EDMOND'),
      shift(`2026-09-${d}`, '17:30', '22:00', 'EDMOND'),
    ]);
    const hit = validateRoster(run({ shifts, people: [person({ userId: 'EDMOND' })] })).find(
      (x) => x.code === 'R10_SPLIT_FAIRNESS',
    );
    expect(hit?.severity).toBe('WARN');
    expect(hit?.message).toContain('4 split shifts');
  });
});

describe('publishing', () => {
  it('is refused while any BLOCK stands, and permitted on warnings alone', () => {
    const warnOnly = validateRoster(
      run({ shifts: [shift('2026-09-07', '11:30', '16:00', null)], people: [] }),
    );
    expect(blocksPublish(warnOnly)).toBe(false);

    const blocked = validateRoster(
      run({
        shifts: [
          shift('2026-09-07', '10:30', '14:30', 'MERSI'),
          shift('2026-09-07', '14:00', '18:00', 'MERSI'),
        ],
        people: [person({ userId: 'MERSI' })],
      }),
    );
    expect(blocksPublish(blocked)).toBe(true);
  });

  it('puts the blocking findings first', () => {
    const v = validateRoster(
      run({
        shifts: [
          shift('2026-09-07', '11:30', '16:00', null),
          shift('2026-09-07', '10:30', '14:30', 'MERSI'),
          shift('2026-09-07', '14:00', '18:00', 'MERSI'),
        ],
        people: [person({ userId: 'MERSI' })],
      }),
    );
    expect(v[0]!.severity).toBe('BLOCK');
  });

  it('respects a rule that has been switched off', () => {
    const shifts = [
      shift('2026-09-07', '10:30', '14:30', 'MERSI'),
      shift('2026-09-07', '14:00', '18:00', 'MERSI'),
    ];
    const v = validateRoster(
      run({
        shifts,
        people: [person({ userId: 'MERSI' })],
        rules: { ...RULES, R6_NO_OVERLAP: { severity: 'BLOCK', isEnabled: false, config: {} } },
      }),
    );
    expect(v.map((x) => x.code)).not.toContain('R6_NO_OVERLAP');
  });
});
