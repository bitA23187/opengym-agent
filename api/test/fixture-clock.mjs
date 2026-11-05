// Run historical training fixtures against a progressing September clock.
// Timers still use real elapsed time; neither test retries nor process polling freeze.
const RealDate = globalThis.Date;
const offset = RealDate.parse('2026-09-20T12:00:00Z') - RealDate.now();
globalThis.Date = class FixtureDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [RealDate.now() + offset])); }
  static now() { return RealDate.now() + offset; }
};
