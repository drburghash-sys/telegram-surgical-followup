import test from 'node:test';import assert from 'node:assert/strict';
import {reminderOffsets,HOUR,DAY,dueAt,canRespond,backupRetentionFilter} from '../src/rules.js';
test('36h split into thirds',()=>assert.deepEqual(reminderOffsets(36*HOUR),[12*HOUR,24*HOUR]));
test('long appointments 12 and 24 hours',()=>assert.deepEqual(reminderOffsets(72*HOUR),[12*HOUR,24*HOUR]));
test('one-hour urgent appointment',()=>assert.deepEqual(reminderOffsets(HOUR),[20*60000,40*60000]));
test('expired appointments have no reminders',()=>assert.deepEqual(reminderOffsets(-1),[]));
test('dueAt parses Riyadh local',()=>assert.equal(dueAt('2026-10-29T07:30'),Date.parse('2026-10-29T04:30:00Z')));
test('archive disables responses',()=>assert.equal(canRespond({state:'archived'},{status:'sent'}),false));
test('deleted ids cannot restore',()=>assert.deepEqual(backupRetentionFilter([{id:'a'},{id:'b'}],['b']),[{id:'a'}]));
