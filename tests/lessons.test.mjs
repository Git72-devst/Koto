import test from 'node:test';
import assert from 'node:assert/strict';
import {runPascal} from '../dist/pascal.js';
import {lessons} from '../dist/lessons.js';

// Exercise the exact message handler used by the checking Worker.
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

// Independent specifications: these deliberately differ from the lesson examples.
const oracles = {
  '3-1': (a,indices) => indices.map(i => a[i-1]).join(' '),
  '3-2': a => a.filter((_,i) => i%2===0).reverse().join(' '),
  '4-1': a => a.reduce((sum,x) => sum+x*x,0),
  '4-2': a => a.filter(x => x<0).reduce((sum,x) => sum+x,0),
  '5-1': (a,x) => a.filter(value => value>x).length,
  '5-2': (a,x) => a.lastIndexOf(x)+1,
  '6-1': a => Math.max(...a)-Math.min(...a),
  '6-2': a => a.filter(x => x===Math.min(...a)).length,
};
function makeCase(task, array, arg, label) {
  let extra='';
  if(task.id==='3-1') extra=`\n${arg.join(' ')}`;
  if(['5-1','5-2'].includes(task.id)) extra=`\n${arg}`;
  return {input:`${array.length}\n${array.join(' ')}${extra}`, expected:String(oracles[task.id](array,arg)), label};
}
function defaultArg(task,array) {
  return task.id==='3-1' ? [array.length,1] : array[Math.floor(array.length/2)];
}
function assertAccepted(task,sample) {
  const [result]=grade(task.solution,[sample]);
  assert.equal(result.error,undefined,result.error);
  assert.equal(result.passed,true,`${task.id}: ${sample.label}: expected ${sample.expected}; received ${result.actual}`);
  return result;
}

test('curriculum has eight distinct transfer tasks with blank starting editors',()=>{
  assert.deepEqual(lessons.map(x=>x.id),[3,4,5,6]);
  assert.equal(tasks.length,8);
  assert.equal(new Set(tasks.map(x=>x.id)).size,8);
  assert.ok(tasks.reduce((n,t)=>n+t.tests.length,0)>=40);
  for(const task of tasks) {
    assert.equal(task.starter,'',`${task.id} must start with an empty editor`);
    assert.ok(task.tests.length>=5,`${task.id} needs several independent inputs`);
    assert.ok(task.transferNote?.trim(),`${task.id} must explain what changed from the lesson`);
  }
});

for(const task of tasks) {
  for(const sample of task.tests) {
    test(`${task.id} reference solution: ${sample.label}`,()=>{
      const result=assertAccepted(task,sample);
      assert.ok(result.steps>0);
    });
  }

  for(const lesson of lessons) {
    test(`${task.id} rejects unchanged example from section ${lesson.id}`,()=>{
      const results=grade(lesson.code,task.tests);
      assert.equal(results.length,task.tests.length);
      assert.ok(results.some(r=>!r.passed),`Copying section ${lesson.id}'s entire program must not complete ${task.id}`);
    });
  }

  test(`${task.id} a hardcoded example does not pass the full suite`,()=>{
    const literal=task.tests[0].expected.replaceAll("'","''");
    const results=grade(`begin writeln('${literal}') end.`,task.tests);
    assert.equal(results[0].passed,true);
    assert.ok(results.some(x=>!x.passed),'A literal sample answer must fail another input');
  });

  const boundaryArrays=[
    [0],[-1000],[1000],[-9,-3,-7],[9,3,7],[5,5,5,5],
    [-8,5,-8,5,-8],[4,-7,4,-7,9,9,9],[0,-1,0,1,0],
    [1000,-1000,1000,-1000],
    Array.from({length:100},(_,i)=>(i*37%199)-99),
  ];
  for(const [index,array] of boundaryArrays.entries()) {
    test(`${task.id} independent boundary array ${index+1} (n=${array.length})`,()=>{
      assertAccepted(task,makeCase(task,array,defaultArg(task,array),`Граничный набор ${index+1}`));
    });
  }

  test(`${task.id} generated arrays agree with an independent JS specification`,()=>{
    let seed=77;
    const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
    for(let trial=0;trial<40;trial++) {
      const length=trial===0?1:1+random()%100;
      const array=Array.from({length},()=>Number(random()%2001)-1000);
      const arg=task.id==='3-1'
        ?[1+random()%length,1+random()%length]
        :trial%2?1000:array[random()%length];
      const sample=makeCase(task,array,arg,`Generated case ${trial}`);
      const result=runPascal(task.solution,sample.input,{maxSteps:150000});
      assert.equal(normalize(result.output),normalize(sample.expected),`Input: ${sample.input}`);
    }
  });
}

