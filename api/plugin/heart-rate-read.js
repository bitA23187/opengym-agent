// Read-only summaries for the sidecar files written by api/heart-rate.js.
// User IDs and workout keys are hashed exactly as they are by the API.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { workoutKey } from '../heart-rate-data.js';
import { getHeartMetrics } from '../heart-rate-metrics.js';

const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const empty = status => ({ status, available: false, sample_count: 0 })
export { heartRateInterpretation } from '../heart-rate-metrics.js';

export function createHeartRateReads(dataDir) {
  return {
    forWorkout(user, workout, { includeCurve = false } = {}) {
      if (!dataDir || !user?.id) return empty('unavailable');
      const key = workoutKey(workout);
      const file = path.join(dataDir, 'heart-rate', hash(user.id), 'workouts', hash(key) + '.json');
      let record;
      try {
        record = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return empty('not_imported');
        return empty('unavailable');
      }
      if (!record || typeof record !== 'object' || Array.isArray(record) || record.workoutId !== key) return empty('invalid_record');
      const metrics = getHeartMetrics(record, workout);
      if (includeCurve) return metrics;
      const { curve, logged_set_events, set_log_intervals, ...compact } = metrics;
      return compact;
    },
  };
}
