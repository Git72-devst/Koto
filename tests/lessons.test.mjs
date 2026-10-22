import test from 'node:test';
import assert from 'node:assert/strict';
import {runPascal} from '../dist/pascal.js';
import {lessons} from '../dist/lessons.js';

// Exercise the same message handler used in the browser Worker, without a DOM.
let lastWorkerReply;
globalThis.self = {postMessage: reply => { lastWorkerReply = reply; }};
await import('../dist/runner.js');
function grade(source, cases) {
  lastWorkerReply = undefined;
  self.onmessage({data: {source, tests: cases}});
  assert.ok(lastWorkerReply?.results, 'Worker must return test results');
  return lastWorkerReply.results;
}
const tasks = lessons.flatMap(lesson => lesson.tasks);
const normalize = s => String(s).trim().split(/\s+/).filter(Boolean).join(' ');

const oracles = {
  '3-1': (a,k) => a[k-1],
  '3-2': a => [...a].reverse().join(' '),
  '4-1': a => a.reduce((s,x)=>s+x,0),
  '4-2': a => a.filter(x=>x>0).reduce((s,x)=>s+x,0),
  '5-1': a => a.filter(x=>x%2===0).length,
  '5-2': (a,x) => a.indexOf(x)+1,
  '6-1': a => Math.max(...a),
  '6-2': a => a.indexOf(Math.min(...a))+1,
};
function makeCase(task, array, arg, label) {
  const extra = ['3-1','5-2'].includes(task.id) ? `\n${arg}` : '';
  return {input:`${array.length}\n${array.join(' ')}${extra}`, expected:String(oracles[task.id](array,arg)), label};
}

test('curriculum contains all four requested sections and eight distinct tasks', () => {
  assert.deepEqual(lessons.map(x=>x.id),[3,4,5,6]);
  assert.equal(tasks.length,8);
  assert.equal(new Set(tasks.map(x=>x.id)).size,8);
  assert.equal(tasks.reduce((n,t)=>n+t.tests.length,0),40);
});

for(const task of tasks) {
  for(const sample of task.tests) {
    test(`${task.id} reference solution: ${sample.label}`,()=>{
      const [result]=grade(task.solution,[sample]);
      assert.equal(result.error,undefined,result.error);
      assert.equal(result.passed,true,`Expected ${sample.expected}; received ${result.actual}`);
      assert.ok(result.steps>0);
    });
  }

  test(`${task.id} a hardcoded example does not pass the full suite`,()=>{
    const literal=task.tests[0].expected.replaceAll("'","''");
    const results=grade(`begin writeln('${literal}') end.`,task.tests);
    assert.equal(results[0].passed,true);
    assert.ok(results.some(x=>!x.passed),'A literal sample answer must fail another input');
  });

  test(`${task.id} maximum length of 100 elements is accepted`,()=>{
    const array=Array.from({length:100},(_,i)=>(i*37%199)-99);
    const arg=task.id==='3-1' ? 100 : array[99];
    const sample=makeCase(task,array,arg,'Полная длина 100');
    const [result]=grade(task.solution,[sample]);
    assert.equal(result.passed,true,result.error||`Expected ${sample.expected}, got ${result.actual}`);
  });

  test(`${task.id} generated arrays agree with an independent JS oracle`,()=>{
    let seed=77;
    const random=()=>{seed=(seed*1664525+1013904223)>>>0; return seed;};
    for(let trial=0;trial<20;trial++) {
      const length=trial===0 ? 1 : 1+random()%100;
      const array=Array.from({length},()=>Number(random()%2001)-1000);
      const arg=task.id==='3-1' ? 1+random()%length : trial%2 ? 2001 : array[random()%length];
      const sample=makeCase(task,array,arg,`Generated case ${trial}`);
      const result=runPascal(task.solution,sample.input,{maxSteps:150000});
      assert.equal(normalize(result.output),normalize(sample.expected),`Input: ${sample.input}`);
    }
  });

  test(`${task.id} starter is a valid editable Pascal program`,()=>{
    assert.doesNotThrow(()=>runPascal(task.starter,task.tests[0].input));
  });
}

for(const lesson of lessons) {
  test(`section ${lesson.id} main demonstration program executes correctly`,()=>{
    // Every section teaches the algorithm practiced by its first task.
    for(const sample of lesson.tasks[0].tests) {
      const result=runPascal(lesson.code,sample.input);
      assert.equal(normalize(result.output),normalize(sample.expected),sample.label);
    }
  });
}

test('initializing maximum to zero fails negative-only and singleton arrays',()=>{
  const task=tasks.find(x=>x.id==='6-1');
  const bad=task.solution.replace('mx := a[1]','mx := 0');
  assert.notEqual(bad,task.solution);
  const results=grade(bad,task.tests);
  assert.equal(results.find(x=>x.label==='Только отрицательные').passed,false);
  assert.equal(results.find(x=>x.label==='Один элемент').passed,false);
  assert.equal(results[0].passed,true);
});

test('reverse output visits every element and leaves the source array unchanged',()=>{
  const task=tasks.find(x=>x.id==='3-2');
  const array=[5,-2,9,0,5];
  const sample=makeCase(task,array,undefined,'Обратный вывод, а не обмен краёв');
  const result=runPascal(task.solution,sample.input);
  assert.equal(normalize(result.output),'5 0 9 -2 5');
  assert.deepEqual(result.variables.a.values.slice(0,array.length),array);
});

test('using <= for first minimum is caught when the minimum is repeated',()=>{
  const task=tasks.find(x=>x.id==='6-2');
  const bad=task.solution.replace('a[i] < a[pos]','a[i] <= a[pos]');
  assert.notEqual(bad,task.solution);
  const results=grade(bad,task.tests);
  assert.equal(results.find(x=>x.label==='Два одинаковых минимума').passed,false);
  assert.equal(results.find(x=>x.label==='Все значения равны').passed,false);
});

test('first search returns zero when missing and preserves the first repeated match',()=>{
  const task=tasks.find(x=>x.id==='5-2');
  const repeated=makeCase(task,Array(100).fill(-7),-7,'Все равны цели');
  const absent=makeCase(task,Array(100).fill(-7),8,'Совпадений нет');
  const results=grade(task.solution,[repeated,absent]);
  assert.deepEqual(results.map(x=>normalize(x.actual)),['1','0']);
  assert.ok(results.every(x=>x.passed));
});

test('grading reports syntax failures and continues to produce every test result',()=>{
  const task=tasks.find(x=>x.id==='4-1');
  const results=grade('begin writeln(1) end',task.tests);
  assert.equal(results.length,task.tests.length);
  for(const result of results) {
    assert.equal(result.passed,false);
    assert.match(result.error,/Строка 1:.*Ожидается «\.»/);
  }
});

test('grading rejects infinite loops without hanging the checking worker',()=>{
  const results=grade('begin while true do begin end end.',[{input:'',expected:'0',label:'Зацикливание'}]);
  assert.equal(results[0].passed,false);
  assert.match(results[0].error,/лимит шагов/);
});

test('grading accepts whitespace differences but rejects extra debug output',()=>{
  assert.equal(grade("begin writeln('  1   2  ') end.",[{input:'',expected:'1 2',label:'Пробелы'}])[0].passed,true);
  assert.equal(grade("begin writeln('answer 3') end.",[{input:'',expected:'3',label:'Лишний текст'}])[0].passed,false);
});
