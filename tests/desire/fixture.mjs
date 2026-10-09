import { DatabaseSync } from 'node:sqlite';
export function fixture(t) {
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const adapter={prepare(sql){const statement=(values=[])=>({sql,values,bind:(...v)=>statement(v),first:async()=>db.prepare(sql).get(...values)??null,all:async()=>({results:db.prepare(sql).all(...values)}),run:async()=>db.prepare(sql).run(...values)});return statement();},async batch(statements){db.exec('BEGIN');try{const results=statements.map(({sql,values},i)=>{if(adapter.failAt===i)throw Error('injected transaction interruption');return db.prepare(sql).run(...values);});db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};
 return {db,adapter,env:{DB:adapter,VESPER_APP_TOKEN:'fixture-token',DESIRE_DB:new Proxy({},{get(){throw Error('Original Desire must not be accessed');}})}};
}
