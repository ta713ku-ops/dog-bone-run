import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const output='test-results/ultimate-v39/verify';mkdirSync(output,{recursive:true});
const stages=[
  ...(!process.argv.includes('--browser-only')?[['unit',[],true],['build',['scripts/build.mjs']]]:[]),
  ['core',['tests/ultimate.browser.mjs']],
  ['lifecycle',['tests/ultimate-lifecycle.browser.mjs']],
  ['pack',['tests/ultimate-pack.browser.mjs']],
  ['production',['tests/ultimate-production.browser.mjs']],
  ['loading',['tests/ultimate-loading.browser.mjs']],
];
const results=[];
for(const[name,args,unit]of stages){
  console.log(`Verifying ${name}…`);
  try{
    const text=unit?execFileSync('npm',['test'],{encoding:'utf8',maxBuffer:8*1024*1024}):execFileSync(process.execPath,args,{encoding:'utf8',maxBuffer:8*1024*1024});
    writeFileSync(`${output}/${name}.log`,text);results.push({stage:name,status:'PASS'});console.log(`${name}: PASS`);
  }catch(error){
    writeFileSync(`${output}/${name}.log`,`${error.stdout??''}\n${error.stderr??''}`);results.push({stage:name,status:'FAIL'});
    writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));console.error(`${name}: FAIL — ${output}/${name}.log`);process.exit(1);
  }
}
writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));
