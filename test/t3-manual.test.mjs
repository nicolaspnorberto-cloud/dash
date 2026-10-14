import test from 'node:test';
import assert from 'node:assert/strict';
import {POST} from '../api/seatalk.mjs';
import {configureRuntimeEnv} from '../lib/blob-store.mjs';
import {sendDailyDialogueReminder} from '../lib/seatalk-reminders.mjs';

test('comando T3 exige PIN antes de executar envio',async()=>{
  configureRuntimeEnv({TREATMENT_WRITE_PIN:'test-pin'});
  const result=await POST(new Request('https://test/api/seatalk',{method:'POST',body:JSON.stringify({action:'daily-dialogues-t3'})}));
  assert.equal(result.status,401);
});
test('envio T3 forçado não ultrapassa bloqueio após fechamento',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-14T08:31:00Z')});
  const result=await sendDailyDialogueReminder({force:true,turn:'T3'});
  assert.equal(result.skipped,true);
  assert.equal(result.reason,'outside-t2-window');
});
