import assert from "node:assert/strict";
import test from "node:test";
import { runScheduledMaintenance } from "../features/runtime/scheduled-maintenance.ts";
import { createOperationalLogger } from "../features/privacy/operational-log.ts";
const emptyCleanup={pendingQuarantined:0,verifyingDiscarded:0,blobsDeleted:0,blobsPendingRetry:0};
const delivered={configured:true,tenants:1,processed:3,failed:0,queueAgeSeconds:20};

test("both operations run on every tick and report bounded operational counters", async()=>{
  const calls=[];const lines=[];let now=100;
  const result=await runScheduledMaintenance({cleanup:async(limit)=>{calls.push(["cleanup",limit]);return emptyCleanup;},mail:async(limit)=>{calls.push(["mail",limit]);return delivered;},now:()=>now+=10,log:createOperationalLogger(line=>lines.push(line))});
  assert.deepEqual(calls,[["cleanup",10],["mail",10]]);
  assert.equal(result.alarm,false);
  assert.equal(JSON.parse(lines[0]).event,"scheduler.completed");
  assert.equal(result.durationMs,10);
});

test("cleanup outage does not skip mail and produces an alarm without raw error text",async()=>{
  const canary="SECRET-CANARY-DO-NOT-LOG";const lines=[];let mailRuns=0;
  const result=await runScheduledMaintenance({cleanup:async()=>{throw Error(canary);},mail:async()=>{mailRuns++;return delivered;},log:createOperationalLogger(line=>lines.push(line))});
  assert.equal(mailRuns,1);assert.equal(result.alarm,true);assert.equal(result.cleanupFailed,true);
  assert.equal(lines.join().includes(canary),false);
  assert.equal(JSON.parse(lines[0]).event,"scheduler.failed");
});

test("queue age, mail failures and missing configuration each trip the local alarm contract",async()=>{
  for(const change of [{queueAgeSeconds:600},{failed:1},{configured:false}]) {
    const result=await runScheduledMaintenance({cleanup:async()=>emptyCleanup,mail:async()=>({...delivered,...change}),log:()=>{}});
    assert.equal(result.alarm,true);
  }
  const result=await runScheduledMaintenance({cleanup:async()=>emptyCleanup,mail:async()=>{throw Error("SENSITIVE CONNECTION");},log:()=>{}});
  assert.equal(result.alarm,true);assert.equal(result.failed,1);assert.equal(JSON.stringify(result).includes("SENSITIVE"),false);
});