const demonstrationCases={
  3:[{input:'5\n7 3 8 2 5\n3',expected:'8'},{input:'1\n-9\n1',expected:'-9'}],
  4:[{input:'5\n7 3 8 2 5',expected:'25'},{input:'3\n-9 -3 -7',expected:'-19'}],
  5:[{input:'5\n7 3 8 2 5',expected:'2'},{input:'4\n0 -2 3 8',expected:'3'}],
  6:[{input:'5\n7 3 8 2 5',expected:'8'},{input:'3\n-9 -3 -7',expected:'-3'},{input:'1\n-42',expected:'-42'}],
};
for(const lesson of lessons) {
  test(`section ${lesson.id} example still solves its own teaching problem`,()=>{
    for(const sample of demonstrationCases[lesson.id]) {
      const result=runPascal(lesson.code,sample.input);
      assert.equal(normalize(result.output),normalize(sample.expected),sample.input);
    }
  });
}

test('two indices must both be output, even if they refer to the same cell',()=>{
  const task=tasks.find(t=>t.id==='3-1');
  assertAccepted(task,makeCase(task,[4,-7,9],[2,2],'Один адрес указан дважды'));
  const wrong=lessons.find(l=>l.id===3).code;
  assert.equal(grade(wrong,[makeCase(task,[4,-7,9],[2,2],'Два требуемых значения')])[0].passed,false);
});

test('reverse odd positions are different from reversing the entire array or testing values',()=>{
  const task=tasks.find(t=>t.id==='3-2');
  const array=[8,3,10,5,12,7];
  const sample=makeCase(task,array,undefined,'Чётные значения на нечётных местах');
  const result=assertAccepted(task,sample);
  assert.equal(normalize(result.actual),'12 10 8');
  assert.deepEqual(runPascal(task.solution,sample.input).variables.a.values.slice(0,array.length),array);
});

test('sum of squares counts negative values as positive contributions',()=>{
  const task=tasks.find(t=>t.id==='4-1');
  assertAccepted(task,makeCase(task,[-3,0,4],undefined,'Квадраты дают 25, не сумму 1'));
});

test('negative-only sum excludes zero and every positive value',()=>{
  const task=tasks.find(t=>t.id==='4-2');
  for(const array of [[2,0,9],[-5,0,8,-2],[-7]]) assertAccepted(task,makeCase(task,array,undefined,'Сумма отрицательных'));
});

test('strict threshold excludes elements equal to x and can find no matches',()=>{
  const task=tasks.find(t=>t.id==='5-1');
  for(const [array,x] of [[[2,2,3],2],[[-4,-4],-4],[[0,0],0],[[1,2,3],1000]]) {
    assertAccepted(task,makeCase(task,array,x,'Строго больше порога'));
  }
});

test('last search returns zero when absent and the final index when repeated',()=>{
  const task=tasks.find(t=>t.id==='5-2');
  const repeated=makeCase(task,Array(100).fill(-7),-7,'Все равны цели');
  const absent=makeCase(task,Array(100).fill(-7),8,'Совпадений нет');
  const results=grade(task.solution,[repeated,absent]);
  assert.deepEqual(results.map(x=>normalize(x.actual)),['100','0']);
  assert.ok(results.every(x=>x.passed));
});

test('range uses both extrema and is zero for an array of equal values',()=>{
  const task=tasks.find(t=>t.id==='6-1');
  for(const array of [[-9,-3,-7],[9,3,7],[-5,-5,-5],[42]]) assertAccepted(task,makeCase(task,array,undefined,'Размах массива'));
});

test('minimum multiplicity is neither its index nor the count of maxima',()=>{
  const task=tasks.find(t=>t.id==='6-2');
  assertAccepted(task,makeCase(task,[5,-8,5,-8,5],undefined,'Два минимума, три максимума'));
  const all=assertAccepted(task,makeCase(task,Array(100).fill(-2),undefined,'Все значения минимальны'));
  assert.equal(normalize(all.actual),'100');
});

test('grading rejects a blank editor with an error instead of marking it complete',()=>{
  const task=tasks[0];
  const results=grade('',task.tests);
  assert.equal(results.length,task.tests.length);
  assert.ok(results.every(r=>!r.passed&&typeof r.error==='string'));
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
