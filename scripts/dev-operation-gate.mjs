/** Fail closed before any real test/maintenance HTTP request. Values must come
 * from the current quota period (not a rolling 24h usage chart). No billing API
 * credentials, quota assumptions or automatic retries are introduced here. */
export const limits=Object.freeze({reads:200,writes:150,deletes:50,users:2});
export function checkDevOperationGate(evidence,plan,{now=Date.now(),build}={}){
 if(evidence?.project!=='pgt-bjj-dev'||plan?.project!=='pgt-bjj-dev')throw Error('DEV_PROJECT_REQUIRED');
 const age=now-Date.parse(evidence.observedAt);
 if(!Number.isFinite(age)||age<0||age>10*60*1000||evidence.source!=='cloud-firestore-api-quota-current-period')throw Error('RELIABLE_FRESH_QUOTA_REQUIRED');
 if(!build||plan.build!==build||plan.measuredLocally!==true||plan.includesCleanup!==true)throw Error('CURRENT_LOCAL_COST_PLAN_REQUIRED');
 for(const [key,free] of [['reads',50000],['writes',20000],['deletes',20000]]){
  const used=evidence.used?.[key],cost=plan.total?.[key];
  if(!Number.isSafeInteger(used)||used<0||!Number.isSafeInteger(cost)||cost<0||cost>limits[key])throw Error('DEV_TEST_BUDGET_INVALID');
  if(used>=free*.8||used+cost>=free*.8)throw Error('DEV_QUOTA_TOO_CLOSE_TO_LIMIT');
 }
 if(!Number.isSafeInteger(plan.users)||plan.users<1||plan.users>limits.users)throw Error('DEV_SYNTHETIC_USER_LIMIT');
 if(plan.realExecutionsForBuild!==0)throw Error('DEV_REAL_EXECUTION_ALREADY_RECORDED');
 return {...limits};
}
