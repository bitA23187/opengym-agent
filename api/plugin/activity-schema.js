import { z } from 'zod';
import { WEIGHT_SOURCES,VALUE_SOURCES } from '../../frontend/src/lib/activity-data.js';
export const activitySetFields={
  weight_source:z.enum(WEIGHT_SOURCES).optional(),value_source:z.enum(VALUE_SOURCES).optional(),
  rep_segments:z.array(z.object({portion:z.enum(['full','upper','lower']),reps:z.number().int().min(1).max(100)}).strict()).min(1).max(20).optional(),
  distance_km:z.number().min(0).max(1000).optional(),elapsed_seconds:z.number().min(1).max(36000).optional(),
  incline_segments:z.array(z.object({start_seconds:z.number().min(0).max(36000),end_seconds:z.number().min(0).max(36000),incline_percent:z.number().min(-20).max(45)}).strict()).min(1).max(200).optional(),
};
export const climbingRouteSchema=z.object({route_id:z.string().min(1).max(64),name:z.string().max(100).optional(),grade:z.string().max(80).optional(),grading_system:z.string().max(80).optional(),attempts:z.number().int().min(1).max(1000),completed:z.boolean(),note:z.string().max(500).optional()}).strict();
