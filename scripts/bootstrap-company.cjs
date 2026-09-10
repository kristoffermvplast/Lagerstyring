// Explicit operator tool, not part of deployment/startup. No secret output.
const { Client } = require('pg');
const { readFileSync } = require('node:fs');
const { validateCaPem } = require('../apps/api/dist/config.js');
const { bootstrapCompany } = require('../apps/api/dist/bootstrap.js');
(async()=>{
 let client;
 try {
  if(!process.argv.includes('--confirm-bootstrap') || !process.env.BOOTSTRAP_DATABASE_URL || !process.env.BOOTSTRAP_USER_ID || !process.env.BOOTSTRAP_COMPANY_NAME || !process.env.DATABASE_CA_FILE)throw new Error();
  const url=new URL(process.env.BOOTSTRAP_DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(url.protocol) || url.search || url.hash)throw new Error();
  client=new Client({connectionString:process.env.BOOTSTRAP_DATABASE_URL,ssl:{rejectUnauthorized:true,ca:validateCaPem(readFileSync(process.env.DATABASE_CA_FILE,'utf8'))},connectionTimeoutMillis:5000,query_timeout:10000});
  client.on('error',()=>{console.error('BOOTSTRAP_CONNECTION_FAILED');process.exitCode=1;});
  await client.connect();
  await bootstrapCompany(client,process.env.BOOTSTRAP_USER_ID,process.env.BOOTSTRAP_COMPANY_NAME);
  console.log('COMPANY_BOOTSTRAP: PASS');
 }catch{console.error('COMPANY_BOOTSTRAP: FAILED (no configuration or secret details printed)');process.exitCode=1;}
 finally{try{await client?.end();}catch{}}
})();
