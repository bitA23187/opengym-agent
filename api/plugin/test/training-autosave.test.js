import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTraining } from '../training.js'

const state = { unit: 'kg', routines: [], customEx: [], workouts: [{ id: 'old', d: '2026-10-22', name: 'Old', entries: [] }] }
const input = { date: '2026-10-22', workout: { name: 'A', exercises: [{ exercise_id: '0293', mode: 'reps', sets: [{ weight: 12, reps: 8 }] }] } }
test('direct-save preference applies only to its opted-in account and ordinary records', () => {
  const training = createTraining({ read: () => structuredClone(state), append: () => { throw Error('test only previews') }, defaultTimezone: 'Asia/Taipei', autoSaveUsers: ['alice'] })
  const alice = training.preview({ id: 'alice' }, 'grant', input)
  assert.equal(alice.authorization.requires_user_confirmation, false)
  assert.match(alice.instructions, /without asking for a separate confirmation reply/)
  assert.equal(training.preview({ id: 'bob' }, 'grant', input).authorization.requires_user_confirmation, true)
  assert.equal(training.preview({ id: 'alice' }, 'grant', { date: input.date, workout_id: 'old', delete_workout: true }).authorization.requires_user_confirmation, true)
  assert.equal(training.preview({ id: 'alice' }, 'grant', { ...input, context_notes: [{ text: 'Important context', kind: 'preference' }] }).authorization.requires_user_confirmation, true)
  assert.equal(training.preview({ id: 'alice' }, 'grant', { ...input, exercise_notes: [{ exercise_id: '0293', note: 'Standing note' }] }).authorization.requires_user_confirmation, true)
  assert.throws(() => training.save({ id: 'bob' }, 'grant', alice.draft_id, true, alice.confirmation_summary), /different authorization/)
})


test('complete but questionable records require clarification before direct save', () => {
  const training = createTraining({ read: () => structuredClone(state), append: () => { throw Error('test only previews') }, defaultTimezone: 'Asia/Taipei', autoSaveUsers: ['alice'] })
  const questions = ['You wrote 120 kg instead of your recent 12 kg. Is that correct?', 'Does the dumbbell weight mean each hand or total?']
  const preview = training.preview({ id: 'alice' }, 'grant', { ...input, review_questions: questions })
  assert.equal(preview.authorization.requires_user_confirmation, true)
  assert.deepEqual(preview.review_questions, questions)
  assert.match(preview.instructions, /Do not call save_training_update yet/)
  const clear = training.preview({ id: 'alice' }, 'grant', input)
  assert.equal(clear.authorization.requires_user_confirmation, false)
  assert.match(clear.instructions, /suspected typos, unexpected outliers, conflicting units/)
  assert.match(clear.instructions, /A complete record may still need clarification/)
  assert.match(clear.instructions, /not proof the record is unambiguous/)
})
