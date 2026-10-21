import {ApiError} from '../security.ts';
export type OperationBudget={reads:number;writes:number;deletes:number};
/** Document-operation estimate, not Google's billing ledger. Failed attempts
 * consume reservations conservatively; query index-entry billing is unknown.
 * Share this object across repositories when measuring one local scenario. */
export class FirestoreUsage {
 readonly totals={httpRequests:0,queries:0,estimatedReads:0,attemptedWrites:0,attemptedDeletes:0,confirmedWrites:0,confirmedDeletes:0,uncertainResponses:0};
 readonly budget?:OperationBudget;
 constructor(budget?:OperationBudget){this.budget=budget;}
 private reserve(key:'estimatedReads'|'attemptedWrites'|'attemptedDeletes',n:number,limit?:number){
  if(limit!==undefined&&this.totals[key]+n>limit)throw new ApiError(429,'FIRESTORE_TEST_BUDGET_EXCEEDED');
  this.totals[key]+=n;
 }
 read(n=1){this.reserve('estimatedReads',n,this.budget?.reads);}
 queryLimit(){if(!this.budget)return undefined;const left=this.budget.reads-this.totals.estimatedReads;if(left<1)throw new ApiError(429,'FIRESTORE_TEST_BUDGET_EXCEEDED');return left;}
 query(rows:number,limit?:number){this.totals.queries++;this.read(Math.max(1,rows));if(limit!==undefined&&rows>=limit)throw new ApiError(429,'FIRESTORE_TEST_QUERY_BUDGET_BOUNDARY');}
 mutation(writes:any[]){const w=writes.filter(w=>w.update).length,d=writes.filter(w=>w.delete).length;
  // Check both dimensions before reserving either or sending an HTTP request.
  if(this.budget&&(this.totals.attemptedWrites+w>this.budget.writes||this.totals.attemptedDeletes+d>this.budget.deletes))throw new ApiError(429,'FIRESTORE_TEST_BUDGET_EXCEEDED');
  this.reserve('attemptedWrites',w);this.reserve('attemptedDeletes',d);
 }
 confirmed(writes:any[]){this.totals.confirmedWrites+=writes.filter(w=>w.update).length;this.totals.confirmedDeletes+=writes.filter(w=>w.delete).length;}
}
