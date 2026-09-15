import {expect,test} from 'bun:test';
import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {command,cleanEnvironment,requireSuccess} from '../src/handoff/io';
import {testRoot,repo} from './handoff-fixture';

test('TAKTの大きなログはディスクへ残し、2MBを超えても停止しない',async()=>{
  const prefix=join(testRoot,'streamed-command');
  const r=await command([process.execPath,'-e',"process.stdout.write('x'.repeat(2300000)+'DONE\\n'); process.stderr.write('diagnostic');"],repo,cleanEnvironment(),10000,{outputPrefix:prefix});
  expect(r.code).toBe(0);expect(r.timedOut).toBe(false);expect(r.outputTruncated).toBe(true);expect(r.stdout.length).toBeLessThanOrEqual(64000);
  expect(readFileSync(r.stdoutFile!,'utf8').length).toBe(2300005);expect(r.stdout.endsWith('DONE\n')).toBe(true);expect(readFileSync(r.stderrFile!,'utf8')).toBe('diagnostic');
});
test('通常コマンドの出力超過を時間切れと誤記しない',async()=>{
  const r=await command([process.execPath,'-e',"process.stdout.write('x'.repeat(2300000));setTimeout(()=>{},10000);"],repo,cleanEnvironment(),15000);
  expect(r.outputLimitExceeded).toBe(true);expect(r.timedOut).toBe(false);expect(()=>requireSuccess(r)).toThrow('出力上限');
});
test('チャンク境界でUTF-8を壊さない',async()=>{
  const r=await command([process.execPath,'-e',"const b=Buffer.from('日本語');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),50);"],repo,cleanEnvironment(),10000);
  expect(r.stdout).toBe('日本語');
});
